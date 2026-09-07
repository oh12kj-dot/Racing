//! `sim-track` の受け入れテスト。TESTING.md T-TRK-01〜06 に対応する。
//!
//! 2 種類のテストトラックを使う。
//! - `build_circle_track`: 半径 `R` の円。全長・曲率が解析的に既知。
//! - `build_complex_track`: 直線 + 高速コーナー（バンク付き）+ 高低差のある直線 +
//!   ヘアピン を含むオリジナル形状。

use approx::assert_relative_eq;
use sim_math::Vec3;
use sim_track::{
    detect_lap_crossing, CrossSection, LapCrossing, SurfaceKind, Track, TrackCoord,
    TrackDefinition, TrackError,
};
use std::collections::HashSet;

// ---------------------------------------------------------------------------
// テスト用トラック定義
// ---------------------------------------------------------------------------

/// XZ 平面上の半径 `r` の円を `n` 点で近似した制御点列。
fn circle_points(r: f64, n: usize) -> Vec<Vec3> {
    (0..n)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / n as f64;
            Vec3::new(r * a.cos(), 0.0, r * a.sin())
        })
        .collect()
}

fn circle_track_definition(r: f64, n: usize) -> TrackDefinition {
    TrackDefinition {
        name: "Test Circle".to_string(),
        centerline: circle_points(r, n),
        sections: vec![CrossSection::default(); n],
        closed: true,
        sector_splits: vec![1.0 / 3.0, 2.0 / 3.0],
        start_finish: 0.0,
    }
}

fn build_circle_track(r: f64, n: usize) -> Track {
    Track::build(&circle_track_definition(r, n)).expect("valid circle track")
}

/// (x, z) 方向の単位ベクトル。
type Dir = (f64, f64);

fn norm_dir(d: Dir) -> Dir {
    let l = (d.0 * d.0 + d.1 * d.1).sqrt();
    (d.0 / l, d.1 / l)
}

/// `entry` から `heading` 方向に接する半径 `radius` の半円（180 度）を生成する。
///
/// 生成される弧は必ず `entry` において `heading` に接する（中心を heading に
/// 垂直な方向へ配置するため）。これにより直線 -> 円弧の遷移で曲率が
/// 連続的に立ち上がり、自己近接や不接線な結合による `world_to_track` の
/// 局所的な数値誤差を避けられる。`bulge_left` で heading に対しどちら側へ
/// 膨らむかを選ぶ。戻り値は (中間点+終点の `n` 個, 終点, 終点での heading)。
fn half_circle(
    entry: Vec3,
    heading: Dir,
    radius: f64,
    bulge_left: bool,
    n: usize,
    elevation: impl Fn(f64) -> f64,
) -> (Vec<Vec3>, Vec3, Dir) {
    let heading = norm_dir(heading);
    let perp = if bulge_left {
        (-heading.1, heading.0)
    } else {
        (heading.1, -heading.0)
    };
    let center = (entry.x + perp.0 * radius, entry.z + perp.1 * radius);
    let rel = (entry.x - center.0, entry.z - center.1);
    let entry_angle = rel.1.atan2(rel.0);
    // 増加方向の接線と heading の内積で、どちら向きに掃引すれば heading に
    // 一致するかを決める（中心の配置と heading の向きから自動的に定まる）。
    let inc_deriv = (-entry_angle.sin(), entry_angle.cos());
    let sweep_sign = if inc_deriv.0 * heading.0 + inc_deriv.1 * heading.1 > 0.0 {
        1.0
    } else {
        -1.0
    };

    let mut pts = Vec::with_capacity(n);
    let mut exit_pt = entry;
    let mut exit_heading = heading;
    for i in 1..=n {
        let frac = i as f64 / n as f64;
        let a = entry_angle + sweep_sign * frac * std::f64::consts::PI;
        let p = Vec3::new(
            center.0 + radius * a.cos(),
            elevation(frac),
            center.1 + radius * a.sin(),
        );
        pts.push(p);
        exit_pt = p;
        exit_heading = norm_dir((-a.sin() * sweep_sign, a.cos() * sweep_sign));
    }
    (pts, exit_pt, exit_heading)
}

