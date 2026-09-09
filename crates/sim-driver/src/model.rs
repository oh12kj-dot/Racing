//! [`DriverModel`]（個体の能力値）と [`DriverState`]（レース中に動的に変わる状態）。

use crate::SIM_DT;
use sim_math::approach_exponential;

/// 能力値の検査に失敗した理由。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DriverModelError {
    /// `0.0..=1.0` に収まるべき能力値が範囲外。
    AbilityOutOfRange {
        /// フィールド名。
        field: &'static str,
    },
    /// `reaction_time` が `0.0..=0.60` の範囲外（負・非有限を含む）。
    ReactionTimeOutOfRange,
    /// いずれかの能力値が非有限。
    NotFinite {
        /// フィールド名。
        field: &'static str,
    },
}

/// `confidence` を 1.0 側へ回復させる時定数 [s]（遅い）。
pub(crate) const TAU_CONF_UP: f64 = 20.0;
/// `confidence` を 0.0 側へ失わせる時定数 [s]（速い）。
pub(crate) const TAU_CONF_DOWN: f64 = 1.5;
/// ミスによる入力バイアスの減衰時定数 [s]。
pub(crate) const TAU_MISTAKE: f64 = 1.2;

/// ドライバー個体の能力値。**`0.0..=1.0`**（`reaction_time` のみ秒）。
///
/// これらは「原因」にのみ作用する。**`v_max` / ラップタイムを直接変えてはならない。**
/// `ARCHITECTURE.md` §6 の能力値表を全項目そのまま持つ（Phase 2 で使わないものも、
/// 後から形式を変えないために定義しておく。`TrajectoryKind` と同じ方針）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DriverModel {
    /// 素の速さ。`v_target` のペーススケールに効く。
    pub pace: f64,
    /// ブレーキング精度。ブレーキングポイントの誤差に効く（`v_cap` は変えない）。
    pub braking_skill: f64,
    /// コーナリング精度。逆操舵の許容スリップ角と入力精度に効く。
    pub cornering_skill: f64,
    /// レースクラフト。**Phase 2 未使用**（Phase 4+）。
    pub racecraft: f64,
    /// 攻撃性。`risk_budget` に効く。
    pub aggression: f64,
    /// 一貫性。入力精度ノイズとミス確率に効く（ラップ間ばらつき）。
    pub consistency: f64,
    /// 追い抜きの巧さ。**Phase 2 未使用**（Phase 5）。
    pub overtaking_skill: f64,
    /// 防御の巧さ。**Phase 2 未使用**（Phase 5）。
    pub defending_skill: f64,
    /// ウェット適性。**Phase 2 未使用**（Phase 7）。
    pub wet_skill: f64,
    /// タイヤマネジメント。**Phase 2 未使用**（Phase 6）。
    pub tyre_management: f64,
    /// リスク許容度。`risk_budget` に効く。
    pub risk_tolerance: f64,
    /// 反応時間 [s]。`0.15..=0.35`（`ARCHITECTURE.md` §6）。予見経路の遅延段数を決める。
    pub reaction_time: f64,
    /// 空間認知。認知誤差の大きさに効く（低いほど誤差が大きい）。
    pub spatial_awareness: f64,
    /// ミス率。`mistake_*_bias` の発生確率に効く。
    pub error_rate: f64,
}

impl DriverModel {
    /// 全能力 0.5 / `reaction_time` 0.25 の基準ドライバー。
    pub fn balanced() -> DriverModel {
        DriverModel {
            pace: 0.5,
            braking_skill: 0.5,
            cornering_skill: 0.5,
            racecraft: 0.5,
            aggression: 0.5,
            consistency: 0.5,
            overtaking_skill: 0.5,
            defending_skill: 0.5,
            wet_skill: 0.5,
            tyre_management: 0.5,
            risk_tolerance: 0.5,
            reaction_time: 0.25,
            spatial_awareness: 0.5,
            error_rate: 0.5,
        }
    }

    /// 範囲検査。範囲外は `Err`。**クランプで黙って通さない。**
    pub fn validate(&self) -> Result<(), DriverModelError> {
        let unit = [
            ("pace", self.pace),
            ("braking_skill", self.braking_skill),
            ("cornering_skill", self.cornering_skill),
            ("racecraft", self.racecraft),
            ("aggression", self.aggression),
            ("consistency", self.consistency),
            ("overtaking_skill", self.overtaking_skill),
            ("defending_skill", self.defending_skill),
            ("wet_skill", self.wet_skill),
            ("tyre_management", self.tyre_management),
            ("risk_tolerance", self.risk_tolerance),
            ("spatial_awareness", self.spatial_awareness),
            ("error_rate", self.error_rate),
        ];
        for (field, v) in unit {
            if !v.is_finite() {
                return Err(DriverModelError::NotFinite { field });
            }
            if !(0.0..=1.0).contains(&v) {
                return Err(DriverModelError::AbilityOutOfRange { field });
            }
        }
        if !self.reaction_time.is_finite() || !(0.0..=0.60).contains(&self.reaction_time) {
            return Err(DriverModelError::ReactionTimeOutOfRange);
        }
        Ok(())
    }

    /// 入力精度の合成値 `0..1`。`0.5*consistency + 0.5*cornering_skill`。
    ///
    /// `ARCHITECTURE.md` §6 の「`max_steer_rate` は precision に依存」の precision。
    /// §6 の能力値表に `precision` 単体は無いためここで定義する（Architect 判断・
    /// `TODO.md` TASK-2-2 Deviations 1）。フィールドは増やさない。
    pub fn precision(&self) -> f64 {
        0.5 * self.consistency + 0.5 * self.cornering_skill
    }
}

/// レース中に動的に変わる状態。乱数と直近の成否で変動する。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DriverState {
    /// 自信 `0.0..=1.0`。`pace` / `risk_budget` を変調する（`ARCHITECTURE.md` §6）。
    pub confidence: f64,
    /// 直近のミスからの経過 tick。
    pub ticks_since_mistake: u64,
    /// 現在のミスによる操舵オフセットの残量 [rad]（road wheel angle・指数減衰する）。
    pub mistake_steer_bias: f64,
    /// 現在のミスによるブレーキオフセットの残量 `0..1` 相当（指数減衰する）。
    pub mistake_brake_bias: f64,
}

impl DriverState {
    /// 初期状態。自信は中庸から始める。
    pub(crate) fn initial() -> DriverState {
        DriverState {
            confidence: 0.6,
            ticks_since_mistake: u64::MAX / 2,
            mistake_steer_bias: 0.0,
            mistake_brake_bias: 0.0,
        }
    }

    /// 1 tick 分、`confidence` とミスバイアスを更新する。
    ///
    /// `clean` は「コース内・グリップ余裕内・大きなスライドやロックアップなし」で
    /// 走れた tick を表す。回復は遅く（[`TAU_CONF_UP`]）、失うのは速い（[`TAU_CONF_DOWN`]）。
    pub(crate) fn advance(&mut self, clean: bool) {
        let tau = if clean { TAU_CONF_UP } else { TAU_CONF_DOWN };
        let target = if clean { 1.0 } else { 0.0 };
        self.confidence =
            approach_exponential(self.confidence, target, tau, SIM_DT).clamp(0.0, 1.0);
        self.mistake_steer_bias =
            approach_exponential(self.mistake_steer_bias, 0.0, TAU_MISTAKE, SIM_DT);
        self.mistake_brake_bias =
            approach_exponential(self.mistake_brake_bias, 0.0, TAU_MISTAKE, SIM_DT);
        self.ticks_since_mistake = self.ticks_since_mistake.saturating_add(1);
    }
}
