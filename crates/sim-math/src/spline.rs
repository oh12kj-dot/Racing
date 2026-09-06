//! 弧長パラメータ化スプライン。
//!
//! `sim-track` の Track Coordinate System はすべてこの上に載る。
//! トラック上の位置は Waypoint index ではなく **連続量 `s`（センターライン沿いの弧長 [m]）**
//! で表現する。これが ARCHITECTURE.md §3 で述べた「Waypoint index が暴走しない」構造の根拠である。
//!
//! # 構成
//!
//! - [`CubicSpline`] — centripetal Catmull-Rom による C1 連続な 3 次スプライン。
//!   パラメータ `u` は `[0, 1]`。
//! - [`ArcLengthSpline`] — 上記を弧長で再パラメータ化し、`s` [m] でアクセスできるようにしたもの。
//!
//! # なぜ centripetal 版か
//!
//! 一様 Catmull-Rom は制御点間隔が不均一なときにカスプ（尖り）とオーバーシュートを生じる。
//! centripetal 版（alpha = 0.5）はこれを数学的に回避する。
//! サーキットのセンターラインは直線区間とヘアピンで点間隔が大きく変わるため、これは必須である。

use crate::util::EPSILON;
use crate::vec::Vec3;
use std::fmt;

/// スプライン構築時のエラー。
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SplineError {
    /// 制御点が 4 点未満。
    TooFewPoints {
        /// 与えられた制御点数。
        got: usize,
        /// 必要な最小制御点数。
        need: usize,
    },
    /// 隣接する制御点が重複している（`index` と `index + 1`）。
    DuplicatePoint {
        /// 重複したセグメントの開始制御点の添字。
        index: usize,
    },
    /// 制御点に NaN / 無限大が含まれる。
    NonFinitePoint {
        /// 非有限値を含む制御点の添字。
        index: usize,
    },
}

impl fmt::Display for SplineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SplineError::TooFewPoints { got, need } => {
                write!(f, "spline needs at least {need} control points, got {got}")
            }
            SplineError::DuplicatePoint { index } => {
                write!(f, "control points {index} and {} are coincident", index + 1)
            }
            SplineError::NonFinitePoint { index } => {
                write!(f, "control point {index} is not finite")
            }
        }
    }
}

impl std::error::Error for SplineError {}

/// centripetal Catmull-Rom の指数。
const ALPHA: f64 = 0.5;
/// ノットスパンの下限。端点の仮想制御点が退化した場合の除算を防ぐ。
const MIN_KNOT_SPAN: f64 = 1.0e-6;

/// 1 セグメント分のエルミート係数。局所パラメータは `[0, 1]`。
#[derive(Clone, Copy, Debug)]
struct Segment {
    p1: Vec3,
    p2: Vec3,
    m1: Vec3,
    m2: Vec3,
    /// このセグメントのノットスパン（= |p2 - p1|^ALPHA）。
    span: f64,
    /// スプライン先頭からの累積ノット値。
    cum: f64,
}

/// centripetal Catmull-Rom による C1 連続な 3 次スプライン。
///
/// 大域パラメータ `u in [0, 1]` は各セグメントへ **ノットスパンに比例して**割り当てられる。
/// これにより接線ベクトルがセグメント境界で完全に一致し、真の C1 連続となる。
#[derive(Clone, Debug)]
pub struct CubicSpline {
    segments: Vec<Segment>,
    total_knot: f64,
    closed: bool,
}