/// `entry` から `heading` 方向へ長さ `length` の直線区間を `n` 点で生成する。
fn straight_line(
    entry: Vec3,
    heading: Dir,
    length: f64,
    n: usize,
    elevation: impl Fn(f64) -> f64,
) -> (Vec<Vec3>, Vec3) {
    let heading = norm_dir(heading);
    let mut pts = Vec::with_capacity(n);
    let mut last = entry;
    for i in 1..=n {
        let frac = i as f64 / n as f64;
        let d = frac * length;
        let p = Vec3::new(
            entry.x + heading.0 * d,
            elevation(frac),
            entry.z + heading.1 * d,
        );
        pts.push(p);
        last = p;
    }
    (pts, last)
}

/// 直線 + 高速コーナー（バンク付き）+ 高低差のある直線 + ヘアピン を含む
/// オリジナル形状の閉じたトラック。制御点とバンク角を同時に返す。
///
/// すべての区間の接続に [`half_circle`] / [`straight_line`] を使い、各区間が
/// 進入時の進行方向へ必ず接するように構成する。これにより自己近接
/// （トラック上の離れた `s` が空間的に接近し `world_to_track` が誤った枝へ
/// 収束すること）や、接線が不連続な結合による数値誤差を構造的に避ける。
fn complex_points_and_banking() -> (Vec<Vec3>, Vec<f64>) {
    let mut pts = vec![Vec3::new(0.0, 0.0, 0.0)];
    let mut bank = vec![0.0];
    let mut pos = pts[0];
    let mut heading: Dir = (1.0, 0.0);

    // スタート/フィニッシュ直線。
    let (p, last) = straight_line(pos, heading, 200.0, 3, |_| 0.0);
    pts.extend(p);
    bank.extend([0.0; 3]);
    pos = last;

    // 高速コーナー（半径 80 m、バンク角 0.1 rad）。
    let (p, last, h) = half_circle(pos, heading, 80.0, true, 4, |_| 0.0);
    pts.extend(p);
    bank.extend([0.1; 4]);
    pos = last;
    heading = h;

    // 高低差のある直線（登り）。
    let (p, last) = straight_line(pos, heading, 100.0, 3, |f| 18.0 * f);
    pts.extend(p);
    bank.extend([0.0; 3]);
    pos = last;

    // ヘアピン（半径 15 m、他区間から十分離れた側へ膨らむ）。
    let (p, last, h) = half_circle(pos, heading, 15.0, true, 4, |f| 18.0 + f * 2.0);
    pts.extend(p);
    bank.extend([0.0; 4]);
    pos = last;
    heading = h;

    // ヘアピン直後の短い直線（進行方向は反転している）。
    let (p, last) = straight_line(pos, heading, 40.0, 2, |_| 20.0);
    pts.extend(p);
    bank.extend([0.0; 2]);
    pos = last;

    // リターンコーナー: 進行方向を元へ戻す（半径 40 m）。
    let (p, last, h) = half_circle(pos, heading, 40.0, true, 4, |_| 20.0);
    pts.extend(p);
    bank.extend([0.0; 4]);
    pos = last;
    heading = h;

    // x=0 側へ戻る、標高を下げる直線。
    let (p, last) = straight_line(pos, heading, pos.x.abs().max(50.0), 3, |f| 20.0 * (1.0 - f));
    pts.extend(p);
    bank.extend([0.0; 3]);
    pos = last;

    // クロージングコーナー: スタート地点 (0,0,0) / heading (1,0) へ戻る。
    // 半径はオフセットしている z 方向の距離から自動的に決める。
    let radius_close = (pos.z / 2.0).abs().max(10.0);
    let (p, _last, _h) = half_circle(pos, heading, radius_close, true, 4, |_| 0.0);
    // 最後の生成点はスタート地点 (0,0,0) と一致するため含めない
    // （closed=true が最終制御点から先頭制御点へ自動的に接続する）。
    let keep = p.len() - 1;
    for pt in p.into_iter().take(keep) {
        pts.push(pt);
        bank.push(0.0);
    }

    (pts, bank)
}

fn complex_track_definition() -> TrackDefinition {
    let (centerline, banking) = complex_points_and_banking();
    let sections: Vec<CrossSection> = banking
        .iter()
        .map(|&b| CrossSection {
            banking: b,
            ..CrossSection::default()
        })
        .collect();
    TrackDefinition {
        name: "Test Complex".to_string(),
        centerline,
        sections,
        closed: true,
        sector_splits: vec![0.33, 0.66],
        start_finish: 0.0,
    }
}

fn build_complex_track() -> Track {
    Track::build(&complex_track_definition()).expect("valid complex track")
}

// ---------------------------------------------------------------------------
// T-TRK-01: 座標変換の往復
// ---------------------------------------------------------------------------

