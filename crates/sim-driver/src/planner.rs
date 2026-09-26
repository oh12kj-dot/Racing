//! Planner 層 — Decision の意図から `t_target` / `v_target` / 先読み距離を作る。
//!
//! **二重補正の禁止**（Quality Gate 対象）:
//! - バンクによるコーナリング速度の有利/不利は [`SpeedProfile`] に織り込み済み
//!   （`bank_assist = -g·sin(bank)·sign(κ)`）。Planner / Controller で再補正しない。
//! - 標高勾配の along-track 重力成分（Aoyama 最大 ≈ 0.407 m/s²）は [`SpeedProfile`] が
//!   **未考慮**（TASK-2-1 申し送り R8）。下り braking zone がわずかに楽観的だが、
//!   本層で勾配項を足して埋めてはならない（`SpeedProfile` 側と併せて直すべき債務）。
//! - 曲率は必ず [`Trajectory::curvature_at`]。`Track::frame_at().curvature`
//!   （センターライン曲率）は継ぎ目にオーバーシュートが残る（TASK-1A-5 LOW-1）。

use crate::decision::{DriverIntent, DriverMode};
use crate::model::DriverModel;
use crate::perception::PerceivedSelf;
use crate::SIM_DT;
use sim_line::{Corridor, PerformanceEnvelope, SpeedProfile, Trajectory};
use sim_math::{approach_exponential, clamp, lerp};
use sim_track::Track;
use sim_vehicle::{AIR_DENSITY, GRAVITY};

/// Planner 1 tick の出力。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plan {
    /// 目標横位置 [m]（トラック局所 `t`。+t が左）。`Corridor` のクランプが唯一の出口。
    pub t_target: f64,
    /// 目標速度 [m/s]。**必ず `0 <= v_target <= speed_profile.v_at(s)`**（T-AI-04）。
    pub v_target: f64,
    /// Pure Pursuit の先読み距離 [m]。
    pub lookahead_m: f64,
    /// 先読み地点の弧長（デバッグ / Engineering View 用）。
    pub aim_s: f64,
}

impl Plan {
    pub(crate) fn zeroed() -> Plan {
        Plan {
            t_target: 0.0,
            v_target: 0.0,
            lookahead_m: LOOKAHEAD_MIN_M,
            aim_s: 0.0,
        }
    }
}

/// `t_target` の時間平滑化の時定数 [s]（C1 性を保つ。T-AI-03）。
const TAU_T_TARGET: f64 = 0.25;
/// `pace = 0` のときの目標速度スケール（物理限界 `v_cap` に対する割合）。
const PACE_SCALE_MIN: f64 = 0.90;
/// `pace = 1` のときの目標速度スケール。
///
/// TASK-2-3 Part F（Architect 承認）: 元は `1.00`。`ARCHITECTURE.md` §6 の
/// 「`pace` は物理限界より下の v_target 係数」に沿って `1.0` 未満に置く。実物理では
/// SpeedProfile の限界ちょうどを狙うとブレーキング/ターンインの余裕がなく、`v_target`
/// が `v_cap` に張り付いてコーナーで曲がりきれなかった。`v_target <= v_cap` と
/// `pace` 単調性は保たれる。
const PACE_SCALE_MAX: f64 = 0.98;
/// 先読み区間長のマージン [m]。
const LOOKAHEAD_MARGIN_M: f64 = 20.0;
/// 先読み区間長の上限 [m]。
const H_MAX: f64 = 400.0;
/// 先読み区間の走査刻み [m]。
const HORIZON_STEP_M: f64 = 5.0;
/// タイヤ荷重感度で割り引いた実効 μ の係数。`mu_eff = envelope.mu * MU_LOAD_DERATE`。
///
/// TASK-2-3 Part F（PDC-6・Architect 承認 2026-09-09）。
/// [`PerformanceEnvelope::from_params`] は `mu = tyre.mu0` を荷重感度なしで写すが、
/// 実タイヤは `mu = mu0 / (1 + LS·(Fz/Fz_nom − 1))`。`gt_proto_a` は `LS = 0.28`、
/// 基準荷重比 1.5（`sim-core::racing_line::LOAD_RATIO_REF` と同一の仮定）なので
/// `1 / (1 + 0.28·0.5) = 0.877`。`controller.rs::MU_TRACTION`（= 1.316）と同じ
/// グリップ像を指す。恒久対応（`PerformanceEnvelope` の荷重感度対応）は TASK-2-4。
const MU_LOAD_DERATE: f64 = 0.877;
/// 計画減速度の下限 [m/s²]（先読み区間長を有限に保つためのフロア）。
const A_BRAKE_FLOOR: f64 = 1.0;
/// Pure Pursuit 先読み距離の定数項 [m]。
const LOOKAHEAD_BASE_M: f64 = 3.0;
/// Pure Pursuit 先読み距離の速度係数 [s]。
const LOOKAHEAD_TIME_S: f64 = 0.45;
/// Pure Pursuit 先読み距離の下限 [m]。
///
/// TASK-2-4 Phase 2: `t=0` spawn からの立ち上がりレーンチェンジ（`t_core_ai_10_offline_spawn`）
/// で、低速時に `LOOKAHEAD_BASE_M` 付近まで縮む先読みと大きな横オフセットが組み合わさり
/// `delta_pp` が飽和し発進直後にスピンした（Architect 起票の Known Risk）。下限を上げて
/// 低速での alpha を抑える。
const LOOKAHEAD_MIN_M: f64 = 9.0;
/// Pure Pursuit 先読み距離の上限 [m]。
const LOOKAHEAD_MAX_M: f64 = 45.0;

