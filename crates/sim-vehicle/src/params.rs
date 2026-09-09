//! 車両パラメータ。`assets/vehicles/*.spec.json` の物理側フィールドを保持する。
//!
//! **見た目（Blender）と物理（この crate）が同一ファイルから導出される**という
//! ADR-0006 の中核。`visual` セクションはこの crate では読まない（無視される）。
//!
//! spec.json に存在しない物理パラメータ（タイヤモデル係数・エンジン慣性など）は
//! ここで既定値を持ち、JSON 側に同名フィールドがあれば上書きされる。
//! 既定値の根拠は各フィールドの doc comment に書いてある。

use crate::state::WheelIndex;
use crate::GRAVITY;
use sim_math::Vec3;
use std::fmt;

/// 車両スペックファイルのスキーマバージョン。
pub const VEHICLE_SCHEMA_VERSION: u32 = 1;

/// 慣性テンソルの直方体近似に掛ける補正係数（ロール軸 = 車両 `+X` まわり）。
pub const DEFAULT_K_ROLL: f64 = 0.75;
/// 慣性テンソルの直方体近似に掛ける補正係数（ピッチ軸 = 車両 `+Z` まわり）。
pub const DEFAULT_K_PITCH: f64 = 1.10;
/// 慣性テンソルの直方体近似に掛ける補正係数（ヨー軸 = 車両 `+Y` まわり）。
pub const DEFAULT_K_YAW: f64 = 1.05;

// --------------------------------------------------------------------------------------
// serde 既定値
// --------------------------------------------------------------------------------------

#[cfg(feature = "serde")]
fn d_k_roll() -> f64 {
    DEFAULT_K_ROLL
}
#[cfg(feature = "serde")]
fn d_k_pitch() -> f64 {
    DEFAULT_K_PITCH
}
#[cfg(feature = "serde")]
fn d_k_yaw() -> f64 {
    DEFAULT_K_YAW
}
#[cfg(feature = "serde")]
fn d_mu0() -> f64 {
    1.50
}
#[cfg(feature = "serde")]
fn d_load_sensitivity() -> f64 {
    0.28
}
#[cfg(feature = "serde")]
fn d_bx() -> f64 {
    12.0
}
#[cfg(feature = "serde")]
fn d_cx() -> f64 {
    1.65
}
#[cfg(feature = "serde")]
fn d_by() -> f64 {
    9.0
}
#[cfg(feature = "serde")]
fn d_cy() -> f64 {
    1.35
}
#[cfg(feature = "serde")]
fn d_relaxation_length() -> f64 {
    0.30
}
#[cfg(feature = "serde")]
fn d_stick_stiffness() -> f64 {
    40.0
}
#[cfg(feature = "serde")]
fn d_stick_damping_ratio() -> f64 {
    0.5
}
#[cfg(feature = "serde")]
fn d_wheel_inertia_factor() -> f64 {
    0.35
}
#[cfg(feature = "serde")]
fn d_engine_inertia() -> f64 {
    0.22
}
#[cfg(feature = "serde")]
fn d_engine_brake_torque() -> f64 {
    55.0
}
#[cfg(feature = "serde")]
fn d_driveline_efficiency() -> f64 {
    0.92
}
#[cfg(feature = "serde")]
fn d_lsd_torque_per_rad() -> f64 {
    30.0
}
#[cfg(feature = "serde")]
fn d_lsd_preload() -> f64 {
    60.0
}
#[cfg(feature = "serde")]
fn d_progressive() -> f64 {
    0.50
}
fn d_max_steer_angle() -> f64 {
    0.50
}
fn d_steer_time_constant() -> f64 {
    0.06
}

// --------------------------------------------------------------------------------------
// パラメータ構造体
// --------------------------------------------------------------------------------------

/// 車体寸法 [m]。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Dimensions {
    /// 全長。
    pub length: f64,
    /// 全幅。
    pub width: f64,
    /// 全高。
    pub height: f64,
    /// ホイールベース。
    pub wheelbase: f64,
    /// フロントトレッド。
    pub track_front: f64,
    /// リアトレッド。
    pub track_rear: f64,
    /// フロントオーバーハング（Phase 1B では保持のみ）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub front_overhang: f64,
    /// リアオーバーハング（Phase 1B では保持のみ）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub rear_overhang: f64,
    /// フロント車高（Phase 1B では保持のみ。幾何はサスの静的つり合いから決まる）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub ride_height_front: f64,
    /// リア車高（Phase 1B では保持のみ）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub ride_height_rear: f64,
}

