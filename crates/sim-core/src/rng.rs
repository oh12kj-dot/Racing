//! 乱数の派生規約。**状態を持たない自由関数だけ**を置く。
//!
//! `sim-core` は `Rng` を保持しない（`HANDOFF.md` §3「`sim-core` は乱数を持たない」）。
//! 呼び出し側（テスト / `sim-wasm`）が `Rng::from_seed(race_seed)` を作り、この
//! モジュールで個体系列を得て [`crate::World::spawn_with_driver`] へ渡す。

use crate::VehicleId;
use sim_math::Rng;

/// レース系列から「この車の Driver 系列」を派生する。
///
/// ラベルは `driver:NN`（`NN` は [`VehicleId`]`.0` の 2 桁ゼロ詰め・10 進。
/// `id.0 >= 100` は 3 桁以上をそのまま出すので一意性は保たれる）。
///
/// [`Rng::derive`] は親状態を変えず派生順にも依存しないので、
/// **どの順に `spawn_with_driver` を呼んでも各車の系列は不変**（T-CORE-AI-08）。
/// `Driver::new` がこの系列からさらに `perception` / `decision` /
/// `mistake` / `precision` の 4 本へ `derive` する。
pub fn driver_rng(race: &Rng, id: VehicleId) -> Rng {
    race.derive(&format!("driver:{:02}", id.0))
}
