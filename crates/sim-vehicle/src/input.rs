//! ドライバーが生成できる操作。

/// ドライバーが生成できる操作。**これ以外の手段で車両を動かしてはならない。**
///
/// AI は Transform / Position / Velocity を直接書き換えられない。出せるのはこの構造体だけである。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct ControlInput {
    /// ステアリング。`-1.0`（左いっぱい）〜 `+1.0`（右いっぱい）。
    pub steer: f64,
    /// スロットル `0.0..=1.0`。
    pub throttle: f64,
    /// ブレーキ `0.0..=1.0`。
    pub brake: f64,
    /// クラッチ `0.0`（接続）〜 `1.0`（切断）。
    pub clutch: f64,
    /// 要求ギア。`-1` = リバース、`0` = ニュートラル、`1..=n`。
    pub gear: i8,
    /// DRS / ブースト。Phase 1B では受け取るのみで効果はない。
    pub drs: bool,
}

/// 非有限値を `fallback` に落としてから `[lo, hi]` へクランプする。
///
/// `f64::clamp` は `NaN` を `NaN` のまま返すため、そのままでは
/// 不正入力が物理へ流れ込む（T-VEH-13）。
fn sanitize(x: f64, lo: f64, hi: f64, fallback: f64) -> f64 {
    if x.is_finite() {
        x.clamp(lo, hi)
    } else {
        fallback
    }
}

impl ControlInput {
    /// 全成分を有効域へクランプした複製を返す。`NaN` / `inf` は安全側の既定値になる。
    ///
    /// `gear_count` は前進ギアの段数。要求ギアは `-1..=gear_count` に丸める。
    ///
    /// [`crate::Vehicle::step`] の冒頭で必ず呼ばれる。**不正値で破綻させない。**
    pub fn sanitized(&self, gear_count: usize) -> ControlInput {
        let max_gear = i8::try_from(gear_count.min(127)).unwrap_or(i8::MAX);
        ControlInput {
            steer: sanitize(self.steer, -1.0, 1.0, 0.0),
            throttle: sanitize(self.throttle, 0.0, 1.0, 0.0),
            // 非有限のブレーキは「踏んでいない」ではなく安全側（全制動）に倒す。
            brake: sanitize(self.brake, 0.0, 1.0, 1.0),
            clutch: sanitize(self.clutch, 0.0, 1.0, 0.0),
            gear: self.gear.clamp(-1, max_gear),
            drs: self.drs,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitized_clamps_out_of_range_values() {
        let raw = ControlInput {
            steer: 1e9,
            throttle: -3.0,
            brake: 12.0,
            clutch: 4.0,
            gear: 99,
            drs: true,
        };
        let c = raw.sanitized(6);
        assert_eq!(c.steer, 1.0);
        assert_eq!(c.throttle, 0.0);
        assert_eq!(c.brake, 1.0);
        assert_eq!(c.clutch, 1.0);
        assert_eq!(c.gear, 6);
    }

    #[test]
    fn sanitized_replaces_non_finite_values() {
        let raw = ControlInput {
            steer: f64::NAN,
            throttle: f64::INFINITY,
            brake: f64::NAN,
            clutch: f64::NEG_INFINITY,
            gear: -5,
            drs: false,
        };
        let c = raw.sanitized(6);
        assert_eq!(c.steer, 0.0);
        assert_eq!(c.throttle, 0.0);
        assert_eq!(c.brake, 1.0);
        assert_eq!(c.clutch, 0.0);
        assert_eq!(c.gear, -1);
        assert!(c.steer.is_finite() && c.throttle.is_finite() && c.clutch.is_finite());
    }
}
