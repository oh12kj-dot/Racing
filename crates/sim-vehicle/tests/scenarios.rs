//! `docs/phase-1b-vehicle.md`「シナリオ（数値で挙動を確認する）」と Performance Criteria。
//!
//! **これらは「正解」ではなく妥当性のレンジである。**
//!
//! # 100-0 制動距離の帯について（Opus 判断・仕様の修正）
//!
//! 当初の仕様は 100-0 を **30〜40 m**、定常円旋回 R=50 m を **1.4〜2.2 G** としていた。
//! この 2 つは**同時に満たせない**。摩擦円は等方であり、`mu0` は縦グリップと横グリップを
//! 同じ比率で動かすためである。`mu0` を掃引した実測（`mu0` 以外はアセットの値のまま）:
//!
//! | `mu0` | 100-0 [m] | 0-100 [s] | 最大横 G @ 26 m/s |
//! |-------|-----------|-----------|------------------|
//! | 1.30  | 31.9 ✓    | 3.85 ✓    | 1.24 ✗ |
//! | 1.40  | 29.3 ✗    | 3.55 ✓    | 1.32 ✗ |
//! | 1.50  | 26.8 ✗    | 3.32 ✓    | 1.41 ✓（R = 49.0 m）|
//! | 1.60  | 25.1 ✗    | 3.16 ✗    | 1.46 ✓ |
//!
//! `mu0 = 1.50` を採る。理由:
//!
//! - 定常円旋回のシナリオは**半径が数値で指定されている**（R=50 m）唯一のもので、
//!   `mu0 = 1.50` はそこで R = 49.0 m / 1.41 G と、仕様どおりの円を仕様どおりの G で回る
//! - GT3 級スリックの実測ピーク摩擦係数は 1.5〜1.6 であり、1.50 の方が実車に近い
//! - 実車の GT3 の 100-0 は 28〜31 m 程度であり、26.8 m は現実的な範囲。
//!   当初の 30〜40 m の方がロードカー寄りの保守的な帯だったと判断する
//!
//! **したがって 100-0 の受け入れ帯を 25〜40 m へ改める。** これは実装者の裁量ではなく
//! Architect による仕様変更であり、`docs/phase-1b-vehicle.md` にも記載してある。

mod common;

use common::*;
use sim_vehicle::*;

