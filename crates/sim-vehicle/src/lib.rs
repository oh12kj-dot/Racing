//! `sim-vehicle` — 車両物理（Phase 1B）。
//!
//! `docs/phase-1b-vehicle.md` を唯一の実装仕様とする。
//!
//! # 責務の境界（不可侵）
//!
//! ```text
//! DriverAI  --ControlInput-->  Vehicle  --forces-->  Physics  -->  VehicleState
//! ```
//!
//! - この crate は `sim-driver` を知らない。入力は [`ControlInput`] の値のみ
//! - **[`VehicleState`] を外部から書き換える経路は存在しない。** 状態を変えるのは
//!   [`Vehicle::step`] だけである
//! - この crate は `sim-track` に依存しない。路面は [`GroundProbe`] 経由で問い合わせる
//!   （`sim-core` が `sim-track` を使って実装する）。これにより平面上で単体テストできる
//!
//! # 物理の要点
//!
//! - 固定タイムステップ [`PHYSICS_DT`]（240 Hz）。車輪回転とタイヤ力のみ
//!   [`WHEEL_SUBSTEPS`] 分割して 960 Hz で解く
//! - ピッチ / ロール / 荷重移動は**代入しない**。サスペンション力の合力として創発する
//! - ロックアップも**判定を書かない**。ブレーキトルクで `spin -> 0` になった結果、
//!   スリップ比が `-1` へ漸近することで創発する
//! - 状態と積算はすべて `f64`。グローバル乱数・時刻依存乱数は使わない
//!
//! # 主要な型
//!
//! | 型 | 役割 |
//! |----|------|
//! | [`Vehicle`] | 車両本体。[`Vehicle::step`] が唯一の状態遷移 |
//! | [`ControlInput`] | ドライバーが生成できる操作のすべて |
//! | [`VehicleState`] / [`WheelState`] | 観測される状態 |
//! | [`VehicleParams`] | `assets/vehicles/*.spec.json` の物理側フィールド |
//! | [`GroundProbe`] / [`GroundHit`] | 路面の問い合わせ境界 |

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod aero;
pub mod ground;
pub mod input;
pub mod params;
pub mod powertrain;
pub mod state;
pub mod tyre;
pub mod vehicle;

pub use ground::{FlatGround, GroundHit, GroundProbe};
pub use input::ControlInput;
pub use params::{
    AeroParams, BrakeParams, Dimensions, DrivetrainLayout, DrivetrainParams, EngineParams,
    MassParams, SuspensionParams, TyreParams, TyreSize, VehicleParams, VehicleParamsError,
    VEHICLE_SCHEMA_VERSION,
};
pub use state::{VehicleState, WheelIndex, WheelState};
pub use vehicle::Vehicle;

/// 固定物理タイムステップ [s]。**可変 dt は受け取らない。**
pub const PHYSICS_DT: f64 = 1.0 / 240.0;

/// 車輪回転とタイヤ力のサブステップ分割数。実効 960 Hz。
///
/// 低速でのスリップ計算が最も不安定なため、ここだけ細かく刻む
/// （車体の剛体積分は [`PHYSICS_DT`] のまま）。
pub const WHEEL_SUBSTEPS: u32 = 4;

/// 重力加速度 [m/s^2]。
pub const GRAVITY: f64 = 9.806_65;

/// 空気密度 [kg/m^3]（海面上・15 degC）。
pub const AIR_DENSITY: f64 = 1.225;
