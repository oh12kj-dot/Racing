//! TASK-2-1 受け入れテスト（T-LINE-01 〜 10）。
//!
//! トラック（`assets/tracks/aoyama_ring.track.json`）と車両
//! （`assets/vehicles/gt_proto_a.spec.json`）は実アセットを読む。

use std::path::PathBuf;
use std::time::Instant;

use sim_line::{Corridor, PerformanceEnvelope, SpeedProfile, Trajectory, TrajectoryKind};
use sim_math::Vec3;
use sim_track::{load_track, CrossSection, Track, TrackDefinition};
use sim_vehicle::{VehicleParams, GRAVITY};

const SPEC_JSON: &str = include_str!("../../../assets/vehicles/gt_proto_a.spec.json");
const STEP_M: f64 = 2.0;
const CAR_HALF_WIDTH: f64 = 1.03; // gt_proto_a: width 2.05 / 2
const SAFETY: f64 = 0.15;

fn track() -> Track {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("assets")
        .join("tracks")
        .join("aoyama_ring.track.json");
    load_track(path).expect("bundled circuit loads and validates")
}

fn params() -> VehicleParams {
    VehicleParams::from_json_str(SPEC_JSON).expect("gt_proto_a.spec.json loads and validates")
}

/// 合成バンク・スキッドパッド（定半径 `radius` の閉円・全周一様 `banking`）。
///
/// 実サーキット + 本物のレーシングラインではバンクコーナー（T7）が out-in-out で
/// 直線化され、`κ_traj` が小さくなって `v_at` がコーナリング限界に達しない。
/// バンク項（`speed.rs` の `bank_assist = -g·sin(bank)·sign(κ)`）の符号は、
/// 全域がコーナリング限界に張り付くこのスキッドパッドで検証する（Architect MEDIUM-1）。
fn banked_skidpad(radius: f64, banking: f64) -> Track {
    const N: usize = 24;
    let centerline: Vec<Vec3> = (0..N)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / N as f64;
            Vec3::new(radius * a.cos(), 0.0, radius * a.sin())
        })
        .collect();
    let sections = vec![
        CrossSection {
            banking,
            ..Default::default()
        };
        N
    ];
    let def = TrackDefinition {
        name: "synthetic banked skidpad".to_string(),
        centerline,
        sections,
        closed: true,
        sector_splits: vec![],
        start_finish: 0.0,
    };
    Track::build(&def).expect("synthetic skidpad builds")
}

fn corridor(t: &Track) -> Corridor {
    Corridor::from_track(t, STEP_M, CAR_HALF_WIDTH, SAFETY)
}

/// 水平面（XZ）へ射影した 3 点の Menger 曲率（符号なし）。
/// 3 点が同一円上なら間隔によらず 1/R を厳密に返す。
fn menger_xz(a: Vec3, b: Vec3, c: Vec3) -> f64 {
    menger_signed_xz(a, b, c).abs()
}

/// XZ 射影の符号付き Menger 曲率。符号は三角形 `a→b→c` の向き（XZ 外積 z 成分）。
/// トラック曲率の符号規約との対応は呼び出し側でセンターラインを使って較正する
/// （右手系 +Y 上で XZ を見ると回り方の符号がトラック規約と一致するとは限らないため）。
fn menger_signed_xz(a: Vec3, b: Vec3, c: Vec3) -> f64 {
    let ab = ((b.x - a.x).powi(2) + (b.z - a.z).powi(2)).sqrt();
    let bc = ((c.x - b.x).powi(2) + (c.z - b.z).powi(2)).sqrt();
    let ca = ((a.x - c.x).powi(2) + (a.z - c.z).powi(2)).sqrt();
    let cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    let denom = ab * bc * ca;
    if denom < 1.0e-9 {
        0.0
    } else {
        2.0 * cross / denom
    }
}

