//! 空力。抗力とダウンフォース。
//!
//! **ダウンフォースは圧力中心に作用させる。** 重心にまとめて作用させると
//! 空力によるピッチ変化が消えてしまう（`docs/phase-1b-vehicle.md` 空力）。

use crate::params::AeroParams;
use crate::AIR_DENSITY;
use sim_math::{Quat, Vec3};

/// 空力の合力とモーメント（ワールド座標、重心まわり）。
pub(crate) struct AeroLoads {
    /// 合力 [N]。
    pub force: Vec3,
    /// 重心まわりのモーメント [Nm]。
    pub torque: Vec3,
    /// 総ダウンフォース [N]。テレメトリと T-VEH-09 用。
    pub downforce: f64,
}

/// 動圧 `q = 0.5 * rho * v^2` [Pa]。
pub fn dynamic_pressure(speed: f64) -> f64 {
    0.5 * AIR_DENSITY * speed * speed
}

/// 空力荷重を計算する。
pub(crate) fn aero_loads(p: &AeroParams, orientation: Quat, velocity: Vec3) -> AeroLoads {
    let speed = velocity.length();
    let q = dynamic_pressure(speed);

    let drag_magnitude = q * p.cd * p.frontal_area;
    let drag = match velocity.try_normalize() {
        Some(dir) => dir * (-drag_magnitude),
        None => Vec3::ZERO,
    };

    // ダウンフォースは車体の下方向へ。圧力中心に作用させることでピッチにも効く。
    let down = orientation * Vec3::new(0.0, -1.0, 0.0);
    let df_front = q * p.cl_front * p.frontal_area;
    let df_rear = q * p.cl_rear * p.frontal_area;

    let arm_front = orientation * Vec3::new(p.cop_front_x, 0.0, 0.0);
    let arm_rear = orientation * Vec3::new(p.cop_rear_x, 0.0, 0.0);
    let force_front = down * df_front;
    let force_rear = down * df_rear;

    AeroLoads {
        force: drag + force_front + force_rear,
        // 抗力は重心に作用させる（モーメント寄与なし）。
        torque: arm_front.cross(force_front) + arm_rear.cross(force_rear),
        downforce: df_front + df_rear,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> AeroParams {
        AeroParams {
            frontal_area: 1.95,
            cd: 0.62,
            cl_front: 1.05,
            cl_rear: 1.55,
            cop_front_x: 1.20,
            cop_rear_x: -1.35,
        }
    }

    #[test]
    fn downforce_scales_with_speed_squared() {
        let p = params();
        let a = aero_loads(&p, Quat::IDENTITY, Vec3::new(20.0, 0.0, 0.0));
        let b = aero_loads(&p, Quat::IDENTITY, Vec3::new(40.0, 0.0, 0.0));
        assert!((b.downforce / a.downforce - 4.0).abs() < 1.0e-9);
    }

    #[test]
    fn drag_opposes_velocity() {
        let p = params();
        let a = aero_loads(&p, Quat::IDENTITY, Vec3::new(30.0, 0.0, 0.0));
        assert!(a.force.x < 0.0);
        assert!(a.force.y < 0.0);
    }

    #[test]
    fn zero_speed_produces_no_load() {
        let p = params();
        let a = aero_loads(&p, Quat::IDENTITY, Vec3::ZERO);
        assert_eq!(a.force, Vec3::ZERO);
        assert_eq!(a.downforce, 0.0);
    }
}
