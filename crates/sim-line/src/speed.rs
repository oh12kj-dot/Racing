//! [`SpeedProfile`] — 弧長 `s` ごとの限界速度。物理由来。乱数を使わない。

use crate::{Stations, Trajectory};
use sim_track::{Track, TrackCoord};
use sim_vehicle::{VehicleParams, AIR_DENSITY, GRAVITY};

/// 速度計画に必要な車両能力の要約。[`VehicleParams`] から一度だけ導出する。
///
/// `sim-line` が `sim-vehicle` に依存する唯一の理由。以降 `sim-vehicle` の型を
/// 持ち回らずに済むよう、必要な量だけをここへ写す。
#[derive(Clone, Copy, Debug)]
pub struct PerformanceEnvelope {
    /// 車両総質量 [kg]。
    pub mass_kg: f64,
    /// 基準摩擦係数 `mu0`（路面グリップ倍率は [`SpeedProfile::generate`] が `s` ごとに掛ける）。
    pub mu: f64,
    /// 抗力係数 × 前面投影面積 [m^2]。`F_drag = 0.5 ρ v² · cd_a`。
    pub cd_a: f64,
    /// 総ダウンフォース係数 × 前面投影面積 [m^2]。`F_down = 0.5 ρ v² · cl_a_total`。
    pub cl_a_total: f64,
    /// ブレーキトルク上限による最大減速度 [m/s^2]（ダウンフォース・空力抗力を含まない）。
    pub max_brake_decel: f64,
    /// 駆動輪の最大出力 [W]（トルクカーブのピーク × 伝達効率）。
    pub max_power_w: f64,
    /// 抗力と駆動力が釣り合う終端速度 [m/s]。
    pub v_max: f64,
}

impl PerformanceEnvelope {
    /// [`VehicleParams`] から導出する。
    pub fn from_params(p: &VehicleParams) -> PerformanceEnvelope {
        let mass_kg = p.mass.total_kg;
        let mu = p.tyre.mu0;
        let cd_a = p.aero.cd * p.aero.frontal_area;
        let cl_a_total = (p.aero.cl_front + p.aero.cl_rear) * p.aero.frontal_area;

        let tyre_radius = 0.5 * (p.tyre.front.radius + p.tyre.rear.radius);
        let brake_force =
            2.0 * (p.brakes.max_torque_front + p.brakes.max_torque_rear) / tyre_radius;
        let max_brake_decel = brake_force / mass_kg;

        // トルクカーブのピーク出力（Nm × rad/s）。
        let peak_engine_w = p
            .engine
            .torque_curve
            .iter()
            .map(|pt| pt[1] * pt[0] * (std::f64::consts::TAU / 60.0))
            .fold(0.0_f64, f64::max);
        let max_power_w = peak_engine_w * p.drivetrain.driveline_efficiency;

        // power = 0.5 ρ v³ cd_a を v について解く。
        let v_max = if cd_a > 0.0 && max_power_w > 0.0 {
            (2.0 * max_power_w / (AIR_DENSITY * cd_a)).cbrt()
        } else {
            120.0
        };

        PerformanceEnvelope {
            mass_kg,
            mu,
            cd_a,
            cl_a_total,
            max_brake_decel,
            max_power_w,
            v_max,
        }
    }
}

/// 弧長 `s` ごとの限界速度 [m/s]。コーナリング限界・ブレーキング・トラクション/パワーを
/// 合成した結果。
pub struct SpeedProfile {
    stations: Stations,
    closed: bool,
    v_max: Vec<f64>,
}

impl SpeedProfile {
    /// コーナー速度のダウンフォース反復回数。契約は「3〜5 回」だが、収束の
    /// 頭打ちを確実にするため 6 回に固定した（起動時 1 回・コスト無視できる）。
    const DF_ITERS: u32 = 6;
    /// 直線とみなす曲率の下限 [1/m]。
    const KAPPA_MIN: f64 = 1.0e-5;
    /// 限界速度の下限 [m/s]（停止を計画に入れない）。
    const V_MIN: f64 = 1.0;

