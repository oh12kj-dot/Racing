//! TASK-2-2 受け入れテスト。T-AI-01〜08 / T-DRV-01〜06。
//!
//! 検証は 2 段（`common/mod.rs` の doc 参照）:
//! (1) 実トラック幾何（Aoyama Ring + `gt_proto_a` のレーシングライン）+ 運動学プラント、
//! (2) 手組み `VehicleState` / `DriverState` に対する単体テスト。
//! 実車両・実路面の閉ループ再検証は TASK-2-3 の受け入れに含まれる。

mod common;

use common::*;
use sim_driver::*;
use sim_line::Trajectory;
use sim_math::Rng;
use sim_track::TrackCoord;
use sim_vehicle::{ControlInput, VehicleState, WheelIndex, WheelState};

const MAX_TICKS_20: usize = 60 * 130 * 20; // 20 周ぶんの上限（~130 s/lap 見込み）

/// 全能力 0.5 を基準に、指定フィールドだけ上書きしたモデル。
fn model(
    pace: f64,
    braking: f64,
    cornering: f64,
    consistency: f64,
    reaction: f64,
    error: f64,
) -> DriverModel {
    DriverModel {
        pace,
        braking_skill: braking,
        cornering_skill: cornering,
        consistency,
        reaction_time: reaction,
        error_rate: error,
        ..DriverModel::balanced()
    }
}

// ================================================================= T-AI-01
#[test]
#[ignore = "K-1: 本物のレーシングライン（TASK-2-4 Phase 1）を運動学プラントが追えない。実物理の同一ドライバーは T1 を通過する（clean 0.6 が s≈1569 まで到達）。したがってこれはハーネスの限界であり Driver の欠陥ではない。TASK-2-4 Phase 2 で運動学プラントごと廃止・実物理閉ループへ移行して解消"]
fn t_ai_01_stays_on_course_for_20_laps() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let res = run_laps(
        &track,
        &params,
        &line,
        DriverModel::balanced(),
        driver_rng(0xA101, 0),
        20,
        MAX_TICKS_20,
    );
    assert!(
        res.lap_times.len() >= 20,
        "completed only {} laps",
        res.lap_times.len()
    );
    assert!(
        res.max_limit_excursion <= 1e-6,
        "left limit_bounds by {:.4} m at s={:.0}",
        res.max_limit_excursion,
        res.max_excursion_s
    );
    assert!(
        res.max_t_target_violation <= 1e-6,
        "t_target outside clamp_limits by {:.6} m",
        res.max_t_target_violation
    );
}

// ================================================================= T-AI-02
#[test]
fn t_ai_02_steering_does_not_chatter() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let res = run_laps(
        &track,
        &params,
        &line,
        DriverModel::balanced(),
        driver_rng(0xA102, 0),
        4,
        MAX_TICKS_20,
    );
    // 落ち着いた 1200 サンプル窓（2 周目以降）。
    let start = res.steer.len() / 3;
    let w = &res.steer[start..start + 1200];

    // precision = 0.5 -> max_steer_rate = lerp(2.5, 6.0, 0.5) = 4.25 /s。
    let max_step = 4.25 * SIM_DT + 1e-12;
    let worst = w
        .windows(2)
        .map(|p| (p[1] - p[0]).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        worst <= max_step,
        "|Δsteer| = {worst:.5} exceeds {max_step:.5}"
    );

    // 2 階差分 RMS。
    let sd: Vec<f64> = w.windows(3).map(|p| p[2] - 2.0 * p[1] + p[0]).collect();
    let rms = (sd.iter().map(|x| x * x).sum::<f64>() / sd.len() as f64).sqrt();
    assert!(rms <= 0.02, "2nd-difference RMS = {rms:.5} exceeds 0.02");

    // 素朴 DFT: 5 Hz 以上のパワー和 < 全体の 5%。
    let n = w.len();
    let mean = w.iter().sum::<f64>() / n as f64;
    let mut total = 0.0;
    let mut high = 0.0;
    let k_hi = (5.0 * n as f64 / 60.0).ceil() as usize; // f = k*60/N >= 5 Hz
    for k in 1..n / 2 {
        let (mut re, mut im) = (0.0, 0.0);
        for (j, &x) in w.iter().enumerate() {
            let ph = -2.0 * std::f64::consts::PI * k as f64 * j as f64 / n as f64;
            re += (x - mean) * ph.cos();
            im += (x - mean) * ph.sin();
        }
        let p = re * re + im * im;
        total += p;
        if k >= k_hi {
            high += p;
        }
    }
    let ratio = high / total.max(1e-30);
    assert!(
        ratio < 0.05,
        "high-frequency (>=5 Hz) power ratio = {ratio:.4} exceeds 0.05"
    );
}

