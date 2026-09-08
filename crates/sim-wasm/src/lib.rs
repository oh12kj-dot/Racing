//! `sim-wasm` — Engineering View 向けの **読み出し専用** WASM 境界。
//!
//! この crate の責務は「Simulation Core の状態を JS から読み出させる」ことだけである。
//! ロジックを持たず、Presentation が Simulation を書き換える経路も作らない
//! （ARCHITECTURE.md の依存方向、および DECISIONS.md ADR-0003）。
//!
//! # 構成
//!
//! | 層 | 型 | 役割 |
//! |----|----|------|
//! | 純 Rust | [`TrackView`] | サンプリングの実装。`wasm_bindgen` に依存しない |
//! | 境界 | [`WasmTrack`] | [`TrackView`] への薄いラッパ。型変換のみ |
//!
//! テストは [`TrackView`] に対して書く。これによりネイティブの
//! `cargo test -p sim-wasm` でサンプリングのロジックを検証できる。
//!
//! # サンプリングの規約
//!
//! `step_m` を受け取る関数はすべて同一の **ステーション列** を共有する。
//! 全長 `L`、`n = ceil(L / step_m)` として
//!
//! ```text
//! s_i = i * L / n     (i = 0 ..= n)
//! ```
//!
//! すなわちステーション数は `n + 1` で、実際の間隔 `L / n` は `step_m` 以下になる。
//! 最後のステーション `s_n = L` は [`sim_track::Track::frame_at`] の `wrap_s` により
//! `s_0 = 0` と厳密に一致するため、閉じたトラックの継ぎ目が正確に閉じる。
//!
//! `sample_curvature` / `sample_banking` の `i` 番目の値は、
//! `sample_line` の `i` 番目の点、`sample_surface` の `2i` / `2i+1` 番目の頂点に対応する。

#![deny(unsafe_code)]
#![warn(missing_docs)]

use sim_math::Vec3;
use sim_track::{Track, TrackCoord, TrackIoError};

/// ステーション数の上限。これを超える `step_m` の指定は不正として空を返す。
///
/// Engineering View はブラウザ上で動く。極端に小さい `step_m` を渡されたときに
/// 数 GB の配列を確保してタブを落とすのではなく、空配列で失敗させる。
/// 4 km のトラックに対して 200 000 ステーションは 2 cm 間隔に相当する。
const MAX_STATIONS: usize = 200_000;

/// トラック幾何のサンプリング。`wasm_bindgen` に依存しない純 Rust 層。
pub struct TrackView {
    track: Track,
}

impl TrackView {
    /// トラック定義 JSON 文字列から構築する。
    ///
    /// [`sim_track::track_from_json_str`] がスキーマバージョンと構築可能性を
    /// 検証するため、不正なデータはここで弾かれる。
    pub fn from_json(track_json: &str) -> Result<TrackView, TrackIoError> {
        let def = sim_track::track_from_json_str(track_json)?;
        let track = Track::build(&def).map_err(TrackIoError::Invalid)?;
        Ok(TrackView { track })
    }

    /// 内部の [`Track`] への参照。テストと検証用。
    pub fn track(&self) -> &Track {
        &self.track
    }

    /// `step_m` に対応するステーションの `s` 列。
    ///
    /// `step_m` が非有限・非正、またはステーション数が [`MAX_STATIONS`] を
    /// 超える場合は空を返す。
    pub fn stations(&self, step_m: f64) -> Vec<f64> {
        if !step_m.is_finite() || step_m <= 0.0 {
            return Vec::new();
        }
        let length = self.track.length();
        let segments = (length / step_m).ceil();
        if !segments.is_finite() || segments < 1.0 || segments >= MAX_STATIONS as f64 {
            return Vec::new();
        }
        let n = segments as usize;
        (0..=n).map(|i| (i as f64) * length / (n as f64)).collect()
    }

