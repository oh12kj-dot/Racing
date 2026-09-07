//! トラック局所座標。
//!
//! # 幾何規約（ARCHITECTURE.md §3 / TODO.md 仕様。変更禁止）
//!
//! ```text
//! up            = Vec3::Y
//! lateral_flat  = up.cross(tangent).normalize()      // tangent=+X のとき -Z（= 左）
//! normal_flat   = tangent.cross(lateral_flat)        // 平坦時に +Y になる
//! lateral       = lateral_flat を tangent 軸まわりに banking だけ回した結果
//! normal        = normal_flat  を tangent 軸まわりに banking だけ回した結果
//! ```

use sim_math::Vec3;

/// トラック上の位置。レースロジックの唯一の正。
///
/// Waypoint index は存在しない。位置は常にこの連続量で表現する。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TrackCoord {
    /// センターライン沿いの弧長 [m]。`0 <= s < track.length()`。
    pub s: f64,
    /// 横方向オフセット [m]。**左が正・右が負**。
    pub t: f64,
}

impl TrackCoord {
    /// `s` と `t` から生成する。
    #[inline]
    pub fn new(s: f64, t: f64) -> Self {
        Self { s, t }
    }
}

/// `s` における路面の幾何フレーム。
#[derive(Clone, Copy, Debug)]
pub struct TrackFrame {
    /// センターライン上のワールド位置。
    pub position: Vec3,
    /// 進行方向の単位ベクトル。
    pub tangent: Vec3,
    /// 路面法線（バンクを含む。`tangent.cross(lateral)` として構成され、
    /// `tangent` / `lateral` と厳密に直交する単位ベクトル）。
    pub normal: Vec3,
    /// 路面内で進行方向に直交する単位ベクトル。**左向き**。
    pub lateral: Vec3,
    /// 曲率 `1/R` [1/m]。**符号付き**（左カーブが正）。
    pub curvature: f64,
    /// バンク角 [rad]。左端が持ち上がる向きを正とする。
    pub banking: f64,
    /// カンバー角 [rad]。センターラインから両端が下がる向きを正とする。
    ///
    /// **現時点では値の保持のみ。** `Track::track_to_world` / `frame_at` の
    /// 幾何計算には反映されない（`t` に応じた路面の下がりは実装されていない）。
    /// バンクとは異なり `lateral` / `normal` の回転には使われないため、
    /// 下流のコードはこの値が既に幾何へ適用済みだと仮定してはならない。
    /// 適用は将来の拡張（TODO.md Out of Scope）。
    pub camber: f64,
    /// 標高 [m]（`position.y` と同値。利便のため保持）。
    pub elevation: f64,
    /// センターラインから左端までの距離 [m]（正）。
    pub width_left: f64,
    /// センターラインから右端までの距離 [m]（正）。
    pub width_right: f64,
}
