//! `Rng` と `util` の検証。
//!
//! 決定性（PROJECT.md §7）と、制御出力のレート制限（TESTING.md T-AI-02 の前提）を検証する。

use approx::assert_relative_eq;
use sim_math::util::{
    approach_exponential, clamp, inverse_lerp, lerp, move_towards, remap, saturate,
    signed_angle_delta, smootherstep, smoothstep, wrap_angle,
};
use sim_math::Rng;
use std::f64::consts::PI;

// ---------------------------------------------------------------------------
// Rng
// ---------------------------------------------------------------------------

#[test]
fn rng_determinism() {
    // 同一 seed から 2 回生成し、ビット一致すること。
    let run = || {
        let mut r = Rng::from_seed(0xDEAD_BEEF_1234_5678);
        (0..10_000).map(|_| r.next_u64()).collect::<Vec<_>>()
    };
    assert_eq!(run(), run());

    // f64 側もビット一致すること。
    let run_f = || {
        let mut r = Rng::from_seed(7);
        (0..10_000)
            .map(|_| r.next_f64().to_bits())
            .collect::<Vec<_>>()
    };
    assert_eq!(run_f(), run_f());

    // 異なる seed は異なる列
    let mut a = Rng::from_seed(1);
    let mut b = Rng::from_seed(2);
    let sa: Vec<u64> = (0..64).map(|_| a.next_u64()).collect();
    let sb: Vec<u64> = (0..64).map(|_| b.next_u64()).collect();
    assert_ne!(sa, sb);
}

#[test]
fn rng_derive_stability() {
    let race = Rng::from_seed(2026);

    // 同じラベルからは常に同じ子。
    let mut a = race.derive("driver:07:perception");
    let mut b = race.derive("driver:07:perception");
    let va: Vec<u64> = (0..256).map(|_| a.next_u64()).collect();
    let vb: Vec<u64> = (0..256).map(|_| b.next_u64()).collect();
    assert_eq!(va, vb);

    // 異なるラベルは異なる列。
    let mut c = race.derive("driver:07:mistake");
    let vc: Vec<u64> = (0..256).map(|_| c.next_u64()).collect();
    assert_ne!(va, vc);

    // 派生は親の状態を変えないため、派生の順序に依存しない。
    let parent = Rng::from_seed(99);
    let mut x1 = parent.derive("a");
    let _y = parent.derive("b");
    let mut x2 = parent.derive("a");
    assert_eq!(x1.next_u64(), x2.next_u64());

    // 空ラベルでも縮退しない。
    let mut e = race.derive("");
    assert!(e.next_u64() != 0 || e.next_u64() != 0);

    // 24 台 x 数系統のラベルが全て異なるストリームになること。
    let mut firsts = std::collections::HashSet::new();
    for car in 0..24 {
        for kind in ["perception", "mistake", "decision", "confidence"] {
            let mut r = race.derive(&format!("driver:{car:02}:{kind}"));
            assert!(
                firsts.insert(r.next_u64()),
                "stream collision at {car}/{kind}"
            );
        }
    }
}

#[test]
fn rng_distribution() {
    let mut r = Rng::from_seed(31337);

    // next_f64 は [0, 1)
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    let mut sum = 0.0;
    const N: usize = 200_000;
    for _ in 0..N {
        let v = r.next_f64();
        assert!((0.0..1.0).contains(&v), "next_f64 out of range: {v}");
        lo = lo.min(v);
        hi = hi.max(v);
        sum += v;
    }
    assert!(lo < 0.001 && hi > 0.999, "poor coverage: [{lo}, {hi}]");
    assert!(
        (sum / N as f64 - 0.5).abs() < 0.01,
        "uniform mean off: {}",
        sum / N as f64
    );

    // normal の平均・標準偏差
    let mut r = Rng::from_seed(4242);
    let mean = 3.0;
    let sd = 2.0;
    let samples: Vec<f64> = (0..N).map(|_| r.normal(mean, sd)).collect();
    let m = samples.iter().sum::<f64>() / N as f64;
    let var = samples.iter().map(|v| (v - m) * (v - m)).sum::<f64>() / (N - 1) as f64;
    let s = var.sqrt();
    assert!((m - mean).abs() < sd * 0.02, "normal mean {m} vs {mean}");
    assert!((s - sd).abs() / sd < 0.02, "normal sd {s} vs {sd}");
    assert!(samples.iter().all(|v| v.is_finite()));

    // normal_clamped は指定範囲を出ない
    let mut r = Rng::from_seed(5);
    for _ in 0..100_000 {
        let v = r.normal_clamped(0.0, 1.0, 2.0);
        assert!(
            (-2.0..=2.0).contains(&v),
            "normal_clamped out of range: {v}"
        );
    }
}

