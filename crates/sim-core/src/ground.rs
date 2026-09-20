//! [`sim_track::Track`] を使う [`GroundProbe`] 実装。

use sim_math::Vec3;
use sim_track::Track;
use sim_vehicle::{GroundHit, GroundProbe};

/// トラックの路面を [`GroundProbe`] として提供する。
///
/// [`sim_vehicle::Vehicle::step`] は毎 tick・全車輪でこれを呼ぶ。
/// `sim_track::Track::world_to_track` はヒント有で ~579 ns / 無で ~3.8 us なので、
/// **[`TrackGround::set_hint`] を毎 tick 更新すること**。
pub struct TrackGround<'a> {
    track: &'a Track,
    /// 直近に判っている `s`。`world_to_track` の探索開始点。
    hint: Option<f64>,
}

impl<'a> TrackGround<'a> {
    /// トラックを借りて構築する。ヒント未設定の状態で始まる。
    pub fn new(track: &'a Track) -> Self {
        TrackGround { track, hint: None }
    }

    /// 参照しているトラック。
    #[inline]
    pub fn track(&self) -> &Track {
        self.track
    }

    /// 前 tick の `s` を探索ヒントとして与える。**毎 tick 更新すること。**
    #[inline]
    pub fn set_hint(&mut self, s: f64) {
        self.hint = Some(s);
    }

    /// 現在のヒント。
    #[inline]
    pub fn hint(&self) -> Option<f64> {
        self.hint
    }
}

impl GroundProbe for TrackGround<'_> {
    fn probe(&self, from: Vec3, max_distance: f64) -> Option<GroundHit> {
        if !from.is_finite() || !max_distance.is_finite() {
            return None;
        }

        // GroundProbe の契約は「`from` から鉛直下方へ探索」（FlatGround と同じ）。
        // 路面は s における平面（点 frame.position、法線 frame.normal）で近似する
        // （camber は sim-track では幾何に未適用なので使わない）。鉛直線
        // x = from.x, z = from.z とこの平面の交点は
        //   (from - P)·n + drop·(-Y·n) = 0  =>  drop = ((from - P)·n) / n.y
        // で、接地点は (from.x, from.y - drop, from.z)。
        //
        // ここで `world_to_track` は接線に直交する平面へ落とすため、路面に勾配が
        // あると `from`（路面から鉛直に持ち上げた点）の投影先 s は真の接地点の s から
        // 勾配ぶんだけずれる。1 回目で接地高さ付近まで下ろした点で `world_to_track` を
        // 引き直すと、鉛直成分がほぼ消えてこのずれが二次以下になる。センターライン
        // 近傍では 2 反復で 1e-9 未満に収まる。高曲率かつ大 |t|（ヘアピン外縁の
        // |t| ≈ 6 m など）では上限 4 回に達し、残差は 1e-8 m オーダー
        // （static_compression の 2e-6 倍。物理的に無害）。未収束でも直近 station の
        // 平面との厳密な鉛直交点を返すので破綻しない。
        let mut guess = from;
        let mut coord = self.track.world_to_track(guess, self.hint);
        let mut drop = 0.0;
        // 上限 4 回。発散経路は無いが、未収束でも必ず終了させる。
        for _ in 0..4 {
            let frame = self.track.frame_at(coord.s);
            let n = frame.normal;
            // 法線がほぼ水平だと鉛直線と交わらない（数値的にも発散する）。
            if n.y.abs() < 1.0e-6 {
                return None;
            }
            drop = (from - frame.position).dot(n) / n.y;
            if !drop.is_finite() {
                return None;
            }
            let next_y = from.y - drop;
            let converged = (next_y - guess.y).abs() < 1.0e-12;
            guess = Vec3::new(from.x, next_y, from.z);
            if converged {
                break;
            }
            coord = self.track.world_to_track(guess, Some(coord.s));
        }

        if drop > max_distance {
            return None;
        }
        // 探索は鉛直方向（FlatGround と同じ規約）。路面下でも接地扱いにする。
        let point = guess;
        // surface_at / normal は収束後の coord.s の frame から取る。
        let frame = self.track.frame_at(coord.s);

        // 種別ではなく物理量を渡す。SurfaceKind::properties() から詰め替える。
        let props = self.track.surface_at(coord).properties();

        Some(GroundHit {
            // TrackFrame は Gram-Schmidt 済みの正規直交基底。法線をそのまま使う
            // （自前で作り直すと直交性が近似になる）。
            point,
            normal: frame.normal,
            grip: props.grip_multiplier,
            rolling_resistance: props.rolling_resistance,
            roughness: props.roughness,
        })
    }
}