// ------------------------------------------------------------------------------------
// T-LINE-01 — Corridor 白線境界
// ------------------------------------------------------------------------------------
#[test]
fn t_line_01_white_bounds_match_track_width() {
    let tr = track();
    let c = corridor(&tr);
    let margin = CAR_HALF_WIDTH + SAFETY;
    let mut s = 0.0;
    let mut sum_abs = 0.0;
    let mut count = 0.0;
    while s < tr.length() {
        let (r, l) = c.white_bounds(s);
        assert!(r <= l, "s={s}: t_right {r} > t_left {l}");
        let frame = tr.frame_at(s);
        let expected_width = (frame.width_left - margin) + (frame.width_right - margin);
        if expected_width > 0.0 {
            let err = (l - r - expected_width).abs();
            // white_bounds は ~2 m ステーションの線形補間。幅プロファイルの折れ点
            // （コーナー進入で 12→16 m へ変化する区間）で frame_at の 0.5 m テーブル
            // 補間と最大数 cm ずれる。デバッグ計器の走行計画としては無害。
            assert!(
                err < 0.06,
                "s={s}: white width {} vs expected {expected_width}",
                l - r
            );
            sum_abs += err;
            count += 1.0;
        }
        s += 1.0;
    }
    // 全周平均では track 幅にぴったり追従している（折れ点だけが外れ値）。
    assert!(
        sum_abs / count < 0.01,
        "mean |white width - track width| = {}",
        sum_abs / count
    );
}

// ------------------------------------------------------------------------------------
// T-LINE-02 — limits 境界は白線以上に広い
// ------------------------------------------------------------------------------------
#[test]
fn t_line_02_limit_bounds_contain_white() {
    let tr = track();
    let c = corridor(&tr);
    let mut s = 0.0;
    while s < tr.length() {
        let (wr, wl) = c.white_bounds(s);
        let (lr, ll) = c.limit_bounds(s);
        let white_w = wl - wr;
        let limit_w = ll - lr;
        assert!(
            limit_w >= white_w - 1e-6,
            "s={s}: limit width {limit_w} < white width {white_w}"
        );
        // limits はコース内側では白線とほぼ一致、縁石区間で広がる。
        assert!(
            limit_w <= white_w + 12.0,
            "s={s}: limit width absurdly wide"
        );
        s += 1.0;
    }
}

// ------------------------------------------------------------------------------------
// T-LINE-03 — clamp_* が境界内に収める
// ------------------------------------------------------------------------------------
#[test]
fn t_line_03_clamp_stays_inside() {
    let tr = track();
    let c = corridor(&tr);
    let mut s = 0.0;
    while s < tr.length() {
        for k in -20..=20 {
            let t = k as f64 * 0.8;
            let cw = c.clamp_white(s, t);
            let (wr, wl) = c.white_bounds(s);
            assert!(
                cw >= wr - 1e-9 && cw <= wl + 1e-9,
                "white clamp out of range"
            );
            let cl = c.clamp_limits(s, t);
            let (lr, ll) = c.limit_bounds(s);
            assert!(
                cl >= lr - 1e-9 && cl <= ll + 1e-9,
                "limits clamp out of range"
            );
        }
        s += 3.0;
    }
}

// ------------------------------------------------------------------------------------
// T-LINE-04 — reference がコリドー内
// ------------------------------------------------------------------------------------
#[test]
fn t_line_04_reference_inside_corridor() {
    let tr = track();
    let c = corridor(&tr);
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    assert_eq!(traj.kind(), TrajectoryKind::Reference);
    let mut s = 0.0;
    while s < tr.length() {
        let t = traj.t_at(s);
        let (r, l) = c.limit_bounds(s);
        assert!(
            t >= r - 1e-6 && t <= l + 1e-6,
            "s={s}: reference t={t} outside limits [{r}, {l}]"
        );
        s += 0.5;
    }
}

// ------------------------------------------------------------------------------------
// T-LINE-05 — reference が C1 連続（1 階差分が連続）
// ------------------------------------------------------------------------------------
#[test]
fn t_line_05_reference_is_c1() {
    let tr = track();
    let c = corridor(&tr);
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    let ds = 0.25;
    let mut prev_slope: Option<f64> = None;
    let mut s = 0.0;
    while s < tr.length() {
        let slope = (traj.t_at(s + ds) - traj.t_at(s - ds)) / (2.0 * ds);
        if let Some(p) = prev_slope {
            assert!(
                (slope - p).abs() < 0.05,
                "s={s}: d(t)/ds jumped {p} -> {slope}"
            );
        }
        prev_slope = Some(slope);
        s += ds;
    }
}