/// その地点で縦（制動）に使える減速度 [m/s²]。摩擦楕円の残りとブレーキトルク上限の小さい方。
///
/// TASK-2-3 Part F（PDC-6・Architect 承認 2026-09-09）。従来の
/// `envelope.max_brake_decel`（ブレーキトルク由来のみ・約 26 m/s²）は摩擦円を
/// 一切見ておらず、実タイヤの縦グリップ（45 m/s で約 20 m/s²、ターンイン区間では
/// 横成分に食われてほぼ 0）を大きく上回る。その結果ブレーキングポイントが約 30 m
/// 遅く計画され、T3（R63）でフロントが縦で飽和して `beta≈0` の純アンダーステアに
/// 陥っていた。
///
/// `v_ref` はその地点の計画速度（[`SpeedProfile::v_at`]）、`kappa` は
/// [`Trajectory::curvature_at`]（センターライン曲率ではない）。バンク / 標高勾配は
/// 補正しない（二重補正禁止。[`SpeedProfile`] の担当）。
fn plan_brake_decel(env: &PerformanceEnvelope, v_ref: f64, kappa: f64) -> f64 {
    let v = v_ref.max(0.0);
    let df = 0.5 * AIR_DENSITY * v * v * env.cl_a_total;
    let g_eff = GRAVITY + df / env.mass_kg;
    let a_tyre = env.mu * MU_LOAD_DERATE * g_eff; // 摩擦円の半径
    let a_lat = v * v * kappa.abs(); // そこで横に使う分
    let a_long = (a_tyre * a_tyre - a_lat * a_lat).max(0.0).sqrt();
    a_long.min(env.max_brake_decel)
}

/// Planner の状態（平滑化のための前 tick 値）。
#[derive(Default)]
pub struct Planner {
    t_target: f64,
    initialised: bool,
}

impl Planner {
    /// 構築する（平滑化状態は最初の update で初期化される）。
    pub fn new() -> Planner {
        Planner::default()
    }

