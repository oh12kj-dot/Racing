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

/// 弧長 `s` におけるレーシングラインの横位置。**Driver を回すテストは spawn をライン上に置く。**
///
/// TASK-2-4 Phase 1 で基準線が幅を使うようになり `t_at(GRID_S) ≈ +4.6 m`（センターラインから
/// 4.6 m）。**現行の lateral inner loop は S/F ストレート上で 4.6 m のレーンチェンジを
/// 立ち上がりから実行できず**、`t = 0` spawn だと s≈71 でコリドーを割り s≈126 で
/// 4 秒走らずコースアウトする（HEAD ではクリーンだった）。これは K-1（横方向インナーループの
/// 安定余裕ゼロ）の一部で、Phase 1 では承認 B が無く直せない。初期条件をライン上へ固定するのは
/// **T3 の失敗をこの straight-lane-change の失敗から切り離す**ためで、後者の回帰は
/// `#[ignore]` の [`t_core_ai_10_offline_spawn`] が記録する（Architect HIGH-1）。運動学プラントの
/// `Plant::spawn` も `t0 = line.trajectory.t_at(s0)` としている。
fn line_t(world: &World, s: f64) -> f64 {
    world.racing_line().unwrap().trajectory().t_at(s)
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

/// 現在コース保持が緑を維持できる弧長の上限 [m]。
///
/// **TASK-2-4 Phase 1（Architect 監査）で `3100 → 1400`（T3 手前）へ縮小**。本物の out-in-out
/// レーシングライン（Phase 1）では T3 進入速度が上がり、lateral inner loop（K-1）が保持できず
/// clean 0.6 でも s≈1561 で `coord.t` が `limit_bounds` を 7 cm 超える。`s < 1400` は T1 の
/// **95% 幅ライン**と T2 を含むので、Phase 2 の回帰網として実際に機能する。T3 以降の全周版は
/// `#[ignore]` の `t_core_ai_10_full` に温存（`S_VALIDATED_FULL_M`）。
/// **縮小と ignore の両方をやることで回帰情報は失われない**（Architect Round-4 訂正裁定）。
const S_VALIDATED_M: f64 = 1400.0;
/// 全周版（K-1 解消後・Phase 2 の受け入れ）の弧長上限 [m]。
const S_VALIDATED_FULL_M: f64 = 3100.0;
/// コリドー封じ込めの許容 [m]。Architect 契約どおり 0 m。
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

/// solo・クリーン基準ドライバー（ライン上に spawn）・seed 固定で `s` が `until_s` に達するまで
/// 走らせ、各 tick で `f(&World)` を呼ぶ。到達前に打ち切られたら panic（回帰検出）。
fn run_solo_until(seed: u64, until_s: f64, f: impl FnMut(&World)) {
    run_solo_from_until(seed, None, until_s, f)
}

/// [`run_solo_until`] の spawn 横位置を上書きできる版。`spawn_t = None` はライン上
/// （`t_at(GRID_S)`）、`Some(t)` は明示。`Some(0.0)` は実グリッド位置＝センターライン
/// （[`t_core_ai_10_offline_spawn`] が K-1 の straight-lane-change 失敗を記録するのに使う）。
fn run_solo_from_until(seed: u64, spawn_t: Option<f64>, until_s: f64, mut f: impl FnMut(&World)) {
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
    let gt = spawn_t.unwrap_or_else(|| line_t(&world, GRID_S));
    world
        .spawn_with_driver(params(), GRID_S, gt, clean_reference_driver(), rng)
        .unwrap();

    let max_ticks = 6000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        if world.vehicles()[0].coord.s >= until_s {
            return;
        }
        if world.sim_tick() > WARMUP_TICKS {
            f(&world);
        }
    }
    panic!(
        "clean reference driver did not reach s = {until_s} m within {max_ticks} sim ticks \
         (final s = {:.1}, t = {:+.2}). regression?",
        world.vehicles()[0].coord.s,
        world.vehicles()[0].coord.t,
    );
}

