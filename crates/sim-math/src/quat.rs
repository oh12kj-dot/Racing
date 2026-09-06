//! 姿勢表現（単位四元数）。
//!
//! # オイラー角規約（変更禁止）
//!
//! 回転順序は **YXZ**。すなわち合成回転は `R = Ry(yaw) * Rx(pitch) * Rz(roll)`。
//! 車両姿勢を `yaw`（方位）/ `pitch`（ダイブ・スクワット）/ `roll`（ロール）として
//! 直感的に扱えるため、この順序を採用する。

use crate::util::EPSILON;
use crate::vec::Vec3;
use std::ops::Mul;

/// 単位四元数。`w` がスカラー部。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quat {
    /// ベクトル部 X。
    pub x: f64,
    /// ベクトル部 Y。
    pub y: f64,
    /// ベクトル部 Z。
    pub z: f64,
    /// スカラー部。
    pub w: f64,
}

impl Default for Quat {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Quat {
    /// 無回転。
    pub const IDENTITY: Self = Self {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        w: 1.0,
    };

    /// 成分から生成する。正規化は行わない。
    #[inline]
    pub const fn new(x: f64, y: f64, z: f64, w: f64) -> Self {
        Self { x, y, z, w }
    }

    /// 軸と角度から生成する。軸がゼロ長なら [`Quat::IDENTITY`]。
    pub fn from_axis_angle(axis: Vec3, angle: f64) -> Self {
        match axis.try_normalize() {
            None => Self::IDENTITY,
            Some(a) => {
                let (s, c) = (angle * 0.5).sin_cos();
                Self::new(a.x * s, a.y * s, a.z * s, c)
            }
        }
    }

    /// YXZ 順（`Ry(yaw) * Rx(pitch) * Rz(roll)`）で生成する。
    pub fn from_euler_yxz(yaw: f64, pitch: f64, roll: f64) -> Self {
        let qy = Self::from_axis_angle(Vec3::Y, yaw);
        let qx = Self::from_axis_angle(Vec3::X, pitch);
        let qz = Self::from_axis_angle(Vec3::Z, roll);
        qy * qx * qz
    }

    /// YXZ 順のオイラー角 `(yaw, pitch, roll)` を取り出す。
    ///
    /// ジンバルロック（`pitch` が ±PI/2 近傍）では `roll` を 0 に固定し、
    /// `yaw` に回転をまとめる。
    pub fn to_euler_yxz(self) -> (f64, f64, f64) {
        let m = self.to_mat3();
        // R = Ry(y)Rx(p)Rz(r) のとき m[1][2] = -sin(pitch)
        let sp = crate::util::clamp(-m[1][2], -1.0, 1.0);
        let pitch = sp.asin();
        let cp = (1.0 - sp * sp).sqrt();

        if cp > 1.0e-6 {
            let roll = m[1][0].atan2(m[1][1]);
            let yaw = m[0][2].atan2(m[2][2]);
            (yaw, pitch, roll)
        } else if sp > 0.0 {
            // pitch = +PI/2: yaw - roll のみが定まる。roll = 0 とする。
            (m[0][1].atan2(m[0][0]), pitch, 0.0)
        } else {
            // pitch = -PI/2: yaw + roll のみが定まる。roll = 0 とする。
            ((-m[0][1]).atan2(m[0][0]), pitch, 0.0)
        }
    }

    /// 共役（単位四元数では逆回転）。
    #[inline]
    pub fn conjugate(self) -> Self {
        Self::new(-self.x, -self.y, -self.z, self.w)
    }

    /// 逆回転。ノルムがゼロに近い場合は [`Quat::IDENTITY`]。
    #[inline]
    pub fn inverse(self) -> Self {
        let n2 = self.norm_squared();
        if n2 <= EPSILON {
            Self::IDENTITY
        } else {
            let c = self.conjugate();
            Self::new(c.x / n2, c.y / n2, c.z / n2, c.w / n2)
        }
    }

    /// ノルムの 2 乗。
    #[inline]
    pub fn norm_squared(self) -> f64 {
        self.x * self.x + self.y * self.y + self.z * self.z + self.w * self.w
    }

    /// ノルム。単位四元数なら 1。
    #[inline]
    pub fn norm(self) -> f64 {
        self.norm_squared().sqrt()
    }

