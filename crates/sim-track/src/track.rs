//! トラック本体。Track Coordinate System の実装。

use crate::coord::{TrackCoord, TrackFrame};
use crate::definition::{CrossSection, TrackDefinition, TrackError};
use crate::surface::SurfaceKind;
use sim_math::{clamp, lerp, ArcLengthSpline, CubicSpline, Quat, Vec3, EPSILON};

/// 曲率の符号を決めるための、接線変化を見る微小弧長オフセット [m]。
const CURVATURE_SIGN_EPS: f64 = 0.05;

/// 断面パラメータを `s` で補間した結果。
struct SectionSample {
    width_left: f64,
    width_right: f64,
    banking: f64,
    camber: f64,
    kerb_left: f64,
    kerb_right: f64,
    runoff: SurfaceKind,
}

/// `control_s`（昇順）上で `s` を挟む区間 `(a, b, f)` を求める。
/// `b` は `a` の次の制御点（閉曲線かつ最終制御点の場合は 0 へ巡回）。
fn section_bracket(control_s: &[f64], closed: bool, length: f64, s: f64) -> (usize, usize, f64) {
    let n = control_s.len();
    let mut lo = 0usize;
    let mut hi = n - 1;
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if control_s[mid] <= s {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    let i = lo;
    if i + 1 < n {
        let span = control_s[i + 1] - control_s[i];
        let f = if span > EPSILON {
            (s - control_s[i]) / span
        } else {
            0.0
        };
        (i, i + 1, f)
    } else if closed {
        let span = length - control_s[i];
        let f = if span > EPSILON {
            (s - control_s[i]) / span
        } else {
            0.0
        };
        (i, 0, f)
    } else {
        (i, i, 0.0)
    }
}

/// `s` における断面パラメータを線形補間で求める。
fn section_at(
    sections: &[CrossSection],
    control_s: &[f64],
    closed: bool,
    length: f64,
    s: f64,
) -> SectionSample {
    let (a, b, f) = section_bracket(control_s, closed, length, s);
    let sa = sections[a];
    let sb = sections[b];
    SectionSample {
        width_left: lerp(sa.width_left, sb.width_left, f),
        width_right: lerp(sa.width_right, sb.width_right, f),
        banking: lerp(sa.banking, sb.banking, f),
        camber: lerp(sa.camber, sb.camber, f),
        kerb_left: lerp(sa.kerb_left, sb.kerb_left, f),
        kerb_right: lerp(sa.kerb_right, sb.kerb_right, f),
        runoff: if f < 0.5 { sa.runoff } else { sb.runoff },
    }
}

/// トラック。Track Coordinate System の本体。
///
/// [`TrackDefinition`] から構築し、以降のレースロジックはすべて
/// この上のトラック局所座標（[`TrackCoord`]）で行う。
pub struct Track {
    name: String,
    closed: bool,
    length: f64,
    centerline: ArcLengthSpline,
    control_s: Vec<f64>,
    sections: Vec<CrossSection>,
    sector_boundaries: Vec<f64>,
    start_finish_s: f64,

    // フレームテーブル（`FRAME_SPACING_M` 間隔、SoA）。
    frame_s: Vec<f64>,
    frame_pos: Vec<Vec3>,
    frame_tangent: Vec<Vec3>,
    // `frame_normal` は保持しない: `normal` は常に `tangent.cross(lateral)` から
    // 構成する（M-1 修正）。独立に補間・保持すると直交性が近似になってしまう。
    frame_lateral: Vec<Vec3>,
    frame_curvature: Vec<f64>,
    frame_banking: Vec<f64>,
    frame_camber: Vec<f64>,
    frame_width_left: Vec<f64>,
    frame_width_right: Vec<f64>,
}

impl Track {
    /// フレームテーブルのサンプル間隔 [m]。
    pub const FRAME_SPACING_M: f64 = 0.5;

    /// 定義から構築する。フレームテーブルを事前計算する。
    pub fn build(def: &TrackDefinition) -> Result<Track, TrackError> {
        let n = def.centerline.len();
        if def.sections.len() != n {
            return Err(TrackError::SectionCountMismatch {
                centerline: n,
                sections: def.sections.len(),
            });
        }
        for (i, sec) in def.sections.iter().enumerate() {
            if sec.width_left <= 0.0 || sec.width_right <= 0.0 {
                return Err(TrackError::NonPositiveWidth { index: i });
            }
        }
        {
            let mut prev = 0.0f64;
            for &x in &def.sector_splits {
                if !(x > 0.0 && x < 1.0) || x <= prev {
                    return Err(TrackError::InvalidSectorSplits);
                }
                prev = x;
            }
        }
        if !(def.start_finish >= 0.0 && def.start_finish < 1.0) {
            return Err(TrackError::InvalidStartFinish);
        }

        let cubic = CubicSpline::new(&def.centerline, def.closed).map_err(TrackError::Spline)?;
        let centerline = ArcLengthSpline::with_default_samples(cubic);
        let length = centerline.total_length();
        let closed = centerline.is_closed();

        let control_s: Vec<f64> = (0..n).map(|i| centerline.control_point_s(i)).collect();
        let sections = def.sections.clone();

        let sector_boundaries: Vec<f64> = def.sector_splits.iter().map(|f| f * length).collect();
        let start_finish_s = def.start_finish * length;

        let spacing = Self::FRAME_SPACING_M;
        let n_steps = (length / spacing).ceil() as usize;
        let num_frames = n_steps + 1;

        let mut frame_s = Vec::with_capacity(num_frames);
        let mut frame_pos = Vec::with_capacity(num_frames);
        let mut frame_tangent = Vec::with_capacity(num_frames);
        let mut frame_lateral = Vec::with_capacity(num_frames);
        let mut frame_curvature = Vec::with_capacity(num_frames);
        let mut frame_banking = Vec::with_capacity(num_frames);
        let mut frame_camber = Vec::with_capacity(num_frames);
        let mut frame_width_left = Vec::with_capacity(num_frames);
        let mut frame_width_right = Vec::with_capacity(num_frames);

        for i in 0..num_frames {
            let raw_s = if i == n_steps {
                length
            } else {
                i as f64 * spacing
            };
            let eval_s = if closed {
                centerline.wrap_s(raw_s)
            } else {
                clamp(raw_s, 0.0, length)
            };

            let (position, tangent) = centerline.pose_at(eval_s);
            let curvature_mag = centerline.curvature_at(eval_s);

            let sign = {
                let s_minus = centerline.wrap_s(eval_s - CURVATURE_SIGN_EPS);
                let s_plus = centerline.wrap_s(eval_s + CURVATURE_SIGN_EPS);
                let t_minus = centerline.tangent_at(s_minus);
                let t_plus = centerline.tangent_at(s_plus);
                let diff = t_plus.xz() - t_minus.xz();
                // TODO.md (corrected, credited to this implementation's review):
                // `sign = +1 if d(tangent)/ds.xz().perp_dot(tangent.xz()) > 0`.
                // `lateral = up.cross(tangent)` is the opposite handedness from the
                // standard CCW "left normal" convention, so the operand order here
                // is `diff.perp_dot(tangent)`, not `tangent.perp_dot(diff)`.
                if diff.perp_dot(tangent.xz()) > 0.0 {
                    1.0
                } else {
                    -1.0
                }
            };
            let curvature = sign * curvature_mag;

            let sec = section_at(&sections, &control_s, closed, length, eval_s);

            // `normal` はここでは保持しない。`frame_at` が常に
            // `tangent.cross(lateral)` から構成する（直交性の構造的保証。M-1 修正）。
            let up = Vec3::Y;
            let lateral_flat = up.cross(tangent).normalize();
            let bank_rot = Quat::from_axis_angle(tangent, sec.banking);
            let lateral = bank_rot.rotate_vec3(lateral_flat).normalize();

            frame_s.push(raw_s);
            frame_pos.push(position);
            frame_tangent.push(tangent);
            frame_lateral.push(lateral);
            frame_curvature.push(curvature);
            frame_banking.push(sec.banking);
            frame_camber.push(sec.camber);
            frame_width_left.push(sec.width_left);
            frame_width_right.push(sec.width_right);
        }

        Ok(Track {
            name: def.name.clone(),
            closed,
            length,
            centerline,
            control_s,
            sections,
            sector_boundaries,
            start_finish_s,
            frame_s,
            frame_pos,
            frame_tangent,
            frame_lateral,
            frame_curvature,
            frame_banking,
            frame_camber,
            frame_width_left,
            frame_width_right,
        })
    }

    /// トラック名。
    #[inline]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// 全長 [m]。
    #[inline]
    pub fn length(&self) -> f64 {
        self.length
    }

    /// 閉曲線か。
    #[inline]
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// フレームテーブル上で `s` を挟む区間 `(i, i+1, f)` を求める。
    fn frame_bracket(&self, s: f64) -> (usize, usize, f64) {
        let n = self.frame_s.len();
        if n < 2 {
            return (0, 0, 0.0);
        }
        let spacing = Self::FRAME_SPACING_M;
        let raw_idx = (s / spacing).floor();
        let mut idx = if raw_idx.is_finite() && raw_idx > 0.0 {
            raw_idx as usize
        } else {
            0
        };
        if idx > n - 2 {
            idx = n - 2;
        }
        while idx + 1 < n - 1 && self.frame_s[idx + 1] < s {
            idx += 1;
        }
        while idx > 0 && self.frame_s[idx] > s {
            idx -= 1;
        }
        let span = self.frame_s[idx + 1] - self.frame_s[idx];
        let f = if span > EPSILON {
            (s - self.frame_s[idx]) / span
        } else {
            0.0
        };
        (idx, idx + 1, f)
    }

    /// `s` における幾何フレーム。事前計算テーブルの線形補間で O(1)。
    pub fn frame_at(&self, s: f64) -> TrackFrame {
        let s = self.wrap_s(s);
        let (i, j, f) = self.frame_bracket(s);

        let position = self.frame_pos[i].lerp(self.frame_pos[j], f);
        // 独立に lerp + normalize すると、フレーム間の変換が複合回転
        // （バンク角の変化や標高変化による 3D のねじれ）のとき直交性が
        // 保たれない。Gram-Schmidt で明示的に直交化し、`normal` は
        // 外積から構成することで直交性を近似ではなく構造的に保証する。
        let tangent = self.frame_tangent[i]
            .lerp(self.frame_tangent[j], f)
            .normalize();
        let lateral_lerp = self.frame_lateral[i].lerp(self.frame_lateral[j], f);
        let lateral = (lateral_lerp - tangent * lateral_lerp.dot(tangent)).normalize();
        let normal = tangent.cross(lateral);
        let curvature = lerp(self.frame_curvature[i], self.frame_curvature[j], f);
        let banking = lerp(self.frame_banking[i], self.frame_banking[j], f);
        let camber = lerp(self.frame_camber[i], self.frame_camber[j], f);
        let width_left = lerp(self.frame_width_left[i], self.frame_width_left[j], f);
        let width_right = lerp(self.frame_width_right[i], self.frame_width_right[j], f);

        TrackFrame {
            position,
            tangent,
            normal,
            lateral,
            curvature,
            banking,
            camber,
            elevation: position.y,
            width_left,
            width_right,
        }
    }

    /// トラック座標 -> ワールド座標。
    /// `position(s) + lateral(s) * t`（バンクにより t に応じて標高も変わる）。
    pub fn track_to_world(&self, c: TrackCoord) -> Vec3 {
        let f = self.frame_at(c.s);
        f.position + f.lateral * c.t
    }

    /// ワールド座標 -> トラック座標。
    /// `hint` に前 tick の `s` を渡すこと（毎 tick 全車で呼ばれる）。
    pub fn world_to_track(&self, p: Vec3, hint: Option<f64>) -> TrackCoord {
        let mut s = self.centerline.closest_s(p, hint);
        let max_step = Self::FRAME_SPACING_M * 8.0;
        for _ in 0..8 {
            let f = self.frame_at(s);
            let g = (f.position - p).dot(f.tangent);
            if g.abs() <= 1.0e-9 {
                break;
            }
            // PDC-10（Opus 2026-09-26）: 真のヤコビアン `g'(s) = 1 - κ·t` で割る。
            // 旧実装は `g' ≈ 1`（センターライン近傍でのみ妥当）で、急コーナーの**外側**
            // （左カーブ κ > 0 で t < 0 など、κ·t < 0）では反復の誤差倍率が `|κ·t|` になり、
            // `|t| > R`（ヘアピン R≈13〜19 m の外 20 m 超）で発散・振動していた（再埋め込み誤差
            // 0.6〜12 m・`TrackGround` の接地平面が車輪ごとに食い違い 4 輪中 0〜1 輪しか接地しない）。
            // 内側で曲率中心に近づく（κ·t → 1）と `g'` → 0 で不定になるので下限 0.2 で抑える
            // （方向は正しいまま歩幅が小さくなるだけ。粗探索 + `max_step` の外枠は従来どおり）。
            let t_est = (p - f.position).dot(f.lateral);
            let jac = (1.0 - f.curvature * t_est).max(0.2);
            s = self.wrap_s(s + clamp(-g / jac, -max_step, max_step));
        }
        let f = self.frame_at(s);
        let t = (p - f.position).dot(f.lateral);
        TrackCoord::new(s, t)
    }

    /// `s` を `[0, length)` へ正規化する。ラップ処理は必ずこれを通す。
    #[inline]
    pub fn wrap_s(&self, s: f64) -> f64 {
        self.centerline.wrap_s(s)
    }

    /// 符号付き最短距離 `(-L/2, L/2]`。車間・前後判定は必ずこれを使う。
    #[inline]
    pub fn signed_delta_s(&self, from_s: f64, to_s: f64) -> f64 {
        self.centerline.signed_delta_s(from_s, to_s)
    }

    /// 与えられたトラック座標の路面種別。
    pub fn surface_at(&self, c: TrackCoord) -> SurfaceKind {
        let s = self.wrap_s(c.s);
        let sec = section_at(&self.sections, &self.control_s, self.closed, self.length, s);
        if c.t >= 0.0 {
            if c.t <= sec.width_left {
                SurfaceKind::Asphalt
            } else if c.t <= sec.width_left + sec.kerb_left {
                SurfaceKind::Kerb
            } else {
                sec.runoff
            }
        } else {
            let at = -c.t;
            if at <= sec.width_right {
                SurfaceKind::Asphalt
            } else if at <= sec.width_right + sec.kerb_right {
                SurfaceKind::Kerb
            } else {
                sec.runoff
            }
        }
    }

    /// track limits 内か（縁石は内側とみなす）。
    pub fn is_within_limits(&self, c: TrackCoord) -> bool {
        self.surface_at(c).properties().within_limits
    }

    /// `s` が属するセクター番号（0 始まり）。
    pub fn sector_of(&self, s: f64) -> usize {
        let s = self.wrap_s(s);
        self.sector_boundaries.iter().filter(|&&b| s >= b).count()
    }

    /// セクター境界の `s` 値（昇順、要素数 = セクター数 - 1）。
    #[inline]
    pub fn sector_boundaries(&self) -> &[f64] {
        &self.sector_boundaries
    }

    /// スタート/フィニッシュラインの `s`。
    #[inline]
    pub fn start_finish_s(&self) -> f64 {
        self.start_finish_s
    }
}
