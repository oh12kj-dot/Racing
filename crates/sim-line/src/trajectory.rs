//! [`Trajectory`] — 走行軌跡。横位置 `t(s)` の C1 連続関数。

use crate::{Corridor, Stations};
use sim_math::Vec3;
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
    /// 基準線がここより白線に近づいてはならない距離 [m]。**求解の箱制約を
    /// [`Corridor::white_bounds`] からこれだけ内側へ寄せる**ことで確保する
    /// （目的関数へペナルティは足さない）。
    ///
    /// [`Corridor`] のクランプ・防御ライン・追い越しラインの逸脱余地を残すための契約値
    /// （T-DRV-03。`= 0` だと基準線が白線にベタ付けして Phase 2/3 の前提が壊れる）。
    /// アクティブセットが箱制約を厳密に扱うので T-LINE-14 は**定義により**満たされる。
    ///
    /// **正則化ペナルティ（`λ·Σ(t/hw)²`）は使わない。** 一様な中心引力は曲率に依存しない
    /// ため、幅使用による κ² の利得が大きい高速コーナー（大 R）から先にレーシングラインを
    /// 壊す（実測: R130/R125 で幅使用 12〜16%）。マージンが欲しければ目的関数ではなく
    /// 箱を内側へ寄せる（Architect Round-4 監査）。
    pub const REF_MARGIN_M: f64 = 0.30;
    /// アクティブセット反復の上限（凸箱制約 QP）。
    const MAX_ACTIVE_SET_ITERS: u32 = 4000;
    /// 制約の実行可能性の許容 [m]。
    const FEAS_TOL_M: f64 = 1.0e-9;
    /// KKT（クランプ点の勾配符号）判定の許容。
    const KKT_TOL: f64 = 1.0e-7;

    /// **基準走行ライン（Reference）を生成する。**
    ///
    /// 求解領域は [`Corridor::white_bounds`] を [`Self::REF_MARGIN_M`] だけ内側へ寄せた箱。
    /// その中で経路（ワールド点列）の曲率二乗和 `E = Σ|D²P_i|²` を最小化する `t(s)` を求める。
    /// `P_i = pos_i + t_i·lateral_i` は `t` について affine なので `E` は **`t` について厳密に
    /// 二次形式**、勾配は線形。系は周期 5 重対角の SPD 線形システム（`[1,-4,6,-4,1]`
    /// biharmonic ステンシルを `lateral_i` の向き変化込みで組んだもの・帯幅 2）で、
    /// **直接解法**で `O(n)`・機械精度で解ける（TASK-2-4 Phase 1・Architect 起票）。
    /// 反復緩和は biharmonic の条件数 `~n⁴` により長波長モードで `ρ ≈ 1 − 2×10⁻⁷` となり
    /// 収束しない（旧実装のリップルの正体）。
    ///
    /// 周期性は border-elimination + 4×4 Schur、白線の箱制約は primal アクティブセットで解く。
    /// アルゴリズムの選択理由は `TODO.md`（TASK-2-1 / TASK-2-4 Phase 1）に記録。
    pub fn reference(corridor: &Corridor, track: &Track, step_m: f64) -> Trajectory {
        let ReferenceSystem {
            stations,
            d0,
            d1,
            d2,
            rhs,
            bounds,
        } = assemble_reference_system(corridor, track, step_m);
        let n = stations.count;
        let t = solve_box_qp(n, &d0, &d1, &d2, &rhs, &bounds, &stations).0;

        // 曲率評価にはセンターライン幾何が要る（系の組み立てとは独立に読み直す）。
        let idx = |i: isize| stations.wrap_index(i);
        let kappa_c: Vec<f64> = (0..n)
            .map(|i| track.frame_at(stations.s_of(i)).curvature)
            .collect();

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

    /// **テスト専用**（T-LINE-12 KKT 残差）。`(自由点での max|g_i|, クランプ点の内向き勾配の
    /// 最悪値, アクティブセット反復回数, クランプ点数)` を返す。自由点の勾配が機械精度なら
    /// 「厳密最小化子である」証明。
    #[doc(hidden)]
    pub fn reference_kkt_for_test(
        corridor: &Corridor,
        track: &Track,
        step_m: f64,
    ) -> (f64, f64, u32, usize) {
        // `reference` と **同一の** `assemble_reference_system` を呼ぶ。ここで系を組み直すと
        // 「テストは reference が解く系のコピーを解いている」ことしか証明できない（Architect
        // MEDIUM-3。両者の唯一の組み立て箇所を共有することで KKT 証明の循環を断つ）。
        let ReferenceSystem {
            stations,
            d0,
            d1,
            d2,
            rhs,
            bounds,
        } = assemble_reference_system(corridor, track, step_m);
        let (_, diag) = solve_box_qp(stations.count, &d0, &d1, &d2, &rhs, &bounds, &stations);
        (
            diag.max_free_grad,
            diag.worst_inward_clamp,
            diag.iters,
            diag.n_clamped,
        )
    }
}

