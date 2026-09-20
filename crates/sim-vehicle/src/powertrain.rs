//! エンジン / クラッチ / ギアボックス / LSD。
//!
//! 「エンジン回転数は駆動輪の平均回転から逆算し、クラッチ切断時はエンジン単体で回す」
//! （`docs/phase-1b-vehicle.md` パワートレイン）という方針をそのまま実装する。

use crate::input::ControlInput;
use crate::params::{Derived, VehicleParams};
use crate::state::WheelIndex;
use sim_math::util::lerp;

/// rpm と rad/s の変換係数。
pub const RPM_TO_RAD_PER_S: f64 = std::f64::consts::TAU / 60.0;
/// rad/s と rpm の変換係数。
pub const RAD_PER_S_TO_RPM: f64 = 60.0 / std::f64::consts::TAU;

/// レブリミッター解除のヒステリシス [rpm]。
pub const LIMITER_HYSTERESIS_RPM: f64 = 200.0;

/// トルクカーブを線形補間する。範囲外は端の値で頭打ち。
pub fn torque_at_rpm(curve: &[[f64; 2]], rpm: f64) -> f64 {
    if curve.is_empty() {
        return 0.0;
    }
    if rpm <= curve[0][0] {
        return curve[0][1];
    }
    let last = curve.len() - 1;
    if rpm >= curve[last][0] {
        return curve[last][1];
    }
    for i in 1..=last {
        let (r0, t0) = (curve[i - 1][0], curve[i - 1][1]);
        let (r1, t1) = (curve[i][0], curve[i][1]);
        if rpm <= r1 {
            let u = (rpm - r0) / (r1 - r0);
            return lerp(t0, t1, u);
        }
    }
    curve[last][1]
}

/// パワートレインの持続状態。
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Powertrain {
    /// エンジン角速度 [rad/s]。
    pub engine_omega: f64,
    /// 現在のギア。
    pub gear: i8,
    /// 変速の残り時間 [s]。正の間はトルクカット。
    pub shift_timer: f64,
    /// レブリミッター作動中か。
    pub limiter_active: bool,
}

impl Powertrain {
    pub fn new(idle_rpm: f64) -> Self {
        Powertrain {
            engine_omega: idle_rpm * RPM_TO_RAD_PER_S,
            gear: 0,
            shift_timer: 0.0,
            limiter_active: false,
        }
    }

    /// 現在ギアの総減速比。ニュートラルは `0.0`。
    pub fn total_ratio(&self, p: &VehicleParams) -> f64 {
        let dt = &p.drivetrain;
        if self.gear > 0 {
            let i = (self.gear as usize) - 1;
            match dt.gear_ratios.get(i) {
                Some(r) => r * dt.final_drive,
                None => 0.0,
            }
        } else if self.gear < 0 {
            -dt.reverse_ratio * dt.final_drive
        } else {
            0.0
        }
    }
}

/// 1 物理ステップぶんのパワートレイン更新結果。
pub(crate) struct DriveTorques {
    /// 各車輪へ与える駆動トルク [Nm]。
    pub wheel_torque: [f64; 4],
    /// エンジン回転数 [rpm]。
    pub engine_rpm: f64,
}