impl CubicSpline {
    /// 制御点から構築する。
    ///
    /// - `closed = true` でループを閉じる（最終点から始点へ戻るセグメントが追加される）
    /// - 制御点が 4 未満、隣接点が重複、非有限値を含む場合は [`SplineError`]
    /// - 開曲線の端点には反射による仮想制御点を用いる（端でのカスプを防ぐ）
    pub fn new(points: &[Vec3], closed: bool) -> Result<Self, SplineError> {
        const MIN_POINTS: usize = 4;
        if points.len() < MIN_POINTS {
            return Err(SplineError::TooFewPoints {
                got: points.len(),
                need: MIN_POINTS,
            });
        }
        for (i, p) in points.iter().enumerate() {
            if !p.is_finite() {
                return Err(SplineError::NonFinitePoint { index: i });
            }
        }

        let n = points.len();
        let n_seg = if closed { n } else { n - 1 };

        for i in 0..n_seg {
            let a = points[i];
            let b = points[(i + 1) % n];
            if (b - a).length() <= EPSILON {
                return Err(SplineError::DuplicatePoint { index: i });
            }
        }

        // 符号付きインデックスから制御点を取得する。
        // 閉曲線は巡回、開曲線は端点を反射して仮想点を作る。
        let get = |j: isize| -> Vec3 {
            if closed {
                points[j.rem_euclid(n as isize) as usize]
            } else if j < 0 {
                points[0] * 2.0 - points[1]
            } else if j as usize >= n {
                points[n - 1] * 2.0 - points[n - 2]
            } else {
                points[j as usize]
            }
        };

        let knot_span =
            |a: Vec3, b: Vec3| -> f64 { (b - a).length().powf(ALPHA).max(MIN_KNOT_SPAN) };

        let mut segments = Vec::with_capacity(n_seg);
        let mut cum = 0.0;
        for i in 0..n_seg {
            let i = i as isize;
            let (p0, p1, p2, p3) = (get(i - 1), get(i), get(i + 1), get(i + 2));

            let d0 = knot_span(p0, p1);
            let d1 = knot_span(p1, p2);
            let d2 = knot_span(p2, p3);

            // 非一様 Catmull-Rom の接線。
            //   m1 = d1 * [ (P1-P0)/d0 - (P2-P0)/(d0+d1) + (P2-P1)/d1 ]
            //   m2 = d1 * [ (P2-P1)/d1 - (P3-P1)/(d1+d2) + (P3-P2)/d2 ]
            // 係数 d1 を掛けることで、局所パラメータを [0,1] に正規化した
            // エルミート形式の接線になる。
            let m1 = ((p1 - p0) / d0 - (p2 - p0) / (d0 + d1) + (p2 - p1) / d1) * d1;
            let m2 = ((p2 - p1) / d1 - (p3 - p1) / (d1 + d2) + (p3 - p2) / d2) * d1;

            segments.push(Segment {
                p1,
                p2,
                m1,
                m2,
                span: d1,
                cum,
            });
            cum += d1;
        }

        Ok(Self {
            segments,
            total_knot: cum,
            closed,
        })
    }

    /// 閉曲線か。
    #[inline]
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// セグメント数。
    #[inline]
    pub fn segment_count(&self) -> usize {
        self.segments.len()
    }

    /// セグメント `i` の始点に対応する大域パラメータ `u`。
    ///
    /// セグメント `i` の始点は制御点 `i` そのものである（Catmull-Rom は制御点を補間する）。
    /// トラックの断面定義（コース幅・バンク・カンバー）は制御点ごとに与えられるため、
    /// それを弧長 `s` へ対応付けるのにこれを使う。
    /// `i` が範囲外の場合は 1.0（終端）を返す。
    #[inline]
    pub fn segment_start_u(&self, i: usize) -> f64 {
        match self.segments.get(i) {
            Some(seg) => seg.cum / self.total_knot,
            None => 1.0,
        }
    }

    /// `u` を定義域へ収める。閉曲線なら巡回、開曲線ならクランプ。
    #[inline]
    fn normalize_u(&self, u: f64) -> f64 {
        if !u.is_finite() {
            return 0.0;
        }
        if self.closed {
            u.rem_euclid(1.0)
        } else {
            crate::util::saturate(u)
        }
    }

