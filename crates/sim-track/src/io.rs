//! トラック定義ファイルの入出力（JSON）。
//!
//! `#[cfg(feature = "serde")]` の下でのみコンパイルされる。`--no-default-features`
//! でビルドすると本モジュールごと存在しなくなり、`sim-track` の core は
//! 依存ゼロのまま残る（WASM / FFI ターゲット向け）。
//!
//! 形式は JSON（RON ではない）。Blender Python と Engineering View（JavaScript）が
//! 追加ライブラリなしで同じファイルを読む必要があるため（DECISIONS.md ADR-0006）。

use crate::definition::{TrackDefinition, TrackError};
use crate::track::Track;
use std::fmt;
use std::path::Path;

/// ファイル形式のスキーマバージョン。破壊的変更のたびに上げる。
pub const TRACK_SCHEMA_VERSION: u32 = 1;

/// トラック定義ファイルの入出力エラー。
#[derive(Debug)]
pub enum TrackIoError {
    /// ファイル入出力に失敗した。
    Io(std::io::Error),
    /// JSON の構文または型が不正。
    Parse(serde_json::Error),
    /// JSON としては読めたが、トラックとして不正。
    Invalid(TrackError),
    /// スキーマバージョンが未対応。
    UnsupportedVersion {
        /// ファイルに書かれていたバージョン。
        found: u32,
        /// このビルドが対応するバージョン。
        supported: u32,
    },
}

impl fmt::Display for TrackIoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TrackIoError::Io(e) => write!(f, "track file I/O error: {e}"),
            TrackIoError::Parse(e) => write!(f, "track file JSON parse error: {e}"),
            TrackIoError::Invalid(e) => write!(f, "invalid track definition: {e}"),
            TrackIoError::UnsupportedVersion { found, supported } => write!(
                f,
                "unsupported track schema version {found} (this build supports {supported})"
            ),
        }
    }
}

impl std::error::Error for TrackIoError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            TrackIoError::Io(e) => Some(e),
            TrackIoError::Parse(e) => Some(e),
            TrackIoError::Invalid(e) => Some(e),
            TrackIoError::UnsupportedVersion { .. } => None,
        }
    }
}

/// ファイルの最上位構造。[`TrackDefinition`] にバージョンとメタ情報を添えたもの。
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TrackFile {
    /// スキーマバージョン。読み込み時に検証する。
    pub schema_version: u32,
    /// 任意の説明文。シミュレーションからは参照しない。
    #[cfg_attr(feature = "serde", serde(default))]
    pub description: String,
    /// トラック定義本体。
    pub track: TrackDefinition,
}

/// JSON 文字列から読む。スキーマバージョンと構築可能性を検証する。
///
/// 処理順序:
/// 1. `serde_json` でパース（失敗 -> [`TrackIoError::Parse`]）
/// 2. `schema_version` を検証（不一致 -> [`TrackIoError::UnsupportedVersion`]）
/// 3. [`Track::build`] を試行（失敗 -> [`TrackIoError::Invalid`]）。
///    **読み込み時点で構築可能性を検証するため、不正なデータは後段へ流れない。**
pub fn track_from_json_str(s: &str) -> Result<TrackDefinition, TrackIoError> {
    let file: TrackFile = serde_json::from_str(s).map_err(TrackIoError::Parse)?;
    if file.schema_version != TRACK_SCHEMA_VERSION {
        return Err(TrackIoError::UnsupportedVersion {
            found: file.schema_version,
            supported: TRACK_SCHEMA_VERSION,
        });
    }
    Track::build(&file.track).map_err(TrackIoError::Invalid)?;
    Ok(file.track)
}

/// JSON ファイルから読む。
pub fn track_from_json_file(path: impl AsRef<Path>) -> Result<TrackDefinition, TrackIoError> {
    let s = std::fs::read_to_string(path).map_err(TrackIoError::Io)?;
    track_from_json_str(&s)
}

/// 読み込んだうえで [`Track::build`] まで行う。
pub fn load_track(path: impl AsRef<Path>) -> Result<Track, TrackIoError> {
    let def = track_from_json_file(path)?;
    Track::build(&def).map_err(TrackIoError::Invalid)
}

/// 定義を JSON 文字列へ書き出す（整形あり）。ラウンドトリップ検証と
/// ツール側（Blender / UE5）へのエクスポートに使う。
pub fn track_to_json_string(
    def: &TrackDefinition,
    description: &str,
) -> Result<String, TrackIoError> {
    let file = TrackFile {
        schema_version: TRACK_SCHEMA_VERSION,
        description: description.to_string(),
        track: def.clone(),
    };
    serde_json::to_string_pretty(&file).map_err(TrackIoError::Parse)
}

/// `Vec<sim_math::Vec3>` を `serde` で扱うための補助モジュール。
///
/// `sim_math::Vec3` は凍結された `sim-math` クレートの型であり `Serialize` /
/// `Deserialize` を実装していない（孤児規則によりここで直接 `impl` することもできない）。
/// [`TrackDefinition::centerline`](crate::TrackDefinition::centerline) の
/// `#[serde(with = "crate::io::vec3_seq")]` からのみ使う内部実装。
pub(crate) mod vec3_seq {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    use sim_math::Vec3;

    /// `Vec3` の JSON 表現（`{"x":.., "y":.., "z":..}`）。
    #[derive(Serialize, Deserialize)]
    struct Point {
        x: f64,
        y: f64,
        z: f64,
    }

    pub fn serialize<S: Serializer>(points: &[Vec3], serializer: S) -> Result<S::Ok, S::Error> {
        let repr: Vec<Point> = points
            .iter()
            .map(|p| Point {
                x: p.x,
                y: p.y,
                z: p.z,
            })
            .collect();
        repr.serialize(serializer)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<Vec3>, D::Error> {
        let repr = Vec::<Point>::deserialize(deserializer)?;
        Ok(repr.into_iter().map(|p| Vec3::new(p.x, p.y, p.z)).collect())
    }
}
