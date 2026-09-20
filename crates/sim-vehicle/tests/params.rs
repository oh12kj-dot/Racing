//! `assets/vehicles/*.spec.json` の読み込みと検証。
//!
//! **この crate が spec.json の物理側フィールドを読む最初の実装である**ため、
//! アセットの実データに対して読めることをここで押さえる。

mod common;

use common::*;
use sim_vehicle::*;

#[test]
fn real_asset_loads_and_validates() {
    let p = params();
    assert_eq!(p.name, "GT Proto A");
    assert_eq!(p.mass.total_kg, 1245.0);
    assert_eq!(p.mass.distribution_front, 0.45);
    assert_eq!(p.dimensions.wheelbase, 2.75);
    assert_eq!(p.tyre.front.radius, 0.345);
    assert_eq!(p.tyre.rear.radius, 0.355);
    assert_eq!(p.drivetrain.layout, DrivetrainLayout::Rwd);
    assert_eq!(p.drivetrain.gear_ratios.len(), 6);
    assert_eq!(p.engine.torque_curve.len(), 5);
    assert_eq!(p.aero.cl_rear, 1.55);
    assert_eq!(p.brakes.bias_front, 0.62);
    assert_eq!(p.suspension.travel_up, 0.055);
    p.validate().expect("real asset validates");
}

/// spec.json に無い物理パラメータは crate 側の既定値が入る。
#[test]
fn defaults_are_applied_for_fields_absent_from_the_asset() {
    let p = params();
    assert_eq!(p.tyre.mu0, 1.50);
    assert_eq!(p.tyre.load_sensitivity, 0.28);
    assert_eq!(p.tyre.relaxation_length, 0.30);
    assert_eq!(p.tyre.bx, 12.0);
    assert_eq!(p.tyre.cx, 1.65);
    assert_eq!(p.tyre.by, 9.0);
    assert_eq!(p.tyre.cy, 1.35);
    assert!(p.tyre.nominal_load.is_none());
    assert_eq!(p.drivetrain.driveline_efficiency, 0.92);
    assert_eq!(p.engine.inertia, 0.22);
    assert_eq!(p.suspension.progressive, 0.50);
    assert!(p.suspension.rest_length.is_none());
}

/// JSON 側に書けば既定値を上書きできる。
#[test]
fn asset_can_override_tyre_model_coefficients() {
    let patched = SPEC_JSON.replace(
        r#""front": { "radius": 0.345"#,
        r#""mu0": 1.11, "relaxation_length": 0.42, "front": { "radius": 0.345"#,
    );
    assert_ne!(patched, SPEC_JSON, "patch did not apply");
    let p = VehicleParams::from_json_str(&patched).expect("patched spec loads");
    assert_eq!(p.tyre.mu0, 1.11);
    assert_eq!(p.tyre.relaxation_length, 0.42);
}

#[test]
fn unsupported_schema_version_is_rejected() {
    let bad = SPEC_JSON.replace(r#""schema_version": 1"#, r#""schema_version": 99"#);
    match VehicleParams::from_json_str(&bad) {
        Err(VehicleParamsError::UnsupportedVersion { found, supported }) => {
            assert_eq!(found, 99);
            assert_eq!(supported, VEHICLE_SCHEMA_VERSION);
        }
        other => panic!("expected UnsupportedVersion, got {other:?}"),
    }
}

#[test]
fn malformed_json_is_rejected() {
    assert!(VehicleParams::from_json_str("{ not json").is_err());
    assert!(VehicleParams::from_json_str("{}").is_err());
}

/// 不正な値は**読み込み時点で**弾かれ、物理へ流れない。
#[test]
fn invalid_values_are_rejected_at_load_time() {
    let cases: &[(&str, &str)] = &[
        (r#""total_kg": 1245.0"#, r#""total_kg": -1.0"#),
        (
            r#""distribution_front": 0.45"#,
            r#""distribution_front": 1.4"#,
        ),
        (r#""cg_height": 0.42"#, r#""cg_height": 0.0"#),
        (r#""wheelbase": 2.75"#, r#""wheelbase": -2.0"#),
        (r#""final_drive": 3.44"#, r#""final_drive": 0.0"#),
        (r#""bias_front": 0.62"#, r#""bias_front": 1.5"#),
        (r#""travel_up": 0.055"#, r#""travel_up": 0.0"#),
        (r#""frontal_area": 1.95"#, r#""frontal_area": 0.0"#),
        (
            r#""gear_ratios": [3.15, 2.19, 1.63, 1.29, 1.03, 0.84]"#,
            r#""gear_ratios": [1.0, 2.0, 3.0]"#,
        ),
        (
            r#""torque_curve": [[1000, 380], [3000, 520], [5000, 560], [6500, 530], [7500, 470]]"#,
            r#""torque_curve": []"#,
        ),
    ];
    for (from, to) in cases {
        let broken = SPEC_JSON.replace(from, to);
        assert_ne!(&broken, SPEC_JSON, "patch {from} -> {to} did not apply");
        assert!(
            VehicleParams::from_json_str(&broken).is_err(),
            "expected rejection for {to}"
        );
    }
}

/// 静的つり合いで底付きするパラメータは弾く。
#[test]
fn suspension_that_bottoms_out_at_rest_is_rejected() {
    let mut p = params();
    p.suspension.spring_rate_front = 20_000.0;
    match p.validate() {
        Err(VehicleParamsError::SuspensionBottomsOut { .. }) => {}
        other => panic!("expected SuspensionBottomsOut, got {other:?}"),
    }
}

/// 幾何の導出（重心から前後軸までの距離）が荷重配分と一致する。
#[test]
fn wheel_mounts_are_derived_from_the_mass_distribution() {
    let p = params();
    let fl = p.wheel_mount_local(WheelIndex::FrontLeft);
    let rl = p.wheel_mount_local(WheelIndex::RearLeft);
    let fr = p.wheel_mount_local(WheelIndex::FrontRight);
    assert!((fl.x - rl.x - p.dimensions.wheelbase).abs() < 1.0e-12);
    // 前軸荷重配分 = 重心から後軸までの距離 / ホイールベース。
    let cg_to_rear = -rl.x;
    assert!((cg_to_rear / p.dimensions.wheelbase - p.mass.distribution_front).abs() < 1.0e-12);
    // 左は -Z、右は +Z。
    assert!(fl.z < 0.0 && fr.z > 0.0);
    assert!((fr.z - fl.z - p.dimensions.track_front).abs() < 1.0e-12);
    // 静的つり合いで重心が cg_height に来る高さになっている。
    let expected_y = p.tyre_radius(WheelIndex::FrontLeft) + p.rest_length()
        - p.static_compression(WheelIndex::FrontLeft)
        - p.mass.cg_height;
    assert!((fl.y - expected_y).abs() < 1.0e-12);
}

/// 静的つり合いの解析解がばね力の式と一致する（progressive 項を含む）。
#[test]
fn static_compression_solves_the_progressive_spring() {
    let p = params();
    for w in WheelIndex::ALL {
        let c = p.static_compression(w);
        let k = p.spring_rate(w);
        let f = k * c * (1.0 + p.suspension.progressive * c / p.suspension.travel_up);
        assert!(
            (f - p.static_wheel_load(w)).abs() < 1.0e-6,
            "{w:?}: spring force {f} != static load {}",
            p.static_wheel_load(w)
        );
        assert!(c > 0.0 && c < p.suspension.travel_up);
    }
}