// ------------------------------------------------------------------------------------
// T-LINE-06 — reference の曲率二乗和がセンターラインより小さい
// ------------------------------------------------------------------------------------
#[test]
fn t_line_06_reference_smooths_curvature() {
    let tr = track();
    let c = corridor(&tr);
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    let ds = 1.0;
    let mut sum_traj = 0.0;
    let mut sum_center = 0.0;
    let mut s = 0.0;
    while s < tr.length() {
        let kt = traj.curvature_at(s);
        let kc = tr.frame_at(s).curvature;
        sum_traj += kt * kt * ds;
        sum_center += kc * kc * ds;
        s += ds;
    }
    assert!(
        sum_traj < sum_center,
        "racing line curvature^2 sum {sum_traj} not < centerline {sum_center}"
    );
}

// ------------------------------------------------------------------------------------
// T-LINE-07 — reference 曲率の独立検証（Menger）
// ------------------------------------------------------------------------------------
#[test]
fn t_line_07_curvature_matches_menger() {
    let tr = track();
    let c = corridor(&tr);
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    // Tier 1（全周積分）: ∫k² ds を解析曲率と Menger 曲率でそれぞれ積分し 25% 以内。
    // 点ごとの比較は進入/脱出ランプで点値 vs 弦平均が本質的にずれる（TASK-1A-5）ため、
    // 位相ずれに強い全周積分で式の誤り（2 倍ずれ・符号誤り）を捕捉する。
    let d = 2.0;
    let ds = 2.0;
    let mut sum_analytic = 0.0;
    let mut sum_menger = 0.0;
    let mut s = 0.0;
    while s < tr.length() {
        let ka = traj.curvature_at(s).abs();
        let a = traj.world_at(s - d, &tr);
        let b = traj.world_at(s, &tr);
        let cc = traj.world_at(s + d, &tr);
        let km = menger_xz(a, b, cc);
        sum_analytic += ka * ka * ds;
        sum_menger += km * km * ds;
        s += ds;
    }
    let rel = (sum_analytic - sum_menger).abs() / sum_menger;
    assert!(
        rel < 0.25,
        "lap-integrated k^2: analytic {sum_analytic} vs Menger {sum_menger} (rel {rel})"
    );

    // Tier 2（ヘアピン本体・厳しい）: s∈[3320, 3340] の平均曲率を、本体を張る
    // 3 点の Menger 円と 12% 以内で突き合わせる（TASK-1A-5 の円フィットと同じ発想）。
    let mut sum_analytic = 0.0;
    let mut nn = 0.0;
    let mut hs = 3320.0;
    while hs <= 3340.0 {
        sum_analytic += traj.curvature_at(hs).abs();
        nn += 1.0;
        hs += 1.0;
    }
    let mean_analytic = sum_analytic / nn;
    let hp_menger = menger_xz(
        traj.world_at(3322.0, &tr),
        traj.world_at(3330.0, &tr),
        traj.world_at(3338.0, &tr),
    );
    assert!(
        (mean_analytic - hp_menger).abs() / mean_analytic < 0.12,
        "hairpin mean analytic |k| {mean_analytic} vs Menger {hp_menger}"
    );

    // Tier 3（符号）: Tier 1/2 は絶対値しか見ていない。トラジェクトリ曲率の符号は
    // SpeedProfile の bank_assist（-g·sin(bank)·sign(κ)）を左右するので、符号反転を
    // 捕捉する回帰ガードが要る（Opus 監査 R4）。
    // まずセンターラインで「符号付き Menger」と `frame_at().curvature` の対応（orient）を
    // 較正し、同じ規則をトラジェクトリへ適用して `curvature_at` の符号と突き合わせる。
    let d = 3.0;
    let kappa_gate = 0.004; // ランプ部の微小曲率は符号が数値ノイズなので除外
    let mut vote = 0.0_f64;
    let mut s = 0.0;
    while s < tr.length() {
        let kc = tr.frame_at(s).curvature;
        if kc.abs() > kappa_gate {
            let m = menger_signed_xz(
                tr.frame_at(s - d).position,
                tr.frame_at(s).position,
                tr.frame_at(s + d).position,
            );
            vote += (kc.signum() * m.signum()).signum();
        }
        s += 2.0;
    }
    assert!(
        vote.abs() > 0.0,
        "could not calibrate Menger sign against centerline"
    );
    let orient = vote.signum(); // menger_signed * orient が track 曲率符号

    let mut checked = 0u32;
    let mut disagree = 0u32;
    let mut s = 0.0;
    while s < tr.length() {
        let ka = traj.curvature_at(s);
        if ka.abs() > kappa_gate {
            let m = menger_signed_xz(
                traj.world_at(s - d, &tr),
                traj.world_at(s, &tr),
                traj.world_at(s + d, &tr),
            );
            checked += 1;
            if ka.signum() != orient * m.signum() {
                disagree += 1;
            }
        }
        s += 2.0;
    }
    assert!(
        checked > 100,
        "sign check covered too few stations ({checked})"
    );
    assert_eq!(
        disagree, 0,
        "trajectory curvature sign disagrees with signed Menger at {disagree}/{checked} stations"
    );
}