/// 質量と重心。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MassParams {
    /// 車両総質量 [kg]。剛体の質量としてそのまま使う。
    pub total_kg: f64,
    /// 前軸の静的荷重配分 `0..1`。`0.45` なら前 45%。
    pub distribution_front: f64,
    /// 重心高 [m]（路面から）。
    pub cg_height: f64,
    /// 1 輪あたりのバネ下質量 [kg]。車輪の回転慣性の算出に使う。
    pub unsprung_kg_per_wheel: f64,
    /// 慣性テンソル補正係数（ロール軸）。
    #[cfg_attr(feature = "serde", serde(default = "d_k_roll"))]
    pub k_roll: f64,
    /// 慣性テンソル補正係数（ピッチ軸）。
    #[cfg_attr(feature = "serde", serde(default = "d_k_pitch"))]
    pub k_pitch: f64,
    /// 慣性テンソル補正係数（ヨー軸）。
    #[cfg_attr(feature = "serde", serde(default = "d_k_yaw"))]
    pub k_yaw: f64,
}

/// タイヤの寸法。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TyreSize {
    /// 転がり有効半径 [m]。
    pub radius: f64,
    /// トレッド幅 [m]（Phase 1B では保持のみ）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub width: f64,
    /// リム径 [inch]（Phase 1B では保持のみ）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub rim_diameter_in: f64,
}

/// タイヤ。寸法と簡略 Pacejka Magic Formula の係数。
///
/// 係数は spec.json の `tyre` セクションから上書きできる。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TyreParams {
    /// フロントタイヤ。
    pub front: TyreSize,
    /// リアタイヤ。
    pub rear: TyreSize,
    /// 基準摩擦係数 `mu0`。実効値は路面グリップと荷重感度で修飾される。
    ///
    /// 既定 `1.50` は GT3 級のスリックの実測ピーク（1.5〜1.6）に合わせた値。
    /// 定常円旋回 R=50 m のシナリオ（`docs/phase-1b-vehicle.md`）を満たす下限でもある。
    /// **摩擦円は等方なので、この 1 つの係数が縦グリップと横グリップを同時に動かす。**
    /// 100-0 制動距離の当初の帯（30〜40 m）とは両立しない。経緯は同文書の
    /// 「シナリオ」節に記録してある。
    #[cfg_attr(feature = "serde", serde(default = "d_mu0"))]
    pub mu0: f64,
    /// 荷重感度係数 `LS`。`mu = mu0 * grip / (1 + LS * (Fz / Fz_nominal - 1))`。
    #[cfg_attr(feature = "serde", serde(default = "d_load_sensitivity"))]
    pub load_sensitivity: f64,
    /// 荷重感度の基準荷重 [N]。`None` なら静的 1 輪平均荷重を使う。
    #[cfg_attr(feature = "serde", serde(default))]
    pub nominal_load: Option<f64>,
    /// 縦方向 Magic Formula の剛性係数 `Bx`。
    #[cfg_attr(feature = "serde", serde(default = "d_bx"))]
    pub bx: f64,
    /// 縦方向 Magic Formula の形状係数 `Cx`（`1 < Cx <= 2`）。
    #[cfg_attr(feature = "serde", serde(default = "d_cx"))]
    pub cx: f64,
    /// 横方向 Magic Formula の剛性係数 `By`。
    #[cfg_attr(feature = "serde", serde(default = "d_by"))]
    pub by: f64,
    /// 横方向 Magic Formula の形状係数 `Cy`（`1 < Cy <= 2`）。
    #[cfg_attr(feature = "serde", serde(default = "d_cy"))]
    pub cy: f64,
    /// 緩和長 [m]。生のスリップ値を直接使わないための一次遅れの距離定数。
    #[cfg_attr(feature = "serde", serde(default = "d_relaxation_length"))]
    pub relaxation_length: f64,
    /// 静止摩擦ばねの剛性 [N/m per N of load]。`k_stick = load * この値`。
    #[cfg_attr(feature = "serde", serde(default = "d_stick_stiffness"))]
    pub stick_stiffness_per_n: f64,
    /// 静止摩擦ばねの減衰比。`1.0` で臨界減衰。
    ///
    /// 仕様書のばね単体では停車中の擾乱が減衰せず自励振動する。
    /// タイヤカーカスの減衰に相当する項で、これを 0 にすると T-VEH-06 が不安定になる。
    #[cfg_attr(feature = "serde", serde(default = "d_stick_damping_ratio"))]
    pub stick_damping_ratio: f64,
    /// 車輪回転慣性の係数。`I = factor * unsprung_kg * radius^2`。
    ///
    /// バネ下質量にはアップライトなど回転しない部分が含まれるため、
    /// 円板（0.5）より小さい `0.35` を既定とする。
    #[cfg_attr(feature = "serde", serde(default = "d_wheel_inertia_factor"))]
    pub wheel_inertia_factor: f64,
}

