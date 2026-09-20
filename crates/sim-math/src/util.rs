//! 数値ユーティリティ。
//!
//! [`move_towards`] と [`approach_exponential`] は Driver AI の制御器で必須となる。
//! ステアリング出力にこの 2 つを通すことが
//! 「Steering が不連続に振動しない」（TESTING.md T-AI-02）の構造的保証である。

use std::f64::consts::{PI, TAU};

/// 数値比較・ゼロ長判定の閾値。
pub const EPSILON: f64 = 1e-9;

/// `x` を `[lo, hi]` に丸める。`lo > hi` の場合は `lo` を返す。
#[inline]
pub fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

/// `x` を `[0, 1]` に丸める。
#[inline]
pub fn saturate(x: f64) -> f64 {
    clamp(x, 0.0, 1.0)
}

/// 線形補間。`t` は丸めない（外挿を許す）。
#[inline]
pub fn lerp(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

/// `lerp` の逆。`a == b` の場合は 0 を返す。
#[inline]
pub fn inverse_lerp(a: f64, b: f64, v: f64) -> f64 {
    let d = b - a;
    if d.abs() <= EPSILON {
        0.0
    } else {
        (v - a) / d
    }
}

/// 値域 `[in_lo, in_hi]` から `[out_lo, out_hi]` へ写す（丸めなし）。
#[inline]
pub fn remap(v: f64, in_lo: f64, in_hi: f64, out_lo: f64, out_hi: f64) -> f64 {
    lerp(out_lo, out_hi, inverse_lerp(in_lo, in_hi, v))
}

/// エルミート補間 `3t^2 - 2t^3`。`edge0 >= edge1` の場合は 0/1 のステップになる。
#[inline]
pub fn smoothstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = saturate(inverse_lerp(edge0, edge1, x));
    t * t * (3.0 - 2.0 * t)
}

/// 2 次微分まで連続な補間 `6t^5 - 15t^4 + 10t^3`。
#[inline]
pub fn smootherstep(edge0: f64, edge1: f64, x: f64) -> f64 {
    let t = saturate(inverse_lerp(edge0, edge1, x));
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// **レート制限。** `current` から `target` へ、1 ステップ最大 `max_delta` で近づける。
///
/// ステアリング・スロットル等の制御出力に必ず通すこと。
/// `max_delta` が負の場合は 0 として扱う（後退しない）。
#[inline]
pub fn move_towards(current: f64, target: f64, max_delta: f64) -> f64 {
    let d = target - current;
    let m = max_delta.max(0.0);
    if d.abs() <= m {
        target
    } else {
        current + d.signum() * m
    }
}

/// **一次遅れ。** 時定数 `time_constant` [s] で `current` を `target` へ漸近させる。
///
/// フレームレート非依存な指数減衰。`time_constant <= 0` なら即座に `target`。
/// 人間の腕・脚の帯域制限を模擬するために制御出力へ通す。
#[inline]
pub fn approach_exponential(current: f64, target: f64, time_constant: f64, dt: f64) -> f64 {
    if time_constant <= EPSILON {
        return target;
    }
    let alpha = 1.0 - (-dt / time_constant).exp();
    current + (target - current) * alpha
}

/// 角度を `(-PI, PI]` へ正規化する。
#[inline]
pub fn wrap_angle(a: f64) -> f64 {
    // rem_euclid で [0, TAU) にしてから (-PI, PI] へ移す。
    let mut w = a.rem_euclid(TAU);
    if w > PI {
        w -= TAU;
    }
    // rem_euclid は -PI ちょうどを PI に写すため、境界は PI 側に寄る。
    w
}

/// `from` から `to` への符号付き最短角度差 `(-PI, PI]`。
#[inline]
pub fn signed_angle_delta(from: f64, to: f64) -> f64 {
    wrap_angle(to - from)
}

/// `x` が有限かつ `[lo, hi]` に収まるか。不変条件チェック用。
#[inline]
pub fn is_finite_within(x: f64, lo: f64, hi: f64) -> bool {
    x.is_finite() && x >= lo && x <= hi
}