// ------------------------------------------------------------------------------------
// T-LINE-08 — PerformanceEnvelope
// ------------------------------------------------------------------------------------
#[test]
fn t_line_08_performance_envelope() {
    let p = params();
    let e = PerformanceEnvelope::from_params(&p);
    assert!((e.mu - 1.50).abs() < 1e-9, "mu {}", e.mu);
    // v_max: gt_proto_a は class "gt3"。実測 77.1 m/s (277 km/h) は GT3 の最高速として
    // 妥当。契約起票時の 80〜110 m/s (288〜396 km/h) は LMP 寄りの誤った帯で、
    // 実装が正しい（Dev 8。TODO.md 参照）。帯は実測値を意味のある幅で挟む 70〜85 に締める
    // ——2 倍のパワー誤りでも v_max は 2^(1/3)=1.26 倍しか動かないため、広い帯は
    // 回帰ガードにならない（Opus 監査 R1）。
    assert!(
        (70.0..=85.0).contains(&e.v_max),
        "v_max {} m/s outside expected band 70..=85",
        e.v_max
    );
    // max_brake_decel は「4 輪ブレーキトルク上限による減速度」のみを保持する
    // （タイヤ限界との min は SpeedProfile::brake_decel が速度依存ダウンフォース込みで
    // 後段適用する。struct の doc も新意味で書かれている）。26.2 m/s^2 は
    // タイヤをロックさせうるブレーキ上限であって到達可能な減速度ではない。
    // 契約起票時の 12〜22 m/s^2（到達可能減速度の帯）はこの意味変更で適用外になった
    // （Dev 9。Opus 監査 R2）。ブレーキ上限セマンティクスに合わせて 22〜30 に締める。
    assert!(
        (22.0..=30.0).contains(&e.max_brake_decel),
        "max_brake_decel {} m/s^2 outside expected band 22..=30",
        e.max_brake_decel
    );
    assert!(e.mass_kg > 0.0 && e.cd_a > 0.0 && e.cl_a_total > 0.0 && e.max_power_w > 0.0);
}

