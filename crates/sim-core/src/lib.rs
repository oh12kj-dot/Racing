//! `sim-core` — トラック路面と固定タイムステップのシミュレーション本体。
//!
//! Phase 1A（[`sim_track`]）と Phase 1B（[`sim_vehicle`]）を繋ぐ層。
//! `sim-vehicle` は [`sim_vehicle::GroundProbe`] トレイトしか知らず、
//! `sim-track` は車を知らない。その 2 つをここで結線する。
//!
//! # 責務の境界
//!
//! - [`TrackGround`] が [`sim_track::Track`] を使って [`sim_vehicle::GroundProbe`] を実装する。
//!   `sim-vehicle` へは物理量（グリップ・転がり抵抗・粗さ・法線）だけを渡し、
//!   `SurfaceKind` は渡さない
//! - [`World`] が固定タイムステップでシミュレーションを進める。可変 `dt` は受け取らない
//! - この crate は Rendering / UI / Camera を知らない。乱数も持たない
//!
//! # ラップと順位（不可侵）
//!
//! - ラップ跨ぎの判定は [`sim_track::detect_lap_crossing`] に一本化する。
//!   自前の剰余計算をしない
//! - [`LapCrossing::Suspect`] のときはラップを加算しない
//! - 順位は `(laps_completed, s)` の辞書順のみで決まる。ワールド距離で並べない

#![deny(unsafe_code)]
#![warn(missing_docs)]

mod ground;
mod racing_line;
pub mod rng;
mod world;

pub use ground::TrackGround;
pub use racing_line::RacingLine;
pub use world::{VehicleEntry, VehicleId, World, WorldError, LAP_MAX_DS};

// 下流が同じ型で会話できるよう、依存 crate の主要型を再エクスポートする。
pub use sim_driver::{Driver, DriverMode, DriverModel, DriverModelError, SIM_DT};
pub use sim_line::{Corridor, SpeedProfile, Trajectory};
pub use sim_track::{LapCrossing, Track, TrackCoord, TrackFrame};
pub use sim_vehicle::{ControlInput, GroundHit, GroundProbe, Vehicle, VehicleParams, PHYSICS_DT};
