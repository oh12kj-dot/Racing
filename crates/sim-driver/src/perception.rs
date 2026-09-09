//! Perception 層 — 遅延と認知誤差を入れて「認知された自車状態」を作る。
//!
//! `ARCHITECTURE.md` §6 は単一の `reaction_time` 遅延を書くが、本実装は遅延を
//! **2 系統**に分ける（`TODO.md` TASK-2-2 Deviations 2）:
//!
//! | 経路 | 遅延 | 根拠 |
//! |------|------|------|
//! | 予見（Decision / Planner） | `ceil(reaction_time / SIM_DT)` tick | §6「reaction_time 分のリングバッファ遅延」 |
//! | 安定化（Controller の逆操舵・ヨー減衰） | `ceil(0.08 / SIM_DT)` tick | 前庭反射は視覚より速い。ここまで `reaction_time` で遅らせると限界付近で発散する（TASK-1B-1 C-1 と衝突する） |
//!
//! [`Perception::latest`] は遅延 0 の最新真値を返す（安定化経路の生成元）。
//! 安定化遅延は消費側（[`crate::Driver`]）が [`Perception::stabilisation_delay_ticks`]
//! を使って適用する。

use crate::SIM_DT;
use sim_math::{approach_exponential, Rng};
use std::collections::VecDeque;

/// 認知された自車の状態。**真値ではない**（予見経路は遅延 + 認知誤差が入る）。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PerceivedSelf {
    /// トラジェクトリ基準の弧長 `s` [m]。
    pub s: f64,
    /// 横オフセット `t` [m]（+t が左）。
    pub t: f64,
    /// 前進速度 [m/s]。
    pub speed: f64,
    /// トラジェクトリ接線に対する車体ヨー誤差 [rad]（+ で車体が左を向く）。
    pub heading_error: f64,
    /// 車体スリップ角 `beta` [rad]（+ で速度ベクトルが車体前方の**右**側。
    /// すなわち左コーナーのオーバーステア = 右への逆操舵が要る向き）。
    pub sideslip: f64,
    /// ヨーレート [rad/s]（+ で左旋回）。
    pub yaw_rate: f64,
    /// 4 輪の `grip_usage` の最大値。
    pub grip_usage_max: f64,
    /// トラックリミット内か。
    pub within_limits: bool,
}

impl PerceivedSelf {
    /// 全成分ゼロ・`within_limits = true` の初期値。
    pub fn zeroed() -> PerceivedSelf {
        PerceivedSelf {
            s: 0.0,
            t: 0.0,
            speed: 0.0,
            heading_error: 0.0,
            sideslip: 0.0,
            yaw_rate: 0.0,
            grip_usage_max: 0.0,
            within_limits: true,
        }
    }
}

/// 安定化経路の遅延 [s]。前庭反射の実効遅れ。`reaction_time` とは別系統。
pub(crate) const STABILISATION_DELAY_S: f64 = 0.08;
/// 認知誤差ノイズの低域通過時定数 [s]。白色ノイズを直接足すと操舵が振動して
/// T-AI-02 に落ちるため、必ずこの時定数で低域に落としてから使う。
const PERCEPTION_NOISE_TAU: f64 = 0.5;
/// `spatial_awareness = 0` のときの `t` の認知誤差の標準偏差 [m]。
const SIGMA_T_MAX: f64 = 0.25;
/// `spatial_awareness = 0` のときの `speed` の認知誤差の標準偏差 [m/s]。
const SIGMA_V_MAX: f64 = 1.0;

/// リングバッファ遅延 + 低域ノイズで [`PerceivedSelf`] を作る。
pub struct Perception {
    buffer: VecDeque<PerceivedSelf>,
    capacity: usize,
    preview_delay: usize,
    stabilisation_delay: usize,
    rng: Rng,
    sigma_t: f64,
    sigma_v: f64,
    noise_t: f64,
    noise_v: f64,
    latest: PerceivedSelf,
}

impl Perception {
    /// `reaction_time` から遅延段数とバッファ容量を決めて構築する。
    ///
    /// `rng` は `Driver::new` が `derive("perception")` で用意した系列。
    /// バッファ容量は `reaction_time` から計算する（マジックナンバーを埋めない）。
    /// `reaction_time = 0.0` は予見遅延 0 段として正当に動く（T-AI-07 の対照条件）。
    pub fn new(model: &crate::DriverModel, rng: Rng) -> Perception {
        let preview_delay = (model.reaction_time / SIM_DT).ceil().max(0.0) as usize;
        let stabilisation_delay = (STABILISATION_DELAY_S / SIM_DT).ceil() as usize;
        let capacity = preview_delay.max(stabilisation_delay) + 2;
        let aware = model.spatial_awareness.clamp(0.0, 1.0);
        Perception {
            buffer: VecDeque::with_capacity(capacity),
            capacity,
            preview_delay,
            stabilisation_delay,
            rng,
            sigma_t: (1.0 - aware) * SIGMA_T_MAX,
            sigma_v: (1.0 - aware) * SIGMA_V_MAX,
            noise_t: 0.0,
            noise_v: 0.0,
            latest: PerceivedSelf::zeroed(),
        }
    }

    /// 真値を 1 tick 押し込み、**予見経路の**認知値（遅延 + 低域ノイズ）を返す。
    pub fn update(&mut self, truth: &PerceivedSelf) -> PerceivedSelf {
        self.latest = *truth;
        self.buffer.push_front(*truth);
        while self.buffer.len() > self.capacity {
            self.buffer.pop_back();
        }

        // 低域ノイズ: 毎 tick 目標を引き直し、時定数 PERCEPTION_NOISE_TAU で追従させる。
        let target_t = self.rng.normal(0.0, self.sigma_t.max(f64::MIN_POSITIVE));
        let target_v = self.rng.normal(0.0, self.sigma_v.max(f64::MIN_POSITIVE));
        self.noise_t = approach_exponential(self.noise_t, target_t, PERCEPTION_NOISE_TAU, SIM_DT);
        self.noise_v = approach_exponential(self.noise_v, target_v, PERCEPTION_NOISE_TAU, SIM_DT);

        let idx = self.preview_delay.min(self.buffer.len().saturating_sub(1));
        let mut p = self.buffer[idx];
        p.t += self.noise_t;
        p.speed = (p.speed + self.noise_v).max(0.0);
        p
    }

    /// 予見（Decision / Planner）経路の遅延段数。
    pub fn preview_delay_ticks(&self) -> usize {
        self.preview_delay
    }

    /// 安定化（Controller の逆操舵）経路の遅延段数。
    pub fn stabilisation_delay_ticks(&self) -> usize {
        self.stabilisation_delay
    }

    /// 遅延なしの最新の真値。安定化経路の生成元（短遅延は消費側が適用する）。
    pub fn latest(&self) -> PerceivedSelf {
        self.latest
    }
}
