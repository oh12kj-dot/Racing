//! 運動学プラント（自転車モデル）のテストハーネス。
//!
//! **これは Driver の制御ループを実トラック幾何に対して検証するためのハーネスであり、
//! `sim-vehicle` の代替ではない。** 車両は `(s, t, yaw_err, v)` の 4 状態の自転車
//! モデルで、`ControlInput` を実舵角・縦加速度へ写す最小限の写像で `SIM_DT` 固定で回す。
//! 実車両・実路面の閉ループ検証は TASK-2-3 が担当する（`sim-driver` は `sim-core` に
//! 依存できない = 依存グラフの循環禁止）。

#![allow(dead_code)]

use sim_driver::{Driver, DriverModel, DriverObservation, SIM_DT};
use sim_line::{Corridor, PerformanceEnvelope, SpeedProfile, Trajectory};
use sim_math::{wrap_angle, Quat, Rng, Vec3};
use sim_track::{load_track, Track, TrackCoord};
use sim_vehicle::{ControlInput, VehicleParams, VehicleState, WheelIndex, WheelState};

pub const SPEC_JSON: &str = include_str!("../../../../assets/vehicles/gt_proto_a.spec.json");
/// レーシングラインのサンプリング間隔 [m]。
pub const LINE_STEP_M: f64 = 2.0;
/// プラントがこの `|t|` [m] を超えたら「場外へ発散」とみなして panic する。
pub const TRACK_ENVELOPE_M: f64 = 500.0;

/// 束ねた Aoyama Ring。
pub fn track() -> Track {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("tracks")
        .join("aoyama_ring.track.json");
    load_track(path).expect("bundled circuit loads and validates")
}

/// gt_proto_a の車両パラメータ。
pub fn params() -> VehicleParams {
    VehicleParams::from_json_str(SPEC_JSON).expect("gt_proto_a.spec.json loads and validates")
}

/// レーシングライン一式（起動時 1 回だけ生成する想定。テストでも 1 回で足りる）。
pub struct Line {
    pub corridor: Corridor,
    pub trajectory: Trajectory,
    pub speed: SpeedProfile,
    pub envelope: PerformanceEnvelope,
}

impl Line {
    pub fn build(track: &Track, params: &VehicleParams) -> Line {
        let half_w = 0.5 * params.dimensions.width;
        let corridor = Corridor::from_track(track, LINE_STEP_M, half_w, 0.20);
        let trajectory = Trajectory::reference(&corridor, track, LINE_STEP_M);
        let envelope = PerformanceEnvelope::from_params(params);
        let speed = SpeedProfile::generate(&trajectory, track, &envelope, LINE_STEP_M);
        Line {
            corridor,
            trajectory,
            speed,
            envelope,
        }
    }
}

/// `race_seed` から個体系列を作る。異なる `driver_ix` は異なる系列になる。
pub fn driver_rng(race_seed: u64, driver_ix: u32) -> Rng {
    Rng::from_seed(race_seed).derive(&format!("driver:{driver_ix:02}"))
}

/// 自転車モデルのプラント。
pub struct Plant<'a> {
    track: &'a Track,
    params: &'a VehicleParams,
    envelope: PerformanceEnvelope,
    wheelbase: f64,
    max_steer_angle: f64,
    a_brake_max: f64,
    cd_a: f64,
    cl_a_total: f64,
    mass: f64,
    mu: f64,
    // 状態
    pub s: f64,
    pub t: f64,
    pub yaw_err: f64,
    pub v: f64,
    yaw_rate_world: f64,
}

