//! `docs/phase-1b-vehicle.md` Required Tests（T-VEH-01 〜 T-VEH-14）。
//!
//! **`sim-track` に依存せず、平面 [`FlatGround`] 実装で回す。**

mod common;

use common::*;
use sim_math::Vec3;
use sim_vehicle::*;

/// 静止させて安定させる。
fn settle(v: &mut Vehicle, seconds: f64) {
    let g = FlatGround::asphalt(0.0);
    let n = (seconds / PHYSICS_DT) as usize;
    for _ in 0..n {
        v.step(&ControlInput::default(), &g, PHYSICS_DT);
    }
}

// ======================================================================================
// T-VEH-01 / 02 — 静的荷重
// ======================================================================================

#[test]
fn t_veh_01_static_load_sums_to_vehicle_weight() {
    let mut v = car(0.0);
    settle(&mut v, 5.0);
    let total = v.state().total_load();
    let w = weight();
    let error = (total / w - 1.0).abs();
    assert!(
        error < 0.001,
        "sum of wheel loads = {total} N, weight = {w} N, error = {:.4}%",
        error * 100.0
    );
    assert_eq!(v.state().recovered_steps, 0);
}

#[test]
fn t_veh_02_static_front_rear_distribution_matches_cg() {
    let mut v = car(0.0);
    settle(&mut v, 5.0);
    let s = v.state();
    let front = s.wheels[0].load + s.wheels[1].load;
    let share = front / s.total_load();
    let expected = params().mass.distribution_front;
    assert!(
        (share / expected - 1.0).abs() < 0.01,
        "front share = {share}, expected {expected}"
    );
    // 左右は対称。
    assert!((s.wheels[0].load - s.wheels[1].load).abs() < 1.0e-6);
    assert!((s.wheels[2].load - s.wheels[3].load).abs() < 1.0e-6);
}

// ======================================================================================
// T-VEH-03 / 04 — ダイブとスクワット（**代入ではなく創発であること**）
// ======================================================================================