/// 基準線の求解系（[`assemble_reference_system`] の出力）。`A t = -c` の周期 5 重対角
/// 対角 `d0/d1/d2`、右辺 `rhs`、白線の箱制約 `bounds`。
struct ReferenceSystem {
    stations: Stations,
    /// A の主対角（`6·lat_i·lat_i`）。
    d0: Vec<f64>,
    /// A の ±1 対角（`-4·lat_i·lat_{i+1}`）。
    d1: Vec<f64>,
    /// A の ±2 対角（`lat_i·lat_{i+2}`）。
    d2: Vec<f64>,
    /// 右辺 `-c_j`。
    rhs: Vec<f64>,
    /// 各ステーションの `(lo, hi)`（白線内側 − マージン）。
    bounds: Vec<(f64, f64)>,
}

/// 基準線の求解系 `A t = -c`（対角 `d0/d1/d2`・右辺 `rhs`）と白線の箱制約 `bounds` を組む。
///
/// **`Trajectory::reference` と `Trajectory::reference_kkt_for_test` の唯一の組み立て箇所。**
/// 両者が構造的に同一の系を解くことを保証する（Architect MEDIUM-3）。
///
/// - `A_{j,k} = (lat_j·lat_k)·w_{j,k}`、`w` は周期 biharmonic ステンシル `[1,-4,6,-4,1]`。
/// - `c_j = lat_j·(pos_{j-2} - 4 pos_{j-1} + 6 pos_j - 4 pos_{j+1} + pos_{j+2})`。
/// - `bounds[i]` は [`Corridor::white_bounds`] を [`Trajectory::REF_MARGIN_M`] だけ内側へ寄せた箱。
///   白線内側が `2·REF_MARGIN_M` より狭いと潰れて 1 点 `(mid, mid)`（等式制約）になる。
///
/// `step_m` は `n >= 8` になるようクランプする（border-elimination は wrap が添字
/// `0,1,n-2,n-1` だけに触れる前提。極端な `step_m` でも release で panic しない。Architect LOW-1）。
fn assemble_reference_system(corridor: &Corridor, track: &Track, step_m: f64) -> ReferenceSystem {
    let step_m = step_m.min(track.length() / 8.0);
    let stations = Stations::new(track.length(), step_m);
    let n = stations.count;

    let s: Vec<f64> = (0..n).map(|i| stations.s_of(i)).collect();
    let pos: Vec<Vec3> = s.iter().map(|&si| track.frame_at(si).position).collect();
    let lat: Vec<Vec3> = s.iter().map(|&si| track.frame_at(si).lateral).collect();
    let idx = |i: isize| stations.wrap_index(i);

    let bounds: Vec<(f64, f64)> = s
        .iter()
        .map(|&si| {
            let (r, l) = corridor.white_bounds(si);
            let (r2, l2) = (r + Trajectory::REF_MARGIN_M, l - Trajectory::REF_MARGIN_M);
            if r2 > l2 {
                let mid = 0.5 * (r + l);
                (mid, mid)
            } else {
                (r2, l2)
            }
        })
        .collect();

    let ndot = |a: isize, b: isize| lat[idx(a)].dot(lat[idx(b)]);
    let d0: Vec<f64> = (0..n).map(|i| 6.0 * ndot(i as isize, i as isize)).collect();
    let d1: Vec<f64> = (0..n)
        .map(|i| -4.0 * ndot(i as isize, i as isize + 1))
        .collect();
    let d2: Vec<f64> = (0..n).map(|i| ndot(i as isize, i as isize + 2)).collect();
    let rhs: Vec<f64> = (0..n)
        .map(|j| {
            let w = pos[idx(j as isize - 2)] - pos[idx(j as isize - 1)] * 4.0 + pos[j] * 6.0
                - pos[idx(j as isize + 1)] * 4.0
                + pos[idx(j as isize + 2)];
            -lat[j].dot(w)
        })
        .collect();

    ReferenceSystem {
        stations,
        d0,
        d1,
        d2,
        rhs,
        bounds,
    }
}

/// [`solve_box_qp`] の KKT 診断。
struct QpDiag {
    max_free_grad: f64,
    worst_inward_clamp: f64,
    iters: u32,
    n_clamped: usize,
}