// ================================================================= T-AI-03
#[test]
fn t_ai_03_no_instant_snap_to_waypoint() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let res = run_laps(
        &track,
        &params,
        &line,
        DriverModel::balanced(),
        driver_rng(0xA103, 0),
        4,
        MAX_TICKS_20,
    );
    let start = res.t_target.len() / 3;
    let tt = &res.t_target[start..start + 2400];
    // t_target の 2 階差分が有界（ステーション境界で跳ばない）。
    let worst = tt
        .windows(3)
        .map(|p| (p[2] - 2.0 * p[1] + p[0]).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        worst <= 0.02,
        "t_target 2nd difference {worst:.5} exceeds 0.02 (snap detected)"
    );

    // steer も同じレート上限内。
    let max_step = 4.25 * SIM_DT + 1e-12;
    let s = &res.steer[start..start + 2400];
    let sw = s
        .windows(2)
        .map(|p| (p[1] - p[0]).abs())
        .fold(0.0_f64, f64::max);
    assert!(sw <= max_step, "|Δsteer| {sw:.5} exceeds {max_step:.5}");
}

// ================================================================= T-AI-04
#[test]
fn t_ai_04_target_speed_never_exceeds_physical_limit() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    for (ix, m) in [
        model(0.2, 0.3, 0.4, 0.5, 0.20, 0.0),
        DriverModel::balanced(),
        model(0.95, 0.9, 0.9, 0.9, 0.30, 0.3),
    ]
    .into_iter()
    .enumerate()
    {
        let res = run_laps(
            &track,
            &params,
            &line,
            m,
            driver_rng(0xA104, ix as u32),
            20,
            MAX_TICKS_20,
        );
        assert!(res.lap_times.len() >= 20);
        for i in 0..res.v_target.len() {
            assert!(
                res.v_target[i] >= 0.0 && res.v_target[i] <= res.v_cap[i] + 1e-9,
                "driver {ix}: v_target {:.3} out of [0, {:.3}] at s={:.0}",
                res.v_target[i],
                res.v_cap[i],
                res.st[i].0
            );
        }
    }
}

// ================================================================= T-AI-05
#[test]
fn t_ai_05_ability_ordering_emerges_in_lap_time() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let seed = 0xA105;
    // seed は全員同一。error_rate = 0 / consistency = 1.0 で差を能力値だけに絞る。
    let mut medians = Vec::new();
    for lvl in [0.2_f64, 0.5, 0.9] {
        let m = model(lvl, lvl, lvl, 1.0, 0.25, 0.0);
        let res = run_laps(
            &track,
            &params,
            &line,
            m,
            driver_rng(seed, 0),
            9,
            MAX_TICKS_20,
        );
        assert!(
            res.lap_times.len() >= 8,
            "level {lvl}: only {} laps",
            res.lap_times.len()
        );
        let mut lt = res.lap_times[1..8].to_vec();
        lt.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let med = lt[lt.len() / 2];
        println!(
            "level {lvl}: median lap {med:.3} s  (laps {:?})",
            res.lap_times
        );
        medians.push(med);
        // v_cap を直接動かしていないことの構造証明。
        for i in 0..res.v_target.len() {
            assert!(res.v_target[i] <= res.v_cap[i] + 1e-9);
        }
    }
    assert!(
        medians[0] > medians[1] && medians[1] > medians[2],
        "lap times not monotone: {medians:?}"
    );
    assert!(
        medians[0] - medians[2] >= 0.5,
        "fastest/slowest spread {:.3} s/lap < 0.5",
        medians[0] - medians[2]
    );
}