#[test]
fn t_veh_03_braking_produces_dive() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(30.0);
    settle_rolling(&mut v, 1.0);
    let rest = v.state().clone();
    let mut min_pitch = 0.0f64;
    let mut front_peak = 0.0f64;
    for _ in 0..(240 * 2) {
        v.step(
            &ControlInput {
                brake: 0.45,
                gear: 0,
                clutch: 1.0,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
        let s = v.state();
        min_pitch = min_pitch.min(s.pitch());
        front_peak = front_peak.max(s.wheels[0].load + s.wheels[1].load);
    }
    let rest_front = rest.wheels[0].load + rest.wheels[1].load;
    assert!(min_pitch < -1.0e-4, "no dive: min pitch = {min_pitch}");
    assert!(
        front_peak > rest_front * 1.1,
        "front load did not rise: {front_peak} vs {rest_front}"
    );
    // ピッチと荷重移動は同じ物理（サス力）から出ていること。
    assert!(v.state().wheels[0].compression > rest.wheels[0].compression);
    assert!(v.state().wheels[2].compression < rest.wheels[2].compression);
    assert_eq!(v.state().recovered_steps, 0);
}

#[test]
fn t_veh_04_acceleration_produces_squat() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(5.0);
    settle_rolling(&mut v, 1.0);
    let rest = v.state().clone();
    let mut max_pitch = 0.0f64;
    let mut rear_peak = 0.0f64;
    for _ in 0..(240 * 2) {
        let throttle = traction_throttle(&v, 0.09);
        v.step(
            &ControlInput {
                throttle,
                gear: 1,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
        let s = v.state();
        max_pitch = max_pitch.max(s.pitch());
        rear_peak = rear_peak.max(s.wheels[2].load + s.wheels[3].load);
    }
    let rest_rear = rest.wheels[2].load + rest.wheels[3].load;
    assert!(max_pitch > 1.0e-4, "no squat: max pitch = {max_pitch}");
    assert!(
        rear_peak > rest_rear * 1.1,
        "rear load did not rise: {rear_peak} vs {rest_rear}"
    );
    assert_eq!(v.state().recovered_steps, 0);
}

fn settle_rolling(v: &mut Vehicle, seconds: f64) {
    let g = FlatGround::asphalt(0.0);
    let n = (seconds / PHYSICS_DT) as usize;
    for _ in 0..n {
        v.step(
            &ControlInput {
                gear: 0,
                clutch: 1.0,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
    }
}

// ======================================================================================
// T-VEH-05 — 定常円旋回のロール
// ======================================================================================

#[test]
fn t_veh_05_steady_cornering_roll_matches_lateral_load_transfer() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(26.0);
    // 左旋回（steer 負）。
    let mut throttle = 0.15;
    for _ in 0..(240 * 10) {
        throttle =
            (throttle + (26.0 - v.state().velocity.length()) * 1.5 * PHYSICS_DT).clamp(0.0, 1.0);
        v.step(
            &ControlInput {
                steer: -0.09,
                throttle,
                gear: 4,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
    }
    let s = v.state();
    let speed = s.velocity.length();
    let lateral_a = speed * s.angular_velocity.y.abs();

    // 1. 左旋回では右側が沈む -> roll は正。
    assert!(
        s.roll() > 1.0e-3,
        "left turn should roll right side down: roll = {}",
        s.roll()
    );
    // 2. 外輪（右）の荷重が内輪（左）を上回る。
    let left = s.wheels[0].load + s.wheels[2].load;
    let right = s.wheels[1].load + s.wheels[3].load;
    assert!(
        right > left * 1.3,
        "no load transfer: L = {left}, R = {right}"
    );

    // 3. 横荷重移動は m * a * h / track と整合する（物理の恒等式）。
    let p = params();
    let track = 0.5 * (p.dimensions.track_front + p.dimensions.track_rear);
    let expected_transfer = p.mass.total_kg * lateral_a * p.mass.cg_height / track;
    let measured_transfer = (right - left) * 0.5;
    assert!(
        (measured_transfer / expected_transfer - 1.0).abs() < 0.10,
        "load transfer {measured_transfer} N vs expected {expected_transfer} N (a = {lateral_a})"
    );

    // 4. ロール角はサスペンションの縮み差そのものであること（別系統で作っていない）。
    let dc_front = s.wheels[1].compression - s.wheels[0].compression;
    let dc_rear = s.wheels[3].compression - s.wheels[2].compression;
    let geometric_roll =
        0.5 * (dc_front / p.dimensions.track_front + dc_rear / p.dimensions.track_rear);
    assert!(
        (geometric_roll - s.roll()).abs() < 5.0e-4,
        "roll {} rad does not match suspension geometry {geometric_roll} rad",
        s.roll()
    );
    assert_eq!(s.recovered_steps, 0);
}

// ======================================================================================
// T-VEH-06 — 低速・停止で発散しない（最大リスク）
// ======================================================================================

#[test]
fn t_veh_06_low_speed_is_stable_for_one_hour() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(0.0);
    let ticks = (3600.0 / PHYSICS_DT) as usize; // 60 分
    let mut max_speed = 0.0f64;
    for i in 0..ticks {
        // 発進 -> 低速旋回 -> 停止 -> ニュートラル、を 20 秒周期で繰り返す。
        let phase = (i / (240 * 5)) % 4;
        let input = match phase {
            0 => ControlInput {
                throttle: 0.12,
                gear: 1,
                ..Default::default()
            },
            1 => ControlInput {
                throttle: 0.10,
                steer: 0.8,
                gear: 1,
                ..Default::default()
            },
            2 => ControlInput {
                brake: 1.0,
                clutch: 1.0,
                gear: 1,
                ..Default::default()
            },
            _ => ControlInput {
                gear: 0,
                clutch: 1.0,
                ..Default::default()
            },
        };
        v.step(&input, &g, PHYSICS_DT);
        max_speed = max_speed.max(v.state().velocity.length());
        if i % 2400 == 0 {
            assert_finite(&v, i);
            assert_within_friction_circle(&v, i);
        }
    }
    assert_finite(&v, ticks);
    assert_eq!(
        v.state().recovered_steps,
        0,
        "破綻検知が作動した（カウンタが増えること自体が不具合）"
    );
    assert!(
        max_speed < 20.0,
        "low-speed scenario ran away: {max_speed} m/s"
    );
}

// ======================================================================================
// T-VEH-07 — 摩擦円を超えない
// ======================================================================================

#[test]
fn t_veh_07_tyre_force_never_exceeds_friction_circle() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(40.0);
    // 加速 / 制動 / 旋回を混ぜて全 tick 検証する。
    for i in 0..(240 * 30) {
        let t = i as f64 * PHYSICS_DT;
        let input = ControlInput {
            steer: (t * 1.7).sin() * 0.6,
            throttle: if (t * 0.9).sin() > 0.0 { 1.0 } else { 0.0 },
            brake: if (t * 0.9).sin() > 0.0 { 0.0 } else { 0.8 },
            gear: 3,
            ..Default::default()
        };
        v.step(&input, &g, PHYSICS_DT);
        assert_within_friction_circle(&v, i);
        assert_finite(&v, i);
    }
    assert_eq!(v.state().recovered_steps, 0);
}

// ======================================================================================
// T-VEH-08 — ロックアップが創発する
// ======================================================================================

/// **`sim-vehicle` に「ロック判定」は存在しない。**
/// ブレーキトルクで `spin -> 0` になった結果としてスリップ比が `-1` へ漸近する。
#[test]
fn t_veh_08_lockup_emerges_from_brake_torque() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(40.0);
    settle_rolling(&mut v, 0.5);
    for _ in 0..(240 * 2) {
        v.step(
            &ControlInput {
                brake: 1.0,
                gear: 0,
                clutch: 1.0,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
    }
    let s = v.state();
    assert!(s.forward_speed() > 5.0, "車速が残っている状態で評価する");
    for w in WheelIndex::ALL {
        let wheel = &s.wheels[w as usize];
        assert!(
            wheel.spin.abs() < 1.0e-6,
            "{w:?} did not lock: spin = {}",
            wheel.spin
        );
        assert!(
            (wheel.slip_ratio + 1.0).abs() < 0.05,
            "{w:?} slip_ratio = {} (expected -> -1)",
            wheel.slip_ratio
        );
        // 車輪は逆回転しない（ブレーキトルクのクランプ）。
        assert!(wheel.spin >= 0.0);
    }

    // ロック中でも摩擦円の内側であること。
    assert_within_friction_circle(&v, 0);
    assert_eq!(s.recovered_steps, 0);
}

// ======================================================================================
// T-VEH-09 — ダウンフォースが v^2 に比例
// ======================================================================================

/// サスペンション荷重の合計から測る（空力の式を空力の式で検証しない）。
#[test]
fn t_veh_09_downforce_scales_with_speed_squared() {
    let w = weight();
    // 惰行中に空気抵抗で減速するため、**サンプル時点の実測速度**で正規化する。
    let sample = |speed: f64| -> (f64, f64) {
        let mut v = car(speed);
        settle_rolling(&mut v, 1.5);
        let s = v.state();
        (s.total_load() - w, s.velocity.length())
    };
    let (d1, u1) = sample(25.0);
    let (d2, u2) = sample(50.0);
    assert!(
        d1 > 100.0 && d2 > 100.0,
        "downforce not produced: {d1}, {d2}"
    );
    let ratio = (d2 / d1) / (u2 / u1).powi(2);
    assert!(
        (ratio - 1.0).abs() < 0.01,
        "downforce / v^2 is not constant: {d1} N at {u1} m/s vs {d2} N at {u2} m/s (ratio {ratio})"
    );
}

// ======================================================================================
// T-VEH-10 — 惰行減速が抗力 + 転がり抵抗と整合
// ======================================================================================

#[test]
fn t_veh_10_coasting_deceleration_matches_drag_and_rolling_resistance() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(50.0);
    let neutral = ControlInput {
        gear: 0,
        clutch: 1.0,
        ..Default::default()
    };
    settle_rolling(&mut v, 1.0);

    let v0 = v.state().forward_speed();
    let load = v.state().total_load();
    for _ in 0..240 {
        v.step(&neutral, &g, PHYSICS_DT);
    }
    let v1 = v.state().forward_speed();
    let measured = (v0 - v1) / 1.0;

    let p = params();
    let speed = 0.5 * (v0 + v1);
    let q = 0.5 * AIR_DENSITY * speed * speed;
    let drag = q * p.aero.cd * p.aero.frontal_area;
    let rolling = FlatGround::asphalt(0.0).rolling_resistance * load;
    // 車輪の回転慣性は等価質量として効く。
    // I / r^2 = (factor * m_unsprung * r^2) / r^2 = factor * m_unsprung（半径によらない）。
    let equivalent_mass =
        p.mass.total_kg + 4.0 * p.tyre.wheel_inertia_factor * p.mass.unsprung_kg_per_wheel;
    let expected = (drag + rolling) / equivalent_mass;
    assert!(
        (measured / expected - 1.0).abs() < 0.05,
        "coast decel = {measured} m/s^2, expected {expected} m/s^2 \
         (drag {drag} N, rolling {rolling} N, equivalent mass {equivalent_mass} kg)"
    );
}

// ======================================================================================
// T-VEH-11 — Visual suspension == 物理 compression
// ======================================================================================

#[test]
fn t_veh_11_wheel_transform_matches_physical_compression() {
    let g = FlatGround::asphalt(0.0);
    let p = params();
    let mut v = car(0.0);
    settle(&mut v, 3.0);

    // 静止（水平）では車輪中心がちょうどタイヤ半径ぶん路面の上にある。
    for wheel in WheelIndex::ALL {
        let (center, _) = v.wheel_world_transform(wheel);
        let radius = p.tyre_radius(wheel);
        assert!(
            (center.y - radius).abs() < 1.0e-9,
            "{wheel:?}: wheel centre at {} m, expected {radius} m",
            center.y
        );
    }

    // 走行中も「取り付け点からの距離 == rest_length - compression」が厳密に成り立つ。
    let rest = v.suspension_rest_length();
    for i in 0..(240 * 5) {
        let t = i as f64 * PHYSICS_DT;
        v.step(
            &ControlInput {
                steer: (t * 2.0).sin() * 0.5,
                throttle: 0.6,
                gear: 2,
                ..Default::default()
            },
            &g,
            PHYSICS_DT,
        );
        let s = v.state();
        for wheel in WheelIndex::ALL {
            let (center, _) = v.wheel_world_transform(wheel);
            let mount = s.position + s.orientation * v.wheel_mount_local(wheel);
            let travel = (mount - center).length();
            let expected = rest - s.wheels[wheel as usize].compression;
            assert!(
                (travel - expected).abs() < 1.0e-9,
                "tick {i} {wheel:?}: visual travel {travel} != physical {expected}"
            );
        }
    }
}

// ======================================================================================
// T-VEH-12 — 決定性
// ======================================================================================

#[test]
fn t_veh_12_two_identical_runs_are_bit_identical() {
    let run = || {
        let g = FlatGround::asphalt(0.0);
        let mut v = car(20.0);
        let mut trace = Vec::new();
        for i in 0..(240 * 20) {
            let t = i as f64 * PHYSICS_DT;
            let input = ControlInput {
                steer: (t * 1.3).sin() * 0.7,
                throttle: (t * 0.7).cos().max(0.0),
                brake: (t * 0.4).sin().max(0.0) * 0.6,
                clutch: 0.0,
                gear: 1 + ((i / 900) % 4) as i8,
                drs: false,
            };
            v.step(&input, &g, PHYSICS_DT);
            if i % 240 == 0 {
                trace.push(state_bits(v.state()));
            }
        }
        trace.push(state_bits(v.state()));
        trace
    };
    let a = run();
    let b = run();
    assert_eq!(a.len(), b.len());
    for (i, (x, y)) in a.iter().zip(b.iter()).enumerate() {
        assert_eq!(x, y, "sample {i} differs between two identical runs");
    }
}

// ======================================================================================
// T-VEH-13 — 不正入力で破綻しない
// ======================================================================================

#[test]
fn t_veh_13_malformed_input_is_clamped() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(15.0);
    let inputs = [
        ControlInput {
            steer: 1.0e9,
            throttle: f64::NAN,
            brake: -5.0,
            clutch: f64::INFINITY,
            gear: 127,
            drs: true,
        },
        ControlInput {
            steer: f64::NEG_INFINITY,
            throttle: 1.0e300,
            brake: f64::NAN,
            clutch: -1.0e9,
            gear: -128,
            drs: false,
        },
    ];
    for i in 0..(240 * 20) {
        v.step(&inputs[i % inputs.len()], &g, PHYSICS_DT);
        assert_finite(&v, i);
        assert_within_friction_circle(&v, i);
        let last = v.state().last_input;
        assert!((-1.0..=1.0).contains(&last.steer));
        assert!((0.0..=1.0).contains(&last.throttle));
        assert!((0.0..=1.0).contains(&last.brake));
        assert!((0.0..=1.0).contains(&last.clutch));
        assert!((-1..=6).contains(&last.gear));
    }
    assert_eq!(v.state().recovered_steps, 0);
}

#[test]
fn t_veh_13_non_finite_dt_is_ignored() {
    let g = FlatGround::asphalt(0.0);
    let mut v = car(10.0);
    let before = v.state().clone();
    v.step(&ControlInput::default(), &g, f64::NAN);
    v.step(&ControlInput::default(), &g, -1.0);
    v.step(&ControlInput::default(), &g, 0.0);
    assert_eq!(&before, v.state());
}

// ======================================================================================
// T-VEH-14 — 段差・縁石でダンパが発散しない
// ======================================================================================

#[test]
fn t_veh_14_fifty_millimetre_step_at_two_hundred_kph() {
    // 200 km/h = 55.56 m/s
    let speed = 200.0 / 3.6;
    let ground = StepGround {
        base: FlatGround::asphalt(0.0),
        start: 40.0,
        length: 6.0,
        height: 0.050,
    };
    let mut v = car(speed);
    let mut max_load = 0.0f64;
    let mut max_vertical = 0.0f64;
    for i in 0..(240 * 6) {
        v.step(
            &ControlInput {
                gear: 6,
                clutch: 1.0,
                ..Default::default()
            },
            &ground,
            PHYSICS_DT,
        );
        assert_finite(&v, i);
        assert_within_friction_circle(&v, i);
        let s = v.state();
        max_load = max_load.max(s.wheels.iter().fold(0.0f64, |a, w| a.max(w.load)));
        max_vertical = max_vertical.max(s.velocity.y.abs());
    }
    let s = v.state();
    assert_eq!(
        s.recovered_steps, 0,
        "damper diverged over the step (recovered_steps = {})",
        s.recovered_steps
    );
    // 段差を越えて走り続けていること。
    assert!(
        s.position.x > 100.0,
        "car did not clear the step: x = {}",
        s.position.x
    );
    assert!(
        s.position.y > 0.2 && s.position.y < 1.5,
        "body height diverged: {}",
        s.position.y
    );
    assert!(
        max_vertical < 8.0,
        "vertical velocity spike: {max_vertical} m/s"
    );
    // ダンパのクランプが効いていること（静的荷重の 20 倍を超えない）。
    let static_max = params().static_wheel_load(WheelIndex::RearLeft);
    assert!(
        max_load < static_max * 20.0,
        "load spike {max_load} N exceeds 20x static {static_max} N"
    );
}

#[test]
fn wheels_leave_the_ground_when_airborne() {
    // 路面を遠ざけると接地なしになり、荷重もタイヤ力もゼロになる。
    struct NoGround;
    impl GroundProbe for NoGround {
        fn probe(&self, _from: Vec3, _max: f64) -> Option<GroundHit> {
            None
        }
    }
    let mut v = car(30.0);
    for _ in 0..240 {
        v.step(&ControlInput::default(), &NoGround, PHYSICS_DT);
    }
    let s = v.state();
    for w in WheelIndex::ALL {
        let wheel = &s.wheels[w as usize];
        assert!(!wheel.grounded);
        assert_eq!(wheel.load, 0.0);
        assert_eq!(wheel.force_long, 0.0);
        assert_eq!(wheel.force_lat, 0.0);
    }
    // 自由落下している。
    assert!(s.velocity.y < -8.0, "not falling: vy = {}", s.velocity.y);
    assert_eq!(s.recovered_steps, 0);
}