// ------------------------------------------------------------------------------------
// T-LINE-09 — SpeedProfile の物理的妥当性
// ------------------------------------------------------------------------------------
#[test]
fn t_line_09_speed_profile_physics() {
    let tr = track();
    let p = params();
    let c = corridor(&tr);
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    let env = PerformanceEnvelope::from_params(&p);
    let sp = SpeedProfile::generate(&traj, &tr, &env, STEP_M);

    // 全 s で 0 < v <= v_max（T-AI-04 の土台）。
    let mut s = 0.0;
    while s < tr.length() {
        let v = sp.v_at(s);
        assert!(v > 0.0 && v <= env.v_max + 1e-6, "s={s}: v={v}");
        s += 1.0;
    }

    // ヘアピン（R≈19 m、s≈3316..3343）で v がコーナリング物理と整合。
    let mut hp_min = f64::INFINITY;
    let mut hs = 3316.0;
    while hs < 3343.0 {
        hp_min = hp_min.min(sp.v_at(hs));
        hs += 1.0;
    }
    let v_ref = (env.mu * GRAVITY * 19.0).sqrt(); // ≈ 16.7 m/s
                                                  // 契約どおり ±15%。実測は 1.06%（v_min 16.90 vs 16.72）なので余裕は 14 倍。
                                                  // 起票時に ±20% へ緩めた変更は不要だった（Opus 監査 R3・Dev 10）。
    assert!(
        (hp_min - v_ref).abs() / v_ref < 0.15,
        "hairpin v_min {hp_min} vs sqrt(mu g R) {v_ref}"
    );

    // 最長ストレート（742 m）で終端速度近くまで伸びる。v_max の最後の数 % は
    // 抗力と駆動力が拮抗して漸近的にしか埋まらないので 0.90 を基準にする。
    let mut straight_max = 0.0_f64;
    let mut ss = 300.0;
    while ss < 1200.0 {
        straight_max = straight_max.max(sp.v_at(ss));
        ss += 5.0;
    }
    assert!(
        straight_max >= 0.90 * env.v_max,
        "straight max {straight_max} < 0.90 * v_max {}",
        env.v_max
    );

    // バンク項の符号が正しいことを **実 `SpeedProfile::generate` の出力**で確認する。
    //
    // TASK-2-4 Phase 1（Architect 監査 Q3 + MEDIUM-1）: 旧アサート `v_at >= μ·g·cos(bank)/√|κ_traj|`
    // は **偽の不変量**だった（v_at は前後パスの出力で局所限界を下回るのが正常。floor ∝ 1/√|κ_traj|
    // はラインが直線化するほど発散）。だが最初の差し替え版も `generate` を呼ばず downforce 反復を
    // テスト内へ再実装していたため `speed.rs` の符号を反転しても落ちなかった。実サーキットでは
    // 本物のラインがバンクコーナー（T7）を out-in-out で直線化して `v_at` がコーナリング限界に
    // 届かないので、全域がコーナリング限界に張り付く **合成バンク・スキッドパッド**（R=60 m・
    // 一様バンク 0.15 rad）で検証する。実バンク版と `banking = 0` 版を `generate` し、
    // 有利ペアリング側が速いことを要求する。`speed.rs` の
    // `bank_assist = -g·sin(bank)·sign(κ)` を反転すれば不等号が反転して落ちる。
    let sk_bank = banked_skidpad(60.0, 0.15);
    let sk_flat = banked_skidpad(60.0, 0.0);
    let c_bank = Corridor::from_track(&sk_bank, STEP_M, CAR_HALF_WIDTH, SAFETY);
    let traj_bank = Trajectory::reference(&c_bank, &sk_bank, STEP_M);
    let sp_bank = SpeedProfile::generate(&traj_bank, &sk_bank, &env, STEP_M);
    let sp_noban = SpeedProfile::generate(&traj_bank, &sk_flat, &env, STEP_M);

    let s_probe = sk_bank.length() * 0.5;
    let bank = sk_bank.frame_at(s_probe).banking;
    let ksign = traj_bank.curvature_at(s_probe).signum();
    let favourable = -bank.sin() * ksign > 0.0;
    let v_bank = sp_bank.v_at(s_probe);
    let v_noban = sp_noban.v_at(s_probe);
    assert!(
        v_bank < 0.90 * env.v_max && v_noban < 0.90 * env.v_max,
        "skidpad must be corner-limited, not v_max-clamped (v_bank {v_bank}, v_noban {v_noban})"
    );
    if favourable {
        assert!(
            v_bank > v_noban + 0.05,
            "favourable bank ({bank:.3} rad, κ sign {ksign}) must raise the corner speed: \
             banked {v_bank} <= flat {v_noban} — bank_assist sign is likely inverted"
        );
    } else {
        assert!(
            v_bank < v_noban - 0.05,
            "adverse bank ({bank:.3} rad, κ sign {ksign}) must lower the corner speed: \
             banked {v_bank} >= flat {v_noban} — bank_assist sign is likely inverted"
        );
    }
}

