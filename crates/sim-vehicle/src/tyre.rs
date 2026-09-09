//! 簡略 Pacejka Magic Formula と、低速域の静止摩擦ばね。
//!
//! この crate の**最大のリスクは低速での Pacejka 発散**である
//! （`docs/phase-1b-vehicle.md` Known Risks R3）。対策は 4 つあり、
//! すべてここに実装されている。
//!
//! 1. **緩和長**（[`RELAXATION_MIN_SPEED`] / `relaxation_length`）
//!    — 生のスリップ値を直接使わない
//! 2. **低速ブレンド**（[`LOW_SPEED_BLEND`]）— `v -> 0` でタイヤ力を静止摩擦ばねへ渡す
//! 3. **静止摩擦ばね** — 接地点の滑り変位に比例する力。摩擦円で頭打ちにして滑らせる
//! 4. **サブステップ**（`crate::WHEEL_SUBSTEPS`）— 呼び出し側が 960 Hz で回す
//!
//! ここを自己流にするとグリッドスタートとピットで必ず破綻する。

use crate::params::{Derived, TyreParams};
use sim_math::util::{approach_exponential, smoothstep};

/// スリップ比 / スリップ角の分母の下限 [m/s]。低速ブレンドの上端も兼ねる。
pub const LOW_SPEED_BLEND: f64 = 2.0;

/// 緩和の進行速度に使う速度の下限 [m/s]。停止中でも緩和が進むようにする。
pub const RELAXATION_MIN_SPEED: f64 = 1.0;

/// スリップ比の絶対値の上限。数値上の暴走を防ぐだけで、通常は到達しない。
const SLIP_RATIO_LIMIT: f64 = 50.0;

/// タイヤの持続状態。緩和後のスリップと、静止摩擦ばねの滑り変位。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct TyreMemory {
    pub slip_ratio: f64,
    pub slip_angle: f64,
    /// 接地点の滑り変位（車輪前方向）[m]。
    pub stick_long: f64,
    /// 接地点の滑り変位（車輪右方向）[m]。
    pub stick_lat: f64,
}

impl TyreMemory {
    /// 接地を失ったときにリセットする。浮いている間に変位が育つのを防ぐ。
    pub fn reset(&mut self) {
        *self = TyreMemory::default();
    }
}

/// 1 輪 1 サブステップぶんの入力。
pub(crate) struct TyreInput {
    /// 垂直荷重 [N]。
    pub load: f64,
    /// 路面グリップ倍率。
    pub grip: f64,
    /// 接地点速度の縦成分（車輪前方向が正）[m/s]。
    pub v_long: f64,
    /// 接地点速度の横成分（車輪右方向が正）[m/s]。
    pub v_lat: f64,
    /// 車輪角速度 [rad/s]。
    pub spin: f64,
    /// 転がり有効半径 [m]。
    pub radius: f64,
}

/// 1 輪 1 サブステップぶんの出力。
pub(crate) struct TyreOutput {
    /// 縦力（車輪前方向が正）[N]。
    pub force_long: f64,
    /// 横力（車輪右方向が正）[N]。
    pub force_lat: f64,
    /// 摩擦円の半径 `mu * load` [N]。
    pub friction_limit: f64,
    /// 摩擦円の使用率 `0..1`。
    pub grip_usage: f64,
}

/// 荷重感度つきの実効摩擦係数。
fn effective_mu(p: &TyreParams, d: &Derived, load: f64, grip: f64) -> f64 {
    let ratio = load / d.nominal_load;
    let denom = 1.0 + p.load_sensitivity * (ratio - 1.0);
    // 荷重が極端に小さいと denom が 1 未満になって mu が跳ね上がる。上下限で抑える。
    let sensitivity = (1.0 / denom.max(0.2)).clamp(0.2, 2.0);
    p.mu0 * grip * sensitivity
}

