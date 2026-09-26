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
/// **TASK-2-4 Phase 2（本ラウンド）で `1400 → 3100` へ復元**。K_HEADING/K_YAW_DAMP の速度
/// スケジュール（[`sim_driver::controller`] の `k_heading_scaled`/`k_yaw_damp_scaled`）+
/// `delta_cs` の `beta_dot` 位相進みで T3（s≈1561）は clean 0.6 で worst excursion 0.000 m
/// まで解消した。`s < 3100` は T3 を含む Phase 1 検証区間全体をカバーする。
/// **s ≥ 3100 は新規に発見したヘアピン進入（s≈3305）の未解決の逸脱を含むため、
/// 全周版は引き続き `#[ignore]` の `t_core_ai_10_full`（`S_VALIDATED_FULL_M`）に温存する。**
const S_VALIDATED_M: f64 = 3100.0;
/// 全周版（K-1 解消後・Phase 2 の受け入れ）の弧長上限 [m]。全周長そのもの。
const S_VALIDATED_FULL_M: f64 = 4139.0;
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

/// solo・任意の `DriverModel`（ライン上 spawn）で `laps` 周完走するまで走らせ、
/// 各 tick でコリドー封じ込めを検証する（TASK-2-4 Phase 2・T-CORE-AI-11）。
/// 逸脱があれば最初の 1 件を `Err` で返す（panic せず sweep 全体を続けられるように）。
fn run_solo_model_laps(seed: u64, model: DriverModel, laps: u32) -> Result<(), String> {
    let line_corridor = world_with_line();
    let corridor = line_corridor.racing_line().unwrap().corridor();
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
    let gt = line_t(&world, GRID_S);
    world
        .spawn_with_driver(params(), GRID_S, gt, model, rng)
        .unwrap();

    let max_ticks = 20_000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        let e = &world.vehicles()[0];
        if world.sim_tick() > WARMUP_TICKS {
            let (t_right, t_left) = corridor.limit_bounds(e.coord.s);
            let outside = (t_right - e.coord.t).max(e.coord.t - t_left).max(0.0);
            if outside > CONTAIN_TOL_M {
                return Err(format!(
                    "corridor breach at s={:.1} lap={}: t={:+.3} not in [{:+.3}, {:+.3}] \
                     (outside by {:.3} m)",
                    e.coord.s, e.laps_completed, e.coord.t, t_right, t_left, outside
                ));
            }
        }
        if e.laps_completed >= laps {
            return Ok(());
        }
    }
    let e = &world.vehicles()[0];
    Err(format!(
        "did not complete {laps} laps within {max_ticks} sim ticks \
         (laps_completed={}, s={:.1}, t={:+.2})",
        e.laps_completed, e.coord.s, e.coord.t,
    ))
}

/// T-CORE-AI-11 — 堅牢性スイープ（TASK-2-4 Phase 2・K-1 の実質的合否判定）。
/// `level ∈ {0.3,0.5,0.7,0.9}` × `consistency ∈ {0.5,1.0}` × `error_rate ∈ {0.0,0.5}` ×
/// seed 3 本の全組み合わせ + `DriverModel::balanced()`（3 seed）で、全周 3 周・コリドー逸脱 0 m。
#[test]
#[ignore = "TASK-2-4 Phase 2（本ラウンド・未解決）: T3（s≈1561）はゲインスケジュール + \
            delta_cs 位相進みで全組み合わせ解消したが、**51 組み合わせ中ほぼ全てが \
            s≈3300〜3314 の新規ヘアピン進入で決定論的に逸脱する**（`t_core_ai_10_full` の \
            ignore 理由を参照。乱数非依存・level 0.3〜0.9 のほぼ全域で再現）。level 0.5 / \
            consistency 0.5 の一部と balanced() は T3 手前（s≈1546〜1594）でも逸脱が残り、\
            T3 の安定余裕がまだゼロに近いモデルが存在することも示す。**3 周完走・0 逸脱は \
            未達**。Allowed Files（controller.rs/planner.rs）の範囲で 3 ラウンド \
            （ゲインスケジュール / delta_cs 位相進み / lookahead 下限）を試したが解消せず、\
            contract の『3 ラウンドで解けない場合は止めて報告』に従い停止する。次の診断対象は \
            s=3250〜3305 の進入区間（応答不足型・sim-line との相互作用を疑う）。"]