#[test]
fn rng_ranges() {
    let mut r = Rng::from_seed(11);

    for _ in 0..100_000 {
        let v = r.range_f64(-3.0, 7.0);
        assert!((-3.0..7.0).contains(&v));
    }
    // 退化した範囲
    assert_eq!(r.range_f64(5.0, 5.0), 5.0);
    assert_eq!(r.range_f64(5.0, 1.0), 5.0);

    // range_i64 は [lo, hi) を網羅し、外に出ない
    let mut seen = [0usize; 5];
    for _ in 0..100_000 {
        let v = r.range_i64(-2, 3);
        assert!((-2..3).contains(&v), "range_i64 out of range: {v}");
        seen[(v + 2) as usize] += 1;
    }
    assert!(
        seen.iter().all(|&c| c > 15_000),
        "range_i64 not uniform: {seen:?}"
    );
    assert_eq!(r.range_i64(4, 4), 4);
    assert_eq!(r.range_i64(4, 1), 4);

    // 確率
    let mut r = Rng::from_seed(12);
    let hits = (0..100_000)
        .filter(|_| r.bool_with_probability(0.25))
        .count();
    assert!((hits as f64 / 100_000.0 - 0.25).abs() < 0.01);
    assert!(!r.bool_with_probability(0.0));
    assert!(r.bool_with_probability(1.0));
    // 範囲外の確率は丸められる
    assert!(!r.bool_with_probability(-1.0));
    assert!(r.bool_with_probability(2.0));
}

#[test]
fn rng_no_global_state() {
    // 独立インスタンスが互いに干渉しないこと。
    let mut a = Rng::from_seed(77);
    let mut b = Rng::from_seed(77);

    let a1: Vec<u64> = (0..100).map(|_| a.next_u64()).collect();
    // b を挟んで進めても a の続きは変わらない。
    let _: Vec<u64> = (0..500).map(|_| b.next_u64()).collect();
    let a2: Vec<u64> = (0..100).map(|_| a.next_u64()).collect();

    let mut c = Rng::from_seed(77);
    let c1: Vec<u64> = (0..100).map(|_| c.next_u64()).collect();
    let c2: Vec<u64> = (0..100).map(|_| c.next_u64()).collect();

    assert_eq!(a1, c1);
    assert_eq!(a2, c2);

    // clone は状態ごと複製される
    let mut d = Rng::from_seed(5);
    let _ = d.next_u64();
    let mut e = d.clone();
    assert_eq!(d.next_u64(), e.next_u64());
}

#[test]
fn rng_state_hash_does_not_consume() {
    let mut r = Rng::from_seed(123);
    let h1 = r.state_hash();
    let h2 = r.state_hash();
    assert_eq!(h1, h2, "state_hash must not advance the stream");
    let v = r.next_u64();
    assert_ne!(r.state_hash(), h1);
    // 同じ手順を再現できる
    let mut r2 = Rng::from_seed(123);
    assert_eq!(r2.state_hash(), h1);
    assert_eq!(r2.next_u64(), v);
}

#[test]
fn rng_next_f64_speed() {
    let mut r = Rng::from_seed(1);
    const N: usize = 2_000_000;
    let t = std::time::Instant::now();
    let mut acc = 0.0;
    for _ in 0..N {
        acc += r.next_f64();
    }
    std::hint::black_box(acc);
    let ns = t.elapsed().as_nanos() as f64 / N as f64;
    println!("Rng::next_f64: {ns:.2} ns/call");
    assert!(ns < 50.0, "next_f64 too slow: {ns} ns/call");
}

// ---------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------

#[test]
fn util_basic_interpolation() {
    assert_eq!(clamp(5.0, 0.0, 1.0), 1.0);
    assert_eq!(clamp(-5.0, 0.0, 1.0), 0.0);
    assert_eq!(clamp(0.5, 0.0, 1.0), 0.5);
    assert_eq!(saturate(2.0), 1.0);
    assert_eq!(saturate(-2.0), 0.0);

    assert_relative_eq!(lerp(10.0, 20.0, 0.25), 12.5, epsilon = 1e-12);
    assert_relative_eq!(inverse_lerp(10.0, 20.0, 12.5), 0.25, epsilon = 1e-12);
    // 退化した範囲でゼロ除算しない
    assert_eq!(inverse_lerp(3.0, 3.0, 5.0), 0.0);
    assert_relative_eq!(remap(5.0, 0.0, 10.0, 100.0, 200.0), 150.0, epsilon = 1e-12);

    assert_eq!(smoothstep(0.0, 1.0, -1.0), 0.0);
    assert_eq!(smoothstep(0.0, 1.0, 2.0), 1.0);
    assert_relative_eq!(smoothstep(0.0, 1.0, 0.5), 0.5, epsilon = 1e-12);
    assert_relative_eq!(smootherstep(0.0, 1.0, 0.5), 0.5, epsilon = 1e-12);
    assert_eq!(smootherstep(0.0, 1.0, 1.5), 1.0);
}

