//! 決定的乱数生成器。
//!
//! # 原則（PROJECT.md §5 / §7）
//!
//! - グローバル状態・時刻依存を **一切持たない**
//! - 乱数は「結果」ではなく「原因」に作用させる
//!   （reaction / decision / confidence / risk / mistake / precision / consistency）
//! - すべての乱数ストリームは [`Rng::derive`] により親シードから決定的に派生する
//!
//! アルゴリズムは xoshiro256** (生成) + SplitMix64 (シード拡張)。
//! いずれも整数演算のみで構成されるため、プラットフォーム間でビット一致する。

/// 決定的疑似乱数生成器。
///
/// `Clone` は状態ごと複製する。分岐したシミュレーションを走らせる場合に使える。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rng {
    s: [u64; 4],
}

/// SplitMix64。シード拡張専用。
#[inline]
fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// FNV-1a 64bit。ラベル文字列のハッシュに使う。
#[inline]
fn fnv1a_64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xCBF2_9CE4_8422_2325;
    for &b in bytes {
        h ^= b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01B3);
    }
    h
}

impl Rng {
    /// シードから生成器を作る。同じシードからは常に同じ列が得られる。
    pub fn from_seed(seed: u64) -> Self {
        // SplitMix64 で 256bit へ拡張する。全ゼロ状態は xoshiro が縮退するため回避する。
        let mut sm = seed;
        let mut s = [0u64; 4];
        for slot in s.iter_mut() {
            *slot = splitmix64(&mut sm);
        }
        if s == [0, 0, 0, 0] {
            s[0] = 0x9E37_79B9_7F4A_7C15;
        }
        Self { s }
    }

    /// 親から子ストリームを決定的に派生する。
    ///
    /// 同じ `(親の状態, label)` からは常に同じ子が得られる。
    /// **親の状態は変化しない**（`&self`）ため、派生の順序に結果が依存しない。
    ///
    /// ```
    /// use sim_math::Rng;
    /// let race = Rng::from_seed(42);
    /// let a1 = race.derive("driver:07:perception");
    /// let a2 = race.derive("driver:07:perception");
    /// let b  = race.derive("driver:07:mistake");
    /// assert_eq!(a1, a2);
    /// assert_ne!(a1, b);
    /// ```
    pub fn derive(&self, label: &str) -> Rng {
        let mut sm = self.state_hash() ^ fnv1a_64(label.as_bytes());
        // ラベルハッシュが 0 になるケースでも縮退しないよう定数を混ぜる。
        sm = sm.wrapping_add(0x2545_F491_4F6C_DD1D);
        let mut s = [0u64; 4];
        for slot in s.iter_mut() {
            *slot = splitmix64(&mut sm);
        }
        if s == [0, 0, 0, 0] {
            s[0] = 0x9E37_79B9_7F4A_7C15;
        }
        Rng { s }
    }

    /// xoshiro256** の 1 ステップ。
    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;
        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);
        result
    }

    /// `[0, 1)` の一様乱数。上位 53bit を使う。
    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        // 2^-53。f64 の仮数部にちょうど収まるため丸め誤差が入らない。
        const SCALE: f64 = 1.0 / (1u64 << 53) as f64;
        (self.next_u64() >> 11) as f64 * SCALE
    }

    /// `[lo, hi)` の一様乱数。`lo >= hi` の場合は `lo` を返す。
    #[inline]
    pub fn range_f64(&mut self, lo: f64, hi: f64) -> f64 {
        if lo >= hi {
            return lo;
        }
        lo + self.next_f64() * (hi - lo)
    }

    /// `[lo, hi)` の一様整数。`lo >= hi` の場合は `lo` を返す。
    ///
    /// Lemire の除算削減法により、剰余バイアスを排除する。
    #[inline]
    pub fn range_i64(&mut self, lo: i64, hi: i64) -> i64 {
        if lo >= hi {
            return lo;
        }
        let span = (hi as i128 - lo as i128) as u128 as u64;
        lo.wrapping_add(self.bounded_u64(span) as i64)
    }

    /// `[0, bound)` の一様整数。`bound == 0` なら 0。
    #[inline]
    fn bounded_u64(&mut self, bound: u64) -> u64 {
        if bound == 0 {
            return 0;
        }
        // Lemire: 乗算の上位語を使い、閾値未満のときだけ棄却する。
        let mut m = (self.next_u64() as u128).wrapping_mul(bound as u128);
        let mut low = m as u64;
        if low < bound {
            let threshold = bound.wrapping_neg() % bound;
            while low < threshold {
                m = (self.next_u64() as u128).wrapping_mul(bound as u128);
                low = m as u64;
            }
        }
        (m >> 64) as u64
    }

    /// 確率 `p` で `true`。`p` は `[0, 1]` に丸められる。
    #[inline]
    pub fn bool_with_probability(&mut self, p: f64) -> bool {
        self.next_f64() < crate::util::saturate(p)
    }

    /// 正規分布。ドライバーの誤差モデルで多用する。
    ///
    /// Box-Muller 変換。**キャッシュを持たない**（毎回 2 つの一様乱数を消費する）。
    /// キャッシュを持つと呼び出し順で結果が変わり決定性の検証が困難になるため、
    /// これは意図的な設計判断である（DECISIONS.md / TODO.md TASK-1A-1）。
    #[inline]
    pub fn normal(&mut self, mean: f64, std_dev: f64) -> f64 {
        // u1 == 0 だと ln が -inf になるため下限を与える。
        let u1 = self.next_f64().max(f64::MIN_POSITIVE);
        let u2 = self.next_f64();
        let z = (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos();
        mean + z * std_dev
    }

    /// `mean ± n_sigma * std_dev` に丸めた正規分布。
    ///
    /// 外れ値がシミュレーションを破綻させないよう、能力値由来のノイズには
    /// 原則こちらを使う。
    #[inline]
    pub fn normal_clamped(&mut self, mean: f64, std_dev: f64, n_sigma: f64) -> f64 {
        let n = n_sigma.abs();
        let limit = std_dev.abs() * n;
        crate::util::clamp(self.normal(mean, std_dev), mean - limit, mean + limit)
    }

    /// 現在の内部状態のハッシュ。決定性テストと [`Rng::derive`] で使う。
    ///
    /// 状態を消費しない（`&self`）。
    #[inline]
    pub fn state_hash(&self) -> u64 {
        let mut h = 0xCBF2_9CE4_8422_2325u64;
        for &w in &self.s {
            h ^= w;
            h = h.wrapping_mul(0x0000_0100_0000_01B3);
            h ^= h >> 29;
        }
        // SplitMix64 のファイナライザで雪崩効果を確保する。
        h = (h ^ (h >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        h = (h ^ (h >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        h ^ (h >> 31)
    }
}