fn t_core_ai_11_model_sweep_robustness() {
    let levels = [0.3, 0.5, 0.7, 0.9];
    let consistencies = [0.5, 1.0];
    let error_rates = [0.0, 0.5];
    let seeds = [1u64, 2u64, 3u64];

    let mut failures = Vec::new();
    let mut runs = 0u32;

    for &level in &levels {
        for &consistency in &consistencies {
            for &error_rate in &error_rates {
                for &seed in &seeds {
                    let mut model = driver_model(level);
                    model.consistency = consistency;
                    model.error_rate = error_rate;
                    runs += 1;
                    if let Err(e) = run_solo_model_laps(seed, model, 3) {
                        failures.push(format!(
                            "level={level} consistency={consistency} error_rate={error_rate} \
                             seed={seed}: {e}"
                        ));
                    }
                }
            }
        }
    }
    for &seed in &seeds {
        runs += 1;
        if let Err(e) = run_solo_model_laps(seed, DriverModel::balanced(), 3) {
            failures.push(format!("balanced() seed={seed}: {e}"));
        }
    }

    assert!(
        failures.is_empty(),
        "T-CORE-AI-11: {}/{runs} combinations breached the corridor:\n{}",
        failures.len(),
        failures.join("\n")
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

/// T-CORE-AI-10 — コリドー封じ込め（ライン上 spawn・`s < S_VALIDATED_M` = 3100・T3 を含む）。
/// TASK-2-4 Phase 2 で T3（K-1）を解消したため `S_VALIDATED_M` を 1400 → 3100 へ復元した。
/// s ≥ 3100（新規発見のヘアピン進入問題）は `t_core_ai_10_full`（`#[ignore]`）へ。
#[test]
fn t_core_ai_10_corridor_containment_validated_section() {
    corridor_containment_check(None, S_VALIDATED_M);
}

/// T-CORE-AI-10-FULL — 全周版（ライン上 spawn・`s < S_VALIDATED_FULL_M` = 4139 = 全周）。
/// **TASK-2-4 Phase 2 の受け入れ = この ignore を外す。**
#[test]
#[ignore = "TASK-2-4 Phase 2（本ラウンド）: T3（s≈1561、K-1 の起票根拠）は K_HEADING/K_YAW_DAMP \
            の速度スケジュール + delta_cs の beta_dot 位相進みで解消し、clean 0.6 は s=3100 まで \
            worst excursion 0.000 m。**しかし s≈3300〜3310 のヘアピン進入で新規の逸脱を発見**: \
            kappa_traj が s=3300 の 0.0085 から s=3305 で 0.037（R≈27 m）まで短い距離で急増する \
            区間で steer_raw が s=3302.5〜3307 の間ほぼ全区間 -1.0（フルロック）に張り付き、\
            heading_error はロック中も -0.28→-0.39 rad と拡大し続ける（=フルロックでも要求ヨー \
            レートに追いつけない）。clean 0.6 で s=3310.5 に t=-7.585（limit -7.500 を 8.6 cm 超え）。\
            T3 のような発散振動ではなく、進入区間全体（s=3250〜3300）で yaw_rate がカーブ曲率の \
            増加に対し一貫して遅れる**応答不足**型で、T3 の対策（ゲインスケジュール/位相進み）を \
            この区間にも適用したが解消しなかった。T-CORE-AI-11 でモデルスイープすると ほぼ全ての \
            level/consistency/error_rate 組み合わせが同じ s≈3300〜3314 で同じ向きに逸脱する \
            （決定論的・乱数非依存）。sim-line（速度プロファイル or 基準ライン）とこの区間の \
            相互作用を疑うが、Allowed Files（controller.rs/planner.rs）の範囲では未解決。\
            次ラウンドの診断対象として TODO.md に申し送る。"]
fn t_core_ai_10_full() {
    corridor_containment_check(None, S_VALIDATED_FULL_M);
}

/// T-CORE-AI-10-OFFLINE — 実グリッド位置（`t = 0` = センターライン）から spawn したときの
/// コリドー封じ込め。
///
/// TASK-2-4 Phase 2（本ラウンド）で解消: Pure Pursuit の `LOOKAHEAD_MIN_M` を 5.0 → 9.0 へ
/// 引き上げ、発進直後の低速・大横オフセット（S/F ストレートで `t_at(GRID_S) ≈ +4.6 m`）による
/// `delta_pp` 飽和 → スピンを防いだ。`S_VALIDATED_M`（= 3100・T3 を含む）まで worst excursion
/// 0.000 m を確認。
#[test]
fn t_core_ai_10_offline_spawn() {
    corridor_containment_check(Some(0.0), S_VALIDATED_M);
}
