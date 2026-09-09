//! TASK-2-1 受け入れテスト（T-LINE-01 〜 10）。
//!
//! トラック（`assets/tracks/aoyama_ring.track.json`）と車両
//! （`assets/vehicles/gt_proto_a.spec.json`）は実アセットを読む。

use std::path::PathBuf;
use std::time::Instant;

use sim_line::{Corridor, PerformanceEnvelope, SpeedProfile, Trajectory, TrajectoryKind};
use sim_math::Vec3;
use sim_track::{load_track, Track};
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

    // バンクコーナー（T7・banking ≈ -0.1 rad）で g_eff の符号が正しいことを確認する。
    // 契約 Known Risks は「ヘアピン（バンク ≈ 0）と T7（バンク -0.1）の両方で」検証を
    // 要求しているが、既存はヘアピンのみだった（Opus 監査 R5）。
    // 最大バンク局を探し、そこが「有利なバンク」（外側が持ち上がる＝旋回と逆符号）で
    // あることを確かめたうえで、v_at が平坦・ダウンフォース無視のコーナリング速度
    // 下限を上回ることを assert する。bank_assist の符号が反転していれば a_lat が
    // 2·g·|sin(bank)| 目減りし、この下限を明確に割る。
    let mut s_bank = 0.0;
    let mut min_bank = 0.0_f64;
    let mut s = 0.0;
    while s < tr.length() {
        let b = tr.frame_at(s).banking;
        if b < min_bank {
            min_bank = b;
            s_bank = s;
        }
        s += 1.0;
    }
    assert!(
        min_bank < -0.05,
        "expected a meaningfully banked corner, got {min_bank}"
    );
    let k_traj = traj.curvature_at(s_bank);
    // 有利なバンク: banking < 0（右端が持ち上がる）かつ左旋回（κ_traj > 0）。
    assert!(
        k_traj > 0.0,
        "max-bank station s={s_bank}: expected left turn (κ>0) for favourable negative banking, got κ={k_traj}"
    );
    let v_flat_floor = (env.mu * GRAVITY * min_bank.cos() / k_traj.abs()).sqrt();
    let v_bank = sp.v_at(s_bank);
    assert!(
        v_bank + 1e-6 >= v_flat_floor,
        "banked corner s={s_bank} (bank {min_bank} rad): v_at {v_bank} < flat floor {v_flat_floor} \
         — bank_assist sign is likely inverted"
    );
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
    assert!(t_traj.as_millis() < 800);
    assert!(t_speed.as_millis() < 200);
}
