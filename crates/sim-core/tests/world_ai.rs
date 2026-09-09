//! TASK-2-3 受け入れテスト — Driver AI が実物理（実 `Vehicle` + 実 `TrackGround`）で
//! Aoyama Ring を走る閉ループの検証。
//!
//! トラック（`assets/tracks/aoyama_ring.track.json`）と車両
//! （`assets/vehicles/gt_proto_a.spec.json`）は実アセットを読む。

use std::path::PathBuf;

use sim_core::{DriverModel, RacingLine, Track, VehicleId, World, SIM_DT};
use sim_math::Rng;
use sim_track::load_track;
use sim_vehicle::VehicleParams;

const SPEC_JSON: &str = include_str!("../../../assets/vehicles/gt_proto_a.spec.json");

/// グリッドを置く S/F ストレート上の弧長 [m]。
const GRID_S: f64 = 40.0;

fn track() -> Track {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("tracks")
        .join("aoyama_ring.track.json");
    load_track(path).expect("bundled circuit loads and validates")
}

fn params() -> VehicleParams {
    VehicleParams::from_json_str(SPEC_JSON).expect("gt_proto_a.spec.json loads and validates")
}

fn world_with_line() -> World {
    let track = track();
    let mut world = World::new(track);
    let line = RacingLine::generate(world.track(), &params(), RacingLine::DEFAULT_STEP_M);
    world.attach_racing_line(line);
    world
}

/// テスト用ドライバー能力値。`level` が pace / braking / cornering を同時に動かす。
fn driver_model(level: f64) -> DriverModel {
    DriverModel {
        pace: level,
        braking_skill: level,
        cornering_skill: level,
        racecraft: 0.5,
        aggression: 0.5,
        consistency: 1.0,
        overtaking_skill: 0.5,
        defending_skill: 0.5,
        wet_skill: 0.5,
        tyre_management: 0.5,
        risk_tolerance: 0.5,
        reaction_time: 0.20,
        spatial_awareness: 1.0,
        error_rate: 0.0,
    }
}

// =============================================================================================
// T-CORE-AI-01 / 02 — Simulation Tick の構造と後方互換（Driver 不要・手動入力で検証）
// =============================================================================================

use sim_core::ControlInput;
use sim_driver::PHYSICS_TICKS_PER_SIM_TICK;

fn manual(throttle: f64, gear: i8) -> ControlInput {
    ControlInput {
        steer: 0.0,
        throttle,
        brake: 0.0,
        clutch: 0.0,
        gear,
        drs: false,
    }
}

#[test]
fn t_core_ai_01_sim_tick_structure() {
    let mut w = world_with_line();
    w.spawn(params(), GRID_S, 0.0).unwrap();

    let phys_before = w.tick();
    let sim_before = w.sim_tick();
    w.step_sim_tick_with(&[manual(0.5, 2)]);
    assert_eq!(w.tick() - phys_before, PHYSICS_TICKS_PER_SIM_TICK as u64);
    assert_eq!(w.sim_tick() - sim_before, 1);

    // 同一 ControlInput が 4 物理 tick 保持されること = Driver::update が 1 回しか
    // 呼ばれていないことの外形的証拠。VehicleState::last_input を 4 物理 tick 観測する。
    // （step_sim_tick_with の内部で step が 4 回呼ばれ、毎回 last_input が更新される。
    //  4 回とも同じ値なら zero-order hold。）
    let mut w2 = world_with_line();
    w2.spawn(params(), GRID_S, 0.0).unwrap();
    let inp = manual(0.7, 3);
    // step を直接 4 回、同じ入力で回す（step_sim_tick_with と等価な物理列）。
    for _ in 0..PHYSICS_TICKS_PER_SIM_TICK {
        w2.step(std::slice::from_ref(&inp));
        let li = w2.vehicles()[0].vehicle.state().last_input;
        assert_eq!(li.throttle, 0.7);
        assert_eq!(li.gear, 3);
    }
}