    /// 大域 `u` から (セグメント index, 局所 t, du_local/du_global) を求める。
    fn locate(&self, u: f64) -> (usize, f64, f64) {
        let u = self.normalize_u(u);
        let k = u * self.total_knot;

        // cum は単調増加。上限を超えない最後のセグメントを二分探索する。
        let mut lo = 0usize;
        let mut hi = self.segments.len() - 1;
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            if self.segments[mid].cum <= k {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        let seg = &self.segments[lo];
        let t = crate::util::saturate((k - seg.cum) / seg.span);
        // u_global = (cum + t * span) / total_knot  =>  dt/du_global = total_knot / span
        (lo, t, self.total_knot / seg.span)
    }

    /// 位置を評価する。
    pub fn eval(&self, u: f64) -> Vec3 {
        let (i, t, _) = self.locate(u);
        self.eval_local(i, t)
    }

    /// セグメント `i` の局所パラメータ `t` で位置を評価する。
    #[inline]
    fn eval_local(&self, i: usize, t: f64) -> Vec3 {
        let s = &self.segments[i];
        let (t2, t3) = (t * t, t * t * t);
        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;
        s.p1 * h00 + s.m1 * h10 + s.p2 * h01 + s.m2 * h11
    }

    /// 大域パラメータに関する 1 階微分 `dP/du`。
    pub fn derivative(&self, u: f64) -> Vec3 {
        let (i, t, scale) = self.locate(u);
        self.derivative_local(i, t) * scale
    }

    /// 大域パラメータに関する 2 階微分 `d2P/du2`。
    pub fn second_derivative(&self, u: f64) -> Vec3 {
        let (i, t, scale) = self.locate(u);
        self.second_derivative_local(i, t) * (scale * scale)
    }

    /// 単位接線ベクトル。退化した場合は [`Vec3::ZERO`]。
    pub fn tangent(&self, u: f64) -> Vec3 {
        let (i, t, _) = self.locate(u);
        // スケールは正のスカラーなので正規化すれば消える。
        self.derivative_local(i, t).normalize()
    }

    /// 曲率 `1/R` の大きさ [1/m]。パラメータ化に依存しない。
    pub fn curvature(&self, u: f64) -> f64 {
        let (i, t, _) = self.locate(u);
        // スケール a に対し d1 -> a*d1, d2 -> a^2*d2 なので
        // |d1 x d2| / |d1|^3 は a^3/a^3 で相殺され、局所微分で計算してよい。
        let d1 = self.derivative_local(i, t);
        let d2 = self.second_derivative_local(i, t);
        let denom = d1.length_squared() * d1.length();
        if denom <= EPSILON {
            0.0
        } else {
            d1.cross(d2).length() / denom
        }
    }

    #[inline]
    fn derivative_local(&self, i: usize, t: f64) -> Vec3 {
        let s = &self.segments[i];
        let t2 = t * t;
        let h00 = 6.0 * t2 - 6.0 * t;
        let h10 = 3.0 * t2 - 4.0 * t + 1.0;
        let h01 = -6.0 * t2 + 6.0 * t;
        let h11 = 3.0 * t2 - 2.0 * t;
        s.p1 * h00 + s.m1 * h10 + s.p2 * h01 + s.m2 * h11
    }

    #[inline]
    fn second_derivative_local(&self, i: usize, t: f64) -> Vec3 {
        let s = &self.segments[i];
        let h00 = 12.0 * t - 6.0;
        let h10 = 6.0 * t - 4.0;
        let h01 = -12.0 * t + 6.0;
        let h11 = 6.0 * t - 2.0;
        s.p1 * h00 + s.m1 * h10 + s.p2 * h01 + s.m2 * h11
    }
}

// ---------------------------------------------------------------------------
// ArcLengthSpline
// ---------------------------------------------------------------------------

/// Gauss-Legendre 4 点則の節点と重み（区間 [-1, 1]）。
const GL4_X: [f64; 4] = [
    -0.861_136_311_594_052_6,
    -0.339_981_043_584_856_3,
    0.339_981_043_584_856_3,
    0.861_136_311_594_052_6,
];
const GL4_W: [f64; 4] = [
    0.347_854_845_137_453_8,
    0.652_145_154_862_546_1,
    0.652_145_154_862_546_1,
    0.347_854_845_137_453_8,
];

/// 弧長で再パラメータ化したスプライン。
///
/// レースロジックはすべてこの `s` [m] を用いる。
///
/// # データ配置
///
/// 弧長テーブルは SoA（structure of arrays）で保持する。
/// [`ArcLengthSpline::closest_s`] の粗探索は `pos` のみを走査するため、
/// `s` / `u` を同居させない方がキャッシュ効率が良い。これは実測に基づく判断である。
#[derive(Clone, Debug)]
pub struct ArcLengthSpline {
    spline: CubicSpline,
    /// 各サンプルの弧長 [m]。単調増加。
    table_s: Vec<f64>,
    /// 各サンプルの大域パラメータ。単調増加。
    table_u: Vec<f64>,
    /// 各サンプルの位置。`closest_s` の粗探索が走査する。
    table_pos: Vec<Vec3>,
    total_length: f64,
    /// テーブル 1 区間あたりのおおよその弧長。近傍探索の刻み幅に使う。
    avg_ds: f64,
    /// 1 セグメントあたりのテーブルエントリ数。
    samples_per_segment: usize,
}

impl ArcLengthSpline {
    /// 既定のサンプル密度（1 セグメントあたり）。
    pub const DEFAULT_SAMPLES_PER_SEGMENT: usize = 64;