/// 駆動レイアウト。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum DrivetrainLayout {
    /// 後輪駆動。
    Rwd,
    /// 前輪駆動。
    Fwd,
    /// 四輪駆動（Phase 1B では前後 50:50 固定）。
    Awd,
}

/// エンジン。
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct EngineParams {
    /// アイドル回転数 [rpm]。
    pub idle_rpm: f64,
    /// 最高回転数 [rpm]。
    pub max_rpm: f64,
    /// レブリミッター作動回転数 [rpm]。
    pub limiter_rpm: f64,
    /// トルクカーブ `[[rpm, Nm], ...]`。rpm は狭義単調増加。
    pub torque_curve: Vec<[f64; 2]>,
    /// エンジン回転慣性 [kg m^2]。
    #[cfg_attr(feature = "serde", serde(default = "d_engine_inertia"))]
    pub inertia: f64,
    /// `max_rpm` におけるエンジンブレーキトルク [Nm]。回転数に比例させる。
    #[cfg_attr(feature = "serde", serde(default = "d_engine_brake_torque"))]
    pub engine_brake_torque: f64,
}

/// 駆動系。
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct DrivetrainParams {
    /// 駆動レイアウト。
    pub layout: DrivetrainLayout,
    /// 前進ギア比。狭義単調減少。
    pub gear_ratios: Vec<f64>,
    /// ファイナルギア比。
    pub final_drive: f64,
    /// リバースギア比。
    pub reverse_ratio: f64,
    /// 変速時間 [s]。この間はトルクをカットする。
    pub shift_time_s: f64,
    /// LSD のパワー側トルクバイアス `0..1`。
    pub lsd_power_ratio: f64,
    /// LSD のコースト側トルクバイアス `0..1`。
    pub lsd_coast_ratio: f64,
    /// 駆動系伝達効率 `0..1`。
    #[cfg_attr(feature = "serde", serde(default = "d_driveline_efficiency"))]
    pub driveline_efficiency: f64,
    /// LSD の差回転あたりロックトルク [Nm per rad/s]。
    #[cfg_attr(feature = "serde", serde(default = "d_lsd_torque_per_rad"))]
    pub lsd_torque_per_rad: f64,
    /// LSD のプリロードトルク [Nm]。入力トルク 0 でも生じるロック分。
    #[cfg_attr(feature = "serde", serde(default = "d_lsd_preload"))]
    pub lsd_preload: f64,
}

/// 空力。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AeroParams {
    /// 前面投影面積 [m^2]。
    pub frontal_area: f64,
    /// 抗力係数。
    pub cd: f64,
    /// フロントのダウンフォース係数。
    pub cl_front: f64,
    /// リアのダウンフォース係数。
    pub cl_rear: f64,
    /// フロント圧力中心の車体ローカル `x` [m]（前が正）。
    pub cop_front_x: f64,
    /// リア圧力中心の車体ローカル `x` [m]（後ろが負）。
    pub cop_rear_x: f64,
}

/// ブレーキ。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct BrakeParams {
    /// フロント 1 輪の最大制動トルク [Nm]。
    pub max_torque_front: f64,
    /// リア 1 輪の最大制動トルク [Nm]。
    pub max_torque_rear: f64,
    /// 前後制動バランス `0..1`。前 62% なら `0.62`。
    pub bias_front: f64,
    /// フロントディスク半径 [m]（Phase 1B では保持のみ）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub disc_radius_front: f64,
    /// リアディスク半径 [m]（Phase 1B では保持のみ）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub disc_radius_rear: f64,
}

/// サスペンション。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SuspensionParams {
    /// フロントのバネ定数 [N/m]。
    pub spring_rate_front: f64,
    /// リアのバネ定数 [N/m]。
    pub spring_rate_rear: f64,
    /// フロントのバンプ側減衰係数 [Ns/m]。
    pub damper_bump_front: f64,
    /// フロントのリバウンド側減衰係数 [Ns/m]。
    pub damper_rebound_front: f64,
    /// リアのバンプ側減衰係数 [Ns/m]。
    pub damper_bump_rear: f64,
    /// リアのリバウンド側減衰係数 [Ns/m]。
    pub damper_rebound_rear: f64,
    /// フロントのアンチロールバー剛性 [N/m]。
    pub arb_front: f64,
    /// リアのアンチロールバー剛性 [N/m]。
    pub arb_rear: f64,
    /// バンプ側ストローク [m]。`compression` はこの値でクランプされる。
    pub travel_up: f64,
    /// リバウンド側ストローク [m]。接地探索距離に加算される。
    pub travel_down: f64,
    /// progressive rate 係数。`F = k * x * (1 + progressive * x / travel_up)`。
    #[cfg_attr(feature = "serde", serde(default = "d_progressive"))]
    pub progressive: f64,
    /// サスペンションの自由長 [m]。`None` なら `travel_up + travel_down`。
    ///
    /// 取り付け点の高さと接地探索距離の基準になるだけで、
    /// 静的つり合いの位置には影響しない（取り付け点の高さがこの値から導出されるため）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub rest_length: Option<f64>,
}