#[test]
fn t_core_ai_02_step_backward_compat() {
    // AI を持たない World で step_sim_tick を N 回 == step(&[default]) を 4N 回。
    let n = 50u64;

    let mut a = world_with_line();
    a.spawn(params(), GRID_S, 0.0).unwrap();
    for _ in 0..n {
        a.step_sim_tick();
    }

    let mut b = world_with_line();
    b.spawn(params(), GRID_S, 0.0).unwrap();
    let def = ControlInput::default();
    for _ in 0..(n * PHYSICS_TICKS_PER_SIM_TICK as u64) {
        b.step(std::slice::from_ref(&def));
    }

    let sa = a.vehicles()[0].vehicle.state();
    let sb = b.vehicles()[0].vehicle.state();
    assert_eq!(sa.position.x.to_bits(), sb.position.x.to_bits(), "pos.x");
    assert_eq!(sa.position.y.to_bits(), sb.position.y.to_bits(), "pos.y");
    assert_eq!(sa.position.z.to_bits(), sb.position.z.to_bits(), "pos.z");
    assert_eq!(sa.velocity.x.to_bits(), sb.velocity.x.to_bits(), "vel.x");
    assert_eq!(a.tick(), b.tick());
    assert_eq!(
        a.vehicles()[0].coord.s.to_bits(),
        b.vehicles()[0].coord.s.to_bits()
    );
}

#[test]
fn t_core_ai_06_racing_line_generated_once() {
    // attach 前の spawn_with_driver は NoRacingLine。
    let mut w = World::new(track());
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(0), VehicleId(0));
    let err = w.spawn_with_driver(params(), GRID_S, 0.0, driver_model(0.5), rng);
    assert!(matches!(err, Err(sim_core::WorldError::NoRacingLine)));
}

// =============================================================================================
// TASK-2-3 land (Architect Round 2 裁定 / 2026-09-09) — 実物理閉ループのうち
// **PDC-6 で実証済みの区間**（S/F → T3 → 中速セクション、`s < S_VALIDATED_M`）に限定した検証。
// 3 周完走系（T-CORE-AI-03）と能力値創発（T-AI-01R/05R/07R）は TASK-2-4 へ繰り越し
// （根因 = `sim-line::Trajectory::reference` の未収束基準ライン。`s ≈ 3150` の lateral weave）。
// =============================================================================================

/// PDC-6 で逸脱ゼロ走行が実証されている弧長の上限 [m]。TASK-2-4 で全周へ拡張する。
const S_VALIDATED_M: f64 = 3100.0;
/// コリドー封じ込めの許容 [m]。Architect 契約どおり 0 m。
///
/// **注意（Architect 監査 2026-09-09・HIGH）**: この 0 m 緑は堅牢性の証拠ではない。
/// `level 0.6 / consistency 1.0` という **1 点**でしか成立しない（下の
/// `clean_reference_driver` の実測表を参照）。TASK-2-4 の T-CORE-AI-11（モデルスイープ）で
/// `S_VALIDATED_M` を全周へ広げつつ、この 0 を全モデルで維持できるようにする。
const CONTAIN_TOL_M: f64 = 0.0;

/// 静止発進の過渡を除くためにスキップする先頭 Simulation Tick 数（約 1.5 s）。
const WARMUP_TICKS: u64 = 90;