// ------------------------------------------------------------------------------------
// T-LINE-10 — 決定性
// ------------------------------------------------------------------------------------
#[test]
fn t_line_10_determinism() {
    let tr = track();
    let p = params();
    let env = PerformanceEnvelope::from_params(&p);

    let build = || {
        let c = Corridor::from_track(&tr, STEP_M, CAR_HALF_WIDTH, SAFETY);
        let traj = Trajectory::reference(&c, &tr, STEP_M);
        let sp = SpeedProfile::generate(&traj, &tr, &env, STEP_M);
        let mut out = Vec::new();
        let mut s = 0.0;
        while s < tr.length() {
            let (wr, wl) = c.white_bounds(s);
            let (lr, ll) = c.limit_bounds(s);
            out.push(wr.to_bits());
            out.push(wl.to_bits());
            out.push(lr.to_bits());
            out.push(ll.to_bits());
            out.push(traj.t_at(s).to_bits());
            out.push(traj.curvature_at(s).to_bits());
            out.push(sp.v_at(s).to_bits());
            s += 1.0;
        }
        out
    };

    assert_eq!(build(), build(), "sim-line output is not deterministic");
}

// ------------------------------------------------------------------------------------
// TASK-2-4 Phase 1 — 基準線の直接解法（Architect 起票・監査で基準訂正）
//
// 目的関数は t について厳密に二次で、系は周期 5 重対角 SPD。反復緩和（SOR / cascadic
// multigrid）は biharmonic の条件数で長波長モードが収束せず、直線区間で κ_traj が波長 ~70 m で
// 振動していた。直接帯行列解法 + アクティブセットへ差し替え。求解領域は white_bounds を
// REF_MARGIN_M（0.30 m）内側へ寄せた箱（λ 正則化は「高速コーナーからラインを壊す」ため却下）。
// 番号は既存 T-LINE-10（決定性）との衝突を避けて 11 から。
// ------------------------------------------------------------------------------------

