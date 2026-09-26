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
/// [`t_core_ai_10_offline_spawn`] が記録する（Architect HIGH-1。TASK-2-4 Phase 2 で解消し
/// ignore 解除済み — 上記の「実行できず」は Phase 1 時点の記録）。運動学プラントの
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
/// **TASK-2-4 Phase 2 で `1400 → 3100` へ復元**。T3（s≈1561）は `delta_cs` の `beta_dot`
/// 位相進みで clean 0.6 の逸脱が消えた（Opus 監査のアブレーション: 位相進みを外すと s≈1584 で
/// 再発。K_HEADING/K_YAW_DAMP の速度スケジュールは外しても結果不変＝この区間では無効）。
/// 全周は `t_core_ai_10_full`（[`s_validated_full_m`]・Opus 監査ラウンドのスレッショルド
/// ブレーキング上限でヘアピンのロックアップを解消して緑化）。
const S_VALIDATED_M: f64 = 3100.0;
/// 全周版（K-1 解消後・Phase 2 の受け入れ）の走行距離上限 [m] = グリッドから 1 周して
/// グリッドへ戻るまで（`track.length() + GRID_S`。弧長 `s` 単独では `wrap_s` で 0 に戻るため
/// 全周を表現できない — Opus 監査 MEDIUM-2: 旧 `4139.0` は周長 4139.087 m 未満の 0.087 m 窓でしか
/// 停止せず、クリーン走行でも "did not reach" で赤になる偽陰性だった）。
fn s_validated_full_m() -> f64 {
    track().length() + GRID_S
}
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
/// `until_s` は走行距離 `laps_completed·L + s`（`until_s < L` なら弧長そのもの）。
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

    let len = world.track().length();
    let max_ticks = 8000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        // 走行距離（`laps_completed·L + s`）で打ち切る。`until_s < L` なら従来の `s >= until_s` と同一。
        let e = &world.vehicles()[0];
        if e.laps_completed as f64 * len + e.coord.s >= until_s {
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

/// T-CORE-AI-11b: track limits の外へ出た 1 回の逸脱エピソードが終わる（車体中心が
/// limits 内へ戻る）までの上限 [s]（Architect 裁定 PDC-9・Opus 2026-09-26）。
///
/// `TESTING.md` T-RACE-08（インシデントからの復帰: 全車が走行を再開 or 正常リタイア）の solo 版。
/// ミスの大きさは `MISTAKE_STEER_SIGMA = 0.010` / `MISTAKE_BRAKE_SIGMA = 0.05`（`driver.rs`）と
/// 小さく、ヘアピンでのオーバーラン（ラン-オフ 20〜50 m）からでも 10 s あれば芝上 10 m/s で
/// 100 m 走れる。これを超えて戻れないのは「ミスの帰結」ではなく「コース外で運転できない」欠陥。
const REJOIN_MAX_S: f64 = 10.0;

/// [`run_solo_model_laps`] の 1 走行分の集計（`laps` 周完走した場合）。
struct SweepRun {
    /// 最大コリドー逸脱 [m]（0 なら一度も割っていない）と、その位置の説明。
    worst_outside: f64,
    worst_at: String,
    /// track limits 外エピソードの数と、最長エピソード [sim tick]。
    episodes: u32,
    longest_episode_ticks: u64,
}

/// solo・任意の `DriverModel`（ライン上 spawn）で `laps` 周完走するまで走らせ、
/// 各 tick でコリドー封じ込めを計測する（TASK-2-4 Phase 2・T-CORE-AI-11a/11b）。
///
/// **最初の逸脱で打ち切らない**（PDC-9: 旧実装は最初の逸脱 tick で `Err` を返していたため、
/// 「逸脱 0.2〜8 cm」はその 1 tick の値でしかなく、その後の帰結 — 芝へのオーバーランから
/// 戻れず 100 m 以上離れて周回不能になる — を観測できていなかった）。
/// `Err` は (1) `laps` 周を完走できない、(2) 1 回の limits 外エピソードが [`REJOIN_MAX_S`] を超える。
fn run_solo_model_laps(seed: u64, model: DriverModel, laps: u32) -> Result<SweepRun, String> {
    let line_corridor = world_with_line();
    let corridor = line_corridor.racing_line().unwrap().corridor();
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
    let gt = line_t(&world, GRID_S);
    world
        .spawn_with_driver(params(), GRID_S, gt, model, rng)
        .unwrap();

    let rejoin_max_ticks = (REJOIN_MAX_S / SIM_DT).round() as u64;
    let mut run = SweepRun {
        worst_outside: 0.0,
        worst_at: String::new(),
        episodes: 0,
        longest_episode_ticks: 0,
    };
    // 現在の limits 外エピソード: (開始 tick, 開始時の説明)。
    let mut episode: Option<(u64, String)> = None;
    let max_ticks = 20_000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        let tick = world.sim_tick();
        let e = &world.vehicles()[0];
        if tick > WARMUP_TICKS {
            let (t_right, t_left) = corridor.limit_bounds(e.coord.s);
            let outside = (t_right - e.coord.t).max(e.coord.t - t_left).max(0.0);
            if outside > CONTAIN_TOL_M {
                let ds = world.driver(VehicleId(0)).unwrap().driver_state();
                let desc = || {
                    format!(
                        "s={:.1} lap={}: t={:+.3} not in [{:+.3}, {:+.3}] (outside by {:.3} m; \
                         {} ticks since last mistake)",
                        e.coord.s,
                        e.laps_completed,
                        e.coord.t,
                        t_right,
                        t_left,
                        outside,
                        ds.ticks_since_mistake.min(99_999),
                    )
                };
                if outside > run.worst_outside {
                    run.worst_outside = outside;
                    run.worst_at = desc();
                }
                let (start, start_desc) = episode.get_or_insert_with(|| {
                    run.episodes += 1;
                    (tick, desc())
                });
                let len = tick - *start;
                run.longest_episode_ticks = run.longest_episode_ticks.max(len);
                if len > rejoin_max_ticks {
                    return Err(format!(
                        "did not rejoin within {REJOIN_MAX_S} s: episode began at {start_desc}; \
                         now {} (worst so far {:.3} m)",
                        desc(),
                        run.worst_outside
                    ));
                }
            } else {
                episode = None;
            }
        }
        if e.laps_completed >= laps {
            return Ok(run);
        }
    }
    let e = &world.vehicles()[0];
    Err(format!(
        "did not complete {laps} laps within {max_ticks} sim ticks \
         (laps_completed={}, s={:.1}, t={:+.2})",
        e.laps_completed, e.coord.s, e.coord.t,
    ))
}