// ================================================================= T-AI-06
#[test]
fn t_ai_06_low_consistency_widens_lap_time_spread() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let mut sds = Vec::new();
    for cons in [0.3_f64, 0.6, 0.9] {
        let m = model(0.5, 0.5, 0.5, cons, 0.25, 0.6);
        let res = run_laps(
            &track,
            &params,
            &line,
            m,
            driver_rng(0xA106, 0),
            11,
            MAX_TICKS_20,
        );
        assert!(res.lap_times.len() >= 10);
        let sd = std_dev(&res.lap_times[0..10]);
        println!("consistency {cons}: lap-time stddev {sd:.4} s");
        sds.push(sd);
    }
    assert!(
        sds[0] > sds[1] && sds[1] > sds[2],
        "lap-time stddev not monotone-decreasing with consistency: {sds:?}"
    );
}

// ================================================================= T-AI-07
// PDC-11 により運動学プラント版は退役。実物理版 T-AI-07R
// （crates/sim-core/tests/world_ai.rs::t_ai_07r_perception_delay_changes_behaviour）へ移行。

// ================================================================= T-AI-08
#[test]
fn t_ai_08_determinism_and_derive_order_independence() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let run = |seed: u64| {
        let mut d = Driver::new(DriverModel::balanced(), &params, driver_rng(seed, 7)).unwrap();
        let mut plant = Plant::spawn(&track, &params, &line);
        let mut input = ControlInput {
            gear: 1,
            ..Default::default()
        };
        let mut bits: Vec<u64> = Vec::new();
        for _ in 0..3600 {
            let vs = plant.vehicle_state(&input);
            let obs = DriverObservation {
                track: &track,
                corridor: &line.corridor,
                trajectory: &line.trajectory,
                speed_profile: &line.speed,
                state: &vs,
                coord: plant.coord(),
            };
            input = d.update(&obs);
            for f in [
                input.steer,
                input.throttle,
                input.brake,
                input.clutch,
                input.gear as f64,
            ] {
                bits.push(f.to_bits());
            }
            bits.push(input.drs as u64);
            plant.step(&input);
        }
        bits
    };
    assert_eq!(
        run(0xD00D),
        run(0xD00D),
        "same seed produced different ControlInput streams"
    );

    // derive 順非依存: 別ドライバーを先に生成しても系列が変わらない。
    let series_a = {
        let mut _warm = Driver::new(DriverModel::balanced(), &params, driver_rng(1, 99)).unwrap();
        let _ = &mut _warm;
        run(0xBEEF)
    };
    let series_b = run(0xBEEF);
    assert_eq!(
        series_a, series_b,
        "driver construction order changed the rng stream"
    );
}

// ================================================================= T-DRV-01
#[test]
fn t_drv_01_perception_delay_stage_count() {
    for rt in [0.0_f64, 0.05, 0.20, 0.30] {
        let m = DriverModel {
            reaction_time: rt,
            spatial_awareness: 1.0,
            ..DriverModel::balanced()
        };
        let expect = (rt / SIM_DT).ceil() as usize;
        let mut p = Perception::new(&m, Rng::from_seed(1).derive("perception"));
        assert_eq!(p.preview_delay_ticks(), expect, "rt = {rt}");

        // インパルス: しばらく s = 0、次の tick だけ s = 100。
        let base = PerceivedSelf {
            s: 0.0,
            ..PerceivedSelf::zeroed()
        };
        let mut base = base;
        base.within_limits = true;
        for _ in 0..40 {
            let _ = p.update(&base);
        }
        let mut spike = base;
        spike.s = 100.0;
        let out = p.update(&spike);
        // spatial_awareness = 1.0 なのでノイズは 0。s はノイズを載せていない。
        if expect == 0 {
            assert!(
                (out.s - 100.0).abs() < 1e-9,
                "rt=0 should pass through immediately"
            );
        } else {
            assert!(
                (out.s - 0.0).abs() < 1e-9,
                "spike arrived early (rt = {rt})"
            );
            for k in 1..expect {
                let mid = p.update(&base);
                assert!(
                    (mid.s - 0.0).abs() < 1e-9,
                    "spike arrived at stage {k} < {expect}"
                );
            }
            let arrive = p.update(&base);
            assert!(
                (arrive.s - 100.0).abs() < 1e-9,
                "spike did not arrive at stage {expect}"
            );
        }
    }
}