impl<'a> Plant<'a> {
    /// S/F ストレート上・ローリングスタートで構築する（TASK-1B-4 の spawn 姿勢完全化は
    /// 保留のため、グリッドは S/F ストレートに置く前提）。
    pub fn spawn(track: &'a Track, params: &'a VehicleParams, line: &Line) -> Plant<'a> {
        let envelope = PerformanceEnvelope::from_params(params);
        let s0 = track.start_finish_s();
        let t0 = line.trajectory.t_at(s0);
        // ローリングスタートだが、制御ループが温まる前に第 1 コーナーへ突っ込まない
        // よう控えめな初速にする（TASK-1B-4 の spawn 姿勢完全化は保留。lap 1 は破棄）。
        let v0 = (0.35 * line.speed.v_at(s0)).min(20.0);
        Plant {
            track,
            params,
            wheelbase: params.dimensions.wheelbase,
            max_steer_angle: params.steering.max_steer_angle,
            a_brake_max: envelope.max_brake_decel,
            cd_a: envelope.cd_a,
            cl_a_total: envelope.cl_a_total,
            mass: envelope.mass_kg,
            mu: envelope.mu,
            envelope,
            s: s0,
            t: t0,
            yaw_err: 0.0,
            v: v0,
            yaw_rate_world: 0.0,
        }
    }

    /// 1 tick 進める。
    pub fn step(&mut self, input: &ControlInput) {
        let g = sim_vehicle::GRAVITY;
        let rho = sim_vehicle::AIR_DENSITY;
        let delta_road = -input.steer.clamp(-1.0, 1.0) * self.max_steer_angle; // + が左

        // ダウンフォースによるグリップ増（SpeedProfile と同じモデル。無いと
        // SpeedProfile が許した速度でプラントが曲がりきれず系統的に膨らむ）。
        let downforce = 0.5 * rho * self.v * self.v * self.cl_a_total;
        let g_eff = g + downforce / self.mass;

        // 縦方向。トラクション上限つきの駆動加速度 + 制動 + 抗力 + 惰行。
        let a_drive_cap = self.mu * g_eff; // トラクション上限
        let a_power = self.envelope.max_power_w / (self.mass * self.v.max(8.0));
        let a_drive = a_power.min(a_drive_cap);
        let drag_dec = 0.5 * rho * self.v * self.v * self.cd_a / self.mass;
        let coast = if input.throttle < 1e-3 && input.brake < 1e-3 {
            0.4
        } else {
            0.0
        };
        let a = input.throttle.clamp(0.0, 1.0) * a_drive
            - input.brake.clamp(0.0, 1.0) * self.a_brake_max
            - drag_dec
            - coast;

        // 幾何。センターライン曲率で弧長レートとトラック接線の回転レートを作る。
        let kappa_c = self.track.frame_at(self.s).curvature;
        let one_minus = (1.0 - kappa_c * self.t).max(0.2);
        let s_dot = self.v * self.yaw_err.cos() / one_minus;
        let t_dot = self.v * self.yaw_err.sin();
        // ヨーレートはグリップ円で頭打ちにする。純粋な運動学自転車モデルは
        // `v/L·tan δ` が高速で発散し、どんな制御則でも駆動できない（実車はタイヤ
        // グリップが横加速度を `mu·g` に制限する）。この頭打ちが Speed Profile 由来の
        // `v_target` を意味あるものにする。`common/mod.rs` の doc も参照。
        let yaw_rate_kin = self.v / self.wheelbase * delta_road.tan();
        let yaw_rate_cap = (self.mu * g_eff) / self.v.max(3.0);
        self.yaw_rate_world = yaw_rate_kin.clamp(-yaw_rate_cap, yaw_rate_cap);
        let track_heading_rate = s_dot * kappa_c;
        let yaw_err_dot = self.yaw_rate_world - track_heading_rate;

        self.s = self.track.wrap_s(self.s + s_dot * SIM_DT);
        self.t += t_dot * SIM_DT;
        self.yaw_err = wrap_angle(self.yaw_err + yaw_err_dot * SIM_DT);
        self.v = (self.v + a * SIM_DT).max(0.0);
    }

    /// トラック座標（真値）。
    pub fn coord(&self) -> TrackCoord {
        TrackCoord::new(self.s, self.t)
    }

    /// Driver へ渡す合成 `VehicleState`。運動学モデルなので横滑りは 0。
    pub fn vehicle_state(&self, input: &ControlInput) -> VehicleState {
        let frame = self.track.frame_at(self.s);
        let track_tan_yaw = (-frame.tangent.z).atan2(frame.tangent.x);
        let car_yaw = track_tan_yaw + self.yaw_err;
        let orientation = Quat::from_euler_yxz(car_yaw, 0.0, 0.0);
        let forward = orientation * Vec3::X;
        let position = self.track.track_to_world(self.coord());
        let velocity = forward * self.v;

        // 横加速度からグリップ使用率を近似（confidence ロジックが読む）。
        let lat_acc = self.v * self.v * self.track.frame_at(self.s).curvature.abs();
        let grip = lat_acc / (self.mu * sim_vehicle::GRAVITY);
        let mut wheels = [WheelState::default(); 4];
        let static_load = 0.25 * self.mass * sim_vehicle::GRAVITY;
        for &w in &WheelIndex::ALL {
            wheels[w as usize].grip_usage = grip;
            wheels[w as usize].load = static_load;
            wheels[w as usize].grounded = true;
        }

        VehicleState {
            position,
            orientation,
            velocity,
            angular_velocity: Vec3::new(0.0, self.yaw_rate_world, 0.0),
            wheels,
            engine_rpm: 0.0,
            gear: input.gear,
            last_input: *input,
            aero_downforce: 0.0,
            recovered_steps: 0,
        }
    }
}