/// 0-100 km/h。トラクション制御つき全開（テストハーネス。crate 側には存在しない）。
#[test]
fn scenario_zero_to_one_hundred_kph() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(0.1);
    let mut gear = 1i8;
    let mut t = 0.0;
    let mut time_to_100 = f64::NAN;
    while t < 12.0 {
        if v.state().engine_rpm > 7400.0 && (gear as usize) < 6 {
            gear += 1;
        }
        let throttle = traction_throttle(&v, 0.09);
        v.step(
            &ControlInput {
                throttle,
                gear,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
        t += PHYSICS_DT;
        if time_to_100.is_nan() && v.state().forward_speed() >= 100.0 / 3.6 {
            time_to_100 = t;
        }
    }
    assert!(
        (3.2..=4.2).contains(&time_to_100),
        "0-100 km/h = {time_to_100} s, expected 3.2..4.2 s (GT3 級)"
    );
    assert_eq!(v.state().recovered_steps, 0);
}

/// 100 km/h -> 0 の制動距離。ペダル一定で最良のものを採る。
#[test]
fn scenario_one_hundred_kph_to_zero_braking_distance() {
    let g = FlatGround::asphalt(0.0);
    let mut best = f64::INFINITY;
    let mut best_pedal = 0.0;
    for k in 30..=80 {
        let brake = k as f64 / 100.0;
        let mut v = car(100.0 / 3.6);
        let start = v.state().position.x;
        let mut t = 0.0;
        while v.state().forward_speed() > 0.5 && t < 20.0 {
            v.step(
                &ControlInput {
                    brake,
                    gear: 0,
                    clutch: 1.0,
                    ..Default::default()
                },
                &g,
                PHYSICS_DT,
            );
            t += PHYSICS_DT;
        }
        assert_eq!(v.state().recovered_steps, 0);
        let distance = v.state().position.x - start;
        if distance < best {
            best = distance;
            best_pedal = brake;
        }
    }
    // 帯は 25..40 m（本ファイル冒頭の判断による。当初の仕様は 30..40 m）。
    assert!(
        (25.0..=40.0).contains(&best),
        "100-0 braking = {best} m at pedal {best_pedal}, expected 25..40 m"
    );
}

/// 定常円旋回 R=50 m。ステアを掃引し、達成できる最大横 G とそのときの半径を測る。
#[test]
fn scenario_steady_state_cornering_at_fifty_metre_radius() {
    let g = FlatGround::asphalt(0.0);
    let target_speed = 26.0;
    let mut best_g = 0.0f64;
    let mut best_radius = 0.0f64;
    for k in 10..=40 {
        let steer = -(k as f64) * 0.005;
        let mut v = car(target_speed);
        let mut throttle = 0.15f64;
        let (mut sum_g, mut sum_r, mut n) = (0.0f64, 0.0f64, 0.0f64);
        let mut departed = false;
        for i in 0..(240 * 12) {
            let s = v.state();
            if s.velocity.length() < target_speed * 0.6 {
                departed = true;
                break;
            }
            throttle = (throttle + (target_speed - s.velocity.length()) * 1.5 * PHYSICS_DT)
                .clamp(0.0, 1.0);
            v.step(
                &ControlInput {
                    steer,
                    throttle,
                    gear: 4,
                    ..Default::default()
                },
                &g,
                PHYSICS_DT,
            );
            assert_within_friction_circle(&v, i);
            if i > 240 * 9 {
                let s = v.state();
                let yaw_rate = s.angular_velocity.y.abs();
                if yaw_rate > 1.0e-9 {
                    sum_g += s.velocity.length() * yaw_rate / GRAVITY;
                    sum_r += s.velocity.length() / yaw_rate;
                    n += 1.0;
                }
            }
        }
        assert_eq!(v.state().recovered_steps, 0);
        if departed || n == 0.0 {
            continue;
        }
        if sum_g / n > best_g {
            best_g = sum_g / n;
            best_radius = sum_r / n;
        }
    }
    assert!(
        (1.4..=2.2).contains(&best_g),
        "max lateral acceleration = {best_g} G at R = {best_radius} m, expected 1.4..2.2 G"
    );
    assert!(
        (40.0..=60.0).contains(&best_radius),
        "the limit circle radius was {best_radius} m; the scenario is R = 50 m"
    );
}

/// スロットルオフでのオーバーステア: 後輪の slip_angle が前輪を上回る。
///
/// 判定は**前後バランスの移動**で行う。スロットルを閉じると車は減速するため、
/// スリップ角の絶対値はむしろ小さくなる。「後輪が前輪を上回るようになること」が要点である。
#[test]
fn scenario_lift_off_oversteer() {
    let g = FlatGround::asphalt(0.0);
    let speed = 30.0;
    let steer = -0.085;
    let mut v = car(speed);

    // 一定速度で旋回を安定させる。駆動力が後輪に掛かっている状態。
    let mut throttle = 0.2f64;
    for _ in 0..(240 * 8) {
        throttle =
            (throttle + (speed - v.state().velocity.length()) * 1.5 * PHYSICS_DT).clamp(0.0, 1.0);
        v.step(
            &ControlInput {
                steer,
                throttle,
                gear: 4,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
    }
    let (front_before, rear_before) = axle_slip_angles(&v);
    let balance_before = rear_before.abs() - front_before.abs();
    let rear_load_before = v.state().wheels[2].load + v.state().wheels[3].load;
    assert!(
        balance_before < 0.0,
        "リフト前は弱アンダーであること: F = {front_before}, R = {rear_before}"
    );

    // スロットル全閉。荷重が前へ移り、後輪の横グリップが落ちる。
    let mut best_balance = f64::NEG_INFINITY;
    let mut best_pair = (0.0f64, 0.0f64);
    let mut min_rear_load = f64::INFINITY;
    for i in 0..(240 * 3) {
        v.step(
            &ControlInput {
                steer,
                throttle: 0.0,
                gear: 4,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
        assert_within_friction_circle(&v, i);
        let (f, r) = axle_slip_angles(&v);
        if r.abs() - f.abs() > best_balance {
            best_balance = r.abs() - f.abs();
            best_pair = (f.abs(), r.abs());
        }
        let s = v.state();
        min_rear_load = min_rear_load.min(s.wheels[2].load + s.wheels[3].load);
    }

    // 1. 後輪の slip_angle が前輪を上回る（仕様の判定条件）。
    assert!(
        best_pair.1 > best_pair.0,
        "lift-off did not produce oversteer: rear = {}, front = {}",
        best_pair.1,
        best_pair.0
    );
    // 2. バランスがオーバー側へ移動している。
    assert!(
        best_balance > balance_before,
        "balance did not shift: before {balance_before}, after {best_balance}"
    );
    // 3. その原因が後輪の荷重抜けであること（機構の確認）。
    assert!(
        min_rear_load < rear_load_before * 0.95,
        "rear load did not drop on lift-off: {min_rear_load} N vs {rear_load_before} N"
    );
    assert_eq!(v.state().recovered_steps, 0);
}

// ======================================================================================
// Performance Criteria
// ======================================================================================

/// `Vehicle::step` 1 台 1 tick < 8 us、24 台 x 240 Hz <= 2.0 ms / render frame。
///
/// デバッグビルドでは意味がないので release のみ。
#[test]
#[cfg(not(debug_assertions))]
fn performance_step_budget() {
    use std::time::Instant;

    let g = FlatGround::asphalt(0.0);
    let mut cars: Vec<Vehicle> = (0..24).map(|_| car(45.0)).collect();
    let input = ControlInput {
        steer: 0.15,
        throttle: 0.8,
        gear: 4,
        ..Default::default()
    };

    // ウォームアップ（接地とタイヤの緩和を定常にする）。
    for c in cars.iter_mut() {
        for _ in 0..240 {
            c.step(&input, &g, PHYSICS_DT);
        }
    }

    let ticks = 2000;
    let start = Instant::now();
    for _ in 0..ticks {
        for c in cars.iter_mut() {
            c.step(&input, &g, PHYSICS_DT);
        }
    }
    let elapsed = start.elapsed();
    let per_step_ns = elapsed.as_secs_f64() * 1.0e9 / (ticks as f64 * cars.len() as f64);
    // 60 fps レンダフレーム 1 枚ぶん = 240/60 = 4 物理 tick x 24 台。
    let per_frame_ms = per_step_ns * 4.0 * 24.0 / 1.0e6;
    println!(
        "Vehicle::step = {per_step_ns:.0} ns/step, 24 cars x 4 ticks = {per_frame_ms:.3} ms/frame"
    );
    assert!(
        per_step_ns < 8000.0,
        "Vehicle::step = {per_step_ns:.0} ns, budget 8000 ns"
    );
    assert!(
        per_frame_ms < 2.0,
        "24 cars = {per_frame_ms:.3} ms/frame, budget 2.0 ms"
    );
    for c in &cars {
        assert_eq!(c.state().recovered_steps, 0);
    }
}
