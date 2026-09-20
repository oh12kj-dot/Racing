//! `CubicSpline` / `ArcLengthSpline` の検証。
//!
//! 円を基準形状として使う。半径 `R` の円は弧長 `2*PI*R`、曲率 `1/R` が解析的に既知であり、
//! 弧長パラメータ化と曲率計算の精度を定量的に検証できる。

use approx::assert_relative_eq;
use sim_math::{ArcLengthSpline, CubicSpline, SplineError, Vec3};

/// XZ 平面上の半径 `r` の円を `n` 点で近似した制御点列。
fn circle_points(r: f64, n: usize) -> Vec<Vec3> {
    (0..n)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / n as f64;
            Vec3::new(r * a.cos(), 0.0, r * a.sin())
        })
        .collect()
}

fn circle_spline(r: f64, n: usize) -> ArcLengthSpline {
    let s = CubicSpline::new(&circle_points(r, n), true).expect("valid circle");
    ArcLengthSpline::with_default_samples(s)
}

// ---------------------------------------------------------------------------
// 構築時のバリデーション
// ---------------------------------------------------------------------------

#[test]
fn spline_rejects_invalid_input() {
    let three = circle_points(10.0, 3);
    assert_eq!(
        CubicSpline::new(&three, true).unwrap_err(),
        SplineError::TooFewPoints { got: 3, need: 4 }
    );

    let mut dup = circle_points(10.0, 6);
    dup[2] = dup[3];
    assert_eq!(
        CubicSpline::new(&dup, true).unwrap_err(),
        SplineError::DuplicatePoint { index: 2 }
    );

    let mut bad = circle_points(10.0, 6);
    bad[4] = Vec3::new(f64::NAN, 0.0, 0.0);
    assert_eq!(
        CubicSpline::new(&bad, true).unwrap_err(),
        SplineError::NonFinitePoint { index: 4 }
    );

    // エラーは Display 可能であること（ログ出力で使う）。
    assert!(!CubicSpline::new(&three, true)
        .unwrap_err()
        .to_string()
        .is_empty());
}

// ---------------------------------------------------------------------------
// T-TRK-03 相当: 連続性
// ---------------------------------------------------------------------------

#[test]
fn spline_c1_continuity() {
    // 大域パラメータ u をノットスパンに比例配分しているため、
    // セグメント境界で dP/du が一致する（真の C1）。
    // 制御点間隔を意図的に不均一にして検証する。
    let pts = vec![
        Vec3::new(0.0, 0.0, 0.0),
        Vec3::new(5.0, 0.0, 1.0),
        Vec3::new(60.0, 2.0, 4.0),
        Vec3::new(70.0, 2.5, 20.0),
        Vec3::new(72.0, 1.0, 40.0),
        Vec3::new(30.0, 0.0, 55.0),
        Vec3::new(-20.0, -1.0, 30.0),
        Vec3::new(-10.0, 0.0, 5.0),
    ];
    let sp = CubicSpline::new(&pts, true).expect("valid");

    // セグメント境界の正確な u は非公開のノット配分に依存するため、
    // 境界を含む十分細かい走査で接線の跳びが無いことを確認する。
    // 全域を細かく走査し、隣接サンプル間の接線変化が滑らかであることを確認する。
    // 不連続があれば、そこだけ変化量が突出する。
    let n = 20_000;
    let mut deltas = Vec::with_capacity(n);
    let mut prev = sp.derivative(0.0);
    for k in 1..=n {
        let u = k as f64 / n as f64;
        let d = sp.derivative(u);
        deltas.push((d - prev).length());
        prev = d;
    }
    let mean: f64 = deltas.iter().sum::<f64>() / deltas.len() as f64;
    let max = deltas.iter().cloned().fold(0.0f64, f64::max);
    assert!(
        max < mean * 20.0,
        "tangent discontinuity detected: max step {max} vs mean {mean}"
    );

    // 位置の連続性も同様に確認する。
    let mut prev_p = sp.eval(0.0);
    let mut max_gap: f64 = 0.0;
    for k in 1..=n {
        let p = sp.eval(k as f64 / n as f64);
        max_gap = max_gap.max((p - prev_p).length());
        prev_p = p;
    }
    let circumference_ish = 300.0;
    assert!(
        max_gap < circumference_ish / n as f64 * 10.0,
        "position gap {max_gap}"
    );

    // 接線は常に単位長（退化していない）。
    for k in 0..=1000 {
        let t = sp.tangent(k as f64 / 1000.0);
        assert_relative_eq!(t.length(), 1.0, epsilon = 1e-9);
    }
}