#[test]
fn track_coord_roundtrip() {
    let track = build_circle_track(100.0, 96);
    let length = track.length();
    let ts = [-5.0, -2.0, 0.0, 2.0, 5.0];

    let mut max_err_s = 0.0f64;
    let mut max_err_t = 0.0f64;
    for k in 0..53 {
        let s = length * k as f64 / 53.0;
        for &t in &ts {
            let c = TrackCoord::new(s, t);
            let p = track.track_to_world(c);
            let c2 = track.world_to_track(p, None);
            max_err_s = max_err_s.max(track.signed_delta_s(s, c2.s).abs());
            max_err_t = max_err_t.max((c2.t - t).abs());
        }
    }
    println!("circle roundtrip: max_ds={max_err_s:.3e} m, max_dt={max_err_t:.3e} m");
    assert!(max_err_s < 1e-6, "circle: s roundtrip error {max_err_s} m");
    assert!(max_err_t < 1e-6, "circle: t roundtrip error {max_err_t} m");

    // 円形以外のオリジナル形状でも、コース幅一杯（既定値: 中央 6 m + 縁石側）
    // までを含む格子点で検証する。
    let track2 = build_complex_track();
    let length2 = track2.length();
    let mut max_err_s2 = 0.0f64;
    let mut max_err_t2 = 0.0f64;
    for k in 0..47 {
        let s = length2 * k as f64 / 47.0;
        for &t in &[-6.0, -5.0, -2.0, 0.0, 2.0, 5.0, 6.0] {
            let c = TrackCoord::new(s, t);
            let p = track2.track_to_world(c);
            let c2 = track2.world_to_track(p, None);
            max_err_s2 = max_err_s2.max(track2.signed_delta_s(s, c2.s).abs());
            max_err_t2 = max_err_t2.max((c2.t - t).abs());
        }
    }
    println!("complex roundtrip: max_ds={max_err_s2:.3e} m, max_dt={max_err_t2:.3e} m");
    assert!(
        max_err_s2 < 1e-6,
        "complex: s roundtrip error {max_err_s2} m"
    );
    assert!(
        max_err_t2 < 1e-6,
        "complex: t roundtrip error {max_err_t2} m"
    );
}

// ---------------------------------------------------------------------------
// T-TRK-02: s の単調性・連続性
// ---------------------------------------------------------------------------

#[test]
fn track_s_is_monotonic_and_continuous() {
    let step = 0.37; // FRAME_SPACING_M (0.5) と意図的にずらす。

    for track in [build_circle_track(100.0, 64), build_complex_track()] {
        let length = track.length();
        let mut prev = track.frame_at(0.0).position;
        let mut s = step;
        let mut max_gap = 0.0f64;
        while s < length {
            let p = track.frame_at(s).position;
            max_gap = max_gap.max((p - prev).length());
            prev = p;
            s += step;
        }
        assert!(
            max_gap < step * 2.0,
            "{}: position jump too large: {max_gap} m at step {step} m",
            track.name()
        );
    }
}

// ---------------------------------------------------------------------------
// T-TRK-03: 曲率の連続性と符号
// ---------------------------------------------------------------------------

#[test]
fn track_curvature_continuity() {
    let track = build_circle_track(100.0, 96);
    let length = track.length();
    let n = 400;

    let mut prev_k: Option<f64> = None;
    let mut max_step = 0.0f64;
    let mut signs = HashSet::new();
    for i in 0..n {
        let s = length * i as f64 / n as f64;
        let k = track.frame_at(s).curvature;
        if let Some(pk) = prev_k {
            max_step = max_step.max((k - pk).abs());
        }
        prev_k = Some(k);
        signs.insert(k > 0.0);
    }
    assert!(max_step < 0.01, "curvature discontinuity: {max_step}");
    assert_eq!(
        signs.len(),
        1,
        "a circle has a single, constant turning direction"
    );

    // 符号が実際の旋回方向と一致することを、曲率式そのものを再利用しない
    // 独立した幾何学的な方法（弦の中点からのズレ）で検証する。
    // 左カーブでは (弦の中点 - 実位置) が +lateral 側にズレる。
    let h = 2.0;
    for i in 1..n {
        let s = length * i as f64 / n as f64;
        let f0 = track.frame_at(track.wrap_s(s - h));
        let f1 = track.frame_at(s);
        let f2 = track.frame_at(track.wrap_s(s + h));
        let chord_mid = (f0.position + f2.position) * 0.5;
        let indicator = (chord_mid - f1.position).dot(f1.lateral);
        if f1.curvature.abs() > 1e-4 {
            assert_eq!(
                indicator > 0.0,
                f1.curvature > 0.0,
                "curvature sign mismatch with geometric turn direction at s={s}: \
                 indicator={indicator}, curvature={}",
                f1.curvature
            );
        }
    }

    // 複雑な形状（左右両方の旋回・ヘアピンを含む）でも同じ検証を行う。
    let track2 = build_complex_track();
    let length2 = track2.length();
    for i in 1..n {
        let s = length2 * i as f64 / n as f64;
        let f0 = track2.frame_at(track2.wrap_s(s - h));
        let f1 = track2.frame_at(s);
        let f2 = track2.frame_at(track2.wrap_s(s + h));
        let chord_mid = (f0.position + f2.position) * 0.5;
        let indicator = (chord_mid - f1.position).dot(f1.lateral);
        if f1.curvature.abs() > 1e-3 {
            assert_eq!(
                indicator > 0.0,
                f1.curvature > 0.0,
                "complex track: curvature sign mismatch at s={s}: \
                 indicator={indicator}, curvature={}",
                f1.curvature
            );
        }
    }
}