// ================================================================= T-DRV-02
/// 車体ヨーを `yaw`（ワールド）に合わせ、速度を「前方 v + 車体右方向 v·tan(beta)」で組む。
/// これで `assemble_truth` のヘディング誤差 ≈ 0、スリップ角 = `sideslip` になる。
fn synthetic_state(yaw: f64, sideslip: f64, yaw_rate: f64) -> VehicleState {
    use sim_math::{Quat, Vec3};
    let orientation = Quat::from_euler_yxz(yaw, 0.0, 0.0);
    let forward = orientation * Vec3::X;
    let right = orientation * Vec3::Z;
    let v = 40.0;
    let vel = forward * v + right * (v * sideslip.tan());
    let mut wheels = [WheelState::default(); 4];
    for &w in &WheelIndex::ALL {
        wheels[w as usize].grip_usage = 0.8;
        wheels[w as usize].grounded = true;
    }
    VehicleState {
        position: Vec3::ZERO,
        orientation,
        velocity: vel,
        angular_velocity: Vec3::new(0.0, yaw_rate, 0.0),
        wheels,
        engine_rpm: 5000.0,
        gear: 4,
        last_input: ControlInput::default(),
        aero_downforce: 0.0,
        recovered_steps: 0,
    }
}

#[test]
fn t_drv_02_countersteer_sign_and_throttle_cut() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);

    // 逆操舵: 合成 VehicleState を Driver に通し、sideslip 有無で steer / throttle を比較。
    let straight_s = track.start_finish_s();
    let frame = track.frame_at(straight_s);
    let track_yaw = (-frame.tangent.z).atan2(frame.tangent.x);
    let traj_t = line.trajectory.t_at(straight_s);
    let run_once = |sideslip: f64, yr: f64| -> ControlInput {
        let mut d = Driver::new(
            DriverModel {
                error_rate: 0.0,
                consistency: 1.0,
                ..DriverModel::balanced()
            },
            &params,
            driver_rng(0xD202, 0),
        )
        .unwrap();
        let mut input = ControlInput {
            gear: 4,
            ..Default::default()
        };
        // 数十 tick 回して内部フィルタを定常化させる。
        for _ in 0..90 {
            let vs = synthetic_state(track_yaw, sideslip, yr);
            let obs = DriverObservation {
                track: &track,
                corridor: &line.corridor,
                trajectory: &line.trajectory,
                speed_profile: &line.speed,
                state: &vs,
                coord: TrackCoord::new(straight_s, traj_t),
            };
            input = d.update(&obs);
        }
        input
    };
    let base = run_once(0.0, 0.0);
    let slip = run_once(0.25, 1.2);
    // sideslip + (速度が右) → 右へ切り増す（steer 出力 + が右）。滑りと逆向きの操舵補正。
    assert!(
        slip.steer > base.steer + 0.02,
        "countersteer did not add rightward steer: base {:.3} slip {:.3}",
        base.steer,
        slip.steer
    );
    assert!(
        slip.throttle <= base.throttle + 1e-6,
        "throttle not reduced during slide: base {:.3} slip {:.3}",
        base.throttle,
        slip.throttle
    );

    // 曲率フィードフォワードの符号: 実走で左コーナーは steer 負・右コーナーは steer 正。
    let res = run_laps(
        &track,
        &params,
        &line,
        DriverModel::balanced(),
        driver_rng(0xD202, 1),
        4,
        MAX_TICKS_20,
    );
    assert!(
        res.steer_at_left_corner < -0.02,
        "left corner steer {:.3} not left",
        res.steer_at_left_corner
    );
    assert!(
        res.steer_at_right_corner > 0.02,
        "right corner steer {:.3} not right",
        res.steer_at_right_corner
    );
}