/// T-CORE-AI-11 のスイープ対象: `level ∈ {0.3,0.5,0.7,0.9}` × `consistency ∈ {0.5,1.0}` ×
/// seed 3 本 + `DriverModel::balanced()` × seed 3 本（計 27 走行）を、指定の `error_rate` で。
///
/// 11a（`error_rate = 0`）と 11b（`error_rate = 0.5`）は**同じ 27 組の対**になる。ミス注入は
/// `Driver` 内の独立ストリーム `rng.derive("mistake")` だけを使い、`error_rate` は
/// `maybe_make_mistake` 以外に効かないので、対の差は「ミスの有無」だけ（反実仮想）。
fn sweep_cases(error_rate: f64) -> Vec<(String, DriverModel, u64)> {
    let levels = [0.3, 0.5, 0.7, 0.9];
    let consistencies = [0.5, 1.0];
    let seeds = [1u64, 2u64, 3u64];
    let mut cases = Vec::new();
    for &level in &levels {
        for &consistency in &consistencies {
            for &seed in &seeds {
                let mut model = driver_model(level);
                model.consistency = consistency;
                model.error_rate = error_rate;
                cases.push((
                    format!(
                        "level={level} consistency={consistency} error_rate={error_rate} \
                         seed={seed}"
                    ),
                    model,
                    seed,
                ));
            }
        }
    }
    for &seed in &seeds {
        let mut model = DriverModel::balanced();
        model.error_rate = error_rate;
        cases.push((
            format!("balanced() error_rate={error_rate} seed={seed}"),
            model,
            seed,
        ));
    }
    cases
}

/// `cases` を 3 周ずつ走らせる。各走行は独立・決定論的（走行ごとに World / Driver / Rng を
/// 新規生成・共有状態なし）なのでスレッドへ分配して壁時計を短縮し、結果は入力順に戻す。
fn run_sweep(cases: &[(String, DriverModel, u64)]) -> Vec<Result<SweepRun, String>> {
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, 8);
    let mut indexed: Vec<(usize, Result<SweepRun, String>)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..workers)
            .map(|w| {
                scope.spawn(move || {
                    (w..cases.len())
                        .step_by(workers)
                        .map(|i| (i, run_solo_model_laps(cases[i].2, cases[i].1, 3)))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("sweep worker panicked"))
            .collect()
    });
    indexed.sort_by_key(|(i, _)| *i);
    indexed.into_iter().map(|(_, r)| r).collect()
}

/// T-CORE-AI-11a — 堅牢性スイープ・**ミス無し**（TASK-2-4 Phase 2・K-1 の実質的合否判定）。
///
/// [`sweep_cases`]`(0.0)` の 27 走行すべてで全周 3 周・コリドー逸脱 **0 m**（`CONTAIN_TOL_M`）。
/// 操舵ノイズ（`consistency = 0.5`）を含む — K-1「わずかなノイズで決定論的に破綻する安定余裕
/// ゼロ」を否定するのがこのテストの目的であり、**ここは一切緩めない**（Architect 裁定 PDC-9）。
#[test]
fn t_core_ai_11a_model_sweep_mistake_free() {
    let cases = sweep_cases(0.0);
    let results = run_sweep(&cases);
    let mut failures = Vec::new();
    for ((label, _, _), result) in cases.iter().zip(&results) {
        match result {
            Err(e) => failures.push(format!("{label}: {e}")),
            Ok(run) if run.worst_outside > CONTAIN_TOL_M => failures.push(format!(
                "{label}: corridor breach ({} episodes), worst at {}",
                run.episodes, run.worst_at
            )),
            Ok(_) => {}
        }
    }
    assert!(
        failures.is_empty(),
        "T-CORE-AI-11a (mistake-free, 0 m): {}/{} runs failed:\n{}",
        failures.len(),
        results.len(),
        failures.join("\n")
    );
}