/// 1 台を `laps` 周ぶん走らせ、周回タイムと操舵時系列を集める。
pub struct RunResult {
    /// 各周のラップタイム [s]（周回 1 = 最初の完全ラップ）。
    pub lap_times: Vec<f64>,
    /// steer 時系列（全 tick）。
    pub steer: Vec<f64>,
    /// throttle 時系列（全 tick）。
    pub throttle: Vec<f64>,
    /// v_target 時系列（全 tick）。
    pub v_target: Vec<f64>,
    /// v_at(s)（物理限界）時系列（全 tick）。
    pub v_cap: Vec<f64>,
    /// (s, t) 時系列（全 tick）。
    pub st: Vec<(f64, f64)>,
    /// 全 tick の `ControlInput`（決定性・変速検証用）。
    pub inputs: Vec<ControlInput>,
    /// `driver.driver_state().mistake_steer_bias` の絶対値の最大（全 tick）。
    pub max_mistake_bias: f64,
    /// trajectory 曲率が正（左）で最大の tick の steer と、負（右）で最小の tick の steer。
    pub steer_at_left_corner: f64,
    pub steer_at_right_corner: f64,
    /// t_target 時系列（全 tick）。
    pub t_target: Vec<f64>,
    /// limit_bounds を超えた最大逸脱量 [m]（0 なら常に内側）。
    pub max_limit_excursion: f64,
    /// 最大逸脱が起きた弧長 `s`。
    pub max_excursion_s: f64,
    /// t_target が clamp_limits の外側にあった最大量 [m]。
    pub max_t_target_violation: f64,
}