// ---------------------------------------------------------------------------
// T-TRK-04: コース幅
// ---------------------------------------------------------------------------

#[test]
fn track_width_is_positive() {
    for track in [build_circle_track(100.0, 64), build_complex_track()] {
        let length = track.length();
        let n = 300;
        for i in 0..n {
            let s = length * i as f64 / n as f64;
            let f = track.frame_at(s);
            assert!(
                f.width_left + f.width_right > 6.0,
                "{}: s={s}: width too small ({}, {})",
                track.name(),
                f.width_left,
                f.width_right
            );
        }
    }
}

// ---------------------------------------------------------------------------
// T-TRK-05: 弧長パラメータ化の精度
// ---------------------------------------------------------------------------

#[test]
fn track_arclength_accuracy() {
    let r = 250.0;
    let track = build_circle_track(r, 128);
    let expected = std::f64::consts::TAU * r;
    let err = (track.length() - expected).abs() / expected;
    assert!(
        err < 1.0e-3,
        "arc length error {:.4}% (got {}, want {})",
        err * 100.0,
        track.length(),
        expected
    );
}

// ---------------------------------------------------------------------------
// T-TRK-06: ラップ跨ぎ検出
// ---------------------------------------------------------------------------

#[test]
fn track_lap_crossing() {
    let track = build_circle_track(100.0, 64);
    let l = track.length();
    let max_ds = 5.0;

    // 正方向の跨ぎ。
    assert_eq!(
        detect_lap_crossing(&track, l - 0.5, 0.5, max_ds),
        LapCrossing::Forward
    );
    // 逆方向の跨ぎ。
    assert_eq!(
        detect_lap_crossing(&track, 0.5, l - 0.5, max_ds),
        LapCrossing::Backward
    );
    // 跨がない（正方向の小移動）。
    assert_eq!(
        detect_lap_crossing(&track, 50.0, 53.0, max_ds),
        LapCrossing::None
    );
    // 跨がない（逆方向の小移動）。
    assert_eq!(
        detect_lap_crossing(&track, 53.0, 50.0, max_ds),
        LapCrossing::None
    );
    // テレポート（1 tick で半周移動）: Suspect であり、ラップを跨いだ形跡があっても加算しない。
    assert_eq!(
        detect_lap_crossing(&track, 10.0, l * 0.5, max_ds),
        LapCrossing::Suspect
    );
    // ラインをまたぐ大跳躍も Suspect（跨ぎとして誤検出しない）。
    assert_eq!(
        detect_lap_crossing(&track, l - 1.0, 1.0 + max_ds * 3.0, max_ds),
        LapCrossing::Suspect
    );

    // start_finish がゼロでない場合でも成立すること。
    let mut def = circle_track_definition(100.0, 64);
    def.start_finish = 0.4;
    let track2 = Track::build(&def).expect("valid");
    let sf = track2.start_finish_s();
    assert_eq!(
        detect_lap_crossing(&track2, sf - 0.5, sf + 0.5, max_ds),
        LapCrossing::Forward
    );
    assert_eq!(
        detect_lap_crossing(&track2, sf + 0.5, sf - 0.5, max_ds),
        LapCrossing::Backward
    );
    assert_eq!(
        detect_lap_crossing(&track2, sf + 10.0, sf + 13.0, max_ds),
        LapCrossing::None
    );
}