/// T-CORE-AI-11b — 堅牢性スイープ・**ミス発生**（`error_rate = 0.5`・11a と同じ 27 組の対）。
///
/// ミスは原則 3 の「原因」であり、実際の帰結（コース幅を使い切る・ラン-オフへのオーバーラン）を
/// 生むことは**意図された挙動**なので、逸脱量は問わない（Architect 裁定 PDC-9）。対の 11a が
/// 0 m であることが「この逸脱はミスに起因する」ことの反実仮想的な証明。代わりに要求するのは
/// **帰結からの回復**: (a) 3 周完走、(b) 1 回の limits 外エピソードが [`REJOIN_MAX_S`] 以内に終わる。
#[test]
fn t_core_ai_11b_model_sweep_mistake_recovery() {
    let cases = sweep_cases(0.5);
    let results = run_sweep(&cases);
    let mut failures = Vec::new();
    let mut with_excursion = 0u32;
    for ((label, _, _), result) in cases.iter().zip(&results) {
        match result {
            Err(e) => failures.push(format!("{label}: {e}")),
            Ok(run) if run.episodes > 0 => {
                with_excursion += 1;
                eprintln!(
                    "T-CORE-AI-11b (permitted): {label}: {} episodes, longest {:.2} s, worst at {}",
                    run.episodes,
                    run.longest_episode_ticks as f64 * SIM_DT,
                    run.worst_at
                );
            }
            Ok(_) => {}
        }
    }
    eprintln!(
        "T-CORE-AI-11b: {} runs, {with_excursion} completed with a recovered excursion, {} failed",
        results.len(),
        failures.len()
    );
    assert!(
        failures.is_empty(),
        "T-CORE-AI-11b (mistake regime, must recover): {}/{} runs failed:\n{}",
        failures.len(),
        results.len(),
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
/// 全周は `t_core_ai_10_full`。
#[test]
fn t_core_ai_10_corridor_containment_validated_section() {
    corridor_containment_check(None, S_VALIDATED_M);
}

/// T-CORE-AI-10-FULL — 全周版（ライン上 spawn・グリッドから 1 周してグリッドへ戻るまで）。
///
/// TASK-2-4 Phase 2（Opus 監査ラウンド）で緑化: ヘアピン（s≈3230〜3315）の逸脱の真因は
/// **ABS の無い車で `brake = 1.0` を踏み続けたことによる前輪ロック**（`slip_ratio = -1.0` が
/// 約 75 m 継続・ロック中は操舵が効かずフルロックでも曲がらない）。`controller.rs` の
/// スレッショルドブレーキング上限（荷重感度 + 前後・左右荷重移動込みのロック限界 × 0.95）で解消。
#[test]
fn t_core_ai_10_full() {
    corridor_containment_check(None, s_validated_full_m());
}

/// T-CORE-AI-10-OFFLINE — 実グリッド位置（`t = 0` = センターライン）から spawn したときの
/// コリドー封じ込め。
///
/// TASK-2-4 Phase 2（本ラウンド）で解消: Pure Pursuit の `LOOKAHEAD_MIN_M` を 5.0 → 9.0 へ
/// 引き上げ、発進直後の低速・大横オフセット（S/F ストレートで `t_at(GRID_S) ≈ +4.6 m`）による
/// `delta_pp` 飽和 → スピンを防いだ。Opus 監査ラウンドで検証範囲を `S_VALIDATED_M` から
/// 全周（[`s_validated_full_m`]）へ拡張（worst excursion 0.000 m）。
#[test]
fn t_core_ai_10_offline_spawn() {
    corridor_containment_check(Some(0.0), s_validated_full_m());
}

/// T-CORE-AI-03 — 静止発進から 3 周完走（TASK-2-4 Required Tests 4・Opus 2026-09-26 で追加）。
///
/// 実グリッド位置（`s = GRID_S`・`t = 0` = センターライン）に**静止状態で** spawn し、
/// ミス無し（`consistency = 1.0` / `error_rate = 0`）の `level ∈ {0.2, 0.5, 0.9}` がそれぞれ
/// 3 周を完走する。各周（1 周目はグリッドから S/F まで = `L − GRID_S`）のタイムが
/// `[40, 200] s`、全 tick でコリドー逸脱 0 m（`CONTAIN_TOL_M`）。ラップタイムは Tick の
/// 積み重ねとして計測するだけで、順位・結果は一切生成しない（原則 2）。
/// `level = 0.2` は T-CORE-AI-11 のスイープ下限 0.3 の外側（T-AI-05R が使う最低能力値）。
#[test]
fn t_core_ai_03_standing_start_three_laps() {
    const LAP_TIME_RANGE_S: (f64, f64) = (40.0, 200.0);
    let mut report = Vec::new();
    for level in [0.2, 0.5, 0.9] {
        let mut model = driver_model(level);
        model.consistency = 1.0;
        model.error_rate = 0.0;
        let corridor_world = world_with_line();
        let corridor = corridor_world.racing_line().unwrap().corridor();
        let mut world = world_with_line();
        let rng = sim_core::rng::driver_rng(&Rng::from_seed(3), VehicleId(0));
        world
            .spawn_with_driver(params(), GRID_S, 0.0, model, rng)
            .unwrap();

        let mut lap_start_tick = 0u64;
        let mut laps_seen = 0u32;
        let mut lap_times = Vec::new();
        let max_ticks = 20_000u64;
        for _ in 0..max_ticks {
            world.step_sim_tick();
            let tick = world.sim_tick();
            let e = &world.vehicles()[0];
            if tick > WARMUP_TICKS {
                let (t_right, t_left) = corridor.limit_bounds(e.coord.s);
                let outside = (t_right - e.coord.t).max(e.coord.t - t_left).max(0.0);
                assert!(
                    outside <= CONTAIN_TOL_M,
                    "level {level}: corridor breach at s={:.1} lap={}: t={:+.3} not in \
                     [{t_right:+.3}, {t_left:+.3}] (outside by {outside:.3} m)",
                    e.coord.s,
                    e.laps_completed,
                    e.coord.t,
                );
            }
            if e.laps_completed > laps_seen {
                laps_seen = e.laps_completed;
                lap_times.push((tick - lap_start_tick) as f64 * SIM_DT);
                lap_start_tick = tick;
            }
            if laps_seen >= 3 {
                break;
            }
        }
        assert_eq!(
            laps_seen, 3,
            "level {level}: did not complete 3 laps within {max_ticks} sim ticks \
             (lap times so far {lap_times:?})"
        );
        for (i, &lt) in lap_times.iter().enumerate() {
            assert!(
                (LAP_TIME_RANGE_S.0..=LAP_TIME_RANGE_S.1).contains(&lt),
                "level {level}: lap {} time {lt:.3} s outside {LAP_TIME_RANGE_S:?}",
                i + 1
            );
        }
        report.push(format!("level {level}: {lap_times:.3?}"));
    }
    eprintln!("T-CORE-AI-03 lap times [s]: {}", report.join(" / "));
}

// =============================================================================================
// TASK-2-4 Phase 2 Part 1 — T-AI-01R / T-AI-05R / T-AI-07R（実物理・PDC-11 の前提）
// =============================================================================================

/// FNV-1a 風の決定的ハッシュ（`u64` 列。`sim-driver/tests/common::hash_f64` と同じ構成）。
fn hash_u64_series(series: &[u64]) -> u64 {
    let mut h: u64 = 0xCBF2_9CE4_8422_2325;
    for &x in series {
        for b in x.to_le_bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
        }
    }
    h
}

/// T-AI-01R — `t_ai_01_stays_on_course_for_20_laps`（凍結・運動学プラント）の実物理版。
///
/// 運動学プラントは本物のレーシングライン（Phase 1）を追えない（K-1）ためテスト自体が
/// 意味を持たず ignore 中。実物理・実タイヤでは `clean_reference_driver`（level 0.6・
/// ミス無し）が 3 周、全 tick で (a) コリドー逸脱 0 m、(b) `recovered_steps` 増加なし
/// （数値破綻からの保険が発動しない = 物理が安定に解けている）ことを検証する。
#[test]
fn t_ai_01r_stays_on_course_real_physics() {
    let corridor_world = world_with_line();
    let corridor = corridor_world.racing_line().unwrap().corridor();
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(11), VehicleId(0));
    let gt = line_t(&world, GRID_S);
    world
        .spawn_with_driver(params(), GRID_S, gt, clean_reference_driver(), rng)
        .unwrap();

    const LAPS_TARGET: u32 = 3;
    let mut worst_outside = 0.0_f64;
    let mut worst_s = 0.0_f64;
    let max_ticks = 20_000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        let tick = world.sim_tick();
        let e = &world.vehicles()[0];
        if tick > WARMUP_TICKS {
            let (t_right, t_left) = corridor.limit_bounds(e.coord.s);
            let outside = (t_right - e.coord.t).max(e.coord.t - t_left).max(0.0);
            if outside > worst_outside {
                worst_outside = outside;
                worst_s = e.coord.s;
            }
            assert!(
                outside <= CONTAIN_TOL_M,
                "T-AI-01R: corridor breach at s={:.1} lap={}: t={:+.3} not in [{:+.3}, {:+.3}] \
                 (outside by {:.3} m)",
                e.coord.s,
                e.laps_completed,
                e.coord.t,
                t_right,
                t_left,
                outside,
            );
            let recovered = e.vehicle.state().recovered_steps;
            assert_eq!(
                recovered, 0,
                "T-AI-01R: recovered_steps = {recovered} != 0 at s={:.1} lap={}",
                e.coord.s, e.laps_completed
            );
        }
        if e.laps_completed >= LAPS_TARGET {
            eprintln!(
                "T-AI-01R: {LAPS_TARGET} laps clean, worst excursion {worst_outside:.3} m at \
                 s={worst_s:.1}, recovered_steps=0 throughout"
            );
            return;
        }
    }
    let e = &world.vehicles()[0];
    panic!(
        "T-AI-01R: did not complete {LAPS_TARGET} laps within {max_ticks} sim ticks \
         (laps_completed={}, s={:.1})",
        e.laps_completed, e.coord.s
    );
}