    /// [`Self::closest_s`] にヒントを与えた際の片側探索半径 [m]。
    ///
    /// 60 Hz の Simulation Tick で 110 m/s（396 km/h）の車が進む距離は約 1.8 m。
    /// 5 m はその 2.7 倍の余裕がある。窓の端で最小値が出た場合は
    /// 自動的に全走査へフォールバックするため、この値は性能上の指定であって
    /// 正しさには影響しない。
    pub const HINT_SEARCH_RADIUS_M: f64 = 5.0;

    /// 弧長テーブルを構築する。
    ///
    /// `samples_per_segment` は 1 セグメントを何分割してテーブル化するか。
    /// 各小区間の弧長は Gauss-Legendre 4 点則で積分するため、
    /// 既定値でも実用上の誤差は無視できる（テスト `spline_arclength_accuracy` で検証）。
    /// 0 を渡した場合は 1 として扱う。
    pub fn new(spline: CubicSpline, samples_per_segment: usize) -> Self {
        let spp = samples_per_segment.max(1);
        let n_seg = spline.segment_count();
        let cap = n_seg * spp + 1;
        let mut table_s = Vec::with_capacity(cap);
        let mut table_u = Vec::with_capacity(cap);
        let mut table_pos = Vec::with_capacity(cap);

        let mut s_acc = 0.0;
        table_s.push(0.0);
        table_u.push(0.0);
        table_pos.push(spline.eval(0.0));

        for i in 0..n_seg {
            let seg_cum = spline.segments[i].cum;
            let seg_span = spline.segments[i].span;

            for j in 0..spp {
                let t0 = j as f64 / spp as f64;
                let t1 = (j + 1) as f64 / spp as f64;

                // ∫|dP/dt| dt を GL4 で積分する。
                // 弧長はパラメータ化に依存しないため局所パラメータのまま積分してよい。
                let half = 0.5 * (t1 - t0);
                let mid = 0.5 * (t0 + t1);
                let mut len = 0.0;
                for k in 0..4 {
                    let t = mid + half * GL4_X[k];
                    len += GL4_W[k] * spline.derivative_local(i, t).length();
                }
                s_acc += len * half;

                let u = (seg_cum + t1 * seg_span) / spline.total_knot;
                table_s.push(s_acc);
                table_u.push(u);
                table_pos.push(spline.eval(u));
            }
        }

        let total_length = s_acc;
        let avg_ds = if table_s.len() > 1 {
            total_length / (table_s.len() - 1) as f64
        } else {
            0.0
        };

        debug_assert!(
            table_s.windows(2).all(|w| w[1] >= w[0]),
            "arc length table must be monotonic"
        );
        debug_assert!(
            table_u.windows(2).all(|w| w[1] >= w[0]),
            "u table must be monotonic"
        );

        Self {
            spline,
            table_s,
            table_u,
            table_pos,
            total_length,
            avg_ds,
            samples_per_segment: spp,
        }
    }

    /// 既定のサンプル密度で構築する。
    pub fn with_default_samples(spline: CubicSpline) -> Self {
        Self::new(spline, Self::DEFAULT_SAMPLES_PER_SEGMENT)
    }

    /// 全長 [m]。
    #[inline]
    pub fn total_length(&self) -> f64 {
        self.total_length
    }

    /// 閉曲線か。基となる [`CubicSpline`] に従う。
    #[inline]
    pub fn is_closed(&self) -> bool {
        self.spline.is_closed()
    }

    /// 1 セグメントあたりの弧長テーブルのサンプル数。
    #[inline]
    pub fn samples_per_segment(&self) -> usize {
        self.samples_per_segment
    }

    /// 基となる [`CubicSpline`] への参照。
    #[inline]
    pub fn spline(&self) -> &CubicSpline {
        &self.spline
    }

    /// 制御点 `i` に対応する弧長 `s` [m]。
    ///
    /// 制御点ごとに定義された断面情報（コース幅・バンク・カンバー・路面種別）を
    /// 弧長方向へ写すために使う。`i` が範囲外の場合は [`Self::total_length`]。
    #[inline]
    pub fn control_point_s(&self, i: usize) -> f64 {
        // 範囲外を s_from_u 経由にすると、閉曲線では u = 1.0 が 0.0 へ巡回して
        // 「終端」と「始点」が区別できなくなる。ここで明示的に打ち切る。
        if i >= self.control_point_count() {
            return self.total_length;
        }
        self.s_from_u(self.spline.segment_start_u(i))
    }

