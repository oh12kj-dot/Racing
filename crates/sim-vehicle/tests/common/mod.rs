//! 受け入れテスト共通のヘルパー。

#![allow(dead_code)]

use sim_math::Vec3;
use sim_vehicle::*;

/// `assets/vehicles/gt_proto_a.spec.json`。
/// **この crate が spec.json の物理側フィールドを読む最初の実装である。**
pub const SPEC_JSON: &str = include_str!("../../../../assets/vehicles/gt_proto_a.spec.json");

pub fn params() -> VehicleParams {
    VehicleParams::from_json_str(SPEC_JSON).expect("gt_proto_a.spec.json loads and validates")
}

/// 静的つり合いの高さに置いた車両。`speed` は前方への初速 [m/s]。
pub fn car(speed: f64) -> Vehicle {
    let p = params();
    let h = p.mass.cg_height;
    Vehicle::new_with_velocity(p, Vec3::new(0.0, h, 0.0), 0.0, Vec3::new(speed, 0.0, 0.0))
        .expect("vehicle builds")
}

pub fn weight() -> f64 {
    params().mass.total_kg * GRAVITY
}

/// 段差のある路面。`x` が `[start, start + length]` の範囲だけ `height` だけ持ち上がる。
///
/// T-VEH-14（縁石でダンパが発散しないこと）用。
pub struct StepGround {
    pub base: FlatGround,
    pub start: f64,
    pub length: f64,
    pub height: f64,
}

impl GroundProbe for StepGround {
    fn probe(&self, from: Vec3, max_distance: f64) -> Option<GroundHit> {
        let raised = from.x >= self.start && from.x <= self.start + self.length;
        let h = if raised {
            self.base.height + self.height
        } else {
            self.base.height
        };
        let drop = from.y - h;
        if !(drop.is_finite() && max_distance.is_finite()) || drop > max_distance {
            return None;
        }
        Some(GroundHit {
            point: Vec3::new(from.x, h, from.z),
            // 段差の側面は表現しない（垂直探索のため）。法線は水平のまま。
            normal: Vec3::Y,
            grip: self.base.grip,
            rolling_resistance: self.base.rolling_resistance,
            roughness: self.base.roughness,
        })
    }
}

/// 状態を丸ごとビット列へ落とす。決定性テスト（T-VEH-12）用。
///
/// `f64` の `==` は `NaN` と `+0.0 / -0.0` を取りこぼすため、
/// **ビットパターンで比較する。**
pub fn state_bits(s: &VehicleState) -> Vec<u64> {
    let mut out = Vec::with_capacity(80);
    let mut push = |x: f64| out.push(x.to_bits());
    push(s.position.x);
    push(s.position.y);
    push(s.position.z);
    push(s.orientation.x);
    push(s.orientation.y);
    push(s.orientation.z);
    push(s.orientation.w);
    push(s.velocity.x);
    push(s.velocity.y);
    push(s.velocity.z);
    push(s.angular_velocity.x);
    push(s.angular_velocity.y);
    push(s.angular_velocity.z);
    push(s.engine_rpm);
    push(s.aero_downforce);
    for w in &s.wheels {
        push(w.compression);
        push(w.compression_velocity);
        push(w.spin);
        push(w.rotation);
        push(w.steer_angle);
        push(w.load);
        push(w.slip_ratio);
        push(w.slip_angle);
        push(w.force_long);
        push(w.force_lat);
        push(w.friction_limit);
        push(w.grip_usage);
    }
    out.push(s.gear as u64);
    out.push(s.recovered_steps);
    out
}

/// 全 tick で摩擦円を超えていないことを確認する（T-VEH-07）。
pub fn assert_within_friction_circle(v: &Vehicle, tick: usize) {
    for w in WheelIndex::ALL {
        let s = &v.state().wheels[w as usize];
        let magnitude = (s.force_long * s.force_long + s.force_lat * s.force_lat).sqrt();
        assert!(
            magnitude <= s.friction_limit * 1.001,
            "tick {tick} {w:?}: |F| = {magnitude} > mu*load = {} * 1.001",
            s.friction_limit
        );
    }
}

/// 状態が有限であることを確認する。
pub fn assert_finite(v: &Vehicle, tick: usize) {
    let s = v.state();
    assert!(
        s.position.is_finite() && s.velocity.is_finite() && s.angular_velocity.is_finite(),
        "tick {tick}: non-finite body state {s:?}"
    );
    assert!(
        s.orientation.is_finite(),
        "tick {tick}: non-finite orientation"
    );
    for w in WheelIndex::ALL {
        let wheel = &s.wheels[w as usize];
        assert!(
            wheel.load.is_finite()
                && wheel.spin.is_finite()
                && wheel.force_long.is_finite()
                && wheel.force_lat.is_finite()
                && wheel.slip_ratio.is_finite()
                && wheel.slip_angle.is_finite(),
            "tick {tick} {w:?}: non-finite wheel state {wheel:?}"
        );
    }
}

/// 前後の車軸の平均スリップ角。
pub fn axle_slip_angles(v: &Vehicle) -> (f64, f64) {
    let s = v.state();
    (
        (s.wheels[0].slip_angle + s.wheels[1].slip_angle) * 0.5,
        (s.wheels[2].slip_angle + s.wheels[3].slip_angle) * 0.5,
    )
}

/// 駆動輪のスリップ比を目標付近へ保つ簡易トラクション制御。
///
/// **これはテストハーネスであって Driver AI ではない**（Phase 2 の対象）。
/// crate 側には存在しない。シナリオが「車両の能力」を測るために必要なだけである。
pub fn traction_throttle(v: &Vehicle, target_slip: f64) -> f64 {
    let s = v.state();
    let slip = (s.wheels[2].slip_ratio + s.wheels[3].slip_ratio) * 0.5;
    (1.0 - 4.0 * (slip - target_slip)).clamp(0.0, 1.0)
}