/// T-CORE-AI-04 — `VehicleEntry::coord` が真値（`world_to_track` の再投影と一致）。
/// Driver フェーズは `coord` を消費するだけで書き換えない（書き換えは `World::step` のみ）。
#[test]
fn t_core_ai_04_coord_is_ground_truth() {
    let mut worst = 0.0_f64;
    run_solo_until(1, S_VALIDATED_M, |w| {
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
    run_solo_until(2, S_VALIDATED_M, |w| {
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
    run_solo_until(1, S_VALIDATED_M, |w| {
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
        let gt = line_t(&w, GRID_S);
        w.spawn_with_driver(params(), GRID_S, gt, DriverModel::balanced(), rng)
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
        // グリッドを S/F ストレートに縦列で置く（Phase 2 は車車間衝突なし）。ライン上に置く。
        let s = world.track().wrap_s(GRID_S + i as f64 * 6.0);
        let st = line_t(&world, s);
        world
            .spawn_with_driver(params(), s, st, DriverModel::balanced(), rng)
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

/// クリーン基準ドライバーが `until_s` まで、全 tick で `coord.t` が `limit_bounds` の
/// 内側（許容 `CONTAIN_TOL_M`）に居ることを検証する。`spawn_t = None` はライン上 spawn。
fn corridor_containment_check(spawn_t: Option<f64>, until_s: f64) {
    let line_corridor = world_with_line();
    let corridor = line_corridor.racing_line().unwrap().corridor();
    let mut worst_outside = 0.0_f64;
    let mut worst_s = 0.0_f64;
    run_solo_from_until(1, spawn_t, until_s, |w| {
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
        "corridor containment: worst excursion {worst_outside:.3} m at s={worst_s:.1} \
         (tol {CONTAIN_TOL_M} m, validated to s={until_s} m)"
    );
}

/// T-CORE-AI-10 — コリドー封じ込め（ライン上 spawn・`s < S_VALIDATED_M` = 1400・T3 手前）。
/// T1 の 95% 幅ラインと T2 を含む Phase 2 の回帰網。T3 以降は K-1 のため
/// `t_core_ai_10_full`（`#[ignore]`）、`t = 0` spawn は `t_core_ai_10_offline_spawn`（`#[ignore]`）へ。
#[test]
fn t_core_ai_10_corridor_containment_validated_section() {
    corridor_containment_check(None, S_VALIDATED_M);
}

/// T-CORE-AI-10-FULL — 全周版（ライン上 spawn・`s < 3100`）。
/// **TASK-2-4 Phase 2 の受け入れ = この ignore を外す。**
#[test]
#[ignore = "K-1（TASK-2-4 Phase 1）: 本物の out-in-out レーシングライン（Phase 1 で幅使用を回復）\
            では T3 進入速度が上がり、lateral inner loop（K_HEADING / K_YAW_DAMP / delta_cs の位相）\
            が保持できず s≈1561 で coord.t が limit_bounds を 7 cm 超え、その後 |t|≈19.5 m まで \
            excursion する。過剰正則化された λ 版では緑だったが、それはラインがぬるく T3 進入が \
            遅かったため（緑だが実は壊れている状態）。**S_VALIDATED_M の縮小は t_core_ai_10_full \
            とセットでのみ許される。単独での縮小は禁止**（回帰情報が消える）。TASK-2-4 Phase 2 \
            （lateral inner loop の実タイヤ再設計）で解消し、この ignore を外して全周へ。"]
fn t_core_ai_10_full() {
    corridor_containment_check(None, S_VALIDATED_FULL_M);
}

/// T-CORE-AI-10-OFFLINE — 実グリッド位置（`t = 0` = センターライン）から spawn したときの
/// コリドー封じ込め。**TASK-2-4 Phase 2 の受け入れ = この ignore を外す。**
///
/// `line_t` のコメント参照: TASK-2-4 Phase 1 で `t_at(GRID_S) ≈ +4.6 m` になり、現行の
/// lateral inner loop は S/F ストレート上でこの 4.6 m レーンチェンジを立ち上がりから
/// 実行できず s≈71 でコリドーを割る（HEAD ではクリーンだった）。Driver を回すテストの
/// spawn をライン上へ固定してこの失敗を T3 の失敗から切り離しているが、その回帰情報を
/// ここで保持する。3 本目の T3 由来 ignore とは別の、4 本目の正直な ignore。
#[test]
#[ignore = "K-1（TASK-2-4 Phase 1）: 現行 lateral inner loop は S/F ストレート上で基準線までの \
            4.6 m レーンチェンジを立ち上がりから実行できず、t=0 spawn だと s≈71 でコリドーを割り \
            s≈126 でコースアウトする（HEAD ではクリーンだった）。単独走行テストの spawn を \
            ライン上へ固定してこの失敗を T3 の失敗から切り離しているため、その回帰を本テストで \
            記録する。TASK-2-4 Phase 2（lateral inner loop の実タイヤ再設計・運動学プラント廃止・\
            人間承認 B）で解消し、この ignore を外す。"]
fn t_core_ai_10_offline_spawn() {
    corridor_containment_check(Some(0.0), S_VALIDATED_M);
}

// =============================================================================================
// T-CORE-AI-11 — 堅牢性スイープ（TASK-2-4 Phase 2 の実質的合否・Architect 監査 2026-09-09 R3）
//
// `level ∈ {0.3, 0.5, 0.7, 0.9}` × `consistency ∈ {0.5, 1.0}` × `error_rate ∈ {0.0, 0.5}` ×
// seed 3 本の全 48 組（+ `DriverModel::balanced()` × seed 3 本）で、静止発進から
// LAP_TARGET 周を完走し、全 tick（WARMUP_TICKS 以降）で `coord.t` が `limit_bounds` の内側
// （許容 `CONTAIN_TOL_M` = 0 m）に居ることを検証する。K-1「T3 の安定余裕ゼロ」の解消。
// =============================================================================================

/// スイープで完走を要求する周回数。
const LAP_TARGET: u32 = 3;
/// 1 組あたりの上限 Simulation Tick（LAP_TARGET 周ぶんの十分な余裕。静止発進込み）。
const SWEEP_MAX_TICKS: u64 = 60 * 60 * 6;

/// 1 組を静止発進から `LAP_TARGET` 周走らせ、コリドー封じ込めを検証する。
/// 成功なら各ラップタイム [s]、失敗なら理由を返す。
fn sweep_run(
    seed: u64,
    model: DriverModel,
    corridor: &sim_line::Corridor,
) -> Result<Vec<f64>, String> {
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
    let gt = line_t(&world, GRID_S);
    world
        .spawn_with_driver(params(), GRID_S, gt, model, rng)
        .map_err(|e| format!("spawn failed: {e:?}"))?;

    let mut lap_times = Vec::new();
    let mut last_cross_tick = 0u64;
    let mut prev_laps = 0u32;

    for _ in 0..SWEEP_MAX_TICKS {
        world.step_sim_tick();
        let e = &world.vehicles()[0];
        let (s, t, laps) = (e.coord.s, e.coord.t, e.laps_completed);

        if world.sim_tick() > WARMUP_TICKS {
            let (t_right, t_left) = corridor.limit_bounds(s);
            let outside = (t_right - t).max(t - t_left).max(0.0);
            if outside > CONTAIN_TOL_M {
                return Err(format!(
                    "corridor breach at s={s:.1} lap={laps}: t={t:+.3} not in \
                     [{t_right:+.3}, {t_left:+.3}] (outside {outside:.3} m)"
                ));
            }
        }
        if laps > prev_laps {
            let now = world.sim_tick();
            if prev_laps > 0 {
                lap_times.push((now - last_cross_tick) as f64 * SIM_DT);
            }
            last_cross_tick = now;
            prev_laps = laps;
            if laps >= LAP_TARGET {
                return Ok(lap_times);
            }
        }
    }
    Err(format!(
        "did not complete {LAP_TARGET} laps in {SWEEP_MAX_TICKS} ticks \
         (laps={}, s={:.1}, t={:+.2})",
        prev_laps,
        world.vehicles()[0].coord.s,
        world.vehicles()[0].coord.t,
    ))
}

#[test]
#[ignore = "TASK-2-4 Phase 2 acceptance sweep — un-ignore once green (step (1) landed the \
            control-phase fix; run explicitly to see which sweep cells still breach)"]
fn t_core_ai_11_robustness_sweep() {
    let cw = world_with_line();
    let corridor = cw.racing_line().unwrap().corridor();

    let mut failures: Vec<String> = Vec::new();
    let mut worst_lap_spread = (f64::INFINITY, f64::NEG_INFINITY);

    for &level in &[0.3_f64, 0.5, 0.7, 0.9] {
        for &consistency in &[0.5_f64, 1.0] {
            for &error_rate in &[0.0_f64, 0.5] {
                for seed in 1..=3u64 {
                    let mut m = driver_model(level);
                    m.consistency = consistency;
                    m.error_rate = error_rate;
                    match sweep_run(seed, m, corridor) {
                        Ok(laps) => {
                            for &lt in &laps {
                                worst_lap_spread.0 = worst_lap_spread.0.min(lt);
                                worst_lap_spread.1 = worst_lap_spread.1.max(lt);
                            }
                        }
                        Err(why) => failures.push(format!(
                            "level={level} consistency={consistency} error_rate={error_rate} \
                             seed={seed}: {why}"
                        )),
                    }
                }
            }
        }
    }
    // DriverModel::balanced() を明示的に含める（契約要件）。
    for seed in 1..=3u64 {
        if let Err(why) = sweep_run(seed, DriverModel::balanced(), corridor) {
            failures.push(format!("balanced() seed={seed}: {why}"));
        }
    }

    eprintln!(
        "T-CORE-AI-11: 51 runs, {} breached. lap-time spread over all completed laps: \
         {:.2}..{:.2} s",
        failures.len(),
        worst_lap_spread.0,
        worst_lap_spread.1,
    );
    assert!(
        failures.is_empty(),
        "{} sweep cell(s) breached the corridor:\n{}",
        failures.len(),
        failures.join("\n"),
    );
}

// =============================================================================================
// TASK-2-4 Phase 2 — 診断（instrumentation only・アサーションなし）
//
// 契約要件 1:「T3 進入で he / beta / yaw_rate / str / 各操舵項（delta_pp / delta_ff /
// delta_cs / delta_hd）を時系列で出し、どの項が発散に寄与しているかを数値で示してから触る。」
//
// controller.rs は各操舵項を公開しない & sim-driver/src は凍結なので、ここで
// `Controller::update` の数式を **独立に再現** して分解する（HANDOFF §7「実装者が書いた
// 検証器を信用しきらない」の精神で、むしろ独立再導出が望ましい）。入力は:
//   - preview 経路: w.driver().perceived() / .plan()（reaction_time 遅延済み・clean は
//     spatial_awareness=1 なので低域ノイズ 0）
//   - stabilise 経路: 遅延 0 の真値を STAB_DELAY_TICKS だけ手元のリングで遅らせて再現
// 再現した項の合計から出した steer_raw と、実出力（rate-limit + 一次遅れ後）の
// last_input().steer を並べて出す（位相遅れの寄与が見える）。
//
// 実行: cargo test -p sim-core --release --test world_ai -- --ignored --nocapture t3_entry
// =============================================================================================

/// controller.rs の定数（**変更したら両方直す**）。診断の独立再現用。
mod ctrl_consts {
    pub const BETA_LIMIT_RAD: f64 = 0.12;
    pub const K_COUNTERSTEER: f64 = 0.9;
    pub const BETA_BLEND_RAD: f64 = 0.04; // Phase 2 step (1)
    pub const COUNTERSTEER_LEAD_TAU: f64 = 0.12; // Phase 2 step (1)
    pub const K_HEADING: f64 = 0.30;
    pub const K_YAW_DAMP: f64 = 0.16;
    pub const K_UNDERSTEER: f64 = 0.0018;
    pub const HEADING_DIFF_M: f64 = 1.0; // driver.rs
}

/// perception.rs: `ceil(STABILISATION_DELAY_S / SIM_DT)` = `ceil(0.08 * 60)` = 5。
const STAB_DELAY_TICKS: usize = 5;

/// 真値の [`sim_driver::PerceivedSelf`] 相当（`Driver::assemble_truth` の独立再現）。
#[derive(Clone, Copy)]
struct Truth {
    s: f64,
    speed: f64,
    heading_error: f64,
    sideslip: f64,
    yaw_rate: f64,
}

fn reconstruct_truth(w: &World) -> Truth {
    let e = &w.vehicles()[0];
    let track = w.track();
    let traj = w.racing_line().unwrap().trajectory();
    let st = e.vehicle.state();
    let s = track.wrap_s(e.coord.s);
    let speed = st.forward_speed();
    let frame = track.frame_at(s);
    let track_tan_yaw = (-frame.tangent.z).atan2(frame.tangent.x);
    let h = ctrl_consts::HEADING_DIFF_M;
    let dt_ds = (traj.t_at(s + h) - traj.t_at(s - h)) / (2.0 * h);
    let traj_heading = dt_ds.atan();
    let heading_error = sim_math::wrap_angle(st.yaw() - track_tan_yaw - traj_heading);
    let sideslip = if speed.abs() < 0.5 {
        0.0
    } else {
        let v_fwd = st.velocity.dot(st.forward());
        let v_right = st.velocity.dot(st.right());
        v_right.atan2(v_fwd.max(1e-3))
    };
    Truth {
        s,
        speed,
        heading_error,
        sideslip,
        yaw_rate: st.angular_velocity.y,
    }
}

/// 1 tick 分の診断行を組む（`Controller::update` の数式を独立再現）。
/// `stab` は STAB_DELAY_TICKS 遅らせた真値。
fn diag_tick_line(
    w: &World,
    stab: Truth,
    wheelbase: f64,
    max_steer: f64,
    corridor: &sim_line::Corridor,
) -> String {
    let e = &w.vehicles()[0];
    let (s, t) = (e.coord.s, e.coord.t);
    let track = w.track();
    let traj = w.racing_line().unwrap().trajectory();
    let d = w.driver(VehicleId(0)).unwrap();
    let per = d.perceived();
    let plan = d.plan();
    let corn = d.model().cornering_skill;
    let cur = reconstruct_truth(w);

    // delta_pp (preview)
    let he_p = per.heading_error;
    let aim_t = traj.t_at(track.wrap_s(plan.aim_s));
    let lon = plan.lookahead_m.max(1e-3);
    let lat = aim_t - per.t;
    let x_v = he_p.cos() * lon + he_p.sin() * lat;
    let y_v = -he_p.sin() * lon + he_p.cos() * lat;
    let alpha = y_v.atan2(x_v.max(1e-3));
    let d_pp = (2.0 * wheelbase * alpha.sin()).atan2(plan.lookahead_m.max(1e-3));

    // delta_ff (preview kappa at perceived.s)
    let kappa_traj = traj.curvature_at(per.s);
    let a_lat_demand = per.speed * per.speed * kappa_traj;
    let d_ff = ((wheelbase * kappa_traj).atan() + ctrl_consts::K_UNDERSTEER * a_lat_demand)
        .clamp(-max_steer, max_steer);

    // stabilise-path yaw-rate error (step 0)
    let kappa_stab = traj.curvature_at(track.wrap_s(stab.s));
    let r_err = stab.yaw_rate - stab.speed * kappa_stab;

    // delta_cs (step 1: phase lead + smoothstep knee)
    let beta = stab.sideslip;
    let beta_lim = ctrl_consts::BETA_LIMIT_RAD * (0.8 + (1.2 - 0.8) * corn);
    let beta_lead = beta + ctrl_consts::COUNTERSTEER_LEAD_TAU * r_err;
    let cs_gate = sim_math::smoothstep(
        beta_lim - ctrl_consts::BETA_BLEND_RAD,
        beta_lim + ctrl_consts::BETA_BLEND_RAD,
        beta_lead.abs(),
    );
    let d_cs = -ctrl_consts::K_COUNTERSTEER * cs_gate * (beta_lead - beta_lead.signum() * beta_lim);

    // delta_hd (step 0)
    let d_hd = -ctrl_consts::K_HEADING * stab.heading_error - ctrl_consts::K_YAW_DAMP * r_err;

    let sum = d_pp + d_ff + d_cs + d_hd;
    let inp = d.last_input();
    let (steer_out, thr, brk) = (inp.steer, inp.throttle, inp.brake);
    let (t_right, t_left) = corridor.limit_bounds(s);
    let outside = (t_right - t).max(t - t_left).max(0.0);
    // v_cap = the static physical ceiling the Planner clamps v_target to (T-AI-04).
    let v_cap = w.racing_line().unwrap().speed_profile().v_at(s);

    let st = e.vehicle.state();
    let rgrip = st.wheels[sim_vehicle::WheelIndex::RearLeft as usize]
        .grip_usage
        .max(st.wheels[sim_vehicle::WheelIndex::RearRight as usize].grip_usage);
    let fgrip = st.wheels[sim_vehicle::WheelIndex::FrontLeft as usize]
        .grip_usage
        .max(st.wheels[sim_vehicle::WheelIndex::FrontRight as usize].grip_usage);
    let r_tj = if kappa_traj.abs() > 1e-6 {
        1.0 / kappa_traj.abs()
    } else {
        f64::INFINITY
    };

    format!(
        "{s:7.1} {t:+6.2} out {outside:5.2}  he {:+7.4} beta {:+7.4} yaw {:+7.3}  \
         v {:5.1} vtgt {:5.1} vcap {v_cap:5.1} thr {thr:4.2} brk {brk:4.2}  \
         fgrip {fgrip:4.2} rgrip {rgrip:4.2}  ktj {kappa_traj:+8.5}(R{r_tj:6.0}) lka {:4.1}  \
         d_pp {d_pp:+7.4} d_ff {d_ff:+7.4} d_cs {d_cs:+7.4} d_hd {d_hd:+7.4} SUM {sum:+7.4} \
         out {steer_out:+6.3}",
        cur.heading_error, cur.sideslip, cur.yaw_rate, cur.speed, plan.v_target, plan.lookahead_m,
    )
}

/// solo・任意モデル・任意 seed で `until_s` まで走らせ、`[win_lo, win_hi]` の s を毎 tick 出す。
fn diag_corner(label: &str, model: DriverModel, seed: u64, win: (f64, f64), until_s: f64) {
    let p = params();
    let (wheelbase, max_steer) = (p.dimensions.wheelbase, p.steering.max_steer_angle);
    let cw = world_with_line();
    let corridor = cw.racing_line().unwrap().corridor();

    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
    let gt = line_t(&world, GRID_S);
    world
        .spawn_with_driver(params(), GRID_S, gt, model, rng)
        .unwrap();

    let mut ring: std::collections::VecDeque<Truth> = std::collections::VecDeque::new();
    eprintln!("\n# {label}: window s {:.0}-{:.0}", win.0, win.1);
    let mut logged = 0usize;
    for _ in 0..14000u64 {
        world.step_sim_tick();
        ring.push_back(reconstruct_truth(&world));
        if ring.len() > STAB_DELAY_TICKS + 2 {
            ring.pop_front();
        }
        let s = world.vehicles()[0].coord.s;
        if world.sim_tick() > WARMUP_TICKS && (win.0..=win.1).contains(&s) {
            let stab = *ring
                .get(ring.len().saturating_sub(1 + STAB_DELAY_TICKS))
                .unwrap_or_else(|| ring.front().unwrap());
            eprintln!(
                "{}",
                diag_tick_line(&world, stab, wheelbase, max_steer, corridor)
            );
            logged += 1;
        }
        if s >= until_s {
            break;
        }
    }
    eprintln!(
        "# {label}: logged {logged} ticks (final s={:.1})",
        world.vehicles()[0].coord.s
    );
}

#[test]
#[ignore = "diagnostic: T3-entry steering-term time series for TASK-2-4 Phase 2"]
fn t_core_ai_diag_t3_entry_steering_terms() {
    diag_corner(
        "T3 (clean reference driver, seed 1)",
        clean_reference_driver(),
        1,
        (1400.0, 1650.0),
        1660.0,
    );
}

/// cluster B の pre-check（Architect 裁定 3）: s≈3311 で breach する **failing cell**
/// （level 0.9 / consistency 1.0 / error_rate 0.0）で s 3290–3330 を出し、
/// 後軸 `grip_usage` が飽和しているか（= K-6 signature）を確認する。
#[test]
#[ignore = "diagnostic: s3311 cluster-B + T3 cluster-A pre-check for TASK-2-4 Phase 2 step (3)"]
fn t_core_ai_diag_s3311_precheck() {
    // cluster B: s≈3311, failing cell level 0.9 (consistency 1.0) vs threading cell 0.6.
    for &level in &[0.6_f64, 0.9] {
        diag_corner(
            &format!("s3311 (level {level} / consistency 1.0 / error_rate 0.0, seed 1)"),
            driver_model(level),
            1,
            (3210.0, 3320.0),
            3335.0,
        );
    }
    // cluster A: T3, a failing cell is consistency 0.5 (1% steer noise). Check rgrip there.
    let mut noisy = driver_model(0.6);
    noisy.consistency = 0.5;
    diag_corner(
        "T3 (level 0.6 / consistency 0.5 / error_rate 0.0, seed 2)",
        noisy,
        2,
        (1470.0, 1620.0),
        1630.0,
    );
}
