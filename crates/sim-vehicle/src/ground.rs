//! 路面の問い合わせ境界。
//!
//! `sim-vehicle` はサスペンションの接地判定のために路面を必要とするが、
//! `sim-track` へは依存させない（`docs/phase-1b-vehicle.md`「責務の境界」）。
//! 代わりに [`GroundProbe`] をここで定義し、`sim-core` が `sim-track` を使って実装する。
//!
//! 1. `sim-vehicle` を平面上で単体テストできる（トラック定義なしで T-VEH-01〜14 が回る）
//! 2. 将来 UE5 の物理シーンや別の路面表現へ差し替えられる
//! 3. 依存グラフに循環が生じない

use sim_math::Vec3;

/// 接地点の情報。
///
/// **路面の「種別」ではなく物理量を渡す**ことで、`sim-vehicle` が `SurfaceKind` を
/// 知らずに済む。`sim-core` が `SurfaceKind::properties()` からここへ詰め替える。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GroundHit {
    /// 接地点のワールド座標。
    pub point: Vec3,
    /// 路面法線（単位ベクトル）。
    pub normal: Vec3,
    /// グリップ倍率。アスファルトを 1.0 とする。
    pub grip: f64,
    /// 転がり抵抗係数。
    pub rolling_resistance: f64,
    /// 路面の粗さ [m]。サスペンションの励振に使う（Phase 1B では保持のみ）。
    pub roughness: f64,
}

/// 路面の問い合わせ。`sim-core` が `sim-track` を使って実装する。
pub trait GroundProbe {
    /// `from` から**鉛直下方**へ最大 `max_distance` [m] 探索する。
    ///
    /// 見つからなければ `None`（= 接地なし。タイヤ力も荷重もゼロになる）。
    fn probe(&self, from: Vec3, max_distance: f64) -> Option<GroundHit>;
}

/// 高さ一定の水平面。単体テストと、路面が未接続のときのフォールバックに使う。
#[derive(Clone, Copy, Debug)]
pub struct FlatGround {
    /// 路面の高さ [m]（ワールド `y`）。
    pub height: f64,
    /// グリップ倍率。
    pub grip: f64,
    /// 転がり抵抗係数。
    pub rolling_resistance: f64,
    /// 路面の粗さ [m]。
    pub roughness: f64,
}

impl FlatGround {
    /// アスファルト相当（`SurfaceKind::Asphalt` の既定値と一致させてある）の水平面。
    pub fn asphalt(height: f64) -> Self {
        FlatGround {
            height,
            grip: 1.0,
            rolling_resistance: 0.012,
            roughness: 0.002,
        }
    }
}

impl Default for FlatGround {
    fn default() -> Self {
        FlatGround::asphalt(0.0)
    }
}

impl GroundProbe for FlatGround {
    fn probe(&self, from: Vec3, max_distance: f64) -> Option<GroundHit> {
        let drop = from.y - self.height;
        if !(drop.is_finite() && max_distance.is_finite()) || drop > max_distance {
            return None;
        }
        Some(GroundHit {
            point: Vec3::new(from.x, self.height, from.z),
            normal: Vec3::Y,
            grip: self.grip,
            rolling_resistance: self.rolling_resistance,
            roughness: self.roughness,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flat_ground_reports_hit_within_range() {
        let g = FlatGround::asphalt(0.0);
        let hit = g.probe(Vec3::new(1.0, 0.4, 2.0), 1.0).expect("should hit");
        assert_eq!(hit.point, Vec3::new(1.0, 0.0, 2.0));
        assert_eq!(hit.normal, Vec3::Y);
    }

    #[test]
    fn flat_ground_reports_miss_beyond_range() {
        let g = FlatGround::asphalt(0.0);
        assert!(g.probe(Vec3::new(0.0, 5.0, 0.0), 1.0).is_none());
    }

    #[test]
    fn flat_ground_hits_when_below_surface() {
        // 路面下に潜ったときも接地として扱う（サスが押し戻す）。
        let g = FlatGround::asphalt(0.0);
        assert!(g.probe(Vec3::new(0.0, -0.2, 0.0), 1.0).is_some());
    }
}