/// 検証区間テスト用の「クリーンな基準ドライバー」。全スキル 0.6 / `consistency` 1.0 /
/// `error_rate` 0.0 / `reaction_time` 0.20。
///
/// **Deviation from spec（Architect 契約は `DriverModel::balanced()` を指定・代替は承認済み）**:
/// TASK-2-3 の被検体は構造配線 + PDC-6 であり、ドライバーのノイズ軸から単離するのが正しい。
///
/// **T3 が落ちる真の理由（Architect が軸別に実測。seed 1/2/3 で各軸を単独で動かす）**:
/// `error_rate 0.5` / `spatial_awareness 0.5` / `reaction_time 0.25` を単独で
/// `balanced()` 相当にしても **完走する**。破綻するのは
/// (1) `consistency 0.5`（正規化操舵ノイズ σ ≈ 1%）→ s≈1554〜1626 で breach、
/// (2) **能力値 0.6 → 0.5（pace/braking/cornering）→ 3 seed とも s=1543 で決定論的 breach**。
/// (2) は乱数が一切関与しない。しかも `braking_skill` を下げると計画減速度は
/// `lerp(0.80,1.00,skill)` で**下がる = 早めにブレーキ = 安全側**のはずで、`pace` を下げれば
/// `v_target` も下がる。**全部を安全側に振ると T3 で落ちる**という非単調挙動であり、
/// **T3 の閉ループ安定余裕が実質ゼロ**であることの証拠。PDC-6 は T3 を「修理」したのではなく
/// level 0.6 という 1 点で閾値の向こうへ押しただけ（PDC-6 自体は物理的に正しく、外すと
/// s≈1501 で即破綻するので入れる価値はある）。根治は TASK-2-4（未収束基準ライン +
/// lateral inner loop の実タイヤ検証）。
fn clean_reference_driver() -> DriverModel {
    let mut m = driver_model(0.6);
    m.reaction_time = 0.20;
    m
}

/// solo・クリーン基準ドライバー・seed 固定で `s` が `S_VALIDATED_M` に達するまで
/// 走らせ、各 tick で `f(&World)` を呼ぶ。到達前に打ち切られたら panic（PDC-6 の回帰検出）。
fn run_solo_until_validated(seed: u64, mut f: impl FnMut(&World)) {
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
    world
        .spawn_with_driver(params(), GRID_S, 0.0, clean_reference_driver(), rng)
        .unwrap();

    // 4139 m 中 3100 m を ~50 m/s 平均で走ると ~62 s = ~3700 Simulation Tick。余裕を見て 6000。
    let max_ticks = 6000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        if world.vehicles()[0].coord.s >= S_VALIDATED_M {
            return;
        }
        if world.sim_tick() > WARMUP_TICKS {
            f(&world);
        }
    }
    panic!(
        "clean reference driver did not reach s = {S_VALIDATED_M} m within {max_ticks} sim ticks \
         (final s = {:.1}, t = {:+.2}). PDC-6 regression?",
        world.vehicles()[0].coord.s,
        world.vehicles()[0].coord.t,
    );
}

/// T-CORE-AI-04 — `VehicleEntry::coord` が真値（`world_to_track` の再投影と一致）。
/// Driver フェーズは `coord` を消費するだけで書き換えない（書き換えは `World::step` のみ）。
#[test]
fn t_core_ai_04_coord_is_ground_truth() {
    let mut worst = 0.0_f64;
    run_solo_until_validated(1, |w| {
        let e = &w.vehicles()[0];
        let pos = e.vehicle.state().position;
        // 独立に再投影（前 tick の s をヒントに）。World が保持する coord と一致するはず。
        let truth = w.track().world_to_track(pos, Some(e.coord.s));
        let ds = w.track().signed_delta_s(e.coord.s, truth.s).abs();
        let dt = (e.coord.t - truth.t).abs();
        worst = worst.max(ds.max(dt));
        assert!(
            ds < 1e-6 && dt < 1e-6,
            "coord drifted from ground truth at s={:.1}: ds={ds:.2e} dt={dt:.2e}",
            e.coord.s
        );
    });
    eprintln!("T-CORE-AI-04: worst |coord - world_to_track| = {worst:.2e} m");
}

