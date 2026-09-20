//! Racing Line System — `ARCHITECTURE.md` §4 の 3 概念の分離を型で強制する。
//!
//! - [`Corridor`] — **どこを走ってよいか**。各弧長 `s` で横オフセット `t` の下限・上限。
//! - [`Trajectory`] — **どこを走ろうとするか**。横位置 `t(s)` の C1 連続関数。
//! - [`SpeedProfile`] — **どれだけの速度で走れるか**。`s` ごとの限界速度 [m/s]。
//!
//! この crate は **乱数・時刻依存・グローバル状態を一切持たない**。すべての出力は
//! [`sim_track::Track`] と [`sim_vehicle::VehicleParams`] だけから決定的に導出される。
//! `sim-core` / `sim-driver` / Rendering / UI を知らない（依存方向は一方向）。
//!
//! 位置は連続量 `s`（弧長 [m]）でアクセスする。**Waypoint index を公開しない**
//! （`ARCHITECTURE.md` §4「単一 Waypoint 列の禁止」）。

#![deny(unsafe_code)]
#![warn(missing_docs)]

mod corridor;
mod speed;
mod trajectory;

pub use corridor::Corridor;
pub use speed::{PerformanceEnvelope, SpeedProfile};
pub use trajectory::{Trajectory, TrajectoryKind};

/// ステーション列の共通規約。
///
/// `n = ceil(L / step_m)` 個の**区間**、`m = n` 個の相異なるステーション
/// `s_i = i * L / n`（`i = 0..n`）。閉トラックなので `s_n == s_0`（`wrap_s` により）で
/// あり、格納するのは `i = 0..n-1` の `n` 点。実際の間隔 `h = L / n <= step_m`。
///
/// 3 つの構造体はそれぞれ独自の `step_m` を持ってよい。相互参照はすべて弧長 `s` の
/// 補間で行うため、グリッドが一致している必要はない。
#[derive(Clone, Copy, Debug)]
struct Stations {
    length: f64,
    /// 相異なるステーション数（>= 4）。
    count: usize,
    /// ステーション間隔 `length / count`。
    step: f64,
}

impl Stations {
    /// `length > 0`、`step_m > 0` を前提に構築する。ステーション数は最低 4
    /// （C1 補間に 4 点必要）。
    fn new(length: f64, step_m: f64) -> Stations {
        debug_assert!(length.is_finite() && length > 0.0);
        debug_assert!(step_m.is_finite() && step_m > 0.0);
        let count = (length / step_m).ceil().max(4.0) as usize;
        Stations {
            length,
            count,
            step: length / count as f64,
        }
    }

    #[inline]
    fn s_of(&self, i: usize) -> f64 {
        i as f64 * self.step
    }

    /// `i` を `[0, count)` へ巡回で丸める。
    #[inline]
    fn wrap_index(&self, i: isize) -> usize {
        let n = self.count as isize;
        (((i % n) + n) % n) as usize
    }

    /// 弧長 `s`（任意の実数）を `[0, length)` へ正規化する。
    #[inline]
    fn wrap_s(&self, s: f64) -> f64 {
        let mut r = s % self.length;
        if r < 0.0 {
            r += self.length;
        }
        r
    }

    /// 値列 `values`（`count` 個、周期的）を弧長 `s` で線形補間する。
    fn lerp_periodic(&self, values: &[f64], s: f64) -> f64 {
        let s = self.wrap_s(s);
        let x = s / self.step;
        let i0 = x.floor() as isize;
        let f = x - i0 as f64;
        let a = values[self.wrap_index(i0)];
        let b = values[self.wrap_index(i0 + 1)];
        a + (b - a) * f
    }
}