    /// 1 tick 分の [`Plan`] を作る。順序（横位置 → 目標速度 → 先読み距離）を変えないこと。
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        intent: &DriverIntent,
        perceived: &PerceivedSelf,
        trajectory: &Trajectory,
        corridor: &Corridor,
        speed_profile: &SpeedProfile,
        track: &Track,
        envelope: &PerformanceEnvelope,
        model: &DriverModel,
        confidence: f64,
    ) -> Plan {
        let s = track.wrap_s(perceived.s);

        // --- 1. 横位置 ---
        // Phase 2 は w_reference が支配的（他は 0 に漸近）。合成点は先に作っておく。
        let t_ref = trajectory.t_at(s);
        let w_sum = (intent.w_reference + intent.w_defensive + intent.w_overtake).max(1e-9);
        let t_blend =
            (intent.w_reference * t_ref + intent.w_defensive * t_ref + intent.w_overtake * t_ref)
                / w_sum;
        // 最終クランプ（唯一の出口）。防御は white、それ以外は limits（縁石可）。
        let clamped = if intent.mode == DriverMode::Defending {
            corridor.clamp_white(s, t_blend)
        } else {
            corridor.clamp_limits(s, t_blend)
        };
        if !self.initialised {
            self.t_target = clamped;
            self.initialised = true;
        }
        // 平滑化して C1 性を保つ。平滑化の過渡がクランプ域を出ないよう、同じクランプで
        // もう一度囲う（クランプ関数は域内では冪等なので「唯一の出口」を壊さない）。
        let smoothed = approach_exponential(self.t_target, clamped, TAU_T_TARGET, SIM_DT);
        let t_target = if intent.mode == DriverMode::Defending {
            corridor.clamp_white(s, smoothed)
        } else {
            corridor.clamp_limits(s, smoothed)
        };
        self.t_target = t_target;

        // --- 2. 目標速度 ---
        let v = perceived.speed.max(0.0);
        let v_cap = speed_profile.v_at(s); // 物理限界。T-AI-04 の上限。

        // 先読み区間で後退パスを局所再現。ブレーキングポイントは「探さず」に導く。
        // PDC-6: 計画減速度は地点ごとの摩擦楕円の残り（[`plan_brake_decel`]）。
        // 走査中は「走査済み区間の最小値」を使う — 区間平均減速度の保守的な下界であり、
        // `reachable` が進入速度の妥当な上界であり続ける。
        let skill = lerp(0.80, 1.00, model.braking_skill.clamp(0.0, 1.0));
        // 先読み区間長は直線制動（κ = 0）能力で決める（有限に保つため）。
        let a_ref = (plan_brake_decel(envelope, v, 0.0) * skill).max(A_BRAKE_FLOOR);
        let horizon = clamp(
            v * v / (2.0 * a_ref) + LOOKAHEAD_MARGIN_M,
            HORIZON_STEP_M,
            H_MAX,
        );

        let mut v_horizon = v_cap;
        let mut a_min = a_ref;
        let mut d = HORIZON_STEP_M;
        while d <= horizon {
            let s_i = track.wrap_s(s + d);
            let ds_i = track.signed_delta_s(s, s_i).abs().max(d);
            let v_i = speed_profile.v_at(s_i);
            let a_i = (plan_brake_decel(envelope, v_i, trajectory.curvature_at(s_i)) * skill)
                .max(A_BRAKE_FLOOR);
            if a_i < a_min {
                a_min = a_i;
            }
            let reachable = (v_i * v_i + 2.0 * a_min * ds_i).sqrt();
            if reachable < v_horizon {
                v_horizon = reachable;
            }
            d += HORIZON_STEP_M;
        }

        let pace_scale = lerp(PACE_SCALE_MIN, PACE_SCALE_MAX, model.pace.clamp(0.0, 1.0))
            * lerp(0.97, 1.00, confidence.clamp(0.0, 1.0));
        let v_pace = v_cap * pace_scale;

        let mut v_target = v_cap.min(v_horizon).min(v_pace);
        v_target = clamp(v_target, 0.0, v_cap); // ★構造的保証・省略禁止（T-AI-04）。

        // --- 3. 先読み距離 ---
        let lookahead_m = clamp(
            LOOKAHEAD_BASE_M + LOOKAHEAD_TIME_S * v,
            LOOKAHEAD_MIN_M,
            LOOKAHEAD_MAX_M,
        );
        let aim_s = track.wrap_s(s + lookahead_m);

        Plan {
            t_target,
            v_target,
            lookahead_m,
            aim_s,
        }
    }
}