/// センターラインが直線（|κ_c| < STRAIGHT_KAPPA）の連続ランを弧長列として返す。
fn straight_runs(tr: &Track) -> Vec<Vec<f64>> {
    const STRAIGHT_KAPPA: f64 = 1.0e-4;
    const SAMPLE_STEP_M: f64 = 2.0;
    let l = tr.length();
    let n = (l / SAMPLE_STEP_M) as usize;
    let straight = |s: f64| tr.frame_at(s.rem_euclid(l)).curvature.abs() < STRAIGHT_KAPPA;
    let mut runs: Vec<Vec<f64>> = Vec::new();
    let mut cur: Vec<f64> = Vec::new();
    for i in 0..n {
        let s = i as f64 * SAMPLE_STEP_M;
        if straight(s) {
            cur.push(s);
        } else if !cur.is_empty() {
            runs.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        runs.push(cur);
    }
    runs.retain(|r| r.len() as f64 * SAMPLE_STEP_M >= 120.0);
    runs
}

/// T-LINE-11 — 直線区間の `κ_traj` に未収束リップルが無い。**大きさではなく振動**で判定。
#[test]
fn t_line_11_reference_no_ripple_on_straights() {
    let tr = track();
    let c = corridor(&tr);
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    let runs = straight_runs(&tr);
    assert!(
        runs.len() >= 3,
        "expected several straight runs, got {}",
        runs.len()
    );

    let mut worst_rev_per_km = 0.0_f64;
    let mut worst_tv_ratio = 0.0_f64;
    let mut worst_mag = 0.0_f64;
    for run in &runs {
        let k: Vec<f64> = run.iter().map(|&s| traj.curvature_at(s)).collect();
        let len_m = (run.len() - 1) as f64 * 2.0;
        let max_mag = k.iter().fold(0.0_f64, |a, &v| a.max(v.abs()));
        worst_mag = worst_mag.max(max_mag);
        // 相対フロア: ゼロ近傍の数値チャタリングを反転に数えない。
        let floor = (0.2 * max_mag).max(2.0e-4);
        let mut reversals = 0;
        let mut last_sign = 0.0_f64;
        for &v in &k {
            if v.abs() > floor {
                let sgn = v.signum();
                if last_sign != 0.0 && sgn != last_sign {
                    reversals += 1;
                }
                last_sign = sgn;
            }
        }
        worst_rev_per_km = worst_rev_per_km.max(reversals as f64 / (len_m / 1000.0).max(1e-9));
        let tv: f64 = k.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
        if max_mag > 1.0e-4 {
            worst_tv_ratio = worst_tv_ratio.max(tv / max_mag);
        }
    }
    eprintln!(
        "T-LINE-11: {} runs. worst sign-reversals/km={:.2}, worst TV/max={:.2}, worst |kappa|={:.2e}",
        runs.len(), worst_rev_per_km, worst_tv_ratio, worst_mag
    );
    assert!(
        worst_rev_per_km <= 5.0,
        "kappa_traj reverses {worst_rev_per_km:.2}/km (>5 = ripple)"
    );
    assert!(
        worst_tv_ratio <= 2.5,
        "kappa_traj TV is {worst_tv_ratio:.2}x max (>2.5 = ripple)"
    );
    // 粗い網（gross failure 検出のみ・Architect 承認済み 2e-2）。厳密最小化子でも R19 ヘアピン
    // 脱出は κ_traj ≈ 1.2e-2 で単調減衰する（振動ではない・反転回数と TV 比が本質）。
    assert!(
        worst_mag <= 2.0e-2,
        "straight |kappa_traj| = {worst_mag:.2e} /m (>2e-2 = gross)"
    );
}

/// T-LINE-12 — 厳密最小化子であることの直接証明（KKT 残差）。
#[test]
fn t_line_12_reference_kkt_exact_minimizer() {
    let tr = track();
    let c = corridor(&tr);
    let (max_free_grad, worst_inward, iters, n_clamped) =
        Trajectory::reference_kkt_for_test(&c, &tr, STEP_M);
    eprintln!(
        "T-LINE-12: iters={iters}, clamped={n_clamped}, \
         max|free grad|={max_free_grad:.2e}, worst inward-clamp={worst_inward:.2e}"
    );
    assert!(
        max_free_grad <= 1.0e-9,
        "free-station gradient max = {max_free_grad:.2e} (>1e-9)"
    );
    assert!(
        worst_inward <= 1.0e-7,
        "clamped-station gradient inward by {worst_inward:.2e}"
    );
}

/// T-LINE-13 — ステーション間隔非依存: step_m 1/2/4 m で「シャープコーナーから遠い」直線区間の
/// κ_traj RMS が一致（`max` は離散化誤差 O(h²) の局所ピークを拾うので不可）。
#[test]
fn t_line_13_reference_step_independence() {
    let tr = track();
    let c = corridor(&tr);
    let l = tr.length();
    // 幅を使うラインはコーナー脱出後 ~150 m かけて直線値へ戻る。その O(h²) 誤差を避けるため
    // シャープコーナー（R < 200 = |κ_c| > 0.005）から ±150 m を除外。
    let clean_s: Vec<f64> = straight_runs(&tr)
        .into_iter()
        .flatten()
        .filter(|&s| {
            let mut d = -150.0;
            while d <= 150.0 {
                if tr.frame_at((s + d).rem_euclid(l)).curvature.abs() > 0.005 {
                    return false;
                }
                d += 4.0;
            }
            true
        })
        .collect();
    assert!(
        clean_s.len() > 50,
        "clean straight stations: {}",
        clean_s.len()
    );
    let rms = |step: f64| {
        let traj = Trajectory::reference(&c, &tr, step);
        let sum: f64 = clean_s.iter().map(|&s| traj.curvature_at(s).powi(2)).sum();
        (sum / clean_s.len() as f64).sqrt()
    };
    let (r1, r2, r4) = (rms(1.0), rms(2.0), rms(4.0));
    eprintln!(
        "T-LINE-13: clean-straight kappa RMS  step1={r1:.2e}  step2={r2:.2e}  step4={r4:.2e}"
    );
    let spread = r1.max(r2).max(r4) - r1.min(r2).min(r4);
    assert!(
        spread <= 5.0e-4,
        "clean-straight kappa RMS spans {spread:.2e} across step_m 1/2/4 (>5e-4)"
    );
    // 位置は補助チェック（本命は κ RMS）。コーナー遷移の O(h²) が直線区間へ伝播する。
    let t1 = Trajectory::reference(&c, &tr, 1.0);
    let t2 = Trajectory::reference(&c, &tr, 2.0);
    let t4 = Trajectory::reference(&c, &tr, 4.0);
    let mut worst_dt = 0.0_f64;
    for &s in &clean_s {
        let a = t1.t_at(s);
        worst_dt = worst_dt
            .max((t2.t_at(s) - a).abs())
            .max((t4.t_at(s) - a).abs());
    }
    eprintln!("T-LINE-13: worst |t_at(step) - t_at(1m)| on clean straights = {worst_dt:.4} m");
    assert!(
        worst_dt <= 0.25,
        "line shape grid-dependent: t_at differs by {worst_dt:.4} m"
    );
}

/// T-LINE-14 — 基準線は白線から REF_MARGIN_M 以上内側（Corridor クランプの権限を残す）。
/// **箱制約で構成上成立する。`REF_MARGIN_M = 0` では白線に触れて落ちる**（実質性）。
#[test]
fn t_line_14_reference_keeps_white_margin() {
    let ref_margin = Trajectory::REF_MARGIN_M;
    let tr = track();
    let c = corridor(&tr);
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    let mut worst = f64::INFINITY;
    let mut worst_s = 0.0;
    let mut s = 0.0;
    while s < tr.length() {
        let (wr, wl) = c.white_bounds(s);
        let t = traj.t_at(s);
        let m = (wl - t).min(t - wr);
        if m < worst {
            worst = m;
            worst_s = s;
        }
        s += 1.0;
    }
    eprintln!("T-LINE-14: worst white margin = {worst:.3} m at s={worst_s:.0}");
    // 箱制約は station 値で white−REF_MARGIN。station 間の Catmull-Rom がタイトコーナーで
    // 数 mm オーバーシュートしうるので 2 cm の許容。
    assert!(
        worst >= ref_margin - 0.02,
        "reference line is {worst:.3} m from the white line at s={worst_s:.0} (< {ref_margin} m)"
    );
}

// ------------------------------------------------------------------------------------
// 性能（参考値・環境依存なので緩め）
// ------------------------------------------------------------------------------------
#[test]
fn perf_build_and_accessors() {
    let tr = track();
    let p = params();
    let env = PerformanceEnvelope::from_params(&p);

    let t0 = Instant::now();
    let c = Corridor::from_track(&tr, STEP_M, CAR_HALF_WIDTH, SAFETY);
    let t_corridor = t0.elapsed();

    let t1 = Instant::now();
    let traj = Trajectory::reference(&c, &tr, STEP_M);
    let t_traj = t1.elapsed();

    let t2 = Instant::now();
    let sp = SpeedProfile::generate(&traj, &tr, &env, STEP_M);
    let t_speed = t2.elapsed();

    // アクセサ 100k 回。
    let t3 = Instant::now();
    let mut acc = 0.0;
    for k in 0..100_000 {
        let s = (k as f64 * 0.037) % tr.length();
        acc += traj.t_at(s) + sp.v_at(s);
    }
    let per_call = t3.elapsed().as_nanos() as f64 / 200_000.0;
    assert!(acc.is_finite());

    eprintln!(
        "sim-line perf: corridor {:?}, reference {:?}, speed {:?}, accessor {:.1} ns/call",
        t_corridor, t_traj, t_speed, per_call
    );
    // 生成は起動時 1 回。緩い上限だけ課す（CI 環境差を吸収）。
    assert!(t_corridor.as_millis() < 200);
    // TASK-2-4 Phase 1: 直接帯行列解法 + アクティブセット。実測 ~40 ms（旧 SOR ~600 ms）。
    assert!(
        t_traj.as_millis() < 500,
        "reference build {t_traj:?} > 500 ms"
    );
    assert!(t_speed.as_millis() < 200);
}