#[test]
fn track_lap_crossing_exhaustive_sweep() {
    // 誤検出・見逃しゼロを、独立に計算した「真値」との突き合わせで広く検証する。
    let track = build_circle_track(100.0, 48);
    let l = track.length();
    let sf = track.start_finish_s();
    let max_ds = 5.0;
    let steps = 251; // l と割り切れない値で境界の偶然一致を避ける。
    let deltas = [-4.5, -3.0, -1.0, -0.1, 0.0, 0.1, 1.0, 3.0, 4.5, 12.0, -12.0];

    for i in 0..steps {
        let prev_s = l * i as f64 / steps as f64;
        for &delta in &deltas {
            let raw_new = prev_s + delta;
            let new_s = track.wrap_s(raw_new);
            let result = detect_lap_crossing(&track, prev_s, new_s, max_ds);

            if delta.abs() > max_ds {
                assert_eq!(
                    result,
                    LapCrossing::Suspect,
                    "prev={prev_s} delta={delta}: expected Suspect"
                );
                continue;
            }

            // 境界ぎったり（浮動小数の際どい一致）は誤差の原因になるため除外する。
            let near_boundary = (-2..=2).any(|k| {
                let line = sf + k as f64 * l;
                (prev_s - line).abs() < 1e-6 || (raw_new - line).abs() < 1e-6
            });
            if near_boundary {
                continue;
            }

            let expect = if delta > 0.0 {
                let crossed = (-2..=2).any(|k| {
                    let line = sf + k as f64 * l;
                    prev_s < line && line <= raw_new
                });
                if crossed {
                    LapCrossing::Forward
                } else {
                    LapCrossing::None
                }
            } else if delta < 0.0 {
                let crossed = (-2..=2).any(|k| {
                    let line = sf + k as f64 * l;
                    raw_new <= line && line < prev_s
                });
                if crossed {
                    LapCrossing::Backward
                } else {
                    LapCrossing::None
                }
            } else {
                LapCrossing::None
            };

            assert_eq!(
                result, expect,
                "prev={prev_s} delta={delta} new_s={new_s} (raw_new={raw_new})"
            );
        }
    }
}

// ---------------------------------------------------------------------------
// 幾何規約
// ---------------------------------------------------------------------------

#[test]
fn track_frame_geometry_conventions() {
    let track = build_circle_track(100.0, 64);
    let f = track.frame_at(0.0);

    // 平坦区間: normal == +Y。
    assert_relative_eq!(f.normal.x, 0.0, epsilon = 1e-9);
    assert_relative_eq!(f.normal.y, 1.0, epsilon = 1e-6);
    assert_relative_eq!(f.normal.z, 0.0, epsilon = 1e-9);

    assert_relative_eq!(f.tangent.length(), 1.0, epsilon = 1e-9);
    assert_relative_eq!(f.lateral.length(), 1.0, epsilon = 1e-9);
    assert_relative_eq!(f.lateral.dot(f.tangent), 0.0, epsilon = 1e-6);

    // lateral == up.cross(tangent).normalize()（平坦区間）。
    let expected_lateral = Vec3::Y.cross(f.tangent).normalize();
    assert_relative_eq!(f.lateral.x, expected_lateral.x, epsilon = 1e-6);
    assert_relative_eq!(f.lateral.y, expected_lateral.y, epsilon = 1e-6);
    assert_relative_eq!(f.lateral.z, expected_lateral.z, epsilon = 1e-6);

    // バンク区間: 左端 (t=+5) が右端 (t=-5) より高いこと。
    let track2 = build_complex_track();
    let length2 = track2.length();
    let mut found_banked = false;
    for i in 0..2000 {
        let s = length2 * i as f64 / 2000.0;
        let frame = track2.frame_at(s);
        if frame.banking.abs() > 0.05 {
            found_banked = true;
            let left = track2.track_to_world(TrackCoord::new(s, 5.0));
            let right = track2.track_to_world(TrackCoord::new(s, -5.0));
            assert!(
                left.y > right.y,
                "banked section at s={s}: left.y={} should exceed right.y={}",
                left.y,
                right.y
            );
        }
    }
    assert!(found_banked, "no banked section found in complex track");
}