/// T-CORE-AI-05 — `ControlInput` が唯一の作用経路。物理へ渡った `state.last_input` と
/// Driver が出した `driver.last_input()` の 6 成分がビット一致（zero-order hold の証拠）。
#[test]
fn t_core_ai_05_control_input_is_the_only_channel() {
    run_solo_until_validated(2, |w| {
        let applied = w.vehicles()[0].vehicle.state().last_input;
        let produced = w.driver(VehicleId(0)).unwrap().last_input();
        assert_eq!(applied.steer.to_bits(), produced.steer.to_bits(), "steer");
        assert_eq!(
            applied.throttle.to_bits(),
            produced.throttle.to_bits(),
            "throttle"
        );
        assert_eq!(applied.brake.to_bits(), produced.brake.to_bits(), "brake");
        assert_eq!(
            applied.clutch.to_bits(),
            produced.clutch.to_bits(),
            "clutch"
        );
        assert_eq!(applied.gear, produced.gear, "gear");
        assert_eq!(applied.drs, produced.drs, "drs");
    });
}

/// T-CORE-AI-07 — 変速の健全性（Design Concern 2 の計測）。**数値を必ず報告する**
/// （Architect が TASK-2-4 の要否を判断する材料）。
#[test]
fn t_core_ai_07_gearing_sanity() {
    let p = params();
    let limiter = p.engine.limiter_rpm;
    let idle = p.engine.idle_rpm;

    let mut ticks = 0u64;
    let mut limiter_banging = 0u64;
    let mut bogging = 0u64;
    run_solo_until_validated(1, |w| {
        ticks += 1;
        let st = w.vehicles()[0].vehicle.state();
        let inp = w.driver(VehicleId(0)).unwrap().last_input();
        if st.engine_rpm > 0.995 * limiter {
            limiter_banging += 1;
        }
        if inp.throttle > 0.5 && st.engine_rpm < 1.2 * idle {
            bogging += 1;
        }
    });

    let f_lim = limiter_banging as f64 / ticks as f64;
    let f_bog = bogging as f64 / ticks as f64;
    eprintln!(
        "T-CORE-AI-07: {ticks} ticks, limiter-banging {:.2}% ({limiter_banging}), \
         bogging {:.2}% ({bogging})",
        100.0 * f_lim,
        100.0 * f_bog,
    );
    assert!(f_lim < 0.02, "limiter-banging {:.2}% >= 2%", 100.0 * f_lim);
    assert!(f_bog < 0.02, "bogging {:.2}% >= 2%", 100.0 * f_bog);
}

/// T-CORE-AI-08 — 決定性 + `spawn_with_driver` の順序非依存。
#[test]
fn t_core_ai_08_determinism_and_spawn_order_independence() {
    // (a) 同一 seed の 2 ラン（2000 Simulation Tick = ~33 s、T3 通過前で打ち切り）が
    //     ビット一致すること。
    fn run(seed: u64) -> (f64, f64, f64, f64, f64) {
        let mut w = world_with_line();
        let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
        // balanced() は error_rate 0.5 + consistency 0.5 = RNG 駆動のミス/ノイズ経路を
        // 通す。決定性が崩れるならここに出る。T3 のスピン（~t=35 s）より十分手前で打ち切る。
        w.spawn_with_driver(params(), GRID_S, 0.0, DriverModel::balanced(), rng)
            .unwrap();
        for _ in 0..1200 {
            w.step_sim_tick();
        }
        let s = w.vehicles()[0].vehicle.state();
        (
            s.position.x,
            s.position.y,
            s.position.z,
            s.velocity.x,
            w.vehicles()[0].coord.s,
        )
    }
    let a = run(7);
    let b = run(7);
    assert_eq!(a.0.to_bits(), b.0.to_bits(), "pos.x not deterministic");
    assert_eq!(a.1.to_bits(), b.1.to_bits(), "pos.y not deterministic");
    assert_eq!(a.2.to_bits(), b.2.to_bits(), "pos.z not deterministic");
    assert_eq!(a.3.to_bits(), b.3.to_bits(), "vel.x not deterministic");
    assert_eq!(a.4.to_bits(), b.4.to_bits(), "coord.s not deterministic");

    // (b) driver_rng(race, VehicleId(0)) は VehicleId(1) の派生有無で不変
    //     （`Rng::derive` はラベル固定・親状態を変えない）。
    let race = Rng::from_seed(42);
    let r0_alone = sim_core::rng::driver_rng(&race, VehicleId(0));
    let _r1 = sim_core::rng::driver_rng(&race, VehicleId(1));
    let r0_after = sim_core::rng::driver_rng(&race, VehicleId(0));
    assert_eq!(
        r0_alone.state_hash(),
        r0_after.state_hash(),
        "driver_rng(VehicleId(0)) depends on whether VehicleId(1) was derived"
    );
}