/// T-AI-05R — `t_ai_05_ability_ordering_emerges_in_lap_time`（凍結・運動学プラント）の実物理版。
///
/// `level ∈ {0.2, 0.5, 0.9}`・`consistency = 1.0`・`error_rate = 0.0`
/// （能力値以外は完全に決定論的 = 操舵ノイズもミスも無い）。1 周目はグリッドからの部分周なので
/// 2 周目（最初の全周）のラップタイムを比較する。中央値ではなく単一周だが、決定論的ドライバー
/// なので周ごとの変動が無いことは `t_core_ai_03` で確認済み（0.1 s 単位で不変）。
#[test]
fn t_ai_05r_ability_ordering_emerges_in_lap_time() {
    let mut lap2 = Vec::new();
    let mut report = Vec::new();
    for level in [0.2, 0.5, 0.9] {
        let mut model = driver_model(level);
        model.consistency = 1.0;
        model.error_rate = 0.0;
        let mut world = world_with_line();
        let rng = sim_core::rng::driver_rng(&Rng::from_seed(15), VehicleId(0));
        let gt = line_t(&world, GRID_S);
        world
            .spawn_with_driver(params(), GRID_S, gt, model, rng)
            .unwrap();

        let mut lap_start_tick = 0u64;
        let mut laps_seen = 0u32;
        let mut lap_times = Vec::new();
        let max_ticks = 20_000u64;
        for _ in 0..max_ticks {
            world.step_sim_tick();
            let tick = world.sim_tick();
            let e = &world.vehicles()[0];
            if e.laps_completed > laps_seen {
                laps_seen = e.laps_completed;
                lap_times.push((tick - lap_start_tick) as f64 * SIM_DT);
                lap_start_tick = tick;
            }
            if laps_seen >= 2 {
                break;
            }
        }
        assert!(
            lap_times.len() >= 2,
            "T-AI-05R: level {level}: only {} lap(s) completed",
            lap_times.len()
        );
        report.push(format!(
            "level {level}: lap2={:.3} s ({lap_times:.3?})",
            lap_times[1]
        ));
        lap2.push(lap_times[1]);
    }
    eprintln!("T-AI-05R lap times [s]: {}", report.join(" / "));
    assert!(
        lap2[0] > lap2[1] && lap2[1] > lap2[2],
        "T-AI-05R: lap times not monotone: {lap2:?}"
    );
    assert!(
        lap2[0] - lap2[2] >= 0.5,
        "T-AI-05R: fastest/slowest spread {:.3} s/lap < 0.5",
        lap2[0] - lap2[2]
    );
}

/// T-AI-07R — `t_ai_07_perception_delay_changes_behaviour`（凍結・運動学プラント）の実物理版。
/// PDC-11 の (1)〜(4) を全て検証する（運動学版 `t_ai_07` の退役条件・本ファイル TODO.md 参照）。
#[test]
fn t_ai_07r_perception_delay_changes_behaviour() {
    let corridor_world = world_with_line();
    let corridor = corridor_world.racing_line().unwrap().corridor();

    /// `reaction_time` を変えて走らせ、(lap_times, ControlInput 6 成分の bits 列,
    /// 60 s 時点の走行距離, 最大 recovered_steps, worst コリドー逸脱) を返す。
    fn run(
        corridor: &sim_line::Corridor,
        reaction_time: f64,
    ) -> (Vec<f64>, Vec<u64>, f64, u64, f64) {
        let mut world = world_with_line();
        let rng = sim_core::rng::driver_rng(&Rng::from_seed(107), VehicleId(0));
        let gt = line_t(&world, GRID_S);
        let mut model = driver_model(0.5);
        model.consistency = 1.0;
        model.error_rate = 0.0;
        model.reaction_time = reaction_time;
        world
            .spawn_with_driver(params(), GRID_S, gt, model, rng)
            .unwrap();

        let len = world.track().length();
        let ticks_60s = (60.0 / SIM_DT).round() as u64;
        let mut lap_start_tick = 0u64;
        let mut laps_seen = 0u32;
        let mut lap_times = Vec::new();
        let mut bits = Vec::new();
        let mut recovered_max = 0u64;
        let mut worst_outside = 0.0_f64;
        let mut dist_at_60s = None;
        let max_ticks = 60_000u64;
        for _ in 0..max_ticks {
            world.step_sim_tick();
            let tick = world.sim_tick();
            let e = &world.vehicles()[0];
            let vs = e.vehicle.state();
            recovered_max = recovered_max.max(vs.recovered_steps);
            let inp = world.driver(VehicleId(0)).unwrap().last_input();
            for f in [
                inp.steer,
                inp.throttle,
                inp.brake,
                inp.clutch,
                inp.gear as f64,
            ] {
                bits.push(f.to_bits());
            }
            bits.push(inp.drs as u64);
            if tick > WARMUP_TICKS {
                let (t_right, t_left) = corridor.limit_bounds(e.coord.s);
                let outside = (t_right - e.coord.t).max(e.coord.t - t_left).max(0.0);
                worst_outside = worst_outside.max(outside);
            }
            if dist_at_60s.is_none() && tick >= ticks_60s {
                dist_at_60s = Some(e.laps_completed as f64 * len + e.coord.s);
            }
            if e.laps_completed > laps_seen {
                laps_seen = e.laps_completed;
                lap_times.push((tick - lap_start_tick) as f64 * SIM_DT);
                lap_start_tick = tick;
            }
            if laps_seen >= 4 {
                break;
            }
        }
        (
            lap_times,
            bits,
            dist_at_60s.unwrap_or(0.0),
            recovered_max,
            worst_outside,
        )
    }

    let (fast_laps, fast_bits, fast_dist60, fast_recovered, fast_worst) = run(corridor, 0.0);
    let (slow_laps, slow_bits, slow_dist60, _slow_recovered, _slow_worst) = run(corridor, 0.30);

    assert!(
        fast_laps.len() >= 4,
        "T-AI-07R: reaction_time=0.0 completed only {} laps",
        fast_laps.len()
    );
    assert!(
        slow_laps.len() >= 4,
        "T-AI-07R: reaction_time=0.30 completed only {} laps",
        slow_laps.len()
    );

    // (1) ControlInput 6 成分の bits 列ハッシュが不一致。
    let h_fast = hash_u64_series(&fast_bits);
    let h_slow = hash_u64_series(&slow_bits);
    assert_ne!(
        h_fast, h_slow,
        "T-AI-07R: ControlInput series identical despite different reaction_time"
    );

    // (2) 60 s 走行の距離差 >= 1 m。
    let dist_diff = (fast_dist60 - slow_dist60).abs();
    assert!(
        dist_diff >= 1.0,
        "T-AI-07R: 60 s distance difference {dist_diff:.3} m < 1 m \
         (fast={fast_dist60:.3} slow={slow_dist60:.3})"
    );

    // (3) ラップタイム差 >= 0.1 s（運動学版 t_ai_07 の基準そのもの）。
    let lap_diff = (fast_laps[3] - slow_laps[3]).abs();
    assert!(
        lap_diff >= 0.1,
        "T-AI-07R: lap-time difference {lap_diff:.3} s < 0.1 s \
         (fast={:.3} slow={:.3})",
        fast_laps[3],
        slow_laps[3]
    );

    // (4) reaction_time = 0.0 でも recovered_steps == 0・T-AI-01R の帯（コリドー逸脱 0 m）を満たす。
    assert_eq!(
        fast_recovered, 0,
        "T-AI-07R: reaction_time=0.0 triggered recovered_steps = {fast_recovered}"
    );
    assert!(
        fast_worst <= CONTAIN_TOL_M,
        "T-AI-07R: reaction_time=0.0 breached corridor by {fast_worst:.3} m (T-AI-01R band)"
    );

    eprintln!(
        "T-AI-07R: hash fast={h_fast:#x} slow={h_slow:#x} (differ) | 60s distance fast={fast_dist60:.3} \
         slow={slow_dist60:.3} (diff {dist_diff:.3} m) | lap[3] fast={:.3} slow={:.3} (diff {lap_diff:.3} s) | \
         recovered_steps(fast)=0 worst_outside(fast)={fast_worst:.3} m",
        fast_laps[3],
        slow_laps[3],
    );
}