/// バンク角が制御点 1 か所で `0.0 -> 0.15 rad` へ段状に変化するトラック
/// （半径 60 m の円）。フレームテーブルの 1 セル内で `lateral` の変換が
/// 単純な「同一軸まわりの回転」から外れる状況（M-1）を直接作り出す。
fn build_banking_step_track() -> Track {
    let pts = circle_points(60.0, 32);
    let n = pts.len();
    let sections: Vec<CrossSection> = (0..n)
        .map(|i| CrossSection {
            banking: if i < n / 2 { 0.0 } else { 0.15 },
            ..CrossSection::default()
        })
        .collect();
    let def = TrackDefinition {
        name: "Banking Step".to_string(),
        centerline: pts,
        sections,
        closed: true,
        sector_splits: vec![1.0 / 3.0, 2.0 / 3.0],
        start_finish: 0.0,
    };
    Track::build(&def).expect("valid banking-step track")
}

/// 円（XZ 平面）に正弦波状の標高変化を重ねたトラック。水平方向の曲率と
/// 鉛直方向の起伏が同時に存在するため、隣接フレーム間の変換が単一軸回転
/// では表せない「ねじれ」（3D torsion）を持つ。M-1 が最も強く現れるケース。
fn build_elevation_torsion_track() -> Track {
    let r = 80.0;
    let n = 48;
    let pts: Vec<Vec3> = (0..n)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / n as f64;
            // 1 周に 3 回の起伏。振幅はコース幅に対して十分大きく取る。
            let y = 8.0 * (3.0 * a).sin();
            Vec3::new(r * a.cos(), y, r * a.sin())
        })
        .collect();
    let def = TrackDefinition {
        name: "Elevation Torsion".to_string(),
        centerline: pts,
        sections: vec![CrossSection::default(); n],
        closed: true,
        sector_splits: vec![1.0 / 3.0, 2.0 / 3.0],
        start_finish: 0.0,
    };
    Track::build(&def).expect("valid elevation-torsion track")
}

/// M-1: `frame_at` が返す `(tangent, lateral, normal)` が常に厳密な正規直交基底
/// であることを検証する。平坦な円は独立 lerp + normalize でも直交性が
/// たまたま保たれてしまうため、バンク段差・標高由来のねじれを持つ
/// トラックを必ず含める。
#[test]
fn track_frame_is_orthonormal() {
    let tracks = [
        build_circle_track(100.0, 64),
        build_complex_track(),
        build_banking_step_track(),
        build_elevation_torsion_track(),
    ];

    for track in &tracks {
        let length = track.length();
        let n = 4000;
        let mut max_lt = 0.0f64;
        let mut max_nt = 0.0f64;
        let mut max_nl = 0.0f64;
        let mut max_len_err = 0.0f64;
        for i in 0..n {
            let s = length * i as f64 / n as f64;
            let f = track.frame_at(s);
            max_lt = max_lt.max(f.lateral.dot(f.tangent).abs());
            max_nt = max_nt.max(f.normal.dot(f.tangent).abs());
            max_nl = max_nl.max(f.normal.dot(f.lateral).abs());
            max_len_err = max_len_err.max((f.tangent.length() - 1.0).abs());
            max_len_err = max_len_err.max((f.lateral.length() - 1.0).abs());
            max_len_err = max_len_err.max((f.normal.length() - 1.0).abs());
        }
        println!(
            "{}: |L.T|={max_lt:.3e} |N.T|={max_nt:.3e} |N.L|={max_nl:.3e} unit_len_err={max_len_err:.3e}",
            track.name()
        );
        assert!(
            max_lt < 1e-12,
            "{}: |lateral.tangent| = {max_lt}",
            track.name()
        );
        assert!(
            max_nt < 1e-12,
            "{}: |normal.tangent| = {max_nt}",
            track.name()
        );
        assert!(
            max_nl < 1e-12,
            "{}: |normal.lateral| = {max_nl}",
            track.name()
        );
        assert!(
            max_len_err < 1e-12,
            "{}: unit-length error = {max_len_err}",
            track.name()
        );
    }
}

#[test]
fn track_banked_corner_elevation() {
    // バンク角 0.1 rad 一定の円形トラックで、左端 (t=+5) が右端 (t=-5) より
    // 常に高いことを検証する。
    let pts = circle_points(100.0, 32);
    let n = pts.len();
    let sections: Vec<CrossSection> = (0..n)
        .map(|_| CrossSection {
            banking: 0.1,
            ..CrossSection::default()
        })
        .collect();
    let def = TrackDefinition {
        name: "Banked Circle".to_string(),
        centerline: pts,
        sections,
        closed: true,
        sector_splits: vec![1.0 / 3.0, 2.0 / 3.0],
        start_finish: 0.0,
    };
    let track = Track::build(&def).expect("valid");
    let l = track.length();
    for i in 0..50 {
        let s = l * i as f64 / 50.0;
        let left = track.track_to_world(TrackCoord::new(s, 5.0));
        let right = track.track_to_world(TrackCoord::new(s, -5.0));
        assert!(
            left.y > right.y,
            "s={s}: left.y={} should exceed right.y={}",
            left.y,
            right.y
        );
    }
}