/// ステアリング。
#[derive(Clone, Copy, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SteeringParams {
    /// `steer = ±1.0` における実舵角 [rad]。
    #[cfg_attr(feature = "serde", serde(default = "d_max_steer_angle"))]
    pub max_steer_angle: f64,
    /// ステアリングラックの一次遅れ時定数 [s]。
    ///
    /// 入力から実舵角への機構遅れ。`WheelState::steer_angle` が
    /// 「実舵角」であることの根拠。
    #[cfg_attr(feature = "serde", serde(default = "d_steer_time_constant"))]
    pub time_constant: f64,
}

impl Default for SteeringParams {
    fn default() -> Self {
        SteeringParams {
            max_steer_angle: d_max_steer_angle(),
            time_constant: d_steer_time_constant(),
        }
    }
}

/// 車両パラメータ一式。spec.json の物理関連フィールドを保持する。
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct VehicleParams {
    /// 車名。
    #[cfg_attr(feature = "serde", serde(default))]
    pub name: String,
    /// 寸法。
    pub dimensions: Dimensions,
    /// 質量と重心。
    pub mass: MassParams,
    /// タイヤ。
    pub tyre: TyreParams,
    /// エンジン。
    pub engine: EngineParams,
    /// 駆動系。
    pub drivetrain: DrivetrainParams,
    /// 空力。
    pub aero: AeroParams,
    /// ブレーキ。
    pub brakes: BrakeParams,
    /// サスペンション。
    pub suspension: SuspensionParams,
    /// ステアリング（spec.json には無く、既定値を使う）。
    #[cfg_attr(feature = "serde", serde(default))]
    pub steering: SteeringParams,
}

// --------------------------------------------------------------------------------------
// エラー
// --------------------------------------------------------------------------------------

/// パラメータの読み込み / 検証エラー。
#[derive(Debug)]
pub enum VehicleParamsError {
    /// JSON の構文または型が不正。
    #[cfg(feature = "serde")]
    Parse(serde_json::Error),
    /// ファイル入出力に失敗した。
    #[cfg(feature = "serde")]
    Io(std::io::Error),
    /// スキーマバージョンが未対応。
    UnsupportedVersion {
        /// ファイルに書かれていたバージョン。
        found: u32,
        /// このビルドが対応するバージョン。
        supported: u32,
    },
    /// 正でなければならない値が 0 以下、または非有限。
    NonPositive {
        /// フィールド名。
        field: &'static str,
        /// 実際の値。
        value: f64,
    },
    /// 値が許容範囲外。
    OutOfRange {
        /// フィールド名。
        field: &'static str,
        /// 実際の値。
        value: f64,
        /// 下限（含む）。
        lo: f64,
        /// 上限（含む）。
        hi: f64,
    },
    /// 単調性を満たさない数列。
    NotMonotonic {
        /// フィールド名。
        field: &'static str,
        /// 破れた位置。
        index: usize,
    },
    /// 空であってはならない配列が空。
    Empty {
        /// フィールド名。
        field: &'static str,
    },
    /// 静的つり合いでサスペンションが底付きする。
    SuspensionBottomsOut {
        /// 車輪。
        wheel: WheelIndex,
        /// 静的つり合いでの縮み量 [m]。
        compression: f64,
        /// バンプ側ストローク [m]。
        travel_up: f64,
    },
}

impl fmt::Display for VehicleParamsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            #[cfg(feature = "serde")]
            VehicleParamsError::Parse(e) => write!(f, "vehicle spec JSON parse error: {e}"),
            #[cfg(feature = "serde")]
            VehicleParamsError::Io(e) => write!(f, "vehicle spec I/O error: {e}"),
            VehicleParamsError::UnsupportedVersion { found, supported } => write!(
                f,
                "unsupported vehicle schema version {found} (this build supports {supported})"
            ),
            VehicleParamsError::NonPositive { field, value } => {
                write!(f, "{field} must be positive and finite (got {value})")
            }
            VehicleParamsError::OutOfRange {
                field,
                value,
                lo,
                hi,
            } => write!(f, "{field} must be within [{lo}, {hi}] (got {value})"),
            VehicleParamsError::NotMonotonic { field, index } => {
                write!(f, "{field} is not monotonic at index {index}")
            }
            VehicleParamsError::Empty { field } => write!(f, "{field} must not be empty"),
            VehicleParamsError::SuspensionBottomsOut {
                wheel,
                compression,
                travel_up,
            } => write!(
                f,
                "suspension bottoms out at rest on {wheel:?}: compression {compression} m >= travel_up {travel_up} m"
            ),
        }
    }
}