/// T-CORE-AI-09 — 性能。`step_sim_tick` は 24 台で ≤ 3.5 ms。
#[test]
fn t_core_ai_09_step_sim_tick_performance() {
    const N_CARS: usize = 24;
    const BUDGET_MS: f64 = 3.5;

    let mut world = world_with_line();
    let race = Rng::from_seed(2024);
    for i in 0..N_CARS {
        let id = VehicleId(i);
        let rng = sim_core::rng::driver_rng(&race, id);
        // グリッドを S/F ストレートに縦列で置く（Phase 2 は車車間衝突なし）。
        let s = world.track().wrap_s(GRID_S + i as f64 * 6.0);
        world
            .spawn_with_driver(params(), s, 0.0, DriverModel::balanced(), rng)
            .unwrap();
    }

    // ウォームアップ（発進の過渡 + 分岐予測 / キャッシュ）。
    for _ in 0..120 {
        world.step_sim_tick();
    }

    let iters = 240u32;
    let t0 = std::time::Instant::now();
    for _ in 0..iters {
        world.step_sim_tick();
    }
    let per_tick_ms = t0.elapsed().as_secs_f64() * 1e3 / iters as f64;
    eprintln!(
        "T-CORE-AI-09: {N_CARS} cars, step_sim_tick = {per_tick_ms:.3} ms/tick \
         (budget {BUDGET_MS} ms, {} phys ticks/sim tick)",
        SIM_DT / sim_vehicle::PHYSICS_DT
    );
    assert!(
        per_tick_ms <= BUDGET_MS,
        "step_sim_tick {per_tick_ms:.3} ms > {BUDGET_MS} ms budget for {N_CARS} cars"
    );
}

/// T-CORE-AI-10 — コリドー封じ込め（`s < S_VALIDATED_M` に限定）。
/// TASK-2-4 で `S_VALIDATED_M` を全周へ拡張し、`CONTAIN_TOL_M` を 0 へ締める。
#[test]
fn t_core_ai_10_corridor_containment_validated_section() {
    let line_corridor = world_with_line();
    let corridor = line_corridor.racing_line().unwrap().corridor();
    // corridor は World が保持するものと同一パラメータ（RacingLine::generate 由来）。

    let mut worst_outside = 0.0_f64;
    let mut worst_s = 0.0_f64;
    run_solo_until_validated(1, |w| {
        let e = &w.vehicles()[0];
        let (t_right, t_left) = corridor.limit_bounds(e.coord.s);
        let outside = (t_right - e.coord.t).max(e.coord.t - t_left).max(0.0);
        if outside > worst_outside {
            worst_outside = outside;
            worst_s = e.coord.s;
        }
        assert!(
            outside <= CONTAIN_TOL_M,
            "corridor breach at s={:.1}: t={:+.3} not in [{:+.3}, {:+.3}] (outside by {:.3} m)",
            e.coord.s,
            e.coord.t,
            t_right,
            t_left,
            outside,
        );
    });
    eprintln!(
        "T-CORE-AI-10: worst excursion {worst_outside:.3} m at s={worst_s:.1} \
         (tol {CONTAIN_TOL_M} m, validated to s={S_VALIDATED_M} m)"
    );
}