    /// 幅に対する比 `ratio` の横位置に沿った線。平坦な `[x, y, z, ...]` を返す。
    ///
    /// `ratio` は `-1.0` で右端、`0.0` でセンターライン、`+1.0` で左端。
    /// コース幅が `s` によって変わるため、絶対値ではなく比で指定する。
    pub fn sample_line(&self, lateral_offset_ratio: f64, step_m: f64) -> Vec<f64> {
        let stations = self.stations(step_m);
        let mut out = Vec::with_capacity(stations.len() * 3);
        for s in stations {
            let f = self.track.frame_at(s);
            let t = lateral_offset(lateral_offset_ratio, f.width_left, f.width_right);
            push_vec3(&mut out, f.position + f.lateral * t);
        }
        out
    }

    /// 路面ポリゴン用。左端と右端を交互に並べた三角形ストリップ用頂点列。
    ///
    /// 頂点数は `2 * (ceil(length / step_m) + 1)`、要素数はその 3 倍。
    pub fn sample_surface(&self, step_m: f64) -> Vec<f64> {
        let stations = self.stations(step_m);
        let mut out = Vec::with_capacity(stations.len() * 6);
        for s in stations {
            let f = self.track.frame_at(s);
            push_vec3(&mut out, f.position + f.lateral * f.width_left);
            push_vec3(&mut out, f.position - f.lateral * f.width_right);
        }
        out
    }

    /// 各ステーションの曲率 [1/m]。左カーブが正。
    pub fn sample_curvature(&self, step_m: f64) -> Vec<f64> {
        self.stations(step_m)
            .into_iter()
            .map(|s| self.track.frame_at(s).curvature)
            .collect()
    }

    /// 各ステーションのバンク角 [rad]。左端が持ち上がる向きが正。
    pub fn sample_banking(&self, step_m: f64) -> Vec<f64> {
        self.stations(step_m)
            .into_iter()
            .map(|s| self.track.frame_at(s).banking)
            .collect()
    }

    /// ワールド座標 -> トラック座標。
    ///
    /// ビューアはマウスホバーごとに単発で呼ぶだけで、前 tick の `s` を持たない。
    /// したがって `hint` は渡さない（[`sim_track::Track::world_to_track`] は
    /// hint 無しでも厳密に解を返す）。
    pub fn world_to_track(&self, p: Vec3) -> TrackCoord {
        self.track.world_to_track(p, None)
    }
}

/// 幅の比 `ratio` を横オフセット `t` [m] へ変換する。`+t` は左。
fn lateral_offset(ratio: f64, width_left: f64, width_right: f64) -> f64 {
    if ratio >= 0.0 {
        ratio * width_left
    } else {
        ratio * width_right
    }
}

/// `Vec3` を平坦な `f64` 配列へ追加する。
fn push_vec3(out: &mut Vec<f64>, v: Vec3) {
    out.push(v.x);
    out.push(v.y);
    out.push(v.z);
}

// `wasm_bindgen` のマクロ展開は `unsafe extern "C"` を生成するため、
// crate 全体の `#![deny(unsafe_code)]` を満たせない。
// 例外をこのモジュールだけに閉じ込めることで、
// 「手書きの unsafe はどこにも無い」ことを構造的に保証する。
#[allow(unsafe_code)]
mod bindings {
    use super::TrackView;
    use sim_math::Vec3;
    use wasm_bindgen::prelude::*;

    /// トラックを WASM 側で保持し、JS から幾何を読み出すためのハンドル。
    ///
    /// 書き込み用のメソッドは意図的に存在しない。
    #[wasm_bindgen]
    pub struct WasmTrack {
        view: TrackView,
    }

    #[wasm_bindgen]
    impl WasmTrack {
        /// トラック定義 JSON から構築する。失敗時は `JsError`。
        #[wasm_bindgen(constructor)]
        pub fn new(track_json: &str) -> Result<WasmTrack, JsError> {
            let view =
                TrackView::from_json(track_json).map_err(|e| JsError::new(&e.to_string()))?;
            Ok(WasmTrack { view })
        }