    /// 正規化する。ノルムがゼロに近い場合は [`Quat::IDENTITY`]。
    ///
    /// 積分により単位ノルムから漂流するため、物理ステップごとに呼ぶこと。
    #[inline]
    pub fn normalize(self) -> Self {
        let n = self.norm();
        if n <= EPSILON {
            Self::IDENTITY
        } else {
            Self::new(self.x / n, self.y / n, self.z / n, self.w / n)
        }
    }

    /// 4 成分の内積。2 つの回転の近さの指標。
    #[inline]
    pub fn dot(self, rhs: Self) -> f64 {
        self.x * rhs.x + self.y * rhs.y + self.z * rhs.z + self.w * rhs.w
    }

    /// ベクトルを回転する。
    #[inline]
    pub fn rotate_vec3(self, v: Vec3) -> Vec3 {
        // v' = v + 2 * q_vec x (q_vec x v + w * v)
        let u = Vec3::new(self.x, self.y, self.z);
        let t = u.cross(v) + v * self.w;
        v + u.cross(t) * 2.0
    }

    /// 行優先の 3x3 回転行列。`m[row][col]`。
    ///
    /// レンダラ / FFI への受け渡しと、オイラー角抽出に使う。
    pub fn to_mat3(self) -> [[f64; 3]; 3] {
        let q = self.normalize();
        let (x, y, z, w) = (q.x, q.y, q.z, q.w);
        let (xx, yy, zz) = (x * x, y * y, z * z);
        let (xy, xz, yz) = (x * y, x * z, y * z);
        let (wx, wy, wz) = (w * x, w * y, w * z);
        [
            [1.0 - 2.0 * (yy + zz), 2.0 * (xy - wz), 2.0 * (xz + wy)],
            [2.0 * (xy + wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz - wx)],
            [2.0 * (xz - wy), 2.0 * (yz + wx), 1.0 - 2.0 * (xx + yy)],
        ]
    }

    /// 球面線形補間。最短経路を通るよう符号を揃える。
    ///
    /// 2 つの回転がほぼ同一の場合は線形補間へ縮退させる（数値的安定性のため）。
    pub fn slerp(self, rhs: Self, t: f64) -> Self {
        let a = self.normalize();
        let mut b = rhs.normalize();
        let mut cos_theta = a.dot(b);

        if cos_theta < 0.0 {
            b = Self::new(-b.x, -b.y, -b.z, -b.w);
            cos_theta = -cos_theta;
        }

        if cos_theta > 1.0 - 1.0e-9 {
            // ほぼ同一。線形補間で十分かつ安定。
            return Self::new(
                crate::util::lerp(a.x, b.x, t),
                crate::util::lerp(a.y, b.y, t),
                crate::util::lerp(a.z, b.z, t),
                crate::util::lerp(a.w, b.w, t),
            )
            .normalize();
        }

        let theta = cos_theta.clamp(-1.0, 1.0).acos();
        let sin_theta = theta.sin();
        let wa = ((1.0 - t) * theta).sin() / sin_theta;
        let wb = (t * theta).sin() / sin_theta;
        Self::new(
            a.x * wa + b.x * wb,
            a.y * wa + b.y * wb,
            a.z * wa + b.z * wb,
            a.w * wa + b.w * wb,
        )
        .normalize()
    }

    /// NaN / 無限大を含まないか。
    #[inline]
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite() && self.w.is_finite()
    }
}

/// 回転の合成。`a * b` は「`b` を適用してから `a` を適用する」回転。
///
/// `rotate_vec3` との関係: `(a * b).rotate_vec3(v) == a.rotate_vec3(b.rotate_vec3(v))`。
impl Mul for Quat {
    type Output = Quat;

    #[inline]
    fn mul(self, rhs: Self) -> Self {
        Self::new(
            self.w * rhs.x + self.x * rhs.w + self.y * rhs.z - self.z * rhs.y,
            self.w * rhs.y - self.x * rhs.z + self.y * rhs.w + self.z * rhs.x,
            self.w * rhs.z + self.x * rhs.y - self.y * rhs.x + self.z * rhs.w,
            self.w * rhs.w - self.x * rhs.x - self.y * rhs.y - self.z * rhs.z,
        )
    }
}

/// ベクトルの回転。`q * v` は [`Quat::rotate_vec3`] と等価。
impl Mul<Vec3> for Quat {
    type Output = Vec3;

    #[inline]
    fn mul(self, rhs: Vec3) -> Vec3 {
        self.rotate_vec3(rhs)
    }
}
