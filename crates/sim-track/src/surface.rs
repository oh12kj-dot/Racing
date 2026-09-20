//! 路面種別と物理特性。

/// 路面の種別。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum SurfaceKind {
    /// 舗装路面。
    Asphalt,
    /// 縁石。
    Kerb,
    /// 芝生。
    Grass,
    /// 砂利。
    Gravel,
    /// ピットレーン。
    PitLane,
}

/// 路面の物理特性。`sim-vehicle` が参照する。
#[derive(Clone, Copy, Debug)]
pub struct SurfaceProperties {
    /// グリップ係数の倍率。Asphalt を 1.0 とする。
    pub grip_multiplier: f64,
    /// 転がり抵抗係数。
    pub rolling_resistance: f64,
    /// 路面の粗さ [m]。サスペンションの励振に使う（本タスクでは値の保持のみ）。
    pub roughness: f64,
    /// この路面がコース内（track limits 内）とみなされるか。
    pub within_limits: bool,
}

impl SurfaceKind {
    /// 既定の物理特性。将来 TyreSystem / WeatherSystem が上書きする。
    pub fn properties(self) -> SurfaceProperties {
        match self {
            SurfaceKind::Asphalt => SurfaceProperties {
                grip_multiplier: 1.00,
                rolling_resistance: 0.012,
                roughness: 0.002,
                within_limits: true,
            },
            SurfaceKind::Kerb => SurfaceProperties {
                grip_multiplier: 0.90,
                rolling_resistance: 0.020,
                roughness: 0.030,
                within_limits: true,
            },
            SurfaceKind::Grass => SurfaceProperties {
                grip_multiplier: 0.45,
                rolling_resistance: 0.090,
                roughness: 0.020,
                within_limits: false,
            },
            SurfaceKind::Gravel => SurfaceProperties {
                grip_multiplier: 0.35,
                rolling_resistance: 0.250,
                roughness: 0.040,
                within_limits: false,
            },
            SurfaceKind::PitLane => SurfaceProperties {
                grip_multiplier: 0.95,
                rolling_resistance: 0.013,
                roughness: 0.002,
                within_limits: true,
            },
        }
    }
}
