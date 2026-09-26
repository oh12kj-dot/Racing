//! TASK-2-2 受け入れテスト（残置分）。T-DRV-01 / 03 / 06。
//!
//! TASK-2-4 Phase 3（自転車モデルのテストハーネス廃止）で T-AI-01〜08 と T-DRV-02/04/05 と
//! `smoke_lap_times_are_plausible` は実物理版へ移行して削除した
//! （`crates/sim-core/tests/world_ai.rs` の T-AI-*R / T-DRV-*R。対応表は `TODO.md` 参照）。
//! ここに残るのは自転車モデルの走行ヘルパーを**そもそも使っていなかった** 3 本 —
//! (1) `Perception` の遅延段数を直接検証する単体テスト、
//! (2) `Planner`/`Corridor` のクランプを直接叩く構造保証、
//! (3) ソースの禁止トークン走査。
//! `common/mod.rs` からその走行ヘルパー一式は削除済み（他に参照が無いため）。

mod common;

use common::*;
use sim_driver::*;
use sim_math::Rng;

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
