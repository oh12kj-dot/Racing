//! Decision 層 — Phase 2 は [`DriverMode::FreeAir`] のみを生成する。
//!
//! モード遷移のヒステリシスと最小滞在時間の**仕組み**は Phase 2 でも実装しておく
//! （遷移先が 1 つしかないだけ）。トラジェクトリ重みは必ず時間平滑化して返す
//! （ステップ変化は `ARCHITECTURE.md` §12-8 の禁止アンチパターン）。

use crate::model::{DriverModel, DriverState};
use crate::SIM_DT;
use sim_math::{approach_exponential, saturate, Rng};

/// `ARCHITECTURE.md` §6 のドライバーモード。**enum は全体を定義する**
/// （後から形式を変えないため）。Phase 2 が生成するのは [`DriverMode::FreeAir`] のみ。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DriverMode {
    /// フリーエア（前走車の影響なし）。
    FreeAir,
    /// 追走。
    Following,
    /// 攻撃（追い抜きを狙う）。
    Attacking,
    /// 防御。
    Defending,
    /// 並走。
    SideBySide,
    /// 接触回避。
    Avoiding,
    /// コースオフからの復帰。
    Recovering,
    /// ピットイン。
    PitIn,
    /// ピットアウト。
    PitOut,
    /// イエロー区間。
    UnderYellow,
    /// セーフティカー。
    SafetyCar,
    /// ブルーフラッグ（周回遅れ）。
    BlueFlag,
}

/// Decision 層の出力。Planner はこの重みを必ず経由して `t_target` を作る。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DriverIntent {
    /// 現在のモード。
    pub mode: DriverMode,
    /// 目標車間 [s]。Phase 2 は `0.0`。
    pub target_gap: f64,
    /// 関与度 `0..1`。Phase 2 は `0.0`。
    pub engagement: f64,
    /// リスク予算 `0..1`。`aggression` / `risk_tolerance` / `confidence` から、平滑化して。
    pub risk_budget: f64,
    /// 基準トラジェクトリの重み。Phase 2 は `1.0`（平滑化して漸近）。
    pub w_reference: f64,
    /// 防御ラインの重み。Phase 2 は `0.0`。
    pub w_defensive: f64,
    /// 追い抜きラインの重み。Phase 2 は `0.0`。
    pub w_overtake: f64,
}

/// トラジェクトリ重みとリスク予算の時間平滑化の時定数 [s]。
const TAU_WEIGHT: f64 = 0.4;
/// モードの最小滞在 tick 数（ヒステリシス。Phase 2 は遷移が起きないが仕組みは持つ）。
const MIN_DWELL_TICKS: u64 = 30;

/// Decision 層の状態機械。
pub struct Decision {
    mode: DriverMode,
    ticks_in_mode: u64,
    risk_budget: f64,
    w_reference: f64,
    w_defensive: f64,
    w_overtake: f64,
    rng: Rng,
}

impl Decision {
    /// `rng` は `Driver::new` が `derive("decision")` で用意した系列。
    pub fn new(rng: Rng) -> Decision {
        Decision {
            mode: DriverMode::FreeAir,
            ticks_in_mode: 0,
            risk_budget: 0.5,
            w_reference: 1.0,
            w_defensive: 0.0,
            w_overtake: 0.0,
            rng,
        }
    }

    /// 現在のモード（読み出し）。
    pub fn mode(&self) -> DriverMode {
        self.mode
    }

    /// 1 tick 進めて [`DriverIntent`] を返す。
    pub fn update(&mut self, model: &DriverModel, state: &DriverState) -> DriverIntent {
        // --- モード遷移（Phase 2 は FreeAir へ留まるだけ。仕組みだけ通す）---
        let desired = DriverMode::FreeAir;
        if desired != self.mode && self.ticks_in_mode >= MIN_DWELL_TICKS {
            self.mode = desired;
            self.ticks_in_mode = 0;
        } else {
            self.ticks_in_mode = self.ticks_in_mode.saturating_add(1);
        }

        // --- リスク予算: 能力値 + 自信 + 判断のゆらぎ ---
        let base =
            saturate(0.5 * model.aggression + 0.3 * model.risk_tolerance + 0.2 * state.confidence);
        let jitter = self
            .rng
            .normal(0.0, 0.03 * (1.0 - model.consistency).max(0.0));
        let risk_target = saturate(base + jitter);
        self.risk_budget =
            approach_exponential(self.risk_budget, risk_target, TAU_WEIGHT, SIM_DT).clamp(0.0, 1.0);

        // --- トラジェクトリ重み: Phase 2 は Reference=1 へ漸近（ステップ変化禁止）---
        self.w_reference = approach_exponential(self.w_reference, 1.0, TAU_WEIGHT, SIM_DT);
        self.w_defensive = approach_exponential(self.w_defensive, 0.0, TAU_WEIGHT, SIM_DT);
        self.w_overtake = approach_exponential(self.w_overtake, 0.0, TAU_WEIGHT, SIM_DT);

        DriverIntent {
            mode: self.mode,
            target_gap: 0.0,
            engagement: 0.0,
            risk_budget: self.risk_budget,
            w_reference: self.w_reference,
            w_defensive: self.w_defensive,
            w_overtake: self.w_overtake,
        }
    }
}
