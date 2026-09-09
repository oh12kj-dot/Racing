//! [`Driver`] — 4 層を順に回して [`ControlInput`] を 1 つ返す唯一の公開エントリ。
//!
//! `&mut self` を取る公開メソッドは [`Driver::update`] **だけ**
//! （`sim-vehicle` の `Vehicle::step` と同じ規律）。[`sim_vehicle::VehicleState`] は
//! `&` で受け取るのみで、書き換える経路を作らない。

use crate::controller::Controller;
use crate::decision::{Decision, DriverIntent};
use crate::model::{DriverModel, DriverModelError, DriverState};
use crate::perception::{PerceivedSelf, Perception};
use crate::planner::{Plan, Planner};
use crate::SIM_DT;
use sim_line::{Corridor, PerformanceEnvelope, SpeedProfile, Trajectory};
use sim_math::{wrap_angle, Rng, Vec3};
use sim_track::{Track, TrackCoord};
use sim_vehicle::{ControlInput, VehicleParams, VehicleState, WheelIndex};
use std::collections::VecDeque;

/// 車体スリップ角がこの値（[rad]）を超えた tick は「クリーンでない」とみなす。
const CLEAN_SIDESLIP_MAX: f64 = 0.20;
/// `grip_usage_max` がこの値を超えた tick は「クリーンでない」とみなす。
const CLEAN_GRIP_MAX: f64 = 1.05;
/// `error_rate = 1.0` のときのミス発生率 [Hz]。
const MISTAKE_RATE_HZ: f64 = 0.30;
/// ミス発生時の操舵バイアスの標準偏差 [rad]（road wheel angle）。
const MISTAKE_STEER_SIGMA: f64 = 0.010;
/// ミス発生時のブレーキバイアスの標準偏差（`0..1` 相当）。
const MISTAKE_BRAKE_SIGMA: f64 = 0.05;
/// 車体ヨー誤差を測る前後差分の間隔 [m]。
const HEADING_DIFF_M: f64 = 1.0;

/// 1 tick の観測。**すべて読み出し専用の借用**。
pub struct DriverObservation<'a> {
    /// トラック幾何。
    pub track: &'a Track,
    /// 走行可能域。
    pub corridor: &'a Corridor,
    /// 目標トラジェクトリ。
    pub trajectory: &'a Trajectory,
    /// 速度プロファイル。
    pub speed_profile: &'a SpeedProfile,
    /// 自車の物理状態（読み出しのみ）。
    pub state: &'a VehicleState,
    /// 呼び出し側（TASK-2-3 では `sim-core`）が `world_to_track` で求めた真値。
    pub coord: TrackCoord,
}

/// Driver AI 本体。
pub struct Driver {
    model: DriverModel,
    state: DriverState,
    envelope: PerformanceEnvelope,
    perception: Perception,
    decision: Decision,
    planner: Planner,
    controller: Controller,
    stab_buffer: VecDeque<PerceivedSelf>,
    stab_capacity: usize,
    rng_mistake: Rng,
    rng_precision: Rng,
    // --- 読み出しキャッシュ ---
    last_intent: DriverIntent,
    last_plan: Plan,
    last_perceived: PerceivedSelf,
    last_input: ControlInput,
}

impl Driver {
    /// `VehicleParams` から [`PerformanceEnvelope`] を内部で 1 度だけ導出する。
    ///
    /// `rng` は「このドライバー個体の」系列（呼び出し側が `race.derive("driver:NN")`
    /// などで用意する）。ここから `derive` で 4 本の副系列へ分ける。**`update` の中では
    /// `derive` を呼ばない**（派生順非依存なので生成順序を変えても系列は一致する。T-AI-08）。
    pub fn new(
        model: DriverModel,
        params: &VehicleParams,
        rng: Rng,
    ) -> Result<Driver, DriverModelError> {
        model.validate()?;
        let perception = Perception::new(&model, rng.derive("perception"));
        let decision = Decision::new(rng.derive("decision"));
        let controller = Controller::new(&model, params);
        let stab_capacity = perception.stabilisation_delay_ticks() + 1;
        Ok(Driver {
            model,
            state: DriverState::initial(),
            envelope: PerformanceEnvelope::from_params(params),
            perception,
            decision,
            planner: Planner::new(),
            controller,
            stab_buffer: VecDeque::with_capacity(stab_capacity),
            stab_capacity,
            rng_mistake: rng.derive("mistake"),
            rng_precision: rng.derive("precision"),
            last_intent: DriverIntent {
                mode: crate::DriverMode::FreeAir,
                target_gap: 0.0,
                engagement: 0.0,
                risk_budget: 0.5,
                w_reference: 1.0,
                w_defensive: 0.0,
                w_overtake: 0.0,
            },
            last_plan: Plan::zeroed(),
            last_perceived: PerceivedSelf::zeroed(),
            last_input: ControlInput::default(),
        })
    }