// ---------------------------------------------------------------------------
// T-TRK-05 相当: 弧長パラメータ化の精度
// ---------------------------------------------------------------------------

#[test]
fn spline_arclength_accuracy() {
    let r = 100.0;
    for &n in &[32usize, 64, 128] {
        let sp = circle_spline(r, n);
        let expected = std::f64::consts::TAU * r;
        let err = (sp.total_length() - expected).abs() / expected;
        assert!(
            err < 1.0e-3,
            "n={n}: arc length error {:.6}% (got {}, want {})",
            err * 100.0,
            sp.total_length(),
            expected
        );
    }
}

#[test]
fn spline_curvature_circle() {
    let r = 100.0;
    let sp = circle_spline(r, 128);
    let l = sp.total_length();
    let mut max_err: f64 = 0.0;
    for k in 0..2000 {
        let s = l * k as f64 / 2000.0;
        let kappa = sp.curvature_at(s);
        max_err = max_err.max((kappa - 1.0 / r).abs() * r);
    }
    assert!(
        max_err < 0.01,
        "curvature error {:.4}% exceeds 1%",
        max_err * 100.0
    );
}

#[test]
fn spline_s_u_roundtrip() {
    let sp = circle_spline(75.0, 48);
    let l = sp.total_length();
    for k in 0..1000 {
        let s = l * k as f64 / 1000.0;
        let back = sp.s_from_u(sp.u_from_s(s));
        assert!((back - s).abs() < 1e-6, "s roundtrip failed: {s} -> {back}");
    }
    for k in 0..1000 {
        let u = k as f64 / 1000.0;
        let back = sp.u_from_s(sp.s_from_u(u));
        assert!((back - u).abs() < 1e-9, "u roundtrip failed: {u} -> {back}");
    }
}

// ---------------------------------------------------------------------------
// closest_s
// ---------------------------------------------------------------------------

#[test]
fn spline_closest_s() {
    let r = 100.0;
    let sp = circle_spline(r, 64);
    let l = sp.total_length();

    for k in 0..200 {
        let s_true = l * k as f64 / 200.0;
        let on_curve = sp.position_at(s_true);
        // 曲線から法線方向へ 3 m 外側に離した点。最近傍は s_true のはず。
        let outward = on_curve.normalize() * 3.0;
        let probe = on_curve + outward;

        let without_hint = sp.closest_s(probe, None);
        let with_hint = sp.closest_s(probe, Some(s_true + 2.0));

        // 位置ベースで比較する（s のラップ境界での差分は signed_delta_s で見る）。
        let d_no = sp.signed_delta_s(s_true, without_hint).abs();
        let d_hint = sp.signed_delta_s(s_true, with_hint).abs();
        assert!(
            d_no < 0.5,
            "no-hint closest_s off by {d_no} m at s={s_true}"
        );
        assert!(
            d_hint < 0.5,
            "hint closest_s off by {d_hint} m at s={s_true}"
        );
        // hint の有無で結果が一致すること。
        let diff = sp.signed_delta_s(without_hint, with_hint).abs();
        assert!(diff < 1e-3, "hint changed result by {diff} m at s={s_true}");
    }
}

#[test]
fn spline_closest_s_hint_is_faster() {
    let sp = circle_spline(100.0, 64);
    let l = sp.total_length();
    let probes: Vec<(Vec3, f64)> = (0..2000)
        .map(|k| {
            let s = l * k as f64 / 2000.0;
            (sp.position_at(s) + Vec3::new(0.0, 0.0, 0.0), s)
        })
        .collect();

    let t0 = std::time::Instant::now();
    for (p, s) in &probes {
        std::hint::black_box(sp.closest_s(*p, Some(*s)));
    }
    let with_hint = t0.elapsed();

    let t1 = std::time::Instant::now();
    for (p, _) in &probes {
        std::hint::black_box(sp.closest_s(*p, None));
    }
    let without_hint = t1.elapsed();

    let per_call_ns = with_hint.as_nanos() as f64 / probes.len() as f64;
    println!(
        "closest_s: with hint {:.0} ns/call, without hint {:.0} ns/call",
        per_call_ns,
        without_hint.as_nanos() as f64 / probes.len() as f64
    );

    assert!(
        with_hint < without_hint,
        "hint must be faster: {with_hint:?} vs {without_hint:?}"
    );
    // Simulation Budget の観点: 24 台 * 60 Hz = 1440 call/s。
    // 1 us/call でも 1.4 ms/s であり予算内だが、余裕を持って上限を置く。
    assert!(
        per_call_ns < 2000.0,
        "closest_s too slow: {per_call_ns} ns/call"
    );
}