// ============================================================================================
// 基準線の直接解法（TASK-2-4 Phase 1・Architect 起票）
//
// 目的関数 E(t) = Σ|D²P_i|² は t について厳密に二次。勾配 g = c + A t（A は周期 5 重対角の
// 対称 SPD）。周期性は wrap エントリ A[0][n-2], A[0][n-1], A[1][n-1] だけ → R = {0,1,n-2,n-1}
// を border、I = {2..n-3} を interior に分け、A_II（非周期 5 重対角・SPD の主小行列）を LDLᵀ で
// 解いて 4×4 Schur で border を解く。白線の箱制約は primal アクティブセット。
// ============================================================================================

/// 対称 5 重対角（帯幅 2・非周期）を `A = L D Lᵀ` に分解する。`bd0` 対角（長さ m）、
/// `bd1` ±1（長さ m-1）、`bd2` ±2（長さ m-2）。返り値 `(d, l1, l2)`。
fn penta_ldlt_factor(bd0: &[f64], bd1: &[f64], bd2: &[f64]) -> (Vec<f64>, Vec<f64>, Vec<f64>) {
    let m = bd0.len();
    let mut d = vec![0.0_f64; m];
    let mut l1 = vec![0.0_f64; m];
    let mut l2 = vec![0.0_f64; m];
    for i in 0..m {
        let a_im1 = if i >= 1 { bd1[i - 1] } else { 0.0 };
        let a_im2 = if i >= 2 { bd2[i - 2] } else { 0.0 };
        if i >= 2 {
            l2[i] = a_im2 / d[i - 2];
        }
        if i >= 1 {
            let cross = if i >= 2 {
                l2[i] * l1[i - 1] * d[i - 2]
            } else {
                0.0
            };
            l1[i] = (a_im1 - cross) / d[i - 1];
        }
        let mut di = bd0[i];
        if i >= 1 {
            di -= l1[i] * l1[i] * d[i - 1];
        }
        if i >= 2 {
            di -= l2[i] * l2[i] * d[i - 2];
        }
        debug_assert!(
            di.abs() > 1.0e-9,
            "penta LDLᵀ ~zero pivot at row {i} (d={di:e}) — degenerate track"
        );
        d[i] = di;
    }
    (d, l1, l2)
}

/// `penta_ldlt_factor` の分解で `A x = b` を解く。
fn penta_ldlt_solve(d: &[f64], l1: &[f64], l2: &[f64], b: &[f64]) -> Vec<f64> {
    let m = d.len();
    let mut y = vec![0.0_f64; m];
    for i in 0..m {
        let mut v = b[i];
        if i >= 1 {
            v -= l1[i] * y[i - 1];
        }
        if i >= 2 {
            v -= l2[i] * y[i - 2];
        }
        y[i] = v;
    }
    for i in 0..m {
        y[i] /= d[i];
    }
    let mut x = vec![0.0_f64; m];
    for i in (0..m).rev() {
        let mut v = y[i];
        if i + 1 < m {
            v -= l1[i + 1] * x[i + 1];
        }
        if i + 2 < m {
            v -= l2[i + 2] * x[i + 2];
        }
        x[i] = v;
    }
    x
}

/// 4×4 一般線形系を部分ピボット付きガウス消去で解く。
#[allow(clippy::needless_range_loop)]
fn solve4(mut a: [[f64; 4]; 4], mut b: [f64; 4]) -> [f64; 4] {
    for c in 0..4 {
        let mut piv = c;
        for r in (c + 1)..4 {
            if a[r][c].abs() > a[piv][c].abs() {
                piv = r;
            }
        }
        a.swap(c, piv);
        b.swap(c, piv);
        let inv = 1.0 / a[c][c];
        for r in (c + 1)..4 {
            let f = a[r][c] * inv;
            if f != 0.0 {
                for k in c..4 {
                    a[r][k] -= f * a[c][k];
                }
                b[r] -= f * b[c];
            }
        }
    }
    let mut x = [0.0_f64; 4];
    for r in (0..4).rev() {
        let mut v = b[r];
        for k in (r + 1)..4 {
            v -= a[r][k] * x[k];
        }
        x[r] = v / a[r][r];
    }
    x
}