    /// **1 Simulation Tick（[`SIM_DT`] 固定）進める。`dt` を引数に取らない。**
    ///
    /// 内部順序（決定性のため固定）:
    /// 真値の組み立て → `Perception::update` → Decision → Planner → Controller
    /// → confidence / ミス更新 → 返却。
    pub fn update(&mut self, obs: &DriverObservation<'_>) -> ControlInput {
        let truth = self.assemble_truth(obs);

        // Perception: 予見経路（遅延 + 低域ノイズ）。
        let perceived = self.perception.update(&truth);
        // 安定化経路: 遅延 0 の最新真値を短いバッファに通す（0.08 s 相当）。
        self.stab_buffer.push_front(self.perception.latest());
        while self.stab_buffer.len() > self.stab_capacity {
            self.stab_buffer.pop_back();
        }
        let stab_idx = self
            .perception
            .stabilisation_delay_ticks()
            .min(self.stab_buffer.len().saturating_sub(1));
        let stabilise = self.stab_buffer[stab_idx];

        // Decision → Planner → Controller。
        let intent = self.decision.update(&self.model, &self.state);
        let plan = self.planner.update(
            &intent,
            &perceived,
            obs.trajectory,
            obs.corridor,
            obs.speed_profile,
            obs.track,
            &self.envelope,
            &self.model,
            self.state.confidence,
        );
        let input = self.controller.update(
            &plan,
            &perceived,
            &stabilise,
            obs.trajectory,
            obs.track,
            &self.state,
            &mut self.rng_precision,
        );

        // confidence / ミス更新（次 tick 以降に効く。真値で判定する）。
        let clean = truth.within_limits
            && truth.grip_usage_max < CLEAN_GRIP_MAX
            && truth.sideslip.abs() < CLEAN_SIDESLIP_MAX;
        self.maybe_make_mistake();
        self.state.advance(clean);

        self.last_intent = intent;
        self.last_plan = plan;
        self.last_perceived = perceived;
        self.last_input = input;
        input
    }

    /// [`sim_vehicle::VehicleState`] と `coord` から「真値の [`PerceivedSelf`]」を組む。
    fn assemble_truth(&self, obs: &DriverObservation<'_>) -> PerceivedSelf {
        let s = obs.track.wrap_s(obs.coord.s);
        let speed = obs.state.forward_speed();

        // 車体ヨー誤差 = 車体ヨー − トラック接線ヨー − トラジェクトリ接線オフセット。
        let frame = obs.track.frame_at(s);
        let track_tan_yaw = (-frame.tangent.z).atan2(frame.tangent.x);
        let dt_ds = (obs.trajectory.t_at(s + HEADING_DIFF_M)
            - obs.trajectory.t_at(s - HEADING_DIFF_M))
            / (2.0 * HEADING_DIFF_M);
        let traj_heading = dt_ds.atan();
        let heading_error = wrap_angle(obs.state.yaw() - track_tan_yaw - traj_heading);

        // 車体スリップ角 beta。+ で「速度ベクトルが車体前方の右側」= 逆操舵は右（road angle 負）。
        let v: Vec3 = obs.state.velocity;
        let sideslip = if speed.abs() < 0.5 {
            0.0
        } else {
            let v_fwd = v.dot(obs.state.forward());
            let v_right = v.dot(obs.state.right());
            v_right.atan2(v_fwd.max(1e-3))
        };

        let grip_usage_max = WheelIndex::ALL
            .iter()
            .map(|&w| obs.state.wheels[w as usize].grip_usage)
            .fold(0.0_f64, f64::max);

        PerceivedSelf {
            s,
            t: obs.coord.t,
            speed,
            heading_error,
            sideslip,
            yaw_rate: obs.state.angular_velocity.y,
            grip_usage_max,
            within_limits: obs.track.is_within_limits(obs.coord),
        }
    }

    /// `error_rate` の確率でミスバイアスを発生させる（「原因」への作用）。
    fn maybe_make_mistake(&mut self) {
        let p_tick =
            (self.model.error_rate.clamp(0.0, 1.0) * MISTAKE_RATE_HZ * SIM_DT).clamp(0.0, 1.0);
        if p_tick > 0.0 && self.rng_mistake.bool_with_probability(p_tick) {
            let spread = (1.0 - self.model.consistency).clamp(0.0, 1.0) + 0.25;
            self.state.mistake_steer_bias =
                self.rng_mistake.normal(0.0, MISTAKE_STEER_SIGMA * spread);
            self.state.mistake_brake_bias =
                self.rng_mistake.normal(0.0, MISTAKE_BRAKE_SIGMA * spread);
            self.state.ticks_since_mistake = 0;
        }
    }

    /// 能力値（読み出し）。
    pub fn model(&self) -> &DriverModel {
        &self.model
    }
    /// 動的状態（読み出し）。
    pub fn driver_state(&self) -> &DriverState {
        &self.state
    }
    /// 直近の意図（読み出し）。
    pub fn intent(&self) -> &DriverIntent {
        &self.last_intent
    }
    /// 直近の計画（読み出し）。
    pub fn plan(&self) -> &Plan {
        &self.last_plan
    }
    /// 直近の認知自車状態（読み出し）。
    pub fn perceived(&self) -> &PerceivedSelf {
        &self.last_perceived
    }
    /// 直近の出力（読み出し）。
    pub fn last_input(&self) -> ControlInput {
        self.last_input
    }
}
