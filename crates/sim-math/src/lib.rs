//! `sim-math` — Simulation Core の数学基盤。
//!
//! この crate は依存クレートを持たない。決定性を外部実装の変更に委ねないためであり、
//! これは設計判断である（DECISIONS.md ADR-0001）。依存の追加には Opus の承認を要する。
//!
//! # 規約（ARCHITECTURE.md と一致させること）
//!
//! - 座標系: 右手系、**Y が上**。車両ローカルでは進行方向 `+X`、横方向 `+Z`
//! - 単位: すべて SI（m, kg, s, N, rad）
//! - 浮動小数: 状態と積算はすべて `f64`。fast-math 最適化は禁止
//! - 乱数: [`Rng`] のみを使う。グローバル乱数・時刻依存乱数は禁止
//!
//! # 主要な型
//!
//! | 型 | 役割 |
//! |----|------|
//! | [`Vec2`] / [`Vec3`] | ベクトル |
//! | [`Quat`] | 姿勢 |
//! | [`CubicSpline`] | centripetal Catmull-Rom スプライン |
//! | [`ArcLengthSpline`] | 弧長 `s` [m] で参照できる再パラメータ化スプライン |
//! | [`Rng`] | 決定的乱数生成器 |

#![deny(unsafe_code)]
#![warn(missing_docs)]

pub mod quat;
pub mod rng;
pub mod spline;
pub mod util;
pub mod vec;

pub use quat::Quat;
pub use rng::Rng;
pub use spline::{ArcLengthSpline, CubicSpline, SplineError};
pub use util::{
    approach_exponential, clamp, inverse_lerp, is_finite_within, lerp, move_towards, remap,
    saturate, signed_angle_delta, smootherstep, smoothstep, wrap_angle, EPSILON,
};
pub use vec::{Vec2, Vec3};