    /// 制御点（= セグメント）数。
    #[inline]
    pub fn control_point_count(&self) -> usize {
        self.spline.segment_count()
    }

    /// `s` を `[0, total_length)` へ正規化する。
    ///
    /// 閉曲線では巡回、開曲線では `[0, total_length]` にクランプする。
    /// **ラップ処理はすべてこの関数を通すこと。** 各所で自前計算しない。
    #[inline]
    pub fn wrap_s(&self, s: f64) -> f64 {
        if !s.is_finite() {
            return 0.0;
        }
        if self.is_closed() {
            if self.total_length <= EPSILON {
                0.0
            } else {
                s.rem_euclid(self.total_length)
            }
        } else {
            crate::util::clamp(s, 0.0, self.total_length)
        }
    }

    /// `from_s` から `to_s` への符号付き最短距離。
    ///
    /// 閉曲線ではラップを考慮し、戻り値は `(-L/2, L/2]`。
    /// 前後関係の判定・車間距離の計算はすべてこの関数を使うこと。
    #[inline]
    pub fn signed_delta_s(&self, from_s: f64, to_s: f64) -> f64 {
        if !self.is_closed() {
            return to_s - from_s;
        }
        let l = self.total_length;
        if l <= EPSILON {
            return 0.0;
        }
        let d = (to_s - from_s).rem_euclid(l);
        if d > l * 0.5 {
            d - l
        } else {
            d
        }
    }