        /// トラック名。
        pub fn name(&self) -> String {
            self.view.track().name().to_string()
        }

        /// 全長 [m]。
        pub fn length(&self) -> f64 {
            self.view.track().length()
        }

        /// セクター境界の `s` [m]。
        pub fn sector_boundaries(&self) -> Vec<f64> {
            self.view.track().sector_boundaries().to_vec()
        }

        /// スタート/フィニッシュ線の `s` [m]。
        pub fn start_finish_s(&self) -> f64 {
            self.view.track().start_finish_s()
        }

        /// 幅に対する比 `lateral_offset_ratio` の線。平坦な `[x, y, z, ...]`。
        ///
        /// `-1.0` で右端、`0.0` でセンターライン、`+1.0` で左端。
        pub fn sample_line(&self, lateral_offset_ratio: f64, step_m: f64) -> Vec<f64> {
            self.view.sample_line(lateral_offset_ratio, step_m)
        }

        /// 路面ポリゴン用。左端と右端を交互に並べた三角形ストリップ用頂点列。
        pub fn sample_surface(&self, step_m: f64) -> Vec<f64> {
            self.view.sample_surface(step_m)
        }

        /// 各サンプル点の曲率 [1/m]。`sample_surface` と同じ `step_m` で対応する。
        pub fn sample_curvature(&self, step_m: f64) -> Vec<f64> {
            self.view.sample_curvature(step_m)
        }

        /// 各サンプル点のバンク角 [rad]。
        pub fn sample_banking(&self, step_m: f64) -> Vec<f64> {
            self.view.sample_banking(step_m)
        }

        /// ワールド座標からトラック座標を求める。`[s, t]` を返す。
        pub fn world_to_track(&self, x: f64, y: f64, z: f64) -> Vec<f64> {
            let c = self.view.world_to_track(Vec3::new(x, y, z));
            vec![c.s, c.t]
        }
    }
}

pub use bindings::WasmTrack;

#[cfg(test)]
mod tests {
    use super::*;

    /// Aoyama Ring。アセットが唯一の正であり、テストは同梱した実体を使う。
    const AOYAMA: &str = include_str!("../../../assets/tracks/aoyama_ring.track.json");

    const STEP: f64 = 1.0;

    fn view() -> TrackView {
        TrackView::from_json(AOYAMA).expect("aoyama ring must load")
    }

