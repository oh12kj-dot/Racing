//! [`RacingLine`] — [`Corridor`] / [`Trajectory`] / [`SpeedProfile`] を 1 つの値として束ねる。
//!
//! `Track` と `VehicleParams` から**決定的**に導出される（乱数なし・時刻なし）。
//! [`World`](crate::World) には**生成済み**の `RacingLine` を渡す
//! （`HANDOFF.md` §5 sim-line「`reference` の生成は起動時 1 回」）。
//! `RacingLine::generate` は `World::step_sim_tick` の経路からは呼ばれない。

use sim_line::{Corridor, PerformanceEnvelope, SpeedProfile, Trajectory};
use sim_track::Track;
use sim_vehicle::VehicleParams;

/// [`PerformanceEnvelope::mu`] を補正するときに仮定するタイヤ荷重比 `Fz / Fz_nominal`。
///
/// TASK-2-3 PDC-4（Architect 承認 2026-09-09）。`PerformanceEnvelope::from_params` は
/// `mu = tyre.mu0` を**荷重感度なし**で写すが、`sim-vehicle` の実タイヤは
/// `mu = mu0 / (1 + LS·(Fz/Fz_nominal − 1))` で、ダウンフォースで `Fz` が増える高速
/// コーナーでは実効 μ が 20% ほど下がる。SpeedProfile の限界速度がその分楽観的になり、
/// T2（R125・55 m/s）で要求横 G がタイヤの能力を超えて曲がりきれなかった。
/// ここで荷重比を一律 `1.5`（≒ 中高速コーナーのリア外輪相当）と仮定して μ を割り引く。
/// **これは近似**であり、恒久対応（`from_params` 自体を荷重感度対応にする）は TASK-2-4 候補。
const LOAD_RATIO_REF: f64 = 1.5;

/// 走行計画一式。`Track` と `VehicleParams` から決定的に導出される（乱数なし）。
///
/// **不変**。`&mut self` を取る公開メソッドは無い。
pub struct RacingLine {
    corridor: Corridor,
    trajectory: Trajectory,
    speed: SpeedProfile,
}

impl RacingLine {
    /// 既定のサンプル間隔 [m]。TASK-2-1 の生成品質を再現する値。
    pub const DEFAULT_STEP_M: f64 = 2.0;
    /// 白線に対して残す安全マージン [m]（白線の塗り幅 + 縁石への寄り過ぎ防止）。
    pub const DEFAULT_SAFETY_M: f64 = 0.15;

    /// `Track` と `VehicleParams` から走行計画一式を生成する。
    ///
    /// `step_m` は正の有限値。非有限 / 非正なら [`RacingLine::DEFAULT_STEP_M`] を使う。
    ///
    /// 生成順序（変えない）:
    /// [`Corridor::from_track`] → [`Trajectory::reference`] →
    /// [`PerformanceEnvelope::from_params`] → [`SpeedProfile::generate`]。
    ///
    /// Phase 2 は全車が同一スペック（`gt_proto_a`）なので `SpeedProfile` は 1 本を
    /// 共有してよい。**車種別プロファイルは Phase 3 以降の課題**であり、ここでは作らない。
    pub fn generate(track: &Track, params: &VehicleParams, step_m: f64) -> RacingLine {
        let step_m = if step_m.is_finite() && step_m > 0.0 {
            step_m
        } else {
            Self::DEFAULT_STEP_M
        };
        let car_half_width = 0.5 * params.dimensions.width;

        let corridor = Corridor::from_track(track, step_m, car_half_width, Self::DEFAULT_SAFETY_M);
        let trajectory = Trajectory::reference(&corridor, track, step_m);

        // PDC-4: 荷重感度で割り引いた実効 μ に差し替える（`PerformanceEnvelope` は
        // 公開フィールドのプレーンなデータ構造。`mu` の上書きは API 変更ではない）。
        let mut envelope = PerformanceEnvelope::from_params(params);
        let ls = params.tyre.load_sensitivity;
        envelope.mu = params.tyre.mu0 / (1.0 + ls * (LOAD_RATIO_REF - 1.0));

        let speed = SpeedProfile::generate(&trajectory, track, &envelope, step_m);

        RacingLine {
            corridor,
            trajectory,
            speed,
        }
    }

    /// 走行可能域。
    #[inline]
    pub fn corridor(&self) -> &Corridor {
        &self.corridor
    }

    /// 目標トラジェクトリ（基準走行ライン）。
    #[inline]
    pub fn trajectory(&self) -> &Trajectory {
        &self.trajectory
    }

    /// 速度プロファイル。
    #[inline]
    pub fn speed_profile(&self) -> &SpeedProfile {
        &self.speed
    }
}