    /// 単調配列に対する二分探索。`key` 以下となる最後の添字を返す。
    #[inline]
    fn lower_index(table: &[f64], key: f64) -> usize {
        let n = table.len();
        if n < 2 {
            return 0;
        }
        let mut lo = 0usize;
        let mut hi = n - 1;
        while lo < hi {
            let mid = (lo + hi).div_ceil(2);
            if table[mid] <= key {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        lo
    }

    /// `s` [m] から大域パラメータ `u` を求める。
    pub fn u_from_s(&self, s: f64) -> f64 {
        let s = self.wrap_s(s);
        let n = self.table_s.len();
        if n < 2 {
            return 0.0;
        }
        let i = Self::lower_index(&self.table_s, s);
        if i + 1 >= n {
            return self.table_u[n - 1];
        }
        let ds = self.table_s[i + 1] - self.table_s[i];
        let f = if ds <= EPSILON {
            0.0
        } else {
            (s - self.table_s[i]) / ds
        };
        self.table_u[i] + (self.table_u[i + 1] - self.table_u[i]) * f
    }

    /// 大域パラメータ `u` から `s` [m] を求める。
    pub fn s_from_u(&self, u: f64) -> f64 {
        let u = self.spline.normalize_u(u);
        let n = self.table_u.len();
        if n < 2 {
            return 0.0;
        }
        let i = Self::lower_index(&self.table_u, u);
        if i + 1 >= n {
            return self.table_s[n - 1];
        }
        let du = self.table_u[i + 1] - self.table_u[i];
        let f = if du <= EPSILON {
            0.0
        } else {
            (u - self.table_u[i]) / du
        };
        self.table_s[i] + (self.table_s[i + 1] - self.table_s[i]) * f
    }

    /// `s` における位置。
    #[inline]
    pub fn position_at(&self, s: f64) -> Vec3 {
        self.spline.eval(self.u_from_s(s))
    }

    /// `s` における単位接線。
    #[inline]
    pub fn tangent_at(&self, s: f64) -> Vec3 {
        self.spline.tangent(self.u_from_s(s))
    }

    /// `s` における曲率 `1/R` [1/m]。
    #[inline]
    pub fn curvature_at(&self, s: f64) -> f64 {
        self.spline.curvature(self.u_from_s(s))
    }

    /// `s` における位置と単位接線を一度に求める。
    ///
    /// `position_at` と `tangent_at` を個別に呼ぶと `u_from_s` が二重に走るため、
    /// 両方が必要な場合はこちらを使うこと。
    #[inline]
    pub fn pose_at(&self, s: f64) -> (Vec3, Vec3) {
        let u = self.u_from_s(s);
        let (i, t, _) = self.spline.locate(u);
        (
            self.spline.eval_local(i, t),
            self.spline.derivative_local(i, t).normalize(),
        )
    }

    /// 点 `p` に最も近い曲線上の `s` を求める。
    ///
    /// `hint` に前フレームの `s` を渡すと近傍のみを探索する。
    /// 毎 tick 全車に対して呼ばれるため、`hint` の指定を強く推奨する。
    /// `hint` の有無で結果は一致する（テスト `spline_closest_s` で検証）。
    pub fn closest_s(&self, p: Vec3, hint: Option<f64>) -> f64 {
        let n = self.table_pos.len();
        if n == 0 {
            return 0.0;
        }

        // --- 粗探索: テーブルの事前計算位置から最近傍サンプルを選ぶ ---
        let (mut best_i, mut best_d2) = (0usize, f64::INFINITY);

        // ヒントありの窓探索で最小値が窓の端に来た場合、真の最近傍が窓外にある
        // 可能性があるため全走査へフォールバックする。近似ではなく厳密である。
        let mut need_full_scan = hint.is_none();

        if let Some(h) = hint {
            let window = self.hint_window_entries() as isize;
            let center = Self::lower_index(&self.table_s, self.wrap_s(h)) as isize;
            let mut best_raw = center;
            for raw in (center - window)..=(center + window) {
                let i = self.clamp_or_wrap_index(raw, n);
                let d2 = (self.table_pos[i] - p).length_squared();
                if d2 < best_d2 {
                    best_d2 = d2;
                    best_i = i;
                    best_raw = raw;
                }
            }
            // 開曲線では端点で打ち切られるのが正常なので、その場合は端到達を許す。
            let at_edge = (best_raw - center).abs() >= window;
            let clamped_at_track_end = !self.is_closed() && (best_i == 0 || best_i + 1 == n);
            if at_edge && !clamped_at_track_end {
                need_full_scan = true;
            }
        }

        if need_full_scan {
            best_d2 = f64::INFINITY;
            for (i, &pos) in self.table_pos.iter().enumerate() {
                let d2 = (pos - p).length_squared();
                if d2 < best_d2 {
                    best_d2 = d2;
                    best_i = i;
                }
            }
        }

        // --- 精緻化: g(s) = (P(s) - p) . T(s) の零点をニュートン法で求める ---
        // dP/ds は単位ベクトルなので g'(s) ~= 1（曲率と偏差が小さい領域で妥当）。
        // ステップをテーブル刻みで制限し、発散を防ぐ。
        let mut s = self.table_s[best_i];
        let max_step = self.avg_ds * 2.0;
        for _ in 0..6 {
            let (pos, tan) = self.pose_at(s);
            let g = (pos - p).dot(tan);
            // 1 nm 未満は収束とみなす。トラック座標の要求精度を大きく上回る。
            if g.abs() <= 1.0e-9 {
                break;
            }
            s = self.wrap_s(s + crate::util::clamp(-g, -max_step, max_step));
        }

        // 精緻化が悪化した場合は粗探索の結果を採用する（安全側に倒す）。
        if (self.position_at(s) - p).length_squared() <= best_d2 {
            s
        } else {
            self.table_s[best_i]
        }
    }

    /// ヒント付き探索の片側窓幅（テーブルエントリ数）。
    ///
    /// [`Self::HINT_SEARCH_RADIUS_M`] を弧長方向の刻み幅で割って求める。
    /// 窓の端で最小値が出た場合は全走査へフォールバックするため、
    /// この値が小さすぎても結果は正しい（遅くなるだけ）。
    #[inline]
    fn hint_window_entries(&self) -> usize {
        if self.avg_ds <= EPSILON {
            return self.table_pos.len();
        }
        ((Self::HINT_SEARCH_RADIUS_M / self.avg_ds).ceil() as usize).clamp(8, self.table_pos.len())
    }

    /// 閉曲線なら巡回、開曲線ならクランプして有効な添字にする。
    #[inline]
    fn clamp_or_wrap_index(&self, raw: isize, n: usize) -> usize {
        if self.is_closed() {
            // 末尾エントリは先頭と同一地点なので、巡回時は除いて重複を避ける。
            let m = (n - 1).max(1) as isize;
            raw.rem_euclid(m) as usize
        } else {
            raw.clamp(0, (n - 1) as isize) as usize
        }
    }
}
