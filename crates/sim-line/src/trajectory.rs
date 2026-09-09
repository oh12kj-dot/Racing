//! [`Trajectory`] — 走行軌跡。横位置 `t(s)` の C1 連続関数。

use crate::{Corridor, Stations};
use sim_math::{clamp, Vec3};
use sim_track::Track;

/// 走行軌跡の種類。`ARCHITECTURE.md` §4 の列挙に一致させる。
///
/// 本タスク（TASK-2-1）で生成できるのは [`TrajectoryKind::Reference`] のみ。
/// 残りは形式を後から変えないための予約。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrajectoryKind {
    /// 基準走行ライン（フリーエア）。
    Reference,
    /// 防御ライン。
    Defensive,
    /// 追い抜き（イン側）。
    OvertakeInside,
    /// 追い抜き（アウト側）。
    OvertakeOutside,
    /// ウェットライン。
    Wet,
    /// 復帰ライン（コースオフからの復帰）。
    Recovery,
    /// ピットイン。
    PitIn,
    /// ピットアウト。
    PitOut,
}

/// 走行軌跡。横位置 `t(s)` を C1 連続関数として返す。
///
/// 内部表現は等間隔ステーション上の `t` 値列で、評価は一様 Catmull-Rom
/// （C1 連続）で行う。曲率はセンターライン幾何と `t(s)` の微分から
/// **解析的に**評価してキャッシュする（数値 Menger 曲率とは独立）。
pub struct Trajectory {
    kind: TrajectoryKind,
    stations: Stations,
    closed: bool,
    /// 各ステーションの横オフセット `t` [m]。
    lateral: Vec<f64>,
    /// 各ステーションのトラジェクトリ符号付き曲率 [1/m]。
    curvature: Vec<f64>,
}

impl Trajectory {
    /// 基準線の反復緩和の最大スイープ数（安全上限。通常はこれより早く収束する）。
    const MAX_SWEEPS: u32 = 3000;
    /// 収束判定（1 スイープの最大更新量 [m]）。
    ///
    /// 2 mm。緩和は数百スイープで ~1 cm まで落ち、その後は長波長モードが
    /// サブ cm でゆっくり漂う。2 mm はレーシングラインの制御点として十分で、
    /// 下流（Speed Profile / Pure Pursuit）の他の誤差要因より小さい。
    const CONVERGE_M: f64 = 2.0e-3;
    /// SOR 加速係数（Gauss-Seidel-Newton に対する over-relaxation）。
    /// 4 階（biharmonic 型）作用素なので最適 ω は 2 に近い。
    const SOR_OMEGA: f64 = 1.95;
    /// 縁石からさらに内側に取るマージン [m]。
    const EDGE_MARGIN_M: f64 = 0.20;
    /// 反復緩和後の 3-tap 平滑化パス数（コリドー端の折れを丸める）。
    const SMOOTH_PASSES: u32 = 10;

