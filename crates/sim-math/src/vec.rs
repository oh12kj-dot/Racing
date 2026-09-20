//! ベクトル型。
//!
//! # 座標系規約（変更禁止 / ARCHITECTURE.md）
//!
//! - 右手系、**Y が上**
//! - 車両ローカルでは進行方向 `+X`、横方向 `+Z`
//! - 角度はすべてラジアン
//! - 単位はすべて SI（m, kg, s, N, rad）

use std::ops::{Add, AddAssign, Div, DivAssign, Mul, MulAssign, Neg, Sub, SubAssign};

/// 2 次元ベクトル。水平面（XZ）での計算に使う。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec2 {
    /// 第 1 成分。水平面で使う場合はワールド X。
    pub x: f64,
    /// 第 2 成分。水平面で使う場合はワールド Z（[`Vec3::xz`] 参照）。
    pub y: f64,
}

/// 3 次元ベクトル。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec3 {
    /// X 成分。
    pub x: f64,
    /// Y 成分。座標系規約により**鉛直方向**。
    pub y: f64,
    /// Z 成分。
    pub z: f64,
}

impl Vec2 {
    /// 零ベクトル。
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };
    /// X 軸の単位ベクトル。
    pub const X: Self = Self { x: 1.0, y: 0.0 };
    /// Y 軸の単位ベクトル。
    pub const Y: Self = Self { x: 0.0, y: 1.0 };

    /// 成分から生成する。
    #[inline]
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    /// 全成分を同じ値で埋める。
    #[inline]
    pub const fn splat(v: f64) -> Self {
        Self { x: v, y: v }
    }

    /// 内積。
    #[inline]
    pub fn dot(self, rhs: Self) -> f64 {
        self.x * rhs.x + self.y * rhs.y
    }

    /// 2D の外積相当（z 成分）。`self` から `rhs` への回転方向の符号に使う。
    #[inline]
    pub fn perp_dot(self, rhs: Self) -> f64 {
        self.x * rhs.y - self.y * rhs.x
    }

    /// 反時計回りに 90 度回した垂直ベクトル。
    #[inline]
    pub fn perp(self) -> Self {
        Self::new(-self.y, self.x)
    }

    /// 長さの 2 乗。平方根を避けたい比較で使う。
    #[inline]
    pub fn length_squared(self) -> f64 {
        self.dot(self)
    }

    /// 長さ [m]。
    #[inline]
    pub fn length(self) -> f64 {
        self.length_squared().sqrt()
    }

    /// 正規化する。長さが `EPSILON` 以下の場合は [`Vec2::ZERO`] を返す。
    /// ゼロ長を検出したい場合は [`Vec2::try_normalize`] を使うこと。
    #[inline]
    pub fn normalize(self) -> Self {
        self.try_normalize().unwrap_or(Self::ZERO)
    }

    /// 正規化する。長さが `EPSILON` 以下なら `None`。
    #[inline]
    pub fn try_normalize(self) -> Option<Self> {
        let len = self.length();
        if len <= crate::util::EPSILON {
            None
        } else {
            Some(self / len)
        }
    }

    /// 2 点間の距離。
    #[inline]
    pub fn distance(self, rhs: Self) -> f64 {
        (self - rhs).length()
    }

    /// 2 点間の距離の 2 乗。
    #[inline]
    pub fn distance_squared(self, rhs: Self) -> f64 {
        (self - rhs).length_squared()
    }

    /// 線形補間。`t` は丸めない（外挿を許す）。
    #[inline]
    pub fn lerp(self, rhs: Self, t: f64) -> Self {
        self + (rhs - self) * t
    }

    /// `self` を `onto` 方向へ射影する。`onto` がゼロ長なら [`Vec2::ZERO`]。
    #[inline]
    pub fn project_onto(self, onto: Self) -> Self {
        let l2 = onto.length_squared();
        if l2 <= crate::util::EPSILON {
            Self::ZERO
        } else {
            onto * (self.dot(onto) / l2)
        }
    }

    /// `self` から `from` 方向成分を取り除いた残差。
    #[inline]
    pub fn reject_from(self, from: Self) -> Self {
        self - self.project_onto(from)
    }

    /// 2 ベクトルのなす角 [0, PI]。どちらかがゼロ長なら 0。
    #[inline]
    pub fn angle_between(self, rhs: Self) -> f64 {
        match (self.try_normalize(), rhs.try_normalize()) {
            (Some(a), Some(b)) => a.dot(b).clamp(-1.0, 1.0).acos(),
            _ => 0.0,
        }
    }

    /// 符号付きの角度差 (-PI, PI]。反時計回りが正。
    #[inline]
    pub fn signed_angle_to(self, rhs: Self) -> f64 {
        self.perp_dot(rhs).atan2(self.dot(rhs))
    }

    /// 水平面ベクトルを Y=0 の 3D ベクトルへ持ち上げる。
    #[inline]
    pub fn to_xz(self) -> Vec3 {
        Vec3::new(self.x, 0.0, self.y)
    }

    /// NaN / 無限大を含まないか。テストと不変条件チェックで使う。
    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }
}