/// タイヤ力を 1 サブステップぶん計算し、[`TyreMemory`] を進める。
///
/// **合成後の力は必ず `mu * load` 以下になる**（T-VEH-07）。
/// Magic Formula 側は `|Fx0| <= mu*load` かつ `|Fy0| <= mu*load` であり、
/// 摩擦円配分により `sqrt(Fx^2+Fy^2) <= mu*load`。静止摩擦ばね側も同じ上限で
/// 頭打ちにしてあるため、両者の凸結合もこの上限を超えない。
pub(crate) fn step_tyre(
    p: &TyreParams,
    d: &Derived,
    input: &TyreInput,
    mem: &mut TyreMemory,
    dt: f64,
) -> TyreOutput {
    let v_abs = input.v_long.abs();
    let v_ref = v_abs.max(LOW_SPEED_BLEND);

    // --- 生のスリップ ---------------------------------------------------------------
    let kappa_raw = ((input.spin * input.radius - input.v_long) / v_ref)
        .clamp(-SLIP_RATIO_LIMIT, SLIP_RATIO_LIMIT);
    let alpha_raw = input.v_lat.atan2(v_ref);

    // --- 緩和（relaxation length）------------------------------------------------------
    // 距離定数 L_relax を時間定数へ変換する。停止中は RELAXATION_MIN_SPEED を使う。
    let time_constant = p.relaxation_length / v_abs.max(RELAXATION_MIN_SPEED);
    mem.slip_ratio = approach_exponential(mem.slip_ratio, kappa_raw, time_constant, dt);
    mem.slip_angle = approach_exponential(mem.slip_angle, alpha_raw, time_constant, dt);

    let mu = effective_mu(p, d, input.load, input.grip);
    let limit = mu * input.load;

    if input.load <= 0.0 || limit <= 0.0 {
        mem.stick_long = 0.0;
        mem.stick_lat = 0.0;
        return TyreOutput {
            force_long: 0.0,
            force_lat: 0.0,
            friction_limit: 0.0,
            grip_usage: 0.0,
        };
    }

    // --- Magic Formula --------------------------------------------------------------
    let kappa = mem.slip_ratio;
    let alpha = mem.slip_angle;
    let fx0 = limit * (p.cx * (p.bx * kappa).atan()).sin();
    // 横力は横滑りに逆らう向き。alpha が正（右へ滑る）なら力は左（負）。
    let fy0 = -limit * (p.cy * (p.by * alpha).atan()).sin();

    let sn = kappa / d.kappa_peak;
    let sa = alpha / d.alpha_peak;
    let sigma = (sn * sn + sa * sa).sqrt();
    let (fx_mf, fy_mf) = if sigma > 1.0e-9 {
        (fx0 * sn.abs() / sigma, fy0 * sa.abs() / sigma)
    } else {
        (0.0, 0.0)
    };

    // --- 静止摩擦ばね ----------------------------------------------------------------
    // 接地点の滑り速度。縦は「路面に対する接地点の速度」= v_long - spin * r。
    let slip_vel_long = input.v_long - input.spin * input.radius;
    let slip_vel_lat = input.v_lat;
    mem.stick_long += slip_vel_long * dt;
    mem.stick_lat += slip_vel_lat * dt;

    let k_stick = input.load * p.stick_stiffness_per_n;
    let c_stick = 2.0 * p.stick_damping_ratio * (k_stick * d.corner_mass).sqrt();
    let mut fsx = -k_stick * mem.stick_long - c_stick * slip_vel_long;
    let mut fsy = -k_stick * mem.stick_lat - c_stick * slip_vel_lat;
    let fs = (fsx * fsx + fsy * fsy).sqrt();
    if fs > limit {
        // 摩擦円を超えたら滑らせる。変位を円上へ引き戻すことで減衰させる。
        let scale = limit / fs;
        fsx *= scale;
        fsy *= scale;
        if k_stick > 1.0e-9 {
            mem.stick_long = -fsx / k_stick;
            mem.stick_lat = -fsy / k_stick;
        }
    }

    // --- 低速ブレンド ----------------------------------------------------------------
    let w = smoothstep(0.0, LOW_SPEED_BLEND, v_abs);
    let force_long = w * fx_mf + (1.0 - w) * fsx;
    let force_lat = w * fy_mf + (1.0 - w) * fsy;

    let magnitude = (force_long * force_long + force_lat * force_lat).sqrt();
    TyreOutput {
        force_long,
        force_lat,
        friction_limit: limit,
        grip_usage: (magnitude / limit).min(1.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::params::VehicleParams;

    fn test_params() -> VehicleParams {
        crate::vehicle::tests_support::sample_params()
    }

    #[test]
    fn force_never_exceeds_friction_circle() {
        let p = test_params();
        let d = Derived::new(&p);
        let mut mem = TyreMemory::default();
        // 極端なスリップを与え続けても摩擦円を超えないこと。
        for i in 0..2000 {
            let v = (i as f64) * 0.05;
            let out = step_tyre(
                &p.tyre,
                &d,
                &TyreInput {
                    load: 3000.0,
                    grip: 1.0,
                    v_long: v,
                    v_lat: 12.0,
                    spin: 400.0,
                    radius: 0.35,
                },
                &mut mem,
                1.0 / 960.0,
            );
            let mag = (out.force_long * out.force_long + out.force_lat * out.force_lat).sqrt();
            assert!(
                mag <= out.friction_limit * 1.000_001,
                "step {i}: |F| = {mag} > limit {}",
                out.friction_limit
            );
        }
    }

    #[test]
    fn zero_load_produces_zero_force() {
        let p = test_params();
        let d = Derived::new(&p);
        let mut mem = TyreMemory::default();
        let out = step_tyre(
            &p.tyre,
            &d,
            &TyreInput {
                load: 0.0,
                grip: 1.0,
                v_long: 30.0,
                v_lat: 5.0,
                spin: 0.0,
                radius: 0.35,
            },
            &mut mem,
            1.0 / 960.0,
        );
        assert_eq!(out.force_long, 0.0);
        assert_eq!(out.force_lat, 0.0);
    }

    #[test]
    fn locked_wheel_slip_ratio_approaches_minus_one() {
        let p = test_params();
        let d = Derived::new(&p);
        let mut mem = TyreMemory::default();
        for _ in 0..4000 {
            step_tyre(
                &p.tyre,
                &d,
                &TyreInput {
                    load: 3000.0,
                    grip: 1.0,
                    v_long: 30.0,
                    v_lat: 0.0,
                    spin: 0.0,
                    radius: 0.35,
                },
                &mut mem,
                1.0 / 960.0,
            );
        }
        assert!(
            (mem.slip_ratio + 1.0).abs() < 1.0e-3,
            "slip_ratio = {}",
            mem.slip_ratio
        );
    }
}