// =============================================================================================
// TASK-2-4 Phase 3 — 運動学プラント（`sim-driver/tests/common::Plant`/`run_laps`）廃止に伴う
// 残り移行。対応表は `TODO.md`「TASK-2-4 Phase 3」参照。
// =============================================================================================

/// 標準偏差（`sim-driver/tests/common::std_dev` と同じ構成。テストが互いに独立な
/// バイナリなので import せず複製する）。
fn std_dev(xs: &[f64]) -> f64 {
    if xs.len() < 2 {
        return 0.0;
    }
    let mean = xs.iter().sum::<f64>() / xs.len() as f64;
    let var = xs.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (xs.len() - 1) as f64;
    var.sqrt()
}

/// 実物理でステアリング / 目標横位置 / 目標速度の Simulation Tick 系列を集める
/// （T-AI-02R / T-AI-03R / T-AI-04R 共用）。`v_cap` は Planner が実際にクランプへ使った
/// 認知（遅延）済み `s` での物理限界（`driver.perceived().s` 越しの `v_at`。
/// `sim-driver/tests/common::run_laps` の `res.v_cap` と同じ定義）。
struct DriverSeries {
    steer: Vec<f64>,
    t_target: Vec<f64>,
    v_target: Vec<f64>,
    v_cap: Vec<f64>,
}

fn collect_driver_series(
    seed: u64,
    model: DriverModel,
    laps: u32,
    spawn_t: Option<f64>,
) -> DriverSeries {
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
    let gt = spawn_t.unwrap_or_else(|| line_t(&world, GRID_S));
    world
        .spawn_with_driver(params(), GRID_S, gt, model, rng)
        .unwrap();

    let mut out = DriverSeries {
        steer: Vec::new(),
        t_target: Vec::new(),
        v_target: Vec::new(),
        v_cap: Vec::new(),
    };
    let max_ticks = 60_000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        let laps_completed = world.vehicles()[0].laps_completed;
        let d = world.driver(VehicleId(0)).unwrap();
        out.steer.push(d.last_input().steer);
        out.t_target.push(d.plan().t_target);
        out.v_target.push(d.plan().v_target);
        let perceived_s = d.perceived().s;
        out.v_cap.push(
            world
                .racing_line()
                .unwrap()
                .speed_profile()
                .v_at(perceived_s),
        );
        if laps_completed >= laps {
            break;
        }
    }
    out
}

/// T-AI-02R — `t_ai_02_steering_does_not_chatter`（凍結・運動学プラント）の実物理版。
/// 同一メトリクス: (a) `|Δsteer|` 上限、(b) 2 階差分 RMS、(c) 5 Hz 以上の DFT パワー比。
///
/// **閾値は運動学ハーネス時代の `4.25` ではなく `controller.rs` の実式**
/// `max_steer_rate = lerp(2.5, 6.0, precision).max(LOW_PRECISION_STEER_RATE_FLOOR=5.1)` を使う
/// （`balanced()` は `precision() = 0.5` なので `lerp` 側は `4.25` だが実際にはフロア `5.1` が効く。
/// これは Phase 2 のヘアピン脱出診断で入ったフロアで、旧テストの `4.25` はもう実態と合わない —
/// 測っているのは `move_towards` レート制限という構造保証そのものであり、運動学ハーネスが
/// 使っていた定数ではない）。
#[test]
fn t_ai_02r_steering_does_not_chatter() {
    let series = collect_driver_series(0xA102, DriverModel::balanced(), 5, None);
    let n = series.steer.len();
    let start = n / 3;
    let end = (start + 1200).min(n);
    let w = &series.steer[start..end];
    assert!(
        w.len() >= 1200,
        "T-AI-02R: not enough samples ({}, n={n})",
        w.len()
    );

    let max_steer_rate = sim_math::lerp(2.5, 6.0, DriverModel::balanced().precision()).max(5.1);
    let max_step = max_steer_rate * SIM_DT + 1e-9;
    let worst = w
        .windows(2)
        .map(|p| (p[1] - p[0]).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        worst <= max_step,
        "T-AI-02R: |Δsteer| = {worst:.5} exceeds {max_step:.5}"
    );

    let sd: Vec<f64> = w.windows(3).map(|p| p[2] - 2.0 * p[1] + p[0]).collect();
    let rms = (sd.iter().map(|x| x * x).sum::<f64>() / sd.len() as f64).sqrt();
    assert!(
        rms <= 0.02,
        "T-AI-02R: 2nd-difference RMS = {rms:.5} exceeds 0.02"
    );

    let n = w.len();
    let mean = w.iter().sum::<f64>() / n as f64;
    let mut total = 0.0;
    let mut high = 0.0;
    let k_hi = (5.0 * n as f64 / 60.0).ceil() as usize;
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
        "T-AI-02R: high-frequency (>=5 Hz) power ratio = {ratio:.4} exceeds 0.05"
    );
    eprintln!(
        "T-AI-02R: worst |Δsteer|={worst:.5} (limit {max_step:.5}), 2nd-diff RMS={rms:.5}, \
         hf_ratio={ratio:.4}"
    );
}