impl Vec3 {
    /// 零ベクトル。
    pub const ZERO: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
    };
    /// X 軸の単位ベクトル。
    pub const X: Self = Self {
        x: 1.0,
        y: 0.0,
        z: 0.0,
    };
    /// Y 軸の単位ベクトル。
    pub const Y: Self = Self {
        x: 0.0,
        y: 1.0,
        z: 0.0,
    };
    /// Z 軸の単位ベクトル。
    pub const Z: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 1.0,
    };
    /// 鉛直上方向。座標系規約により `+Y`。
    pub const UP: Self = Self::Y;

    /// 成分から生成する。
    #[inline]
    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    /// 全成分を同じ値で埋める。
    #[inline]
    pub const fn splat(v: f64) -> Self {
        Self { x: v, y: v, z: v }
    }

    /// 内積。
    #[inline]
    pub fn dot(self, rhs: Self) -> f64 {
        self.x * rhs.x + self.y * rhs.y + self.z * rhs.z
    }

    /// 外積。
    #[inline]
    pub fn cross(self, rhs: Self) -> Self {
        Self::new(
            self.y * rhs.z - self.z * rhs.y,
            self.z * rhs.x - self.x * rhs.z,
            self.x * rhs.y - self.y * rhs.x,
        )
    }

    /// 長さの 2 乗。平方根を避けたい比較で使う。
    #[inline]
    pub fn length_squared(self) -> f64 {
        self.dot(self)
    }

    /// 長さ [m]。
    #[inline]
    pub fn length(self) -> f64 {
        self.length_squared().sqrt()
    }

    /// 正規化する。長さが `EPSILON` 以下の場合は [`Vec3::ZERO`] を返す。
    #[inline]
    pub fn normalize(self) -> Self {
        self.try_normalize().unwrap_or(Self::ZERO)
    }

    /// 正規化する。長さが `EPSILON` 以下なら `None`。
    #[inline]
    pub fn try_normalize(self) -> Option<Self> {
        let len = self.length();
        if len <= crate::util::EPSILON {
            None
        } else {
            Some(self / len)
        }
    }

    /// 2 点間の距離。
    #[inline]
    pub fn distance(self, rhs: Self) -> f64 {
        (self - rhs).length()
    }

    /// 2 点間の距離の 2 乗。
    #[inline]
    pub fn distance_squared(self, rhs: Self) -> f64 {
        (self - rhs).length_squared()
    }

    /// 線形補間。`t` は丸めない（外挿を許す）。
    #[inline]
    pub fn lerp(self, rhs: Self, t: f64) -> Self {
        self + (rhs - self) * t
    }

    /// `self` を `onto` 方向へ射影する。`onto` がゼロ長なら [`Vec3::ZERO`]。
    #[inline]
    pub fn project_onto(self, onto: Self) -> Self {
        let l2 = onto.length_squared();
        if l2 <= crate::util::EPSILON {
            Self::ZERO
        } else {
            onto * (self.dot(onto) / l2)
        }
    }

    /// `self` から `from` 方向成分を取り除いた残差。
    #[inline]
    pub fn reject_from(self, from: Self) -> Self {
        self - self.project_onto(from)
    }

    /// 2 ベクトルのなす角 [0, PI]。どちらかがゼロ長なら 0。
    #[inline]
    pub fn angle_between(self, rhs: Self) -> f64 {
        match (self.try_normalize(), rhs.try_normalize()) {
            (Some(a), Some(b)) => a.dot(b).clamp(-1.0, 1.0).acos(),
            _ => 0.0,
        }
    }

    /// 水平面（XZ）への投影。トラック座標計算で多用する。
    #[inline]
    pub fn xz(self) -> Vec2 {
        Vec2::new(self.x, self.z)
    }

    /// 鉛直成分を取り除いた水平ベクトル。
    #[inline]
    pub fn horizontal(self) -> Self {
        Self::new(self.x, 0.0, self.z)
    }

    /// NaN / 無限大を含まないか。テストと不変条件チェックで使う。
    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
}

// ---------------------------------------------------------------------------
// 演算子
// ---------------------------------------------------------------------------

macro_rules! impl_vec_ops {
    ($t:ty, $($field:ident),+) => {
        impl Add for $t {
            type Output = Self;
            #[inline]
            fn add(self, rhs: Self) -> Self { Self { $($field: self.$field + rhs.$field),+ } }
        }
        impl Sub for $t {
            type Output = Self;
            #[inline]
            fn sub(self, rhs: Self) -> Self { Self { $($field: self.$field - rhs.$field),+ } }
        }
        impl Mul<f64> for $t {
            type Output = Self;
            #[inline]
            fn mul(self, rhs: f64) -> Self { Self { $($field: self.$field * rhs),+ } }
        }
        impl Mul<$t> for f64 {
            type Output = $t;
            #[inline]
            fn mul(self, rhs: $t) -> $t { rhs * self }
        }
        impl Div<f64> for $t {
            type Output = Self;
            #[inline]
            fn div(self, rhs: f64) -> Self { Self { $($field: self.$field / rhs),+ } }
        }
        impl Neg for $t {
            type Output = Self;
            #[inline]
            fn neg(self) -> Self { Self { $($field: -self.$field),+ } }
        }
        impl AddAssign for $t {
            #[inline]
            fn add_assign(&mut self, rhs: Self) { $(self.$field += rhs.$field;)+ }
        }
        impl SubAssign for $t {
            #[inline]
            fn sub_assign(&mut self, rhs: Self) { $(self.$field -= rhs.$field;)+ }
        }
        impl MulAssign<f64> for $t {
            #[inline]
            fn mul_assign(&mut self, rhs: f64) { $(self.$field *= rhs;)+ }
        }
        impl DivAssign<f64> for $t {
            #[inline]
            fn div_assign(&mut self, rhs: f64) { $(self.$field /= rhs;)+ }
        }
    };
}

impl_vec_ops!(Vec2, x, y);
impl_vec_ops!(Vec3, x, y, z);