impl std::error::Error for VehicleParamsError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            #[cfg(feature = "serde")]
            VehicleParamsError::Parse(e) => Some(e),
            #[cfg(feature = "serde")]
            VehicleParamsError::Io(e) => Some(e),
            _ => None,
        }
    }
}

/// spec.json の最上位構造。
#[cfg(feature = "serde")]
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct VehicleSpecFile {
    /// スキーマバージョン。読み込み時に検証する。
    pub schema_version: u32,
    /// 物理パラメータ本体（`visual` セクションは無視される）。
    #[serde(flatten)]
    pub params: VehicleParams,
}

// --------------------------------------------------------------------------------------
// 検証と派生量
// --------------------------------------------------------------------------------------

fn need_positive(field: &'static str, value: f64) -> Result<(), VehicleParamsError> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(VehicleParamsError::NonPositive { field, value })
    }
}

fn need_range(field: &'static str, value: f64, lo: f64, hi: f64) -> Result<(), VehicleParamsError> {
    if value.is_finite() && value >= lo && value <= hi {
        Ok(())
    } else {
        Err(VehicleParamsError::OutOfRange {
            field,
            value,
            lo,
            hi,
        })
    }
}

impl VehicleParams {
    /// spec.json の文字列から読む。スキーマバージョンと妥当性を検証する。
    ///
    /// `sim-track` の `track_from_json_str` と同じ方針で、
    /// **読み込み時点で検証するため不正なデータは後段へ流れない。**
    #[cfg(feature = "serde")]
    pub fn from_json_str(s: &str) -> Result<Self, VehicleParamsError> {
        let file: VehicleSpecFile = serde_json::from_str(s).map_err(VehicleParamsError::Parse)?;
        if file.schema_version != VEHICLE_SCHEMA_VERSION {
            return Err(VehicleParamsError::UnsupportedVersion {
                found: file.schema_version,
                supported: VEHICLE_SCHEMA_VERSION,
            });
        }
        file.params.validate()?;
        Ok(file.params)
    }

    /// spec.json をファイルから読む。
    #[cfg(feature = "serde")]
    pub fn from_json_file<P: AsRef<std::path::Path>>(path: P) -> Result<Self, VehicleParamsError> {
        let text = std::fs::read_to_string(path).map_err(VehicleParamsError::Io)?;
        Self::from_json_str(&text)
    }