/// T-AI-03R — `t_ai_03_no_instant_snap_to_waypoint`（凍結・運動学プラント）の実物理版。
/// 同一メトリクス: `t_target` の 2 階差分が有界（ステーション境界で跳ばない）+ steer も
/// レート上限内（閾値は T-AI-02R と同じ実式）。
#[test]
fn t_ai_03r_no_instant_snap_to_waypoint() {
    let series = collect_driver_series(0xA103, DriverModel::balanced(), 5, None);
    let n = series.t_target.len();
    let start = n / 3;
    let end = (start + 2400).min(n);
    let tt = &series.t_target[start..end];
    assert!(
        tt.len() >= 2400,
        "T-AI-03R: not enough samples ({}, n={n})",
        tt.len()
    );
    let worst = tt
        .windows(3)
        .map(|p| (p[2] - 2.0 * p[1] + p[0]).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        worst <= 0.02,
        "T-AI-03R: t_target 2nd difference {worst:.5} exceeds 0.02 (snap detected)"
    );

    let max_steer_rate = sim_math::lerp(2.5, 6.0, DriverModel::balanced().precision()).max(5.1);
    let max_step = max_steer_rate * SIM_DT + 1e-9;
    let s = &series.steer[start..end];
    let sw = s
        .windows(2)
        .map(|p| (p[1] - p[0]).abs())
        .fold(0.0_f64, f64::max);
    assert!(
        sw <= max_step,
        "T-AI-03R: |Δsteer| {sw:.5} exceeds {max_step:.5}"
    );
    eprintln!(
        "T-AI-03R: worst t_target 2nd-diff={worst:.5} (limit 0.02), worst |Δsteer|={sw:.5} \
         (limit {max_step:.5})"
    );
}

/// T-AI-04R — `t_ai_04_target_speed_never_exceeds_physical_limit`（凍結・運動学プラント）の
/// 実物理版。3 段階の能力値それぞれで 3 周、全 tick `0 <= v_target <= v_cap`。
#[test]
fn t_ai_04r_target_speed_never_exceeds_physical_limit() {
    for (ix, level) in [0.2_f64, 0.5, 0.9].into_iter().enumerate() {
        let mut model = driver_model(level);
        model.consistency = 1.0;
        model.error_rate = 0.0;
        let series = collect_driver_series(0xA104 + ix as u64, model, 3, None);
        assert!(
            !series.v_target.is_empty(),
            "level {level}: no ticks recorded"
        );
        for i in 0..series.v_target.len() {
            assert!(
                series.v_target[i] >= 0.0 && series.v_target[i] <= series.v_cap[i] + 1e-9,
                "T-AI-04R: level {level}: v_target {:.3} out of [0, {:.3}] at tick {i}",
                series.v_target[i],
                series.v_cap[i]
            );
        }
    }
    eprintln!("T-AI-04R: v_target <= v_cap held for all ticks at level 0.2/0.5/0.9");
}

/// T-AI-06R — `t_ai_06_low_consistency_widens_lap_time_spread`（凍結・運動学プラント）の
/// 実物理版。同一比較: `consistency` を下げるほどラップタイムの標準偏差が広がる。
#[test]
fn t_ai_06r_low_consistency_widens_lap_time_spread() {
    // 3 seed プールは標本数を増やすため（n = 18。旧テストは 1 seed・n = 10）。
    // Opus 監査（2026-09-26）で訂正: Phase 3 報告の「`0xA106` 単独だと 1.41→1.48→1.51 と逆転」は
    // グリッド発進の部分周（lap 0 ≈ 100.5 s、他は ≈ 96.3 s）を標本に含めた値で、逆転はその外れ値の
    // 産物だった（consistency が高いほど通常周が速く、lap 0 との差が開く）。lap 0 を落とせば
    // `0xA106` 単独でも 0.415→0.335→0.282、旧テストと同じ 10 周窓でも 0.355→0.265→0.216 と単調減少。
    // 16 seed まで先頭から順にプールしても全て単調減少（seed 選びではない）。
    const SEEDS: [u64; 3] = [0xA106, 0xB106, 0xC106];
    let mut sds = Vec::new();
    let mut report = Vec::new();
    for cons in [0.3_f64, 0.6, 0.9] {
        let mut model = driver_model(0.5);
        model.consistency = cons;
        model.error_rate = 0.6;
        model.reaction_time = 0.25;
        let mut pooled = Vec::new();
        for &seed in &SEEDS {
            let mut world = world_with_line();
            let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
            let gt = line_t(&world, GRID_S);
            world
                .spawn_with_driver(params(), GRID_S, gt, model, rng)
                .unwrap();

            let mut lap_start_tick = 0u64;
            let mut laps_seen = 0u32;
            let mut lap_times = Vec::new();
            let max_ticks = 60_000u64;
            for _ in 0..max_ticks {
                world.step_sim_tick();
                let tick = world.sim_tick();
                let e = &world.vehicles()[0];
                if e.laps_completed > laps_seen {
                    laps_seen = e.laps_completed;
                    lap_times.push((tick - lap_start_tick) as f64 * SIM_DT);
                    lap_start_tick = tick;
                }
                if laps_seen >= 8 {
                    break;
                }
            }
            assert!(
                lap_times.len() >= 7,
                "T-AI-06R: consistency {cons} seed {seed:#x}: only {} laps",
                lap_times.len()
            );
            // 1 周目（グリッドから S/F までの部分周）は落とす。
            pooled.extend_from_slice(&lap_times[1..7]);
        }
        let sd = std_dev(&pooled);
        report.push(format!(
            "consistency {cons}: n={} stddev={sd:.4} (pooled {} seeds)",
            pooled.len(),
            SEEDS.len()
        ));
        sds.push(sd);
    }
    eprintln!("T-AI-06R: {}", report.join(" | "));
    assert!(
        sds[0] > sds[1] && sds[1] > sds[2],
        "T-AI-06R: pooled lap-time stddev not monotone-decreasing with consistency: {sds:?}"
    );
}