    /// [`Trajectory`] の曲率と [`Track`] のバンク・路面グリップ、[`PerformanceEnvelope`]
    /// から決定的に生成する。
    ///
    /// 手順（`ARCHITECTURE.md` §4「Speed Profile の生成」）:
    /// 1. 各 `s` で横 G 限界から `v_corner`。ダウンフォースが `v` 依存なので反復収束。
    /// 2. **後退パス**: ブレーキ減速度限界を上流へ伝播（ブレーキングポイントが決まる）。
    /// 3. **前進パス**: トラクション/パワー限界を下流へ伝播（脱出加速が決まる）。
    ///
    /// 閉トラックでは前後パスとも 2 周ぶん回して周回境界で固定点に落とす。
    pub fn generate(
        trajectory: &Trajectory,
        track: &Track,
        envelope: &PerformanceEnvelope,
        step_m: f64,
    ) -> SpeedProfile {
        let stations = Stations::new(track.length(), step_m);
        let n = stations.count;
        let h = stations.step;

        // 各ステーションの幾何・路面を先に固定。
        let mut bank = vec![0.0_f64; n];
        let mut kappa = vec![0.0_f64; n]; // 符号付き
        let mut mu_eff = vec![0.0_f64; n];
        for i in 0..n {
            let si = stations.s_of(i);
            let frame = track.frame_at(si);
            bank[i] = frame.banking;
            kappa[i] = trajectory.curvature_at(si);
            let t_traj = trajectory.t_at(si);
            let grip = track
                .surface_at(TrackCoord::new(si, t_traj))
                .properties()
                .grip_multiplier;
            mu_eff[i] = envelope.mu * grip;
        }

        // 1. コーナー速度。
        let mut v = vec![0.0_f64; n];
        for i in 0..n {
            let k = kappa[i].abs().max(Self::KAPPA_MIN);
            let sign = kappa[i].signum();
            let mut vi = envelope.v_max;
            for _ in 0..Self::DF_ITERS {
                let df = 0.5 * AIR_DENSITY * vi * vi * envelope.cl_a_total;
                let g_eff = GRAVITY * bank[i].cos() + df / envelope.mass_kg;
                // バンクが有利（旋回と逆符号）なら重力成分が横加速度を助ける。
                let bank_assist = -GRAVITY * bank[i].sin() * sign;
                let a_lat = (mu_eff[i] * g_eff + bank_assist).max(0.5);
                vi = (a_lat / k).sqrt().min(envelope.v_max);
            }
            v[i] = vi;
        }

        let idx = |i: isize| stations.wrap_index(i);

        // 2. 後退パス（ブレーキング）。閉トラックなので 2 周。
        for _lap in 0..2 {
            for step in 0..n {
                let i = idx(n as isize - 1 - step as isize);
                let j = idx(i as isize + 1);
                let a = Self::brake_decel(envelope, v[j], bank[i], mu_eff[i]);
                let allow = (v[j] * v[j] + 2.0 * a * h).sqrt();
                if allow < v[i] {
                    v[i] = allow;
                }
            }
        }

        // 3. 前進パス（トラクション / パワー）。2 周。
        for _lap in 0..2 {
            for step in 0..n {
                let i = idx(step as isize);
                let j = idx(i as isize + 1);
                let a = Self::drive_accel(envelope, v[i], bank[i], mu_eff[i]);
                let allow = if a > 0.0 {
                    (v[i] * v[i] + 2.0 * a * h).sqrt()
                } else {
                    v[i]
                };
                if allow < v[j] {
                    v[j] = allow;
                }
            }
        }

        for vi in &mut v {
            *vi = vi.clamp(Self::V_MIN, envelope.v_max);
        }

        SpeedProfile {
            stations,
            closed: track.is_closed(),
            v_max: v,
        }
    }

    /// 実効ブレーキ減速度 [m/s^2]（ダウンフォースによるグリップ増と空力抗力を含む）。
    fn brake_decel(env: &PerformanceEnvelope, v: f64, bank: f64, mu_eff: f64) -> f64 {
        let df = 0.5 * AIR_DENSITY * v * v * env.cl_a_total;
        let g_eff = GRAVITY * bank.cos() + df / env.mass_kg;
        let drag = 0.5 * AIR_DENSITY * v * v * env.cd_a;
        let tyre_limit = mu_eff * g_eff;
        env.max_brake_decel.min(tyre_limit) + drag / env.mass_kg
    }

    /// 実効駆動加速度 [m/s^2]（パワー制限・トラクション制限・空力抗力）。負にもなりうる。
    fn drive_accel(env: &PerformanceEnvelope, v: f64, bank: f64, mu_eff: f64) -> f64 {
        let df = 0.5 * AIR_DENSITY * v * v * env.cl_a_total;
        let g_eff = GRAVITY * bank.cos() + df / env.mass_kg;
        let drag = 0.5 * AIR_DENSITY * v * v * env.cd_a;
        let vv = v.max(5.0);
        let wheel_force = (env.max_power_w / vv).min(mu_eff * g_eff * env.mass_kg);
        (wheel_force - drag) / env.mass_kg
    }

    /// 限界速度 [m/s]。周期線形補間。
    pub fn v_at(&self, s: f64) -> f64 {
        self.stations.lerp_periodic(&self.v_max, s)
    }

    /// トラック全長 [m]。
    pub fn length(&self) -> f64 {
        self.stations.length
    }

    /// 閉トラックか。
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// プロファイル中の最小速度 [m/s]。
    pub fn min_v(&self) -> f64 {
        self.v_max.iter().copied().fold(f64::INFINITY, f64::min)
    }

    /// プロファイル中の最大速度 [m/s]。
    pub fn max_v(&self) -> f64 {
        self.v_max.iter().copied().fold(f64::NEG_INFINITY, f64::max)
    }
}