    /// **基準走行ライン（Reference）を生成する。**
    ///
    /// [`Corridor::limit_bounds`]（縁石を使ってよい変種）の内側で、経路（ワールド点列）
    /// の曲率二乗和を最小化する `t(s)` を、Gauss-Seidel-Newton の反復緩和で求める。
    /// 各ステーションで
    /// `g_i = lateral_i · (D²P_{i-1} - 2 D²P_i + D²P_{i+1})`（目的関数の勾配の 1/2）、
    /// `D²P` はワールド点の 2 階中心差分。対角ヘッセ項は `6` なので
    /// `t_i ← clamp(t_i - g_i / 6, ...)`。閉トラックは周回境界を跨いで連続に扱う。
    ///
    /// アルゴリズムの選択理由は `TODO.md`（TASK-2-1 Deviations）に記録。
    pub fn reference(corridor: &Corridor, track: &Track, step_m: f64) -> Trajectory {
        let stations = Stations::new(track.length(), step_m);
        let n = stations.count;

        // センターライン幾何を先に固定。
        let s: Vec<f64> = (0..n).map(|i| stations.s_of(i)).collect();
        let pos: Vec<Vec3> = s.iter().map(|&si| track.frame_at(si).position).collect();
        let lat: Vec<Vec3> = s.iter().map(|&si| track.frame_at(si).lateral).collect();

        // コリドー境界（内側に EDGE_MARGIN_M）。
        let bounds: Vec<(f64, f64)> = s
            .iter()
            .map(|&si| {
                let (r, l) = corridor.limit_bounds(si);
                let r2 = r + Self::EDGE_MARGIN_M;
                let l2 = l - Self::EDGE_MARGIN_M;
                if r2 > l2 {
                    let mid = 0.5 * (r + l);
                    (mid, mid)
                } else {
                    (r2, l2)
                }
            })
            .collect();

        let idx = |i: isize| stations.wrap_index(i);
        let kappa_c: Vec<f64> = s.iter().map(|&si| track.frame_at(si).curvature).collect();

        // 初期値: センターライン。コーナー内側へ寄せる段差状の初期値は進入/脱出に
        // 折れを作り、早期停止すると曲率を悪化させるため使わない。
        let mut t = vec![0.0_f64; n];
        for i in 0..n {
            t[i] = clamp(0.0, bounds[i].0, bounds[i].1);
        }
        let world = |ti: f64, i: usize| pos[i] + lat[i] * ti;

        // ワールド点列とその 2 階中心差分（周期的）を保持し、Gauss-Seidel で
        // 各 `t_i` を更新するたびに影響を受ける 3 点を差分更新する。
        let mut p: Vec<Vec3> = (0..n).map(|i| world(t[i], i)).collect();
        let mut d2: Vec<Vec3> = (0..n)
            .map(|i| p[idx(i as isize - 1)] - p[i] * 2.0 + p[idx(i as isize + 1)])
            .collect();
        let recompute_d2 = |d2: &mut [Vec3], p: &[Vec3], k: isize| {
            let kk = idx(k);
            d2[kk] = p[idx(k - 1)] - p[kk] * 2.0 + p[idx(k + 1)];
        };

        for _sweep in 0..Self::MAX_SWEEPS {
            let mut max_delta = 0.0_f64;
            for i in 0..n {
                // 曲率二乗和 E = Σ|D²P|² の t_i に関する Newton ステップ。
                // ∂E/∂t_i = 2 lat_i·(D²P_{i-1} - 2 D²P_i + D²P_{i+1})、対角ヘッセ = 12。
                let g = lat[i].dot(d2[idx(i as isize - 1)] - d2[i] * 2.0 + d2[idx(i as isize + 1)]);
                let new_t = clamp(t[i] - Self::SOR_OMEGA * g / 6.0, bounds[i].0, bounds[i].1);
                max_delta = max_delta.max((new_t - t[i]).abs());
                if new_t != t[i] {
                    t[i] = new_t;
                    p[i] = world(new_t, i);
                    recompute_d2(&mut d2, &p, i as isize - 1);
                    recompute_d2(&mut d2, &p, i as isize);
                    recompute_d2(&mut d2, &p, i as isize + 1);
                }
            }
            if max_delta < Self::CONVERGE_M {
                break;
            }
        }

        // 反復緩和はコリドー端で `t` をハードクランプするため、ラインが縁石に
        // 接する / 離れる点にサブステーションの折れが残る（緩和曲線を持たない
        // センターラインと同じ問題。TASK-1A-5）。実ドライバーの操舵はレート制限
        // されているので、軽い 3-tap 平滑化を数パスかけて折れを丸める。
        // コリドー内には留める（再クランプ）。
        for _ in 0..Self::SMOOTH_PASSES {
            let prev = t.clone();
            for i in 0..n {
                let sm = 0.25 * prev[idx(i as isize - 1)]
                    + 0.5 * prev[i]
                    + 0.25 * prev[idx(i as isize + 1)];
                t[i] = clamp(sm, bounds[i].0, bounds[i].1);
            }
        }

        // 曲率を解析的に評価してキャッシュする。
        let h = stations.step;
        let mut curvature = vec![0.0_f64; n];
        for i in 0..n {
            let ip = idx(i as isize + 1);
            let im = idx(i as isize - 1);
            let t_p = (t[ip] - t[im]) / (2.0 * h); // dt/ds
            let t_pp = (t[ip] - 2.0 * t[i] + t[im]) / (h * h); // d²t/ds²
            let kc = kappa_c[i];
            let kc_p = (kappa_c[ip] - kappa_c[im]) / (2.0 * h); // dκ_c/ds
            let one_minus = 1.0 - kc * t[i];
            // r'  = (one_minus, t_p)          （T, N 成分）
            // r'' = (-kc_p·t - 2·kc·t_p,  kc·one_minus + t_pp)
            let rpp_t = -kc_p * t[i] - 2.0 * kc * t_p;
            let rpp_n = kc * one_minus + t_pp;
            let cross_z = one_minus * rpp_n - t_p * rpp_t;
            let speed2 = one_minus * one_minus + t_p * t_p;
            curvature[i] = cross_z / speed2.powf(1.5);
        }

        Trajectory {
            kind: TrajectoryKind::Reference,
            stations,
            closed: track.is_closed(),
            lateral: t,
            curvature,
        }
    }

    /// 軌跡の種類。
    pub fn kind(&self) -> TrajectoryKind {
        self.kind
    }

    /// トラック全長 [m]。
    pub fn length(&self) -> f64 {
        self.stations.length
    }

    /// 閉トラックか。
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// 横位置 `t` [m]。一様 Catmull-Rom（C1 連続）で評価する。
    pub fn t_at(&self, s: f64) -> f64 {
        let st = &self.stations;
        let s = st.wrap_s(s);
        let x = s / st.step;
        let i0 = x.floor() as isize;
        let f = x - i0 as f64;
        let p0 = self.lateral[st.wrap_index(i0 - 1)];
        let p1 = self.lateral[st.wrap_index(i0)];
        let p2 = self.lateral[st.wrap_index(i0 + 1)];
        let p3 = self.lateral[st.wrap_index(i0 + 2)];
        catmull_rom(p0, p1, p2, p3, f)
    }

    /// トラジェクトリの符号付き曲率 [1/m]（左カーブが正）。
    ///
    /// キャッシュした解析値の周期線形補間。
    pub fn curvature_at(&self, s: f64) -> f64 {
        self.stations.lerp_periodic(&self.curvature, s)
    }

    /// トラジェクトリ上のワールド座標。
    pub fn world_at(&self, s: f64, track: &Track) -> Vec3 {
        let f = track.frame_at(s);
        f.position + f.lateral * self.t_at(s)
    }
}

/// 一様 Catmull-Rom。`x` は `[0, 1]`、`p1`/`p2` が区間端。
#[inline]
fn catmull_rom(p0: f64, p1: f64, p2: f64, p3: f64, x: f64) -> f64 {
    let x2 = x * x;
    let x3 = x2 * x;
    0.5 * ((2.0 * p1)
        + (-p0 + p2) * x
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * x2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * x3)
}
