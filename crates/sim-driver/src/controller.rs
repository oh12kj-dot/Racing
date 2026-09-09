//! Controller 層 — Pure Pursuit + 曲率フィードフォワード + 逆操舵 + 縦方向 + 変速。
//!
//! **構造的保証（省略禁止）**: steer / throttle / brake の 3 系統はすべて
//! [`move_towards`] を通してから出力する（T-AI-02 / 受け入れ基準 11）。
//! `v_target` のクランプは [`crate::Planner`]、`t_target` のクランプは
//! [`sim_line::Corridor`] が唯一の出口。ここでは再クランプしない。
//!
//! 符号の規約（内部の road-wheel angle は **+ が左**。`ARCHITECTURE.md` §3 / §6）:
//! - トラジェクトリ曲率は左カーブが正 → `delta_ff = atan(L·κ)` は左カーブで正。
//! - 逆操舵は滑りと逆符号（`beta` + すなわちオーバーステア気味 → road angle は右=負）。
//! - 出力 [`ControlInput::steer`] は **+ が右** なので `steer = -delta_road / max_steer_angle`。

use crate::model::{DriverModel, DriverState};
use crate::perception::PerceivedSelf;
use crate::planner::Plan;
use crate::SIM_DT;
use sim_line::Trajectory;
use sim_math::{approach_exponential, clamp, lerp, move_towards, saturate, Rng};
use sim_track::Track;
use sim_vehicle::{ControlInput, VehicleParams, AIR_DENSITY, GRAVITY};