// ---------------------------------------------------------------------------
// 路面分類
// ---------------------------------------------------------------------------

#[test]
fn track_surface_classification() {
    // 既定断面: width 6.0/6.0, kerb 1.5/1.5, runoff = Grass。
    let track = build_circle_track(100.0, 64);
    let s = track.length() * 0.1;

    assert_eq!(
        track.surface_at(TrackCoord::new(s, 0.0)),
        SurfaceKind::Asphalt
    );
    assert_eq!(
        track.surface_at(TrackCoord::new(s, 6.0)),
        SurfaceKind::Asphalt
    );
    assert_eq!(track.surface_at(TrackCoord::new(s, 6.5)), SurfaceKind::Kerb);
    assert_eq!(track.surface_at(TrackCoord::new(s, 7.5)), SurfaceKind::Kerb);
    assert_eq!(
        track.surface_at(TrackCoord::new(s, 8.0)),
        SurfaceKind::Grass
    );

    assert_eq!(
        track.surface_at(TrackCoord::new(s, -6.0)),
        SurfaceKind::Asphalt
    );
    assert_eq!(
        track.surface_at(TrackCoord::new(s, -6.5)),
        SurfaceKind::Kerb
    );
    assert_eq!(
        track.surface_at(TrackCoord::new(s, -8.0)),
        SurfaceKind::Grass
    );

    assert!(track.is_within_limits(TrackCoord::new(s, 0.0)));
    assert!(track.is_within_limits(TrackCoord::new(s, 6.5)));
    assert!(!track.is_within_limits(TrackCoord::new(s, 8.0)));
    assert!(!track.is_within_limits(TrackCoord::new(s, -8.0)));
}

// ---------------------------------------------------------------------------
// セクター
// ---------------------------------------------------------------------------

#[test]
fn track_sectors() {
    let track = build_circle_track(100.0, 64); // sector_splits = [1/3, 2/3]
    let l = track.length();

    assert_eq!(track.sector_boundaries().len(), 2);
    assert_eq!(track.sector_of(0.0), 0);
    assert_eq!(track.sector_of(l / 3.0 - 1.0), 0);
    assert_eq!(track.sector_of(l / 3.0), 1);
    assert_eq!(track.sector_of(l / 3.0 + 1.0), 1);
    assert_eq!(track.sector_of(2.0 * l / 3.0), 2);
    assert_eq!(track.sector_of(l - 1.0), 2);
    // セクター数 = sector_splits.len() + 1
    assert_eq!(track.sector_boundaries().len() + 1, 3);
}

// ---------------------------------------------------------------------------
// world_to_track の hint 有無一致
// ---------------------------------------------------------------------------

#[test]
fn track_world_to_track_hint_consistency() {
    let track = build_circle_track(100.0, 64);
    let l = track.length();
    for i in 0..200 {
        let s = l * i as f64 / 200.0;
        let p = track.track_to_world(TrackCoord::new(s, 3.0));
        let c_no_hint = track.world_to_track(p, None);
        let c_hint = track.world_to_track(p, Some(track.wrap_s(s + 1.0)));
        let ds = track.signed_delta_s(c_no_hint.s, c_hint.s).abs();
        assert!(ds < 1e-6, "hint changed s by {ds} m at s={s}");
        assert!(
            (c_no_hint.t - c_hint.t).abs() < 1e-6,
            "hint changed t at s={s}"
        );
    }
}

// ---------------------------------------------------------------------------
// 不正な TrackDefinition の拒否
// ---------------------------------------------------------------------------

/// `Track::build` が期待どおりの [`TrackError`] を返すことを確認する。
///
/// `Track` は非公開フィールドのみで `Debug` を持たないため、`unwrap_err`
/// （`Result::Ok` 側に `Debug` を要求する）は使わずここで手動に判定する。
fn assert_build_err(def: &TrackDefinition, expected: TrackError) {
    match Track::build(def) {
        Ok(_) => panic!("expected error {expected:?}, but build succeeded"),
        Err(e) => assert_eq!(e, expected),
    }
}