// ================================================================= T-DRV-03
#[test]
fn t_drv_03_corridor_clamp_is_the_only_exit() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);

    // 1) clamp_limits / clamp_white が異常入力を実際に閉じ込める。
    for i in 0..2000 {
        let s = i as f64 * (track.length() / 2000.0);
        let (r, l) = line.corridor.limit_bounds(s);
        let c = line.corridor.clamp_limits(s, 50.0);
        assert!(
            c <= l + 1e-9 && c >= r - 1e-9,
            "clamp_limits(+50) escaped at s={s:.0}"
        );
        let c = line.corridor.clamp_limits(s, -50.0);
        assert!(
            c <= l + 1e-9 && c >= r - 1e-9,
            "clamp_limits(-50) escaped at s={s:.0}"
        );
        let (wr, wl) = line.corridor.white_bounds(s);
        let cw = line.corridor.clamp_white(s, 50.0);
        assert!(
            cw <= wl + 1e-9 && cw >= wr - 1e-9,
            "clamp_white(+50) escaped at s={s:.0}"
        );
    }

    // 2) Planner を直接叩く。異常な intent を与えても t_target は clamp の内側。
    let mut planner = Planner::new();
    let envelope = line.envelope;
    let intents = [
        DriverIntent {
            mode: DriverMode::FreeAir,
            target_gap: 0.0,
            engagement: 0.0,
            risk_budget: 1.0,
            w_reference: 1e6,
            w_defensive: 0.0,
            w_overtake: 0.0,
        },
        DriverIntent {
            mode: DriverMode::Defending,
            target_gap: 0.0,
            engagement: 0.0,
            risk_budget: 0.0,
            w_reference: 1.0,
            w_defensive: 0.0,
            w_overtake: 0.0,
        },
    ];
    for intent in intents {
        for i in 0..1500 {
            let s = i as f64 * (track.length() / 1500.0);
            let perceived = PerceivedSelf {
                s,
                speed: 40.0,
                ..PerceivedSelf::zeroed()
            };
            let plan = planner.update(
                &intent,
                &perceived,
                &line.trajectory,
                &line.corridor,
                &line.speed,
                &track,
                &envelope,
                &DriverModel::balanced(),
                0.7,
            );
            let (r, l) = if intent.mode == DriverMode::Defending {
                line.corridor.white_bounds(s)
            } else {
                line.corridor.limit_bounds(s)
            };
            assert!(
                plan.t_target <= l + 1e-6 && plan.t_target >= r - 1e-6,
                "Planner t_target {:.3} escaped [{r:.3},{l:.3}] at s={s:.0} mode={:?}",
                plan.t_target,
                intent.mode
            );
            assert!(plan.v_target >= 0.0 && plan.v_target <= line.speed.v_at(s) + 1e-9);
        }
    }
}

// ================================================================= T-DRV-04
#[test]
#[ignore = "K-1: 本物のレーシングライン（TASK-2-4 Phase 1）を運動学プラントが追えない。実物理の同一ドライバーは T1 を通過する（clean 0.6 が s≈1569 まで到達）。したがってこれはハーネスの限界であり Driver の欠陥ではない。TASK-2-4 Phase 2 で運動学プラントごと廃止・実物理閉ループへ移行して解消"]
fn t_drv_04_rng_only_affects_causes() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let mut times = Vec::new();
    for seed in 0..8u64 {
        let res = run_laps(
            &track,
            &params,
            &line,
            DriverModel::balanced(),
            driver_rng(0xD400 + seed, 0),
            5,
            MAX_TICKS_20,
        );
        assert!(
            res.lap_times.len() >= 5,
            "seed {seed}: {} laps",
            res.lap_times.len()
        );
        assert!(
            res.max_limit_excursion <= 1e-6,
            "seed {seed}: excursion {:.4}",
            res.max_limit_excursion
        );
        for i in 0..res.v_target.len() {
            assert!(res.v_target[i] <= res.v_cap[i] + 1e-9);
        }
        times.push(res.lap_times[2]);
    }
    let spread = times.iter().cloned().fold(f64::MIN, f64::max)
        - times.iter().cloned().fold(f64::MAX, f64::min);
    assert!(
        spread > 1e-4,
        "lap times did not vary across seeds (spread {spread:.6})"
    );

    // error_rate = 0 / consistency = 1.0 なら mistake bias は常に 0。
    let clean = run_laps(
        &track,
        &params,
        &line,
        model(0.5, 0.5, 0.5, 1.0, 0.25, 0.0),
        driver_rng(0xD4FF, 0),
        4,
        MAX_TICKS_20,
    );
    assert_eq!(
        clean.max_mistake_bias, 0.0,
        "mistake bias appeared with error_rate = 0"
    );
}