    fn vertex(flat: &[f64], i: usize) -> Vec3 {
        Vec3::new(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2])
    }

    #[test]
    fn wasm_track_builds_from_asset() {
        let v = view();
        let def = sim_track::track_from_json_str(AOYAMA).expect("definition must parse");
        let track = Track::build(&def).expect("track must build");

        assert_eq!(v.track().name(), track.name());
        assert_eq!(v.track().length(), track.length());
        assert!(v.track().length() > 0.0);
    }

    #[test]
    fn sample_surface_is_consistent() {
        let v = view();
        let length = v.track().length();
        let expected_stations = (length / STEP).ceil() as usize + 1;

        let flat = v.sample_surface(STEP);
        assert_eq!(flat.len() % 3, 0);
        let vertices = flat.len() / 3;
        assert_eq!(vertices, 2 * expected_stations);
        // 仕様どおり 2 * ceil(length/step) + 2 であることを別式でも確認する。
        assert_eq!(vertices, 2 * (length / STEP).ceil() as usize + 2);

        assert!(flat.iter().all(|x| x.is_finite()), "all vertices finite");

        let stations = v.stations(STEP);
        assert_eq!(stations.len(), expected_stations);
        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            let left = vertex(&flat, 2 * i);
            let right = vertex(&flat, 2 * i + 1);
            let width = left.distance(right);
            assert!(
                (width - (f.width_left + f.width_right)).abs() < 1.0e-6,
                "station {i}: width {width} != {}",
                f.width_left + f.width_right
            );
        }

        // 閉じたトラックなので継ぎ目は厳密に一致する。
        let first_left = vertex(&flat, 0);
        let last_left = vertex(&flat, 2 * (expected_stations - 1));
        assert_eq!(first_left, last_left, "seam must close exactly");
    }

    #[test]
    fn sample_line_offsets() {
        let v = view();
        let stations = v.stations(STEP);
        let center = v.sample_line(0.0, STEP);
        let left = v.sample_line(1.0, STEP);
        let right = v.sample_line(-1.0, STEP);

        assert_eq!(center.len(), stations.len() * 3);
        assert_eq!(left.len(), center.len());
        assert_eq!(right.len(), center.len());

        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            assert!(vertex(&center, i).distance(f.position) < 1.0e-12);
            let expect_left = f.position + f.lateral * f.width_left;
            let expect_right = f.position - f.lateral * f.width_right;
            assert!(vertex(&left, i).distance(expect_left) < 1.0e-12);
            assert!(vertex(&right, i).distance(expect_right) < 1.0e-12);
        }

        // 左右の端は sample_surface と一致しなければならない。
        let surface = v.sample_surface(STEP);
        for i in 0..stations.len() {
            assert_eq!(vertex(&left, i), vertex(&surface, 2 * i));
            assert_eq!(vertex(&right, i), vertex(&surface, 2 * i + 1));
        }
    }

    #[test]
    fn sample_curvature_matches_track() {
        let v = view();
        let stations = v.stations(STEP);
        let curvature = v.sample_curvature(STEP);
        let banking = v.sample_banking(STEP);

        assert_eq!(curvature.len(), stations.len());
        assert_eq!(banking.len(), stations.len());

        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            assert_eq!(curvature[i], f.curvature);
            assert_eq!(banking[i], f.banking);
        }

        // 曲率が全区間ゼロなら着色は意味を持たない。実データであることを確認する。
        assert!(curvature.iter().any(|k| k.abs() > 1.0e-3));
        assert!(banking.iter().any(|b| b.abs() > 1.0e-3));
    }

    #[test]
    fn world_to_track_roundtrip() {
        let v = view();
        let stations = v.stations(STEP);
        let center = v.sample_line(0.0, STEP);
        let length = v.track().length();

        for (i, &s) in stations.iter().enumerate() {
            let c = v.world_to_track(vertex(&center, i));
            assert!(c.t.abs() < 1.0e-6, "station {i}: t = {}", c.t);
            let ds = v.track().signed_delta_s(v.track().wrap_s(s), c.s).abs();
            assert!(ds < 1.0e-3, "station {i}: ds = {ds} (length {length})");
        }

        // センターライン以外でも t が復元できること。
        let left = v.sample_line(1.0, STEP);
        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            let c = v.world_to_track(vertex(&left, i));
            assert!(
                (c.t - f.width_left).abs() < 1.0e-3,
                "station {i}: t = {} expected {}",
                c.t,
                f.width_left
            );
        }
    }

    #[test]
    fn invalid_json_returns_error() {
        assert!(TrackView::from_json("").is_err(), "empty");
        assert!(TrackView::from_json("{ not json").is_err(), "malformed");
        assert!(
            TrackView::from_json(r#"{"schema_version":999,"track":{}}"#).is_err(),
            "unsupported version"
        );
        assert!(
            TrackView::from_json(r#"{"schema_version":1,"track":{}}"#).is_err(),
            "missing fields"
        );
    }

    #[test]
    fn invalid_step_returns_empty() {
        let v = view();
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, 1.0e-9] {
            assert!(v.stations(bad).is_empty(), "stations({bad})");
            assert!(v.sample_line(0.0, bad).is_empty(), "sample_line({bad})");
            assert!(v.sample_surface(bad).is_empty(), "sample_surface({bad})");
            assert!(
                v.sample_curvature(bad).is_empty(),
                "sample_curvature({bad})"
            );
            assert!(v.sample_banking(bad).is_empty(), "sample_banking({bad})");
        }
    }
}