#[test]
fn util_move_towards() {
    // レート制限を超えない
    assert_relative_eq!(move_towards(0.0, 1.0, 0.1), 0.1, epsilon = 1e-12);
    assert_relative_eq!(move_towards(0.0, -1.0, 0.1), -0.1, epsilon = 1e-12);
    // 目標に到達したら止まる（オーバーシュートしない）
    assert_eq!(move_towards(0.95, 1.0, 0.1), 1.0);
    assert_eq!(move_towards(1.0, 1.0, 0.1), 1.0);
    // 負のレートは 0 として扱う（後退しない）
    assert_eq!(move_towards(0.3, 1.0, -0.5), 0.3);

    // 連続適用でステップ幅が常に上限以内であること。
    // これが「Steering が不連続に振動しない」の数値的保証の核。
    let max_delta = 0.05;
    let mut cur = 0.0;
    let targets = [1.0, -1.0, 1.0, 0.0, -0.7];
    for &tgt in &targets {
        for _ in 0..100 {
            let next = move_towards(cur, tgt, max_delta);
            assert!(
                (next - cur).abs() <= max_delta + 1e-12,
                "rate limit violated: {cur} -> {next}"
            );
            cur = next;
        }
        assert_relative_eq!(cur, tgt, epsilon = 1e-9);
    }
}

#[test]
fn util_approach_exponential() {
    // 時定数 tau で 1 - 1/e ≈ 63.2% まで近づく
    let tau = 0.2;
    let v = approach_exponential(0.0, 1.0, tau, tau);
    assert_relative_eq!(v, 1.0 - (-1.0f64).exp(), epsilon = 1e-12);

    // 時定数 0 は即時
    assert_eq!(approach_exponential(0.0, 1.0, 0.0, 0.016), 1.0);
    assert_eq!(approach_exponential(0.0, 1.0, -1.0, 0.016), 1.0);

    // オーバーシュートしない / 単調に近づく。
    // 収束後は浮動小数の飽和で cur == prev となるため、非減少で判定する。
    let mut cur = 0.0;
    let mut prev = -1.0;
    for _ in 0..1000 {
        cur = approach_exponential(cur, 1.0, 0.1, 1.0 / 240.0);
        assert!(cur <= 1.0 + 1e-12, "overshoot: {cur}");
        assert!(cur >= prev, "not monotonic: {prev} -> {cur}");
        prev = cur;
    }
    assert_relative_eq!(cur, 1.0, epsilon = 1e-6);

    // 下降方向でも同様
    let mut cur = 1.0;
    for _ in 0..1000 {
        let next = approach_exponential(cur, 0.0, 0.1, 1.0 / 240.0);
        assert!(
            next >= -1e-12 && next <= cur,
            "descent violated: {cur} -> {next}"
        );
        cur = next;
    }
    assert_relative_eq!(cur, 0.0, epsilon = 1e-6);

    // dt を分割しても総量がほぼ一致する（フレームレート非依存）
    let one_step = approach_exponential(0.0, 1.0, 0.5, 0.1);
    let mut split = 0.0;
    for _ in 0..10 {
        split = approach_exponential(split, 1.0, 0.5, 0.01);
    }
    assert_relative_eq!(one_step, split, epsilon = 1e-12);
}

#[test]
fn util_wrap_angle() {
    assert_relative_eq!(wrap_angle(0.0), 0.0, epsilon = 1e-12);
    assert_relative_eq!(wrap_angle(PI), PI, epsilon = 1e-12);
    assert_relative_eq!(wrap_angle(-PI), PI, epsilon = 1e-12);
    assert_relative_eq!(wrap_angle(3.0 * PI), PI, epsilon = 1e-12);
    assert_relative_eq!(wrap_angle(-3.0 * PI), PI, epsilon = 1e-12);
    assert_relative_eq!(wrap_angle(1.5 * PI), -0.5 * PI, epsilon = 1e-12);
    assert_relative_eq!(wrap_angle(-1.5 * PI), 0.5 * PI, epsilon = 1e-12);

    // 常に (-PI, PI] に収まる
    let mut r = Rng::from_seed(9);
    for _ in 0..100_000 {
        let a = r.range_f64(-100.0, 100.0);
        let w = wrap_angle(a);
        assert!(w > -PI - 1e-12 && w <= PI + 1e-12, "wrap_angle({a}) = {w}");
        // 元の角度と等価であること
        let diff = ((a - w) / (2.0 * PI)).round() * 2.0 * PI - (a - w);
        assert!(diff.abs() < 1e-9, "wrap changed the angle: {a} -> {w}");
    }

    assert_relative_eq!(
        signed_angle_delta(0.9 * PI, -0.9 * PI),
        0.2 * PI,
        epsilon = 1e-12
    );
    assert_relative_eq!(
        signed_angle_delta(-0.9 * PI, 0.9 * PI),
        -0.2 * PI,
        epsilon = 1e-12
    );
}