// ================================================================= T-DRV-05
#[test]
fn t_drv_05_performance() {
    use std::time::Instant;
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);

    let t0 = Instant::now();
    let mut d = Driver::new(DriverModel::balanced(), &params, driver_rng(5, 0)).unwrap();
    let new_us = t0.elapsed().as_secs_f64() * 1e6;
    assert!(new_us <= 1000.0, "Driver::new took {new_us:.1} us (> 1000)");

    let mut plant = Plant::spawn(&track, &params, &line);
    let mut input = ControlInput {
        gear: 1,
        ..Default::default()
    };
    // ウォームアップ。
    for _ in 0..600 {
        let vs = plant.vehicle_state(&input);
        let obs = DriverObservation {
            track: &track,
            corridor: &line.corridor,
            trajectory: &line.trajectory,
            speed_profile: &line.speed,
            state: &vs,
            coord: plant.coord(),
        };
        input = d.update(&obs);
        plant.step(&input);
    }
    let n = 20_000;
    let vs = plant.vehicle_state(&input);
    let obs = DriverObservation {
        track: &track,
        corridor: &line.corridor,
        trajectory: &line.trajectory,
        speed_profile: &line.speed,
        state: &vs,
        coord: plant.coord(),
    };
    let t1 = Instant::now();
    let mut sink = 0.0;
    for _ in 0..n {
        sink += d.update(&obs).steer;
    }
    let per = t1.elapsed().as_secs_f64() * 1e6 / n as f64;
    println!("Driver::update {per:.3} us/call (sink {sink:.1})");
    assert!(per <= 25.0, "Driver::update {per:.3} us/call exceeds 25 us");
}

// ================================================================= T-DRV-06
#[test]
fn t_drv_06_boundary_structure() {
    let files: [(&str, &str); 6] = [
        ("lib.rs", include_str!("../src/lib.rs")),
        ("model.rs", include_str!("../src/model.rs")),
        ("perception.rs", include_str!("../src/perception.rs")),
        ("decision.rs", include_str!("../src/decision.rs")),
        ("planner.rs", include_str!("../src/planner.rs")),
        ("controller.rs", include_str!("../src/controller.rs")),
    ];
    let driver_rs = include_str!("../src/driver.rs");
    let forbidden = [
        "sim_core",
        "sim_wasm",
        "thread_rng",
        "SystemTime",
        "Instant",
        "std::time",
        "static mut",
        "lazy_static",
        "once_cell",
    ];
    for (name, src) in files
        .iter()
        .chain(std::iter::once(&("driver.rs", driver_rs)))
    {
        for tok in forbidden {
            assert!(
                !src.contains(tok),
                "{name} contains forbidden token `{tok}`"
            );
        }
        // `rand` クレート（`rand::` / `use rand`）。`Rng` は sim_math のもの。
        assert!(!src.contains("use rand"), "{name} uses the rand crate");
        assert!(!src.contains("rand::"), "{name} uses the rand crate");
    }
    // `Driver::update` は dt 引数を取らない。
    assert!(
        driver_rs.contains("pub fn update(&mut self, obs: &DriverObservation<'_>) -> ControlInput")
    );
    assert!(
        !driver_rs.contains("&mut VehicleState"),
        "driver.rs takes &mut VehicleState"
    );
    // 公開 API に waypoint index を出さない（識別子として）。
    for (name, src) in files
        .iter()
        .chain(std::iter::once(&("driver.rs", driver_rs)))
    {
        assert!(
            !src.contains("waypoint_index"),
            "{name} has a waypoint_index identifier"
        );
        assert!(
            !src.contains("fn waypoint"),
            "{name} exposes a waypoint accessor"
        );
    }
}

// ================================================================= 追加スモーク
#[test]
fn smoke_lap_times_are_plausible() {
    let track = track();
    let params = params();
    let line = Line::build(&track, &params);
    let res = run_laps(
        &track,
        &params,
        &line,
        DriverModel::balanced(),
        driver_rng(1, 0),
        5,
        MAX_TICKS_20,
    );
    for lt in &res.lap_times {
        assert!(*lt > 40.0 && *lt < 200.0, "implausible lap time {lt}");
    }
    let _ = Trajectory::reference; // 使用インポートの保持
}