/// パワートレインを 1 物理ステップ進め、各車輪の駆動トルクを返す。
pub(crate) fn step_powertrain(
    p: &VehicleParams,
    d: &Derived,
    pt: &mut Powertrain,
    input: &ControlInput,
    wheel_spin: &[f64; 4],
    dt: f64,
) -> DriveTorques {
    let throttle = input.throttle;
    let clutch = input.clutch;

    // --- 変速 -------------------------------------------------------------------------
    if input.gear != pt.gear {
        pt.gear = input.gear;
        pt.shift_timer = p.drivetrain.shift_time_s;
    } else if pt.shift_timer > 0.0 {
        pt.shift_timer = (pt.shift_timer - dt).max(0.0);
    }
    let shifting = pt.shift_timer > 0.0;

    let ratio = pt.total_ratio(p);
    let engaged = 1.0 - clutch;

    // --- 駆動輪の平均回転からドライブライン角速度を求める --------------------------------
    let mut driven_spin_sum = 0.0;
    for w in WheelIndex::ALL {
        if d.driven[w as usize] {
            driven_spin_sum += wheel_spin[w as usize];
        }
    }
    let driven_spin_avg = driven_spin_sum / d.driven_count;
    let driveline_omega = driven_spin_avg * ratio;

    // --- エンジン単体の回転 -------------------------------------------------------------
    let idle_omega = p.engine.idle_rpm * RPM_TO_RAD_PER_S;
    let limiter_omega = p.engine.limiter_rpm * RPM_TO_RAD_PER_S;
    let rpm_now = pt.engine_omega * RAD_PER_S_TO_RPM;

    if rpm_now >= p.engine.limiter_rpm {
        pt.limiter_active = true;
    } else if rpm_now < p.engine.limiter_rpm - LIMITER_HYSTERESIS_RPM {
        pt.limiter_active = false;
    }

    let cut = pt.limiter_active || shifting;
    let drive_torque = if cut {
        0.0
    } else {
        torque_at_rpm(&p.engine.torque_curve, rpm_now) * throttle
    };
    let brake_torque = p.engine.engine_brake_torque
        * (rpm_now / p.engine.max_rpm).clamp(0.0, 1.5)
        * (1.0 - throttle);
    let engine_torque = drive_torque - brake_torque;

    // 自由回転（クラッチ切断側の挙動）。
    pt.engine_omega += engine_torque / p.engine.inertia * dt;

    // クラッチ結合。engaged = 1 で完全にドライブラインへ拘束される。
    if ratio != 0.0 {
        pt.engine_omega = lerp(pt.engine_omega, driveline_omega, engaged.clamp(0.0, 1.0));
    }
    // アイドル以下には落ちない（エンストは Phase 1B の対象外）。
    pt.engine_omega = pt
        .engine_omega
        .clamp(idle_omega, limiter_omega * 1.05)
        .max(idle_omega);

    // --- 車輪へ配分 --------------------------------------------------------------------
    // clutch_torque = engine_torque * (1 - clutch)
    let clutch_torque = engine_torque * engaged;
    let axle_torque = clutch_torque * ratio * p.drivetrain.driveline_efficiency;

    let mut wheel_torque = [0.0; 4];
    if ratio != 0.0 {
        distribute_lsd(p, d, axle_torque, wheel_spin, &mut wheel_torque);
    }

    DriveTorques {
        wheel_torque,
        engine_rpm: pt.engine_omega * RAD_PER_S_TO_RPM,
    }
}

/// LSD によるアクスルトルクの左右配分。
///
/// `T_left = T/2 + bias * (spin_right - spin_left) * k_lsd`
/// （`docs/phase-1b-vehicle.md`）。ロックトルクは
/// `bias * |T| + preload` で頭打ちにする（差回転に比例したまま無制限にすると発散する）。
fn distribute_lsd(
    p: &VehicleParams,
    d: &Derived,
    axle_torque: f64,
    wheel_spin: &[f64; 4],
    out: &mut [f64; 4],
) {
    let dt = &p.drivetrain;
    let bias = if axle_torque >= 0.0 {
        dt.lsd_power_ratio
    } else {
        dt.lsd_coast_ratio
    };

    // 駆動軸ごとに配分する（AWD は前後 50:50）。
    let axles: &[(WheelIndex, WheelIndex)] = &[
        (WheelIndex::FrontLeft, WheelIndex::FrontRight),
        (WheelIndex::RearLeft, WheelIndex::RearRight),
    ];
    let driven_axles = axles
        .iter()
        .filter(|(l, _)| d.driven[*l as usize])
        .count()
        .max(1) as f64;

    for (left, right) in axles {
        if !d.driven[*left as usize] {
            continue;
        }
        let t_axle = axle_torque / driven_axles;
        let half = t_axle * 0.5;
        let delta_spin = wheel_spin[*right as usize] - wheel_spin[*left as usize];
        let max_lock = bias * t_axle.abs() + dt.lsd_preload;
        let lock = (bias * delta_spin * dt.lsd_torque_per_rad).clamp(-max_lock, max_lock);
        out[*left as usize] = half + lock;
        out[*right as usize] = half - lock;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn torque_curve_interpolates_and_clamps() {
        let curve = [[1000.0, 380.0], [3000.0, 520.0], [5000.0, 560.0]];
        assert_eq!(torque_at_rpm(&curve, 500.0), 380.0);
        assert_eq!(torque_at_rpm(&curve, 6000.0), 560.0);
        assert_eq!(torque_at_rpm(&curve, 1000.0), 380.0);
        assert!((torque_at_rpm(&curve, 2000.0) - 450.0).abs() < 1.0e-9);
        assert!((torque_at_rpm(&curve, 4000.0) - 540.0).abs() < 1.0e-9);
    }

    #[test]
    fn empty_curve_is_zero() {
        assert_eq!(torque_at_rpm(&[], 3000.0), 0.0);
    }
}