// ---------------------------------------------------------------------------
// T-TRK-06 相当: ラップ処理
// ---------------------------------------------------------------------------

#[test]
fn spline_wrap_and_delta() {
    let sp = circle_spline(100.0, 64);
    let l = sp.total_length();

    // wrap_s
    assert_relative_eq!(sp.wrap_s(0.0), 0.0, epsilon = 1e-9);
    assert_relative_eq!(sp.wrap_s(l), 0.0, epsilon = 1e-9);
    assert_relative_eq!(sp.wrap_s(l + 5.0), 5.0, epsilon = 1e-9);
    assert_relative_eq!(sp.wrap_s(-5.0), l - 5.0, epsilon = 1e-9);
    assert_relative_eq!(sp.wrap_s(3.0 * l + 7.0), 7.0, epsilon = 1e-6);
    assert_eq!(sp.wrap_s(f64::NAN), 0.0);

    // signed_delta_s: ラップ境界を跨ぐ前進
    assert_relative_eq!(sp.signed_delta_s(l - 1.0, 1.0), 2.0, epsilon = 1e-9);
    // 後退
    assert_relative_eq!(sp.signed_delta_s(1.0, l - 1.0), -2.0, epsilon = 1e-9);
    // 通常区間
    assert_relative_eq!(sp.signed_delta_s(10.0, 25.0), 15.0, epsilon = 1e-9);
    assert_relative_eq!(sp.signed_delta_s(25.0, 10.0), -15.0, epsilon = 1e-9);
    // ちょうど半周は正側に倒す
    assert_relative_eq!(sp.signed_delta_s(0.0, l * 0.5), l * 0.5, epsilon = 1e-6);
    // 戻り値は常に (-L/2, L/2]
    for k in 0..500 {
        let a = l * k as f64 / 500.0;
        for j in 0..37 {
            let b = l * j as f64 / 37.0;
            let d = sp.signed_delta_s(a, b);
            assert!(
                d > -l * 0.5 - 1e-9 && d <= l * 0.5 + 1e-9,
                "delta out of range: {d}"
            );
        }
    }
}

#[test]
fn spline_open_clamps_instead_of_wrapping() {
    let pts = vec![
        Vec3::new(0.0, 0.0, 0.0),
        Vec3::new(10.0, 0.0, 0.0),
        Vec3::new(20.0, 0.0, 0.0),
        Vec3::new(30.0, 0.0, 0.0),
        Vec3::new(40.0, 0.0, 0.0),
    ];
    let sp = ArcLengthSpline::with_default_samples(CubicSpline::new(&pts, false).expect("valid"));
    assert!(!sp.is_closed());
    let l = sp.total_length();
    assert_relative_eq!(l, 40.0, epsilon = 1e-6);

    assert_relative_eq!(sp.wrap_s(-5.0), 0.0, epsilon = 1e-12);
    assert_relative_eq!(sp.wrap_s(l + 5.0), l, epsilon = 1e-12);
    // 開曲線ではラップしないので単純な差
    assert_relative_eq!(sp.signed_delta_s(35.0, 5.0), -30.0, epsilon = 1e-12);

    // 端点を通過すること
    let p0 = sp.position_at(0.0);
    assert_relative_eq!(p0.x, 0.0, epsilon = 1e-6);
    let pl = sp.position_at(l);
    assert_relative_eq!(pl.x, 40.0, epsilon = 1e-6);
}

#[test]
fn spline_passes_through_control_points() {
    // Catmull-Rom は制御点を補間する。トラック定義の意図が保たれる前提条件。
    let pts = circle_points(50.0, 12);
    let cs = CubicSpline::new(&pts, true).expect("valid");
    let n_seg = cs.segment_count();
    for (i, p) in pts.iter().enumerate() {
        // セグメント i の始点が制御点 i。
        let u = {
            // セグメント境界の u は弧長経由で近似できないため、
            // ArcLengthSpline を使わず直接 eval で最近傍を探す。
            let mut best = (0.0, f64::INFINITY);
            for k in 0..=(n_seg * 400) {
                let u = k as f64 / (n_seg * 400) as f64;
                let d = (cs.eval(u) - *p).length();
                if d < best.1 {
                    best = (u, d);
                }
            }
            best.0
        };
        let d = (cs.eval(u) - *p).length();
        assert!(d < 1e-3, "control point {i} not interpolated (miss {d} m)");
    }
}