/// T-AI-08R — `t_ai_08_determinism_and_derive_order_independence`（凍結・運動学プラント）の
/// 実物理版。**RNG 派生順非依存**は `t_core_ai_08_determinism_and_spawn_order_independence` (b)
/// が既に広い保証（`World` の spawn 順・`driver_rng` の親状態不変）として検証しているため
/// ここでは重複させない。ここで追加するのは (a) の強い版: 決定性を `position`/`velocity`/
/// `coord.s` の 4 成分だけでなく `ControlInput` の全 6 成分のビット列で見る。
#[test]
fn t_ai_08r_determinism_full_control_input_stream() {
    fn run(seed: u64) -> Vec<u64> {
        let mut world = world_with_line();
        let rng = sim_core::rng::driver_rng(&Rng::from_seed(seed), VehicleId(0));
        let gt = line_t(&world, GRID_S);
        world
            .spawn_with_driver(params(), GRID_S, gt, DriverModel::balanced(), rng)
            .unwrap();
        let mut bits = Vec::new();
        for _ in 0..3600 {
            world.step_sim_tick();
            let inp = world.driver(VehicleId(0)).unwrap().last_input();
            for f in [
                inp.steer,
                inp.throttle,
                inp.brake,
                inp.clutch,
                inp.gear as f64,
            ] {
                bits.push(f.to_bits());
            }
            bits.push(inp.drs as u64);
        }
        bits
    }
    let a = run(0xD00D);
    let b = run(0xD00D);
    assert_eq!(
        a, b,
        "T-AI-08R: same seed produced different ControlInput streams"
    );
    eprintln!(
        "T-AI-08R: {} tick ControlInput stream bit-identical across 2 runs",
        a.len() / 6
    );
}

/// T-DRV-02R (Part 1) — `t_drv_02_countersteer_sign_and_throttle_cut` の前半（逆操舵の符号 /
/// スロットルカット）はそもそも運動学プラントを使っていなかった（合成 `VehicleState` を
/// 直接 `Driver` へ通すだけ）。`Plant`/`run_laps` を完全に削除するため、この Plant 非依存の
/// 内容をそのまま実物理テスト側へ移設する（内容は無変更）。
#[test]
fn t_drv_02r_countersteer_sign_and_throttle_cut() {
    use sim_math::{Quat, Vec3};

    fn synthetic_state(yaw: f64, sideslip: f64, yaw_rate: f64) -> sim_vehicle::VehicleState {
        let orientation = Quat::from_euler_yxz(yaw, 0.0, 0.0);
        let forward = orientation * Vec3::X;
        let right = orientation * Vec3::Z;
        let v = 40.0;
        let vel = forward * v + right * (v * sideslip.tan());
        let mut wheels = [sim_vehicle::WheelState::default(); 4];
        for &w in &sim_vehicle::WheelIndex::ALL {
            wheels[w as usize].grip_usage = 0.8;
            wheels[w as usize].grounded = true;
        }
        sim_vehicle::VehicleState {
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

    let track = track();
    let p = params();
    let line = RacingLine::generate(&track, &p, RacingLine::DEFAULT_STEP_M);

    let straight_s = track.start_finish_s();
    let frame = track.frame_at(straight_s);
    let track_yaw = (-frame.tangent.z).atan2(frame.tangent.x);
    let traj_t = line.trajectory().t_at(straight_s);
    let run_once = |sideslip: f64, yr: f64| -> ControlInput {
        let mut d = sim_driver::Driver::new(
            DriverModel {
                error_rate: 0.0,
                consistency: 1.0,
                ..DriverModel::balanced()
            },
            &p,
            sim_core::rng::driver_rng(&Rng::from_seed(0xD202), VehicleId(0)),
        )
        .unwrap();
        let mut input = ControlInput {
            gear: 4,
            ..Default::default()
        };
        for _ in 0..90 {
            let vs = synthetic_state(track_yaw, sideslip, yr);
            let obs = sim_driver::DriverObservation {
                track: &track,
                corridor: line.corridor(),
                trajectory: line.trajectory(),
                speed_profile: line.speed_profile(),
                state: &vs,
                coord: sim_track::TrackCoord::new(straight_s, traj_t),
            };
            input = d.update(&obs);
        }
        input
    };
    let base = run_once(0.0, 0.0);
    let slip = run_once(0.25, 1.2);
    assert!(
        slip.steer > base.steer + 0.02,
        "T-DRV-02R: countersteer did not add rightward steer: base {:.3} slip {:.3}",
        base.steer,
        slip.steer
    );
    assert!(
        slip.throttle <= base.throttle + 1e-6,
        "T-DRV-02R: throttle not reduced during slide: base {:.3} slip {:.3}",
        base.throttle,
        slip.throttle
    );
}

/// T-DRV-02R (Part 2) — 同テストの後半（曲率フィードフォワードの符号）は `run_laps`
/// （運動学プラント）で検証していた。実物理で 4 周走らせ、trajectory 曲率が最大（左）/
/// 最小（右）の tick の実 `ControlInput.steer` を見る。
#[test]
fn t_drv_02r_curvature_feedforward_sign_real_physics() {
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(0xD202), VehicleId(0));
    let gt = line_t(&world, GRID_S);
    world
        .spawn_with_driver(params(), GRID_S, gt, DriverModel::balanced(), rng)
        .unwrap();

    let mut best_left_kappa = 0.0_f64;
    let mut best_right_kappa = 0.0_f64;
    let mut steer_at_left = 0.0_f64;
    let mut steer_at_right = 0.0_f64;
    let mut laps_seen = 0u32;
    let max_ticks = 60_000u64;
    for _ in 0..max_ticks {
        world.step_sim_tick();
        let e = &world.vehicles()[0];
        if e.laps_completed > laps_seen {
            laps_seen = e.laps_completed;
        }
        // 最初の計時ラップ以降だけ計測（旧テストと同じ扱い。spawn 直後の過渡を除く）。
        if laps_seen >= 1 {
            let s = e.coord.s;
            let kap = world.racing_line().unwrap().trajectory().curvature_at(s);
            let steer = world.driver(VehicleId(0)).unwrap().last_input().steer;
            if kap > best_left_kappa {
                best_left_kappa = kap;
                steer_at_left = steer;
            }
            if kap < best_right_kappa {
                best_right_kappa = kap;
                steer_at_right = steer;
            }
        }
        if laps_seen >= 4 {
            break;
        }
    }
    assert!(laps_seen >= 4, "T-DRV-02R: only completed {laps_seen} laps");
    assert!(
        steer_at_left < -0.02,
        "T-DRV-02R: left corner steer {steer_at_left:.3} not left"
    );
    assert!(
        steer_at_right > 0.02,
        "T-DRV-02R: right corner steer {steer_at_right:.3} not right"
    );
    eprintln!(
        "T-DRV-02R: steer_at_left_corner={steer_at_left:.3} steer_at_right_corner={steer_at_right:.3}"
    );
}

/// T-DRV-04R — `t_drv_04_rng_only_affects_causes`（凍結・運動学プラント）の実物理版。
///
/// (1) 8 seed で 5 周走らせ、ラップタイム（周回 3）が seed 間で散らばる（RNG が原因系に効く
/// 構造的証拠）。運動学版はここで `max_limit_excursion <= 1e-6` も課していたが、実物理・
/// `balanced()`（`error_rate=0.5`）はミス由来のコリドー逸脱が**許容된 挙動**であることが
/// `t_core_ai_11b_model_sweep_mistake_recovery`（ミス有りスイープ・7/27 が復帰超過で ignore 中）
/// で既知のため、ここで再度 0 m を課すのは F-6/F-7（Architect 起票待ち）の再提起になり
/// スコープ外。代わりに実測の corridor 逸脱を報告するに留める。
/// (2) クリーンモデル（`error_rate=0` / `consistency=1.0`）は `mistake_*_bias` が常に厳密 0
/// （乱数分岐そのものが起きない構造的証拠）。
#[test]
fn t_drv_04r_rng_only_affects_causes() {
    let corridor_world = world_with_line();
    let corridor = corridor_world.racing_line().unwrap().corridor();
    let mut times = Vec::new();
    let mut report = Vec::new();
    for seed in 0..8u64 {
        let mut world = world_with_line();
        let rng = sim_core::rng::driver_rng(&Rng::from_seed(0xD400 + seed), VehicleId(0));
        let gt = line_t(&world, GRID_S);
        world
            .spawn_with_driver(params(), GRID_S, gt, DriverModel::balanced(), rng)
            .unwrap();
        let mut lap_start_tick = 0u64;
        let mut laps_seen = 0u32;
        let mut lap_times = Vec::new();
        let mut worst_outside = 0.0_f64;
        let max_ticks = 45_000u64;
        for _ in 0..max_ticks {
            world.step_sim_tick();
            let tick = world.sim_tick();
            let e = &world.vehicles()[0];
            if tick > WARMUP_TICKS {
                let (t_right, t_left) = corridor.limit_bounds(e.coord.s);
                let outside = (t_right - e.coord.t).max(e.coord.t - t_left).max(0.0);
                worst_outside = worst_outside.max(outside);
            }
            // 旧 t_drv_04 の per-tick `v_target <= v_cap`（ミス有りモデル）を復元（Opus 監査）。
            // T-AI-04R はミス無しモデルのみなので、ミス（brake bias 等）下でも速度計画が
            // 上限を破らないことはここでしか見ていない。
            let d = world.driver(VehicleId(0)).unwrap();
            let v_cap = world
                .racing_line()
                .unwrap()
                .speed_profile()
                .v_at(d.perceived().s);
            assert!(
                d.plan().v_target >= 0.0 && d.plan().v_target <= v_cap + 1e-9,
                "T-DRV-04R: seed {seed}: v_target {:.3} out of [0, {v_cap:.3}] at tick {tick}",
                d.plan().v_target
            );
            if e.laps_completed > laps_seen {
                laps_seen = e.laps_completed;
                lap_times.push((tick - lap_start_tick) as f64 * SIM_DT);
                lap_start_tick = tick;
            }
            if laps_seen >= 5 {
                break;
            }
        }
        assert!(
            laps_seen >= 5,
            "T-DRV-04R: seed {seed}: only {laps_seen} laps completed"
        );
        report.push(format!("seed {seed}: worst_outside={worst_outside:.4} m"));
        times.push(lap_times[2]);
    }
    eprintln!("T-DRV-04R: {}", report.join(" | "));
    let spread = times.iter().cloned().fold(f64::MIN, f64::max)
        - times.iter().cloned().fold(f64::MAX, f64::min);
    assert!(
        spread > 1e-4,
        "T-DRV-04R: lap times did not vary across seeds (spread {spread:.6})"
    );

    // クリーンモデル: mistake bias は常に 0。
    let mut model = driver_model(0.5);
    model.consistency = 1.0;
    model.error_rate = 0.0;
    let mut world = world_with_line();
    let gt = line_t(&world, GRID_S);
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(0xD4FF), VehicleId(0));
    world
        .spawn_with_driver(params(), GRID_S, gt, model, rng)
        .unwrap();
    let mut max_bias = 0.0_f64;
    for _ in 0..20_000u64 {
        world.step_sim_tick();
        let ds = world.driver(VehicleId(0)).unwrap().driver_state();
        max_bias = max_bias
            .max(ds.mistake_steer_bias.abs())
            .max(ds.mistake_brake_bias.abs());
        if world.vehicles()[0].laps_completed >= 4 {
            break;
        }
    }
    assert_eq!(
        max_bias, 0.0,
        "T-DRV-04R: mistake bias appeared with error_rate=0 (max {max_bias})"
    );
    eprintln!("T-DRV-04R: clean model mistake bias = 0.0 throughout");
}

