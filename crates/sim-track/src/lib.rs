//! `sim-track` — Track Geometry / Track Coordinate System / Surface。
//!
//! ARCHITECTURE.md §3 の Track Coordinate System を実装する。以降のすべてのレースロジック
//! （順位・ラップカウント・車間・ライン・AI 判断）はワールド座標ではなく、
//! この crate が提供するトラック局所座標（[`TrackCoord`]）の上で行う。
//!
//! Waypoint index は存在しない。トラック上の位置は常に連続量 `s`（弧長 [m]）で表現する。
//!
//! # 主要な型
//!
//! | 型 | 役割 |
//! |----|------|
//! | [`TrackCoord`] | トラック局所座標 `(s, t)` |
//! | [`TrackFrame`] | `s` における幾何フレーム |
//! | [`Track`] | トラック本体。座標変換とラップ判定の元 |
//! | [`TrackDefinition`] | メモリ上のトラック入力定義 |
//! | [`SurfaceKind`] / [`SurfaceProperties`] | 路面種別と物理特性 |
//! | [`LapCrossing`] / [`detect_lap_crossing`] | スタート/フィニッシュ跨ぎ検出 |

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod coord;
pub mod definition;
#[cfg(feature = "serde")]
pub mod io;
pub mod lap;
pub mod surface;
pub mod track;

pub use coord::{TrackCoord, TrackFrame};
pub use definition::{CrossSection, TrackDefinition, TrackError};
#[cfg(feature = "serde")]
pub use io::{
    load_track, track_from_json_file, track_from_json_str, track_to_json_string, TrackFile,
    TrackIoError, TRACK_SCHEMA_VERSION,
};
pub use lap::{detect_lap_crossing, LapCrossing};
pub use surface::{SurfaceKind, SurfaceProperties};
pub use track::Track;