/// `max_ticks` を上限に `laps` 周走らせる。発散（NaN・場外へ大きく逸脱）したら panic。
pub fn run_laps(
    track: &Track,
    params: &VehicleParams,
    line: &Line,
    model: DriverModel,
    rng: Rng,
    laps: usize,
    max_ticks: usize,
) -> RunResult {
    let mut driver = Driver::new(model, params, rng).expect("valid driver model");
    let mut plant = Plant::spawn(track, params, line);
    let sf = track.start_finish_s();

    let mut res = RunResult {
        lap_times: Vec::new(),
        steer: Vec::new(),
        throttle: Vec::new(),
        v_target: Vec::new(),
        v_cap: Vec::new(),
        st: Vec::new(),
        inputs: Vec::new(),
        max_mistake_bias: 0.0,
        steer_at_left_corner: 0.0,
        steer_at_right_corner: 0.0,
        t_target: Vec::new(),
        max_limit_excursion: 0.0,
        max_excursion_s: 0.0,
        max_t_target_violation: 0.0,
    };
    let mut best_left_kappa = 0.0_f64;
    let mut best_right_kappa = 0.0_f64;

    let mut ticks_since_cross = 0usize;
    let mut crossed_once = false;
    let mut input = ControlInput {
        gear: 1,
        ..ControlInput::default()
    };

    for _ in 0..max_ticks {
        let vs = plant.vehicle_state(&input);
        let obs = DriverObservation {
            track,
            corridor: &line.corridor,
            trajectory: &line.trajectory,
            speed_profile: &line.speed,
            state: &vs,
            coord: plant.coord(),
        };
        input = driver.update(&obs);
        assert!(
            input.steer.is_finite() && input.throttle.is_finite() && input.brake.is_finite(),
            "control output went non-finite"
        );

        let prev_s = plant.s;
        plant.step(&input);
        assert!(
            plant.v.is_finite() && plant.t.is_finite() && plant.s.is_finite(),
            "plant state went non-finite"
        );
        assert!(
            plant.t.abs() < TRACK_ENVELOPE_M,
            "plant left the track envelope: t = {:.2} m at s = {:.1}",
            plant.t,
            plant.s
        );

        // テレメトリ。
        res.steer.push(input.steer);
        res.throttle.push(input.throttle);
        res.v_target.push(driver.plan().v_target);
        // v_cap は「Planner がクランプに使った s」= 認知（遅延）した s での物理限界。
        // T-AI-04 の構造的保証はこの s に対して成り立つ（プラントは 1 tick で ~1 m
        // 進むため plant.s での v_at と比べると継ぎ目でわずかに超えて見える）。
        res.v_cap.push(line.speed.v_at(driver.perceived().s));
        res.st.push((plant.s, plant.t));
        res.inputs.push(input);
        res.max_mistake_bias = res
            .max_mistake_bias
            .max(driver.driver_state().mistake_steer_bias.abs())
            .max(driver.driver_state().mistake_brake_bias.abs());
        let tt = driver.plan().t_target;
        res.t_target.push(tt);

        // 左/右コーナーで最も曲率が大きい tick の steer を控える（T-DRV-02 符号検証）。
        if !res.lap_times.is_empty() {
            let kap = line.trajectory.curvature_at(plant.s);
            if kap > best_left_kappa {
                best_left_kappa = kap;
                res.steer_at_left_corner = input.steer;
            }
            if kap < best_right_kappa {
                best_right_kappa = kap;
                res.steer_at_right_corner = input.steer;
            }
        }

        // コース逸脱と t_target 逸脱は「最初の計時ラップを終えて以降」だけ測る
        // （spawn の初期過渡は TASK-1B-4 の範疇であって T-AI-01 の対象ではない）。
        if !res.lap_times.is_empty() {
            let (r, l) = line.corridor.limit_bounds(plant.s);
            let excursion = (r - plant.t).max(plant.t - l).max(0.0);
            if excursion > res.max_limit_excursion {
                res.max_limit_excursion = excursion;
                res.max_excursion_s = plant.s;
            }
            let tt_clamped = line.corridor.clamp_limits(plant.s, tt);
            res.max_t_target_violation = res.max_t_target_violation.max((tt - tt_clamped).abs());
        }

        // ラップ検出（S/F の前進通過）。
        let d = track.signed_delta_s(prev_s, plant.s);
        let crossed = d.abs() < 5.0
            && signed_delta(prev_s, sf, track.length()) <= 0.0
            && signed_delta(plant.s, sf, track.length()) > 0.0;
        if crossed {
            if crossed_once {
                res.lap_times.push(ticks_since_cross as f64 * SIM_DT);
            }
            crossed_once = true;
            ticks_since_cross = 0;
        }
        ticks_since_cross += 1;

        if res.lap_times.len() >= laps {
            break;
        }
    }
    res
}

/// `a` から `b` への符号付き差（`(-L/2, L/2]`）を弧長で。
fn signed_delta(a: f64, b: f64, len: f64) -> f64 {
    let mut d = (b - a).rem_euclid(len);
    if d > 0.5 * len {
        d -= len;
    }
    d
}

/// f64 列を `to_bits` で連結したハッシュ（決定性比較用）。
pub fn hash_f64(series: &[f64]) -> u64 {
    let mut h: u64 = 0xCBF2_9CE4_8422_2325;
    for &x in series {
        for b in x.to_bits().to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
        }
    }
    h
}

/// 標準偏差。
pub fn std_dev(xs: &[f64]) -> f64 {
    if xs.len() < 2 {
        return 0.0;
    }
    let mean = xs.iter().sum::<f64>() / xs.len() as f64;
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (xs.len() - 1) as f64;
    var.sqrt()
}