/// T-DRV-05R — `t_drv_05_performance`（凍結・運動学プラント）の実物理版。
///
/// `t_core_ai_09_step_sim_tick_performance` は 24 台合成の `step_sim_tick`（物理込み）を
/// 測るのみで、`Driver::new` / 単体 `Driver::update` 呼び出しのコストは測っていない。
/// ここでその欠けている 2 つを、実物理でウォームアップした `VehicleState` を使って測る。
#[test]
fn t_drv_05r_performance() {
    use std::time::Instant;

    let t0 = Instant::now();
    let _d = sim_driver::Driver::new(
        DriverModel::balanced(),
        &params(),
        sim_core::rng::driver_rng(&Rng::from_seed(5), VehicleId(0)),
    )
    .unwrap();
    let new_us = t0.elapsed().as_secs_f64() * 1e6;
    assert!(
        new_us <= 1000.0,
        "T-DRV-05R: Driver::new took {new_us:.1} us (> 1000)"
    );

    // 実物理でウォームアップ済みの VehicleState を用意する。
    let mut world = world_with_line();
    let rng = sim_core::rng::driver_rng(&Rng::from_seed(5), VehicleId(1));
    let gt = line_t(&world, GRID_S);
    world
        .spawn_with_driver(params(), GRID_S, gt, DriverModel::balanced(), rng)
        .unwrap();
    for _ in 0..150 {
        world.step_sim_tick();
    }
    let track = world.track();
    let line = world.racing_line().unwrap();
    let e = &world.vehicles()[0];
    let state = e.vehicle.state();
    let obs = sim_driver::DriverObservation {
        track,
        corridor: line.corridor(),
        trajectory: line.trajectory(),
        speed_profile: line.speed_profile(),
        state,
        coord: e.coord,
    };
    let mut d = sim_driver::Driver::new(
        DriverModel::balanced(),
        &params(),
        sim_core::rng::driver_rng(&Rng::from_seed(6), VehicleId(0)),
    )
    .unwrap();
    for _ in 0..200 {
        let _ = d.update(&obs);
    }
    let n = 20_000;
    let t1 = Instant::now();
    let mut sink = 0.0;
    for _ in 0..n {
        sink += d.update(&obs).steer;
    }
    let per = t1.elapsed().as_secs_f64() * 1e6 / n as f64;
    eprintln!(
        "T-DRV-05R: Driver::update {per:.3} us/call (sink {sink:.1}), Driver::new {new_us:.1} us"
    );
    assert!(
        per <= 25.0,
        "T-DRV-05R: Driver::update {per:.3} us/call exceeds 25 us"
    );
}