/// 逆操舵が立ち上がる車体スリップ角の基準 [rad]。`cornering_skill` でスケールする。
const BETA_LIMIT_RAD: f64 = 0.12;
/// 逆操舵ゲイン（road wheel angle [rad] / スリップ角 [rad]）。
const K_COUNTERSTEER: f64 = 0.9;
/// ヘディング誤差フィードバックのゲイン（road wheel angle [rad] / [rad]）。
///
/// `ARCHITECTURE.md` §6 Perception 表の「安定化（Controller の逆操舵・**ヨー減衰**）」。
/// Pure Pursuit は予見経路（`reaction_time` 遅延）に載るため、短遅延の安定化経路で
/// ヘディングとヨーレートを内側ループとして押さえないと weave する。
///
/// TASK-2-3 Part F: 運動学プラント向けの `0.55` は実物理（実タイヤの緩和 + 荷重移動で
/// 実効遅れが増える）では高速直進で `-K_HEADING·he` が共振周波数で正帰還になり、
/// ヨーレートが 1 Hz で発散した（s≈500 以降・50 m/s で観測）。`0.30` へ下げて安定化。
const K_HEADING: f64 = 0.30;
/// 余剰ヨーレート減衰のゲイン（road wheel angle [rad] / [rad/s]）。
const K_YAW_DAMP: f64 = 0.16;
/// アンダーステア勾配 [rad / (m/s²)]。要求横加速度に比例して舵角を足す（PDC-5）。
///
/// 実車のアンダーステア勾配は 0.001〜0.003 rad/(m/s²) 程度。ダウンフォース込みの
/// このマシンはやや低めから。TASK-2-3 で実物理に合わせて調整する。
const K_UNDERSTEER: f64 = 0.0018;
/// スロットル P ゲイン（速度誤差 [m/s] / 実効速度 [m/s]）。
const K_THROTTLE: f64 = 2.2;
/// ブレーキ P ゲイン。
const K_BRAKE: f64 = 1.4;
/// ブレーキ誤差の正規化スケール [m/s]。
const BRAKE_SCALE_MS: f64 = 8.0;
/// ペダル・スロットルのデッドバンド [m/s]（ヒステリシス付き）。
const DEADBAND_MS: f64 = 0.3;
/// トレイルブレーキングの最小残し割合。
const TRAIL_MIN: f64 = 0.35;
/// トレイルブレーキングが効き始めるトラジェクトリ曲率 [1/m]。
const KAPPA_TRAIL: f64 = 0.03;
/// 発進クラッチを当てる速度上限 [m/s]。
const LAUNCH_SPEED_MS: f64 = 3.0;
/// 静止発進時のクラッチ値（`0` = 全接続 / `1` = 全切断）。
///
/// `speed = 0` では `1 - speed/LAUNCH_SPEED_MS` が恒等的に `1.0`（全切断）になり
/// `axle_torque ≡ 0` で車が動けない（`sim-vehicle` の `engaged = 1 - clutch`）。
/// 半クラッチのバイト点から始めて `LAUNCH_SPEED_MS` で全接続へ閉じる。
/// TASK-2-3 契約 PDC-1（Architect 承認 2026-09-09）。この値は Part F の
/// 調整対象（範囲 `[0.3, 1.0]`）。エンジン回転は idle にクランプされるため
/// バイト点を上げたときの制約はエンジンのボギングではなく駆動輪のホイールスピン。
const LAUNCH_CLUTCH_BITE: f64 = 0.6;
/// アップシフト回転数割合（`limiter_rpm` に対する）。
///
/// TASK-2-3 Part F: `0.97` からわずかに下げる（`[0.90, 0.97]` の範囲で Architect 承認）。
/// 変速には `shift_time_s` のトルクカット時間があるので、リミッターに当ててから
/// 上げるより少し早めに上げたほうが実効加速がよい。トラクション制限（PDC-3）が
/// 効いたあとは `est_rpm`（車速由来）はほぼ正確で、リミッター当てが残る場合は
/// それ自体が Design Concern 2 の証拠として T-CORE-AI-07 で数値報告する
/// （しきい値を下げて隠さない）。
const UPSHIFT_FRACTION: f64 = 0.95;
/// トラクション制限に使う縦グリップの摩擦係数。
///
/// TASK-2-3 PDC-3 / PDC-4（Architect 承認 2026-09-09）。`sim-core` の `RacingLine` が
/// SpeedProfile 用に使う実効 μ（`mu0 / (1 + LS·0.5)` = `1.50 / 1.14` ≒ 1.316）と揃える。
/// 縦横で同じグリップ像を使わないと、片方を最適化するともう片方が破綻する
/// （実際に、SpeedProfile が楽観的 μ、こちらが保守的 μ で T2/T3 を曲がれなかった）。
const MU_TRACTION: f64 = 1.316;
/// スライド中にスロットル上限を絞る深さ（`0` = 絞らない / `1` = 全閉）。
///
/// TASK-2-3 PDC-3 随伴（Architect 承認）: 元は式中のリテラル `0.3` で、`beta` しきい値を
/// またぐたびに 1.0↔0.3 のバンバン制御になり縦荷重移動で横方向を揺すっていた。深さを
/// 浅くして名前付き定数にする。実際の絞りはこの後の `move_towards`（`pedal_rate`）で
/// レート制限されるので過渡は滑らか。
const SLIDE_CUT_DEPTH: f64 = 0.5;
/// ダウンシフト後に許す最大回転数割合。
const DOWNSHIFT_TARGET_FRACTION: f64 = 0.92;
/// ダウンシフトを起動する現在ギアの回転数割合（これを下回ると 1 段落とす）。
const DOWNSHIFT_TRIGGER_FRACTION: f64 = 0.60;
/// 変速の最小滞在時間 [s]（ハンチング防止）。
const MIN_GEAR_DWELL_S: f64 = 0.25;
/// 入力精度ノイズの低域通過時定数 [s]。
const PRECISION_NOISE_TAU: f64 = 0.5;
/// `consistency = 0` のときの操舵精度ノイズの標準偏差（正規化操舵 `-1..1` に対して）。
const STEER_NOISE_MAX: f64 = 0.02;

/// 縦方向のモード（デッドバンドのヒステリシス用）。
#[derive(Clone, Copy, PartialEq, Eq)]
enum LongMode {
    Coast,
    Throttle,
    Brake,
}

/// Controller 層の状態。
pub struct Controller {
    // --- 車両定数（`new` で `VehicleParams` から写す）---
    wheelbase: f64,
    max_steer_angle: f64,
    gear_ratios: Vec<f64>,
    final_drive: f64,
    limiter_rpm: f64,
    tyre_radius: f64,
    // --- トラクション制限フィードフォワード（PDC-3）---
    mass_kg: f64,
    /// リア軸の静的荷重配分 `0..1`。
    rear_weight_frac: f64,
    /// リアのダウンフォース係数 × 前面投影面積 [m^2]。`F_down_rear = 0.5 ρ v² · cl_a_rear`。
    cl_a_rear: f64,
    /// トルクカーブのピーク値 [Nm]（フルスロットル駆動力の保守的な見積もりに使う）。
    peak_drive_torque: f64,
    /// 駆動系伝達効率 `0..1`。
    driveline_eff: f64,
    // --- ドライバー由来のゲイン ---
    precision: f64,
    cornering_skill: f64,
    braking_skill: f64,
    consistency: f64,
    // --- 内部状態 ---
    prev_steer: f64,
    steer_filt: f64,
    steer_noise: f64,
    prev_throttle: f64,
    prev_brake: f64,
    long_mode: LongMode,
    current_gear: i8,
    gear_dwell: u32,
    min_gear_dwell: u32,
}

