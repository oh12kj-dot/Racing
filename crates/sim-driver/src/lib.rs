//! Driver AI — `ARCHITECTURE.md` §6 の 4 層パイプライン
//! （Perception → Decision → Planner → Controller）+ Driver Model。
//!
//! # 不可侵の原則（`HANDOFF.md` §3）
//!
//! - AI は Transform / Position / Velocity を書き換えない。**出力は [`ControlInput`] ただ 1 つ**。
//! - Lap Time を乱数生成しない。乱数は **原因**（reaction / decision / confidence /
//!   risk / mistake / precision / consistency）にのみ作用させる。
//! - グローバル乱数・時刻依存乱数の禁止。[`sim_math::Rng::derive`] の明示派生のみ。
//!   [`Driver::update`] の中で `derive` を呼ばない（tick ごとに派生を作らない）。
//! - 位置は連続量 `s`（弧長 [m]）。**Waypoint index を保持も公開もしない**。
//! - 固定タイムステップ。[`Driver::update`] は `dt` 引数を取らない（[`SIM_DT`] 定数）。
//! - この crate は `sim-core` / Rendering / UI / Camera を知らない（依存方向は一方向）。
//!
//! # テスト戦略
//!
//! `sim-driver` は `sim-core` に依存できない（依存グラフの循環禁止・dev-dep も不可）。
//! 実物理の閉ループ（`World` + `TrackGround` + `Vehicle`）の検証は **TASK-2-3** が行う。
//! 本 crate のテストは (1) 実トラック幾何 + 運動学プラント（自転車モデル）と
//! (2) 手組みの [`VehicleState`] に対する単体テストで制御ループを構造的に検証する。

#![deny(unsafe_code)]
#![warn(missing_docs)]

mod controller;
mod decision;
mod driver;
mod model;
mod perception;
mod planner;

pub use controller::Controller;
pub use decision::{Decision, DriverIntent, DriverMode};
pub use driver::{Driver, DriverObservation};
pub use model::{DriverModel, DriverModelError, DriverState};
pub use perception::{PerceivedSelf, Perception};
pub use planner::{Plan, Planner};

pub use sim_vehicle::ControlInput;

/// Simulation Tick の固定ステップ [s]。`ARCHITECTURE.md` §11 の 60 Hz。
pub const SIM_DT: f64 = 1.0 / 60.0;

/// Simulation Tick 1 回に対応する Physics Tick 数（240 Hz / 60 Hz）。
///
/// `sim_vehicle::PHYSICS_DT * PHYSICS_TICKS_PER_SIM_TICK as f64 == SIM_DT` が
/// 成り立つことを [`sim_dt_matches_physics_dt`] が検証する。
pub const PHYSICS_TICKS_PER_SIM_TICK: usize = 4;

#[cfg(test)]
#[test]
fn sim_dt_matches_physics_dt() {
    let composed = sim_vehicle::PHYSICS_DT * PHYSICS_TICKS_PER_SIM_TICK as f64;
    assert!((composed - SIM_DT).abs() < 1e-15, "{composed} != {SIM_DT}");
}