    /// 妥当性を検証する。**構築時に必ず呼ばれる。**
    pub fn validate(&self) -> Result<(), VehicleParamsError> {
        let d = &self.dimensions;
        need_positive("dimensions.length", d.length)?;
        need_positive("dimensions.width", d.width)?;
        need_positive("dimensions.height", d.height)?;
        need_positive("dimensions.wheelbase", d.wheelbase)?;
        need_positive("dimensions.track_front", d.track_front)?;
        need_positive("dimensions.track_rear", d.track_rear)?;

        let m = &self.mass;
        need_positive("mass.total_kg", m.total_kg)?;
        need_range("mass.distribution_front", m.distribution_front, 0.05, 0.95)?;
        need_positive("mass.cg_height", m.cg_height)?;
        need_range(
            "mass.unsprung_kg_per_wheel",
            m.unsprung_kg_per_wheel,
            0.0,
            m.total_kg * 0.25,
        )?;
        need_positive("mass.k_roll", m.k_roll)?;
        need_positive("mass.k_pitch", m.k_pitch)?;
        need_positive("mass.k_yaw", m.k_yaw)?;

        let t = &self.tyre;
        need_positive("tyre.front.radius", t.front.radius)?;
        need_positive("tyre.rear.radius", t.rear.radius)?;
        need_positive("tyre.mu0", t.mu0)?;
        need_range("tyre.load_sensitivity", t.load_sensitivity, 0.0, 0.9)?;
        need_positive("tyre.bx", t.bx)?;
        need_positive("tyre.by", t.by)?;
        // C <= 1 では Magic Formula のピーク位置 tan(pi / (2C)) が定義できない。
        need_range("tyre.cx", t.cx, 1.000_001, 2.0)?;
        need_range("tyre.cy", t.cy, 1.000_001, 2.0)?;
        need_positive("tyre.relaxation_length", t.relaxation_length)?;
        need_positive("tyre.stick_stiffness_per_n", t.stick_stiffness_per_n)?;
        need_range("tyre.stick_damping_ratio", t.stick_damping_ratio, 0.0, 4.0)?;
        need_positive("tyre.wheel_inertia_factor", t.wheel_inertia_factor)?;
        if let Some(nominal) = t.nominal_load {
            need_positive("tyre.nominal_load", nominal)?;
        }

        let e = &self.engine;
        need_positive("engine.idle_rpm", e.idle_rpm)?;
        need_positive("engine.max_rpm", e.max_rpm)?;
        need_positive("engine.limiter_rpm", e.limiter_rpm)?;
        need_positive("engine.inertia", e.inertia)?;
        need_range(
            "engine.engine_brake_torque",
            e.engine_brake_torque,
            0.0,
            1.0e5,
        )?;
        if e.max_rpm <= e.idle_rpm {
            return Err(VehicleParamsError::OutOfRange {
                field: "engine.max_rpm",
                value: e.max_rpm,
                lo: e.idle_rpm,
                hi: f64::INFINITY,
            });
        }
        if e.limiter_rpm < e.idle_rpm {
            return Err(VehicleParamsError::OutOfRange {
                field: "engine.limiter_rpm",
                value: e.limiter_rpm,
                lo: e.idle_rpm,
                hi: f64::INFINITY,
            });
        }
        if e.torque_curve.is_empty() {
            return Err(VehicleParamsError::Empty {
                field: "engine.torque_curve",
            });
        }
        for (i, pt) in e.torque_curve.iter().enumerate() {
            if !pt[0].is_finite() || !pt[1].is_finite() {
                return Err(VehicleParamsError::NonPositive {
                    field: "engine.torque_curve",
                    value: pt[1],
                });
            }
            if i > 0 && pt[0] <= e.torque_curve[i - 1][0] {
                return Err(VehicleParamsError::NotMonotonic {
                    field: "engine.torque_curve",
                    index: i,
                });
            }
        }

        let dt = &self.drivetrain;
        if dt.gear_ratios.is_empty() {
            return Err(VehicleParamsError::Empty {
                field: "drivetrain.gear_ratios",
            });
        }
        for (i, r) in dt.gear_ratios.iter().enumerate() {
            need_positive("drivetrain.gear_ratios", *r)?;
            if i > 0 && *r >= dt.gear_ratios[i - 1] {
                return Err(VehicleParamsError::NotMonotonic {
                    field: "drivetrain.gear_ratios",
                    index: i,
                });
            }
        }
        need_positive("drivetrain.final_drive", dt.final_drive)?;
        need_positive("drivetrain.reverse_ratio", dt.reverse_ratio)?;
        need_range("drivetrain.shift_time_s", dt.shift_time_s, 0.0, 5.0)?;
        need_range("drivetrain.lsd_power_ratio", dt.lsd_power_ratio, 0.0, 1.0)?;
        need_range("drivetrain.lsd_coast_ratio", dt.lsd_coast_ratio, 0.0, 1.0)?;
        need_range(
            "drivetrain.driveline_efficiency",
            dt.driveline_efficiency,
            0.1,
            1.0,
        )?;
        need_range(
            "drivetrain.lsd_torque_per_rad",
            dt.lsd_torque_per_rad,
            0.0,
            1.0e4,
        )?;
        need_range("drivetrain.lsd_preload", dt.lsd_preload, 0.0, 1.0e4)?;

        let a = &self.aero;
        need_positive("aero.frontal_area", a.frontal_area)?;
        need_range("aero.cd", a.cd, 0.0, 5.0)?;
        need_range("aero.cl_front", a.cl_front, 0.0, 10.0)?;
        need_range("aero.cl_rear", a.cl_rear, 0.0, 10.0)?;
        need_range("aero.cop_front_x", a.cop_front_x, -20.0, 20.0)?;
        need_range("aero.cop_rear_x", a.cop_rear_x, -20.0, 20.0)?;

        let b = &self.brakes;
        need_positive("brakes.max_torque_front", b.max_torque_front)?;
        need_positive("brakes.max_torque_rear", b.max_torque_rear)?;
        need_range("brakes.bias_front", b.bias_front, 0.05, 0.95)?;

        let s = &self.suspension;
        need_positive("suspension.spring_rate_front", s.spring_rate_front)?;
        need_positive("suspension.spring_rate_rear", s.spring_rate_rear)?;
        need_positive("suspension.damper_bump_front", s.damper_bump_front)?;
        need_positive("suspension.damper_rebound_front", s.damper_rebound_front)?;
        need_positive("suspension.damper_bump_rear", s.damper_bump_rear)?;
        need_positive("suspension.damper_rebound_rear", s.damper_rebound_rear)?;
        need_range("suspension.arb_front", s.arb_front, 0.0, 1.0e7)?;
        need_range("suspension.arb_rear", s.arb_rear, 0.0, 1.0e7)?;
        need_positive("suspension.travel_up", s.travel_up)?;
        need_range("suspension.travel_down", s.travel_down, 0.0, 1.0)?;
        need_range("suspension.progressive", s.progressive, 0.0, 5.0)?;
        if let Some(rl) = s.rest_length {
            need_positive("suspension.rest_length", rl)?;
        }

        let st = &self.steering;
        need_range("steering.max_steer_angle", st.max_steer_angle, 0.01, 1.5)?;
        need_positive("steering.time_constant", st.time_constant)?;

        // 静的つり合いで底付きしないこと。ここを通せば静止状態が必ず有効域に入る。
        for w in WheelIndex::ALL {
            let load = self.static_wheel_load(w);
            let compression = self.static_compression(w);
            if compression >= s.travel_up {
                return Err(VehicleParamsError::SuspensionBottomsOut {
                    wheel: w,
                    compression,
                    travel_up: s.travel_up,
                });
            }
            debug_assert!(load.is_finite());
        }

        Ok(())
    }