impl Controller {
    /// `model` からゲイン、`params` から車両定数を写して構築する。
    pub fn new(model: &DriverModel, params: &VehicleParams) -> Controller {
        Controller {
            wheelbase: params.dimensions.wheelbase,
            max_steer_angle: params.steering.max_steer_angle,
            gear_ratios: params.drivetrain.gear_ratios.clone(),
            final_drive: params.drivetrain.final_drive,
            limiter_rpm: params.engine.limiter_rpm,
            tyre_radius: 0.5 * (params.tyre.front.radius + params.tyre.rear.radius),
            mass_kg: params.mass.total_kg,
            rear_weight_frac: (1.0 - params.mass.distribution_front).clamp(0.0, 1.0),
            cl_a_rear: params.aero.cl_rear * params.aero.frontal_area,
            peak_drive_torque: params
                .engine
                .torque_curve
                .iter()
                .map(|pt| pt[1])
                .fold(0.0_f64, f64::max),
            driveline_eff: params.drivetrain.driveline_efficiency,
            precision: model.precision().clamp(0.0, 1.0),
            cornering_skill: model.cornering_skill.clamp(0.0, 1.0),
            braking_skill: model.braking_skill.clamp(0.0, 1.0),
            consistency: model.consistency.clamp(0.0, 1.0),
            prev_steer: 0.0,
            steer_filt: 0.0,
            steer_noise: 0.0,
            prev_throttle: 0.0,
            prev_brake: 0.0,
            long_mode: LongMode::Coast,
            current_gear: 1,
            gear_dwell: u32::MAX / 2,
            min_gear_dwell: (MIN_GEAR_DWELL_S / SIM_DT).ceil() as u32,
        }
    }

    /// 現在ギア（読み出し）。
    pub fn gear(&self) -> i8 {
        self.current_gear
    }

