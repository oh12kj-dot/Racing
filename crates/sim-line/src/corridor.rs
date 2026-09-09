//! [`Corridor`] — 走行可能な回廊。各弧長 `s` で横オフセット `t` の下限・上限を持つ。

use crate::Stations;
use sim_math::clamp;
use sim_track::{Track, TrackCoord};

/// 走行可能な回廊。`+t` は左（`sim-track` の規約）。組 `(t_right, t_left)` は
/// 常に `t_right <= t_left`。
///
/// 2 変種を保持する:
/// - **white**: 舗装白線の内側。`TrackFrame::width_*` から車半幅ぶん内側にクランプ。
/// - **limits**: 縁石を含む track limits。[`Track::is_within_limits`] の境界。
///
/// Driver AI の基準線は `limits` の内側で最適化し（縁石を使ってよい）、
/// 通常の防御・追い抜きは `white` を使う、といった使い分けを想定する。
pub struct Corridor {
    stations: Stations,
    closed: bool,
    /// `(t_right, t_left)` の白線変種。
    white: Vec<(f64, f64)>,
    /// `(t_right, t_left)` の track-limits 変種。
    limits: Vec<(f64, f64)>,
}

impl Corridor {
    /// track-limits 境界を求める二分探索の反復回数。`12` で 1/4096 分解能（縁石端 ~数 mm）。
    const LIMIT_BISECTION_ITERS: u32 = 12;
    /// track-limits 境界の外側探索の初期マージン [m]。
    const LIMIT_PROBE_MARGIN_M: f64 = 3.0;

    /// [`Track`] から構築する。
    ///
    /// * `step_m` — ステーション間隔 [m]（2.0 前後を推奨）。
    /// * `car_half_width` — 車幅の半分 [m]。
    /// * `safety` — 白線からさらに内側に取る安全マージン [m]。
    ///
    /// white 変種は各端から `car_half_width + safety` だけ内側にクランプする。
    /// 内側にクランプした結果 `t_right > t_left` になる（極端に狭い）区間は
    /// センターライン 1 点（`t_right == t_left == 0`）に潰す。
    pub fn from_track(track: &Track, step_m: f64, car_half_width: f64, safety: f64) -> Corridor {
        let stations = Stations::new(track.length(), step_m);
        let margin = car_half_width + safety;

        let mut white = Vec::with_capacity(stations.count);
        let mut limits = Vec::with_capacity(stations.count);

        for i in 0..stations.count {
            let s = stations.s_of(i);
            let frame = track.frame_at(s);

            // white: 端から margin ぶん内側。
            let mut t_left = frame.width_left - margin;
            let mut t_right = -(frame.width_right - margin);
            if t_right > t_left {
                // コースが車 1 台ぶんより狭い。センターライン 1 点に潰す。
                t_left = 0.0;
                t_right = 0.0;
            }
            white.push((t_right, t_left));

            // limits: is_within_limits の境界を左右それぞれ二分探索。
            let left = Self::outer_within_limit(track, s, 1.0, frame.width_left);
            let right = Self::outer_within_limit(track, s, -1.0, frame.width_right);
            limits.push((right, left));
        }

        Corridor {
            stations,
            closed: track.is_closed(),
            white,
            limits,
        }
    }

    /// センターラインから `dir`（`+1.0` = 左 / `-1.0` = 右）方向へ進み、
    /// `is_within_limits` が真である最遠の `t`（符号は `dir` に従う）を返す。
    ///
    /// `width_edge` は白線までの距離（探索の起点ヒント）。
    fn outer_within_limit(track: &Track, s: f64, dir: f64, width_edge: f64) -> f64 {
        let within = |t: f64| track.is_within_limits(TrackCoord::new(s, dir * t));

        // 白線のわずか内側は必ずコース内のはず。ここを lo とする。
        let mut lo = (width_edge - 0.05).max(0.0);
        if !within(lo) {
            // 白線内すら within でない異常時はセンターライン近傍まで戻す。
            lo = 0.0;
        }
        // hi: within でなくなるまで外へ広げる。
        let mut hi = width_edge + Self::LIMIT_PROBE_MARGIN_M;
        let mut guard = 0;
        while within(hi) && guard < 8 {
            hi += Self::LIMIT_PROBE_MARGIN_M;
            guard += 1;
        }

        for _ in 0..Self::LIMIT_BISECTION_ITERS {
            let mid = 0.5 * (lo + hi);
            if within(mid) {
                lo = mid;
            } else {
                hi = mid;
            }
        }
        dir * lo
    }

    /// トラック全長 [m]。
    pub fn length(&self) -> f64 {
        self.stations.length
    }

    /// 閉トラックか。
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// 白線内の回廊境界 `(t_right, t_left)`。線形補間。`t_right <= t_left`。
    pub fn white_bounds(&self, s: f64) -> (f64, f64) {
        self.interp(&self.white, s)
    }

    /// 縁石を含む track-limits の回廊境界 `(t_right, t_left)`。線形補間。
    pub fn limit_bounds(&self, s: f64) -> (f64, f64) {
        self.interp(&self.limits, s)
    }

    /// `t` を白線内へクランプする。
    pub fn clamp_white(&self, s: f64, t: f64) -> f64 {
        let (r, l) = self.white_bounds(s);
        clamp(t, r, l)
    }

    /// `t` を track-limits 内へクランプする。
    pub fn clamp_limits(&self, s: f64, t: f64) -> f64 {
        let (r, l) = self.limit_bounds(s);
        clamp(t, r, l)
    }

    fn interp(&self, table: &[(f64, f64)], s: f64) -> (f64, f64) {
        let s = self.stations.wrap_s(s);
        let x = s / self.stations.step;
        let i0 = x.floor() as isize;
        let f = x - i0 as f64;
        let (ar, al) = table[self.stations.wrap_index(i0)];
        let (br, bl) = table[self.stations.wrap_index(i0 + 1)];
        (ar + (br - ar) * f, al + (bl - al) * f)
    }
}