/// 対称周期 5 重対角 `A t = rhs` を、`fixed[i] = Some(v)` の添字を `t_i = v` に固定して解く
/// （border-elimination + Schur 補元）。`d0/d1/d2` は元の A の対角
/// （`d1[n-1]` は wrap A[n-1][0]、`d2[n-2]` は A[n-2][0]、`d2[n-1]` は A[n-1][1]）。
#[allow(clippy::needless_range_loop)]
fn solve_periodic_penta_fixed(
    n: usize,
    d0: &[f64],
    d1: &[f64],
    d2: &[f64],
    rhs: &[f64],
    fixed: &[Option<f64>],
    st: &Stations,
) -> Vec<f64> {
    let w = |i: isize| st.wrap_index(i);
    let a_entry = |i: usize, j: usize| -> f64 {
        let n_i = n as isize;
        let raw = (j as isize - i as isize).rem_euclid(n_i);
        let diff = if raw > n_i - raw { raw - n_i } else { raw };
        match diff {
            0 => d0[i],
            1 => d1[i],
            -1 => d1[w(i as isize - 1)],
            2 => d2[i],
            -2 => d2[w(i as isize - 2)],
            _ => 0.0,
        }
    };

    let mut wd0 = d0.to_vec();
    let mut wd1 = d1.to_vec();
    let mut wd2 = d2.to_vec();
    let mut wrhs = rhs.to_vec();
    for i in 0..n {
        if let Some(v) = fixed[i] {
            for off in [-2isize, -1, 1, 2] {
                let j = w(i as isize + off);
                wrhs[j] -= a_entry(j, i) * v;
            }
        }
    }
    for i in 0..n {
        if let Some(v) = fixed[i] {
            wrhs[i] = v;
            wd0[i] = 1.0;
            wd1[i] = 0.0;
            wd1[w(i as isize - 1)] = 0.0;
            wd2[i] = 0.0;
            wd2[w(i as isize - 2)] = 0.0;
        }
    }

    let m = n - 4;
    let bd0: Vec<f64> = (0..m).map(|p| wd0[p + 2]).collect();
    let bd1: Vec<f64> = (0..m - 1).map(|p| wd1[p + 2]).collect();
    let bd2: Vec<f64> = (0..m - 2).map(|p| wd2[p + 2]).collect();
    let (fd, fl1, fl2) = penta_ldlt_factor(&bd0, &bd1, &bd2);

    let mut a_ir = vec![[0.0_f64; 4]; m];
    a_ir[0][0] = wd2[0];
    a_ir[0][1] = wd1[1];
    a_ir[1][1] = wd2[1];
    a_ir[m - 2][2] = wd2[n - 4];
    a_ir[m - 1][2] = wd1[n - 3];
    a_ir[m - 1][3] = wd2[n - 3];

    let rhs_i: Vec<f64> = (0..m).map(|p| wrhs[p + 2]).collect();
    let u = penta_ldlt_solve(&fd, &fl1, &fl2, &rhs_i);
    let mut wcol = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
    for (r, col) in wcol.iter_mut().enumerate() {
        let e: Vec<f64> = (0..m).map(|p| a_ir[p][r]).collect();
        *col = penta_ldlt_solve(&fd, &fl1, &fl2, &e);
    }

    let rb = [0usize, 1, n - 2, n - 1];
    let mut arr = [[0.0_f64; 4]; 4];
    for a in 0..4 {
        for b in 0..4 {
            arr[a][b] = if a == b {
                wd0[rb[a]]
            } else {
                let (i, j) = (rb[a], rb[b]);
                let n_i = n as isize;
                let raw = (j as isize - i as isize).rem_euclid(n_i);
                let diff = if raw > n_i - raw { raw - n_i } else { raw };
                match diff {
                    1 => wd1[i],
                    -1 => wd1[w(i as isize - 1)],
                    2 => wd2[i],
                    -2 => wd2[w(i as isize - 2)],
                    _ => 0.0,
                }
            };
        }
    }

    let mut sc = arr;
    let mut rhs_r = [wrhs[rb[0]], wrhs[rb[1]], wrhs[rb[2]], wrhs[rb[3]]];
    for a in 0..4 {
        for b in 0..4 {
            let mut acc = 0.0;
            for p in 0..m {
                acc += a_ir[p][a] * wcol[b][p];
            }
            sc[a][b] -= acc;
        }
        let mut acc = 0.0;
        for p in 0..m {
            acc += a_ir[p][a] * u[p];
        }
        rhs_r[a] -= acc;
    }
    let t_r = solve4(sc, rhs_r);

    let mut t = vec![0.0_f64; n];
    for p in 0..m {
        let mut v = u[p];
        for r in 0..4 {
            v -= wcol[r][p] * t_r[r];
        }
        t[p + 2] = v;
    }
    for (a, &gi) in rb.iter().enumerate() {
        t[gi] = t_r[a];
    }
    t
}