    /// 1 Simulation Tick 分の操作を生成する。**`dt` を引数に取らない**（[`SIM_DT`] 固定）。
    ///
    /// `perceived` は予見経路（遅い）、`stabilise` は安定化経路（短遅延）。
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        plan: &Plan,
        perceived: &PerceivedSelf,
        stabilise: &PerceivedSelf,
        trajectory: &Trajectory,
        track: &Track,
        state: &DriverState,
        rng: &mut Rng,
    ) -> ControlInput {
        // ================= 横方向 =================
        // 1) Pure Pursuit。aim 点を車両ローカルへ写して曲率を作る。
        let he = perceived.heading_error;
        // Planner がクランプ済みの aim_s を渡すが、ラップ済みであることをここでも保証する。
        let aim_s = track.wrap_s(plan.aim_s);
        let aim_t = trajectory.t_at(aim_s);
        let lon = plan.lookahead_m.max(1e-3);
        let lat = aim_t - perceived.t; // + が左
        let x_v = he.cos() * lon + he.sin() * lat;
        let y_v = -he.sin() * lon + he.cos() * lat; // + が左（車両ローカル）
        let alpha = y_v.atan2(x_v.max(1e-3));
        let delta_pp = (2.0 * self.wheelbase * alpha.sin()).atan2(plan.lookahead_m.max(1e-3));

        // 2) 曲率フィードフォワード（トラジェクトリ曲率。センターライン曲率は使わない）。
        //
        // Ackermann 項 `atan(L·κ)` はスリップ角ゼロのプラント（TASK-2-2 の運動学自転車）
        // でだけ正しく、実タイヤでは高速コーナーで舵不足になる（`δ = L/R + K_us·a_lat`）。
        // アンダーステア勾配項を要求横加速度 `a_lat = v²·κ_traj` から足す（TASK-2-3 PDC-5・
        // Architect 承認 2026-09-09）。フィードフォワードなので位相遅れを持ち込まない。
        let kappa_traj = trajectory.curvature_at(perceived.s);
        let a_lat_demand = perceived.speed * perceived.speed * kappa_traj;
        let delta_ff = clamp(
            (self.wheelbase * kappa_traj).atan() + K_UNDERSTEER * a_lat_demand,
            -self.max_steer_angle,
            self.max_steer_angle,
        );

        // 3) 逆操舵（TASK-1B-1 C-1 対策・必須）。安定化経路の beta を使う。
        let beta = stabilise.sideslip;
        let beta_lim = BETA_LIMIT_RAD * lerp(0.8, 1.2, self.cornering_skill);
        let excess = (beta.abs() - beta_lim).max(0.0);
        let delta_cs = -K_COUNTERSTEER * beta.signum() * excess;
        // スライド中はスロットル上限を絞る（無いと限界付近で素直にスピンする）。
        // 滑らかに絞る（PDC-3 随伴。深さは SLIDE_CUT_DEPTH、過渡は後段の move_towards）。
        let throttle_slide_cap = 1.0 - SLIDE_CUT_DEPTH * saturate(excess / beta_lim);

        // 3b) ヘディング / ヨーレート安定化（安定化経路 = 短遅延）。
        //     heading_error + = 車体が目標より左 → 右へ戻す（road angle 負）。
        //     必要ヨーレート ≈ speed·κ_traj。それを超える分だけ減衰する。
        let desired_yaw_rate = stabilise.speed * kappa_traj;
        let delta_hd = -K_HEADING * stabilise.heading_error
            - K_YAW_DAMP * (stabilise.yaw_rate - desired_yaw_rate);

        // 4) 合成 → 正規化。road-wheel angle は + が左、steer 出力は + が右。
        let delta_target = delta_pp + delta_ff + delta_cs + delta_hd + state.mistake_steer_bias;
        let mut steer_raw = clamp(-delta_target / self.max_steer_angle, -1.0, 1.0);

        // 入力精度ノイズ（「原因」にのみ作用。低域に落としてから足す）。
        let noise_target = rng.normal(0.0, STEER_NOISE_MAX * (1.0 - self.consistency).max(0.0));
        self.steer_noise =
            approach_exponential(self.steer_noise, noise_target, PRECISION_NOISE_TAU, SIM_DT);
        steer_raw = clamp(steer_raw + self.steer_noise, -1.0, 1.0);

        // 5) ★構造的保証: レート制限 → 腕の一次遅れ。
        //    max_steer_rate / STEER_TAU は precision に依存（§6）。
        //    VehicleParams::steering.time_constant は「ラックの機構遅れ」であって
        //    「ドライバーの腕」ではない。役割が違うので二重補正ではない。
        let max_steer_rate = lerp(2.5, 6.0, self.precision); // [1/s]
        let steer_tau = lerp(0.10, 0.04, self.precision); // [s]
        let rate_limited = move_towards(self.prev_steer, steer_raw, max_steer_rate * SIM_DT);
        self.steer_filt = approach_exponential(self.steer_filt, rate_limited, steer_tau, SIM_DT);
        let steer = self.steer_filt;
        self.prev_steer = steer;

        // ================= 縦方向 =================
        let e = plan.v_target - perceived.speed;
        // デッドバンド + ヒステリシス。
        self.long_mode = match self.long_mode {
            LongMode::Throttle if e < -DEADBAND_MS => LongMode::Brake,
            LongMode::Brake if e > DEADBAND_MS => LongMode::Throttle,
            LongMode::Coast if e > DEADBAND_MS => LongMode::Throttle,
            LongMode::Coast if e < -DEADBAND_MS => LongMode::Brake,
            other => other,
        };
        let (mut throttle_raw, mut brake_raw) = match self.long_mode {
            LongMode::Throttle => (saturate(K_THROTTLE * e / perceived.speed.max(5.0)), 0.0),
            LongMode::Brake => (0.0, saturate(K_BRAKE * (-e) / BRAKE_SCALE_MS)),
            LongMode::Coast => (0.0, 0.0),
        };

        // トレイルブレーキング（§6）。下手なドライバーは進入で残せない。
        let trail = lerp(1.0, TRAIL_MIN, saturate(kappa_traj.abs() / KAPPA_TRAIL));
        let reduction = (1.0 - trail) * lerp(1.0, 0.6, self.braking_skill);
        brake_raw *= 1.0 - reduction;
        brake_raw = saturate(brake_raw + state.mistake_brake_bias);

        // スライド中のスロットル絞り。
        throttle_raw = throttle_raw.min(throttle_slide_cap);

        // トラクション制限フィードフォワード（PDC-3・Architect 承認 2026-09-09）。
        // フルスロットル要求がリアタイヤのグリップ円（縦方向の残り）を超えるときだけ
        // スロットル上限を絞る。**`v_target` には一切触らない**（Planner + SpeedProfile が
        // 唯一の権限。ここは「いま何割開けてよいか」だけを決める）。
        // バンク / 標高勾配の補正はしない（二重補正禁止。SpeedProfile の担当）。
        throttle_raw = throttle_raw.min(self.traction_throttle_cap(stabilise.speed, kappa_traj));

        // ★構造的保証: ペダルもレート制限を通す。
        let pedal_rate = lerp(3.0, 8.0, self.precision); // [1/s]
        let throttle = move_towards(self.prev_throttle, throttle_raw, pedal_rate * SIM_DT);
        let brake = move_towards(self.prev_brake, brake_raw, pedal_rate * SIM_DT);
        self.prev_throttle = throttle;
        self.prev_brake = brake;

        // ================= ギア / クラッチ =================
        let speed = perceived.speed.max(0.0);
        self.update_gear(speed);
        let clutch = if speed < LAUNCH_SPEED_MS && self.current_gear == 1 {
            // 半クラッチ発進: バイト点から始めて LAUNCH_SPEED_MS で全接続へ閉じる。
            LAUNCH_CLUTCH_BITE * (1.0 - saturate(speed / LAUNCH_SPEED_MS))
        } else {
            0.0
        };

        ControlInput {
            steer,
            throttle,
            brake,
            clutch,
            gear: self.current_gear,
            drs: false, // Phase 2 は常に false。
        }
    }

    /// トラクション制限フィードフォワード（PDC-3）。
    ///
    /// フルスロットルで現在ギアが要求する駆動力が、リアタイヤのグリップ円の
    /// 縦方向の残り（横力を摩擦円で差し引いたあと）を超えるとき、その比で
    /// スロットル上限を返す（超えないなら `1.0`）。**グリップは低めに、駆動力は
    /// ピークトルクで高めに見積もる**（保守側）。`v_target` は変えない。
    fn traction_throttle_cap(&self, speed: f64, kappa_traj: f64) -> f64 {
        let v = speed.max(0.0);

        // リア軸で使えるグリップ [N]（静荷重 + ダウンフォース）。
        let rear_static = self.mass_kg * GRAVITY * self.rear_weight_frac;
        let rear_downforce = 0.5 * AIR_DENSITY * v * v * self.cl_a_rear;
        let rear_grip = MU_TRACTION * (rear_static + rear_downforce);

        // 軌跡追従に要る横力のうちリア軸の負担分（静的配分で近似）。
        let lat_force = self.mass_kg * v * v * kappa_traj.abs();
        let rear_lat = lat_force * self.rear_weight_frac;

        // 摩擦円の残り = 縦方向に使えるリアグリップ。
        let long_avail = (rear_grip * rear_grip - rear_lat * rear_lat)
            .max(0.0)
            .sqrt();

        // 現在ギアでフルスロットルが要求する駆動力（ピークトルクで保守的に）。
        let gi = (self.current_gear.max(1) as usize - 1).min(self.gear_ratios.len() - 1);
        let drive_full =
            self.peak_drive_torque * self.gear_ratios[gi] * self.final_drive * self.driveline_eff
                / self.tyre_radius.max(1e-3);

        if drive_full > long_avail && drive_full > 1.0 {
            saturate(long_avail / drive_full)
        } else {
            1.0
        }
    }

    /// 現在速度から推定エンジン回転数 [rpm]。`gear` は前進ギア番号（1..=n）。
    fn est_rpm(&self, gear: i8, speed: f64) -> f64 {
        if gear < 1 {
            return 0.0;
        }
        let ratio = self.gear_ratios[(gear as usize - 1).min(self.gear_ratios.len() - 1)];
        let wheel_rps = speed / self.tyre_radius.max(1e-3) / (2.0 * std::f64::consts::PI);
        wheel_rps * ratio * self.final_drive * 60.0
    }

    /// 変速の状態機械（`limiter_rpm` 割合 + 最小滞在時間ヒステリシス）。
    fn update_gear(&mut self, speed: f64) {
        let n = self.gear_ratios.len() as i8;
        if self.gear_dwell >= self.min_gear_dwell {
            let cur = self.est_rpm(self.current_gear, speed);
            if self.current_gear < n && cur > UPSHIFT_FRACTION * self.limiter_rpm {
                self.current_gear += 1;
                self.gear_dwell = 0;
            } else if self.current_gear > 1 {
                let post = self.est_rpm(self.current_gear - 1, speed);
                if cur < DOWNSHIFT_TRIGGER_FRACTION * self.limiter_rpm
                    && post < DOWNSHIFT_TARGET_FRACTION * self.limiter_rpm
                {
                    self.current_gear -= 1;
                    self.gear_dwell = 0;
                }
            }
        }
        self.gear_dwell = self.gear_dwell.saturating_add(1);
    }
}
