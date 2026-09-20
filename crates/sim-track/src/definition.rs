//! トラックの入力定義（メモリ上）。
//!
//! ファイルからのロードは TASK-1A-3 の担当。本タスクはここで定義される
//! [`TrackDefinition`] から [`crate::Track`] を構築するところまでを扱う。

use crate::surface::SurfaceKind;
use sim_math::Vec3;
use std::fmt;

/// 制御点ごとの断面定義。`centerline` と同じ長さでなければならない。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(default))]
pub struct CrossSection {
    /// センターラインから左端までの距離 [m]。`> 0`。
    pub width_left: f64,
    /// センターラインから右端までの距離 [m]。`> 0`。
    pub width_right: f64,
    /// バンク角 [rad]。
    pub banking: f64,
    /// カンバー角 [rad]。
    pub camber: f64,
    /// 左端の外側に続く縁石の幅 [m]。0 なら縁石なし。
    pub kerb_left: f64,
    /// 右端の外側に続く縁石の幅 [m]。0 なら縁石なし。
    pub kerb_right: f64,
    /// 縁石の外側の路面。
    pub runoff: SurfaceKind,
}

impl Default for CrossSection {
    /// width 6.0 / 6.0、バンク・カンバー 0、縁石 1.5 m、runoff = Grass。
    fn default() -> Self {
        Self {
            width_left: 6.0,
            width_right: 6.0,
            banking: 0.0,
            camber: 0.0,
            kerb_left: 1.5,
            kerb_right: 1.5,
            runoff: SurfaceKind::Grass,
        }
    }
}

/// トラックの入力定義。TASK-1A-3 でファイルからロードできるようにする。
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TrackDefinition {
    /// トラック名。
    pub name: String,
    /// センターラインの制御点。`y` が標高。
    #[cfg_attr(feature = "serde", serde(with = "crate::io::vec3_seq"))]
    pub centerline: Vec<Vec3>,
    /// 各制御点の断面。`centerline` と同数。
    pub sections: Vec<CrossSection>,
    /// 常に `true`（サーキット）。`false` はヒルクライム等の将来拡張用。
    pub closed: bool,
    /// セクター境界。全長に対する割合 `(0, 1)` の昇順。
    /// 要素数 2 で 3 セクター（モータースポーツの標準）。
    pub sector_splits: Vec<f64>,
    /// スタート/フィニッシュラインの位置。全長に対する割合 `[0, 1)`。
    /// 既定は 0.0（= 制御点 0）。
    pub start_finish: f64,
}

/// [`Track::build`](crate::Track::build) が返しうるエラー。
#[derive(Clone, Debug, PartialEq)]
pub enum TrackError {
    /// センターラインのスプライン構築に失敗した。
    Spline(sim_math::SplineError),
    /// `sections` の要素数が `centerline` と一致しない。
    SectionCountMismatch {
        /// `centerline` の要素数。
        centerline: usize,
        /// `sections` の要素数。
        sections: usize,
    },
    /// コース幅が 0 以下。
    NonPositiveWidth {
        /// 該当する制御点の添字。
        index: usize,
    },
    /// セクター境界が昇順でない、または範囲外。
    InvalidSectorSplits,
    /// `start_finish` が `[0, 1)` の範囲外。
    InvalidStartFinish,
}

impl fmt::Display for TrackError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TrackError::Spline(e) => write!(f, "centerline spline error: {e}"),
            TrackError::SectionCountMismatch {
                centerline,
                sections,
            } => write!(
                f,
                "sections count ({sections}) does not match centerline count ({centerline})"
            ),
            TrackError::NonPositiveWidth { index } => {
                write!(f, "cross section {index} has non-positive width")
            }
            TrackError::InvalidSectorSplits => {
                write!(f, "sector splits must be strictly ascending within (0, 1)")
            }
            TrackError::InvalidStartFinish => {
                write!(f, "start_finish must be within [0, 1)")
            }
        }
    }
}

impl std::error::Error for TrackError {}