/// `min Σ|D²P|²  s.t. lo ≤ t ≤ hi` を primal アクティブセットで解く。返り値 `(t, KKT 診断)`。
#[allow(clippy::needless_range_loop)]
fn solve_box_qp(
    n: usize,
    d0: &[f64],
    d1: &[f64],
    d2: &[f64],
    rhs: &[f64],
    bounds: &[(f64, f64)],
    st: &Stations,
) -> (Vec<f64>, QpDiag) {
    let w = |i: isize| st.wrap_index(i);
    let at = |t: &[f64], i: usize| -> f64 {
        d2[w(i as isize - 2)] * t[w(i as isize - 2)]
            + d1[w(i as isize - 1)] * t[w(i as isize - 1)]
            + d0[i] * t[i]
            + d1[i] * t[w(i as isize + 1)]
            + d2[i] * t[w(i as isize + 2)]
    };
    let mut fixed: Vec<Option<f64>> = vec![None; n];
    let mut t = vec![0.0_f64; n];

    for iter in 0..Trajectory::MAX_ACTIVE_SET_ITERS {
        t = solve_periodic_penta_fixed(n, d0, d1, d2, rhs, &fixed, st);

        let mut changed = false;
        for i in 0..n {
            if fixed[i].is_none() {
                let (lo, hi) = bounds[i];
                if t[i] < lo - Trajectory::FEAS_TOL_M {
                    fixed[i] = Some(lo);
                    changed = true;
                } else if t[i] > hi + Trajectory::FEAS_TOL_M {
                    fixed[i] = Some(hi);
                    changed = true;
                }
            }
        }
        if changed {
            continue;
        }

        const RELEASE_BATCH_TOL: f64 = 1.0e-3;
        let mut worst_i = usize::MAX;
        let mut worst_viol = Trajectory::KKT_TOL;
        let mut batched = false;
        for i in 0..n {
            if let Some(v) = fixed[i] {
                let (lo, hi) = bounds[i];
                // 潰れた箱（白線内側が 2·REF_MARGIN_M 未満）は等式制約。決して解放しない
                // ——解放しても次の solve で必ず再違反し、add→release の 2-サイクルで
                // MAX_ACTIVE_SET_ITERS まで回る（Architect MEDIUM-2a）。
                if hi - lo <= Trajectory::FEAS_TOL_M {
                    continue;
                }
                let deriv = at(&t, i) - rhs[i];
                let at_lo = (v - lo).abs() <= (v - hi).abs();
                let viol = if at_lo { -deriv } else { deriv };
                if viol > RELEASE_BATCH_TOL {
                    fixed[i] = None;
                    changed = true;
                    batched = true;
                } else if viol > worst_viol {
                    worst_viol = viol;
                    worst_i = i;
                }
            }
        }
        if !batched && worst_i != usize::MAX {
            fixed[worst_i] = None;
            changed = true;
        }
        if !changed {
            let mut max_free_grad = 0.0_f64;
            let mut worst_inward = 0.0_f64;
            let mut n_clamped = 0usize;
            for i in 0..n {
                let deriv = at(&t, i) - rhs[i];
                match fixed[i] {
                    None => max_free_grad = max_free_grad.max(deriv.abs()),
                    Some(v) => {
                        n_clamped += 1;
                        let (lo, hi) = bounds[i];
                        let at_lo = (v - lo).abs() <= (v - hi).abs();
                        let inward = if at_lo {
                            (-deriv).max(0.0)
                        } else {
                            deriv.max(0.0)
                        };
                        worst_inward = worst_inward.max(inward);
                    }
                }
            }
            return (
                t,
                QpDiag {
                    max_free_grad,
                    worst_inward_clamp: worst_inward,
                    iters: iter + 1,
                    n_clamped,
                },
            );
        }
    }
    debug_assert!(false, "Trajectory::reference active set did not converge");
    // 収束しなかった劣化解でも **白線の内側は無条件で保証する**（[`Corridor`] の
    // 走行エンベロープに対する権限を壊さない。T-LINE-14 は「アクティブセットが
    // 収束したなら定義により満たされる」だけなので、ここで明示クランプする。Architect MEDIUM-2b）。
    // 診断は INFINITY のまま残すので T-LINE-12（KKT 残差）はここで大声で落ちる。
    for i in 0..n {
        let (lo, hi) = bounds[i];
        t[i] = t[i].clamp(lo, hi);
    }
    (
        t,
        QpDiag {
            max_free_grad: f64::INFINITY,
            worst_inward_clamp: f64::INFINITY,
            iters: Trajectory::MAX_ACTIVE_SET_ITERS,
            n_clamped: fixed.iter().filter(|f| f.is_some()).count(),
        },
    )
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