#[test]
fn spline_positions_are_finite_everywhere() {
    let sp = circle_spline(100.0, 64);
    let l = sp.total_length();
    for k in 0..5000 {
        let s = l * k as f64 / 5000.0;
        assert!(sp.position_at(s).is_finite());
        assert!(sp.tangent_at(s).is_finite());
        assert!(sp.curvature_at(s).is_finite());
    }
    // 定義域外でも破綻しない
    for s in [-1e9, 1e9, f64::NAN, f64::INFINITY] {
        assert!(sp.position_at(s).is_finite(), "position_at({s}) not finite");
    }
}

#[test]
fn spline_closest_s_survives_stale_hint() {
    // ヒントが古い / 全く的外れでも、窓の端で最小値が出た場合は全走査へ
    // フォールバックするため、結果は hint なしと一致しなければならない。
    let r = 100.0;
    let sp = circle_spline(r, 64);
    let l = sp.total_length();

    for k in 0..120 {
        let s_true = l * k as f64 / 120.0;
        let probe = sp.position_at(s_true) * 1.03;
        let truth = sp.closest_s(probe, None);

        // 半周ずれた（最悪の）ヒント、および複数の陳腐化度合いで検証する。
        for stale in [l * 0.5, l * 0.25, 50.0, -50.0, 5.0, 0.0] {
            let got = sp.closest_s(probe, Some(sp.wrap_s(s_true + stale)));
            let diff = sp.signed_delta_s(truth, got).abs();
            assert!(
                diff < 1e-3,
                "stale hint (+{stale} m) changed result by {diff} m at s={s_true}"
            );
        }
    }
}

#[test]
fn spline_pose_at_matches_individual_lookups() {
    let sp = circle_spline(80.0, 40);
    let l = sp.total_length();
    for k in 0..1000 {
        let s = l * k as f64 / 1000.0;
        let (pos, tan) = sp.pose_at(s);
        let p2 = sp.position_at(s);
        let t2 = sp.tangent_at(s);
        assert_relative_eq!(pos.x, p2.x, epsilon = 1e-12);
        assert_relative_eq!(pos.y, p2.y, epsilon = 1e-12);
        assert_relative_eq!(pos.z, p2.z, epsilon = 1e-12);
        assert_relative_eq!(tan.x, t2.x, epsilon = 1e-12);
        assert_relative_eq!(tan.y, t2.y, epsilon = 1e-12);
        assert_relative_eq!(tan.z, t2.z, epsilon = 1e-12);
        assert_relative_eq!(tan.length(), 1.0, epsilon = 1e-9);
    }
}

#[test]
fn spline_control_point_s_mapping() {
    // 制御点 i の s において、曲線位置が制御点そのものと一致すること。
    // トラック断面定義（幅・バンク・カンバー）を s へ写す際の前提条件。
    let r = 120.0;
    let n = 24;
    let pts = circle_points(r, n);
    let sp = ArcLengthSpline::with_default_samples(CubicSpline::new(&pts, true).expect("valid"));

    assert_eq!(sp.control_point_count(), n);
    let mut prev_s = -1.0;
    for (i, p) in pts.iter().enumerate() {
        let s = sp.control_point_s(i);
        assert!(s > prev_s, "control point s must increase: {prev_s} -> {s}");
        prev_s = s;
        let d = (sp.position_at(s) - *p).length();
        assert!(
            d < 1e-3,
            "control point {i} maps to s={s} but is {d} m away"
        );
    }
    // 円周を等分した制御点なので、s も等間隔に近いはず。
    let expected_step = sp.total_length() / n as f64;
    for i in 0..n {
        let step = sp.control_point_s((i + 1) % n) - sp.control_point_s(i);
        let step = if step < 0.0 {
            step + sp.total_length()
        } else {
            step
        };
        assert!(
            (step - expected_step).abs() < expected_step * 0.05,
            "uneven control point spacing at {i}: {step} vs {expected_step}"
        );
    }
    // 範囲外は終端へクランプ
    assert_relative_eq!(sp.control_point_s(n + 5), sp.total_length(), epsilon = 1e-9);
}