    /// 静止時の 1 輪あたり垂直荷重 [N]。
    pub fn static_wheel_load(&self, w: WheelIndex) -> f64 {
        let weight = self.mass.total_kg * GRAVITY;
        let share = if w.is_front() {
            self.mass.distribution_front
        } else {
            1.0 - self.mass.distribution_front
        };
        weight * share * 0.5
    }

    /// バネ定数 [N/m]。
    pub fn spring_rate(&self, w: WheelIndex) -> f64 {
        if w.is_front() {
            self.suspension.spring_rate_front
        } else {
            self.suspension.spring_rate_rear
        }
    }

    /// タイヤ半径 [m]。
    pub fn tyre_radius(&self, w: WheelIndex) -> f64 {
        if w.is_front() {
            self.tyre.front.radius
        } else {
            self.tyre.rear.radius
        }
    }

    /// サスペンションの自由長 [m]。
    pub fn rest_length(&self) -> f64 {
        self.suspension
            .rest_length
            .unwrap_or(self.suspension.travel_up + self.suspension.travel_down)
    }

    /// 静止時のサスペンション縮み量 [m]。
    ///
    /// `F = k * x * (1 + progressive * x / travel_up)` を静的荷重について解いた解析解。
    pub fn static_compression(&self, w: WheelIndex) -> f64 {
        let k = self.spring_rate(w);
        let f = self.static_wheel_load(w);
        let p = self.suspension.progressive;
        if p <= 0.0 {
            return f / k;
        }
        let a = k * p / self.suspension.travel_up;
        // a x^2 + k x - f = 0
        (-k + (k * k + 4.0 * a * f).sqrt()) / (2.0 * a)
    }

    /// 車輪取り付け点の車体ローカル座標 [m]（重心が原点、`+X` 前 / `+Y` 上 / `+Z` 右）。
    ///
    /// 高さは「静的つり合いで重心が `mass.cg_height` に来る」ことから逆算する。
    pub fn wheel_mount_local(&self, w: WheelIndex) -> Vec3 {
        let l = self.dimensions.wheelbase;
        // 前軸荷重配分 = (重心から後軸までの距離) / ホイールベース。
        let cg_to_rear = l * self.mass.distribution_front;
        let cg_to_front = l - cg_to_rear;
        let (x, half_track) = if w.is_front() {
            (cg_to_front, self.dimensions.track_front * 0.5)
        } else {
            (-cg_to_rear, self.dimensions.track_rear * 0.5)
        };
        let z = if w.is_left() { -half_track } else { half_track };
        let y = self.tyre_radius(w) + self.rest_length()
            - self.static_compression(w)
            - self.mass.cg_height;
        Vec3::new(x, y, z)
    }
}

/// 構築時に一度だけ計算する派生量。ホットループで参照する。
#[derive(Clone, Debug)]
pub(crate) struct Derived {
    pub mass: f64,
    /// 車体ローカルの慣性主軸成分 `(Ixx, Iyy, Izz)`。
    pub inertia: Vec3,
    pub inv_inertia: Vec3,
    pub mount_local: [Vec3; 4],
    pub static_load: [f64; 4],
    pub rest_length: f64,
    pub tyre_radius: [f64; 4],
    pub wheel_inertia: [f64; 4],
    pub spring_rate: [f64; 4],
    pub damper_bump: [f64; 4],
    pub damper_rebound: [f64; 4],
    pub arb: [f64; 4],
    /// `brake = 1.0` のときの 1 輪あたり制動トルク [Nm]。
    pub brake_torque: [f64; 4],
    pub driven: [bool; 4],
    pub driven_count: f64,
    pub kappa_peak: f64,
    pub alpha_peak: f64,
    pub nominal_load: f64,
    /// 静止摩擦ばねの実効質量 [kg]（減衰の臨界値の算出に使う）。
    pub corner_mass: f64,
}