#[test]
fn track_build_rejects_invalid_definitions() {
    let base = circle_track_definition(50.0, 8);

    let mut d = base.clone();
    d.sections.pop();
    assert_build_err(
        &d,
        TrackError::SectionCountMismatch {
            centerline: 8,
            sections: 7,
        },
    );

    let mut d = base.clone();
    d.sections[2].width_left = 0.0;
    assert_build_err(&d, TrackError::NonPositiveWidth { index: 2 });

    let mut d = base.clone();
    d.sections[3].width_right = -1.0;
    assert_build_err(&d, TrackError::NonPositiveWidth { index: 3 });

    let mut d = base.clone();
    d.sector_splits = vec![0.6, 0.3]; // 昇順でない
    assert_build_err(&d, TrackError::InvalidSectorSplits);

    let mut d = base.clone();
    d.sector_splits = vec![0.0, 0.5]; // 0.0 は (0,1) の範囲外
    assert_build_err(&d, TrackError::InvalidSectorSplits);

    let mut d = base.clone();
    d.start_finish = 1.0; // [0,1) の範囲外
    assert_build_err(&d, TrackError::InvalidStartFinish);

    let mut d = base.clone();
    d.start_finish = -0.1;
    assert_build_err(&d, TrackError::InvalidStartFinish);

    // Display / std::error::Error を実装していること。
    let e = match Track::build(&d) {
        Ok(_) => panic!("expected an error"),
        Err(e) => e,
    };
    assert!(!e.to_string().is_empty());
    let _: &dyn std::error::Error = &e;
}

// ---------------------------------------------------------------------------
// Performance（概算計測。TODO.md Performance Criteria 参照）
// ---------------------------------------------------------------------------

#[test]
fn performance_smoke_frame_at_and_world_to_track() {
    // 全長 ~5 km の円形トラック。
    let track = build_circle_track(800.0, 256);
    let l = track.length();
    println!("track length = {:.1} m", l);

    let n = 100_000;
    let mut acc = 0.0;
    let t0 = std::time::Instant::now();
    for i in 0..n {
        let s = l * (i % 10_007) as f64 / 10_007.0;
        let f = track.frame_at(s);
        acc += f.position.x;
    }
    let dt = t0.elapsed();
    let per_call_ns = dt.as_nanos() as f64 / n as f64;
    println!("frame_at: {per_call_ns:.1} ns/call (acc={acc})");
    assert!(
        per_call_ns < 500.0,
        "frame_at too slow: {per_call_ns} ns/call"
    );

    let probes: Vec<Vec3> = (0..5000)
        .map(|i| {
            let s = l * i as f64 / 5000.0;
            track.track_to_world(TrackCoord::new(s, 2.0))
        })
        .collect();
    let t1 = std::time::Instant::now();
    let mut hint = None;
    let mut acc2 = 0.0;
    for p in &probes {
        let c = track.world_to_track(*p, hint);
        hint = Some(c.s);
        acc2 += c.t;
    }
    let dt2 = t1.elapsed();
    let per_call_ns2 = dt2.as_nanos() as f64 / probes.len() as f64;
    println!("world_to_track (hint): {per_call_ns2:.1} ns/call (acc={acc2})");
    assert!(
        per_call_ns2 < 3000.0,
        "world_to_track too slow: {per_call_ns2} ns/call"
    );
}

#[test]
fn performance_smoke_build_time_and_memory() {
    let r = 800.0; // 全長 ~5 km
    let def = circle_track_definition(r, 400);
    let t0 = std::time::Instant::now();
    let track = Track::build(&def).expect("valid");
    let dt = t0.elapsed();
    println!(
        "build: {:.2} ms for length {:.1} m",
        dt.as_secs_f64() * 1000.0,
        track.length()
    );
    assert!(dt.as_millis() < 100, "build too slow: {dt:?}");

    let num_frames = (track.length() / Track::FRAME_SPACING_M).ceil() as usize + 1;
    // SoA レイアウト:
    //   frame_s(8B)
    // + 3 * Vec3(24B)  = pos / tangent / lateral
    // + 5 * f64(8B)    = curvature / banking / camber / width_left / width_right
    // = 8 + 72 + 40    = 120 B/frame
    // `normal` は保存しない（frame_at が tangent.cross(lateral) から導出する）。
    let bytes_per_frame = 120usize;
    let approx_bytes = num_frames * bytes_per_frame;
    println!(
        "frame table: {num_frames} frames, ~{:.3} MB",
        approx_bytes as f64 / 1_000_000.0
    );
    assert!(
        approx_bytes < 2_000_000,
        "frame table memory too large: {approx_bytes} bytes"
    );
}