impl Derived {
    pub(crate) fn new(p: &VehicleParams) -> Self {
        let m = p.mass.total_kg;
        let d = &p.dimensions;
        // 車両ローカル: +X 前 / +Y 上 / +Z 右。
        // ロールは X まわり（幅と高さ）、ヨーは Y まわり（長さと幅）、
        // ピッチは Z まわり（長さと高さ）。
        let ixx = p.mass.k_roll * m * (d.width * d.width + d.height * d.height) / 12.0;
        let iyy = p.mass.k_yaw * m * (d.length * d.length + d.width * d.width) / 12.0;
        let izz = p.mass.k_pitch * m * (d.length * d.length + d.height * d.height) / 12.0;

        let mut mount_local = [Vec3::ZERO; 4];
        let mut static_load = [0.0; 4];
        let mut tyre_radius = [0.0; 4];
        let mut wheel_inertia = [0.0; 4];
        let mut spring_rate = [0.0; 4];
        let mut damper_bump = [0.0; 4];
        let mut damper_rebound = [0.0; 4];
        let mut arb = [0.0; 4];
        let mut brake_torque = [0.0; 4];
        let mut driven = [false; 4];

        // max_torque_* が既に前後バランスを内包しているため、bias_front は
        // その基準からのトリムとして解釈する（両フィールドを整合的に使う）。
        let ref_bias = p.brakes.max_torque_front
            / (p.brakes.max_torque_front + p.brakes.max_torque_rear).max(1.0e-9);
        let brake_scale_front = p.brakes.bias_front / ref_bias.max(1.0e-9);
        let brake_scale_rear = (1.0 - p.brakes.bias_front) / (1.0 - ref_bias).max(1.0e-9);

        for w in WheelIndex::ALL {
            let i = w as usize;
            mount_local[i] = p.wheel_mount_local(w);
            static_load[i] = p.static_wheel_load(w);
            tyre_radius[i] = p.tyre_radius(w);
            wheel_inertia[i] = (p.tyre.wheel_inertia_factor
                * p.mass.unsprung_kg_per_wheel
                * tyre_radius[i]
                * tyre_radius[i])
                .max(1.0e-3);
            if w.is_front() {
                spring_rate[i] = p.suspension.spring_rate_front;
                damper_bump[i] = p.suspension.damper_bump_front;
                damper_rebound[i] = p.suspension.damper_rebound_front;
                arb[i] = p.suspension.arb_front;
                brake_torque[i] = p.brakes.max_torque_front * brake_scale_front;
            } else {
                spring_rate[i] = p.suspension.spring_rate_rear;
                damper_bump[i] = p.suspension.damper_bump_rear;
                damper_rebound[i] = p.suspension.damper_rebound_rear;
                arb[i] = p.suspension.arb_rear;
                brake_torque[i] = p.brakes.max_torque_rear * brake_scale_rear;
            }
            driven[i] = match p.drivetrain.layout {
                DrivetrainLayout::Rwd => !w.is_front(),
                DrivetrainLayout::Fwd => w.is_front(),
                DrivetrainLayout::Awd => true,
            };
        }

        let driven_count = driven.iter().filter(|d| **d).count() as f64;
        let nominal_load = p.tyre.nominal_load.unwrap_or(m * GRAVITY * 0.25);

        // Magic Formula `sin(C * atan(B * s))` のピークは `C * atan(B * s) = pi / 2`。
        let kappa_peak = (std::f64::consts::FRAC_PI_2 / p.tyre.cx).tan() / p.tyre.bx;
        let alpha_peak = (std::f64::consts::FRAC_PI_2 / p.tyre.cy).tan() / p.tyre.by;

        Derived {
            mass: m,
            inertia: Vec3::new(ixx, iyy, izz),
            inv_inertia: Vec3::new(1.0 / ixx, 1.0 / iyy, 1.0 / izz),
            mount_local,
            static_load,
            rest_length: p.rest_length(),
            tyre_radius,
            wheel_inertia,
            spring_rate,
            damper_bump,
            damper_rebound,
            arb,
            brake_torque,
            driven,
            driven_count: driven_count.max(1.0),
            kappa_peak,
            alpha_peak,
            nominal_load,
            corner_mass: m * 0.25,
        }
    }
}
