//! Controller 層 — Pure Pursuit + 曲率フィードフォワード + 逆操舵 + 縦方向 + 変速。
//!
//! **構造的保証（省略禁止）**: steer / throttle / brake の 3 系統はすべて
//! [`move_towards`] を通してから出力する（T-AI-02 / 受け入れ基準 11）。
//! `v_target` のクランプは [`crate::Planner`]、`t_target` のクランプは
//! [`sim_line::Corridor`] が唯一の出口。ここでは再クランプしない。
//!
//! 符号の規約（内部の road-wheel angle は **+ が左**。`ARCHITECTURE.md` §3 / §6）:
//! - トラジェクトリ曲率は左カーブが正 → `delta_ff = atan(L·κ)` は左カーブで正。
//! - 逆操舵は滑りと逆符号（`beta` + すなわちオーバーステア気味 → road angle は右=負）。
//! - 出力 [`ControlInput::steer`] は **+ が右** なので `steer = -delta_road / max_steer_angle`。

use crate::model::{DriverModel, DriverState};
use crate::perception::PerceivedSelf;
use crate::planner::Plan;
use crate::SIM_DT;
use sim_line::Trajectory;
use sim_math::{approach_exponential, clamp, lerp, move_towards, saturate, Rng};
use sim_track::{Track, TrackCoord};
use sim_vehicle::{ControlInput, VehicleParams, AIR_DENSITY, GRAVITY};

/// 逆操舵が立ち上がる車体スリップ角の基準 [rad]。`cornering_skill` でスケールする。
const BETA_LIMIT_RAD: f64 = 0.12;
/// 逆操舵ゲイン（road wheel angle [rad] / スリップ角 [rad]）。
const K_COUNTERSTEER: f64 = 0.9;
/// 逆操舵の位相進み時定数 [s]（TASK-2-4 Phase 2）。`beta` のみに比例する逆操舵は
/// ヨー運動に対し 90° 遅れる（Architect 起票）。`beta_dot` を加えた予測項
/// `beta + K_CS_LEAD_S * beta_dot` で位相を進める。`beta_dot` は `stabilise` 経路の
/// 前 tick 差分（[`SIM_DT`] 固定ステップなので単純差分で決定的）。
const K_CS_LEAD_S: f64 = 0.25;
/// ヘディング誤差フィードバックのゲイン（road wheel angle [rad] / [rad]）。
///
/// `ARCHITECTURE.md` §6 Perception 表の「安定化（Controller の逆操舵・**ヨー減衰**）」。
/// Pure Pursuit は予見経路（`reaction_time` 遅延）に載るため、短遅延の安定化経路で
/// ヘディングとヨーレートを内側ループとして押さえないと weave する。
///
/// TASK-2-3 Part F: 運動学プラント向けの `0.55` は実物理（実タイヤの緩和 + 荷重移動で
/// 実効遅れが増える）では高速直進で `-K_HEADING·he` が共振周波数で正帰還になり、
/// ヨーレートが 1 Hz で発散した（s≈500 以降・50 m/s で観測）。`0.30` へ下げて安定化。
///
/// TASK-2-4 Phase 2: 実タイヤのヨー定常ゲイン `v/(L + K_us·v²)` は非単調なので、
/// 固定ゲインはどこかで marginal になる（Architect 起票）。低速側は据え置き
/// （`V_REF_HEADING` 以下で `K_HEADING_0` そのまま）、高速側で減衰させる
/// [`k_heading_scaled`] を通すこと。**この定数自体は `K_HEADING_0`（速度スケジュール前の
/// 基準値）として使う。**
const K_HEADING: f64 = 0.30;
/// 余剰ヨーレート減衰のゲイン（road wheel angle [rad] / [rad/s]）。
/// [`K_HEADING`] と同じ速度スケジュールを [`k_yaw_damp_scaled`] で通す。
const K_YAW_DAMP: f64 = 0.16;
/// 速度スケジュールの基準速度 [m/s]。`v <= V_REF_HEADING` では [`K_HEADING`] /
/// [`K_YAW_DAMP`] をそのまま使う（既存値の再現点）。TASK-2-3 Part F の resonance が
/// 実測された `50 m/s` の直線速度をそのまま基準に置く。
const V_REF_HEADING: f64 = 50.0;
/// 速度スケジュールの下限速度 [m/s]（ゼロ割回避。発進直後はこれでクランプ）。
const V_MIN_HEADING: f64 = 8.0;
/// 速度スケジュールのゲイン下限比率（`V_REF_HEADING / v` の下限）。
const K_SCALE_MIN: f64 = 0.35;

/// `K_HEADING` の速度スケジュール版。`v <= V_REF_HEADING` は `K_HEADING` のまま、
/// それを超えると `V_REF_HEADING / v` に比例して下がる（下限 `K_SCALE_MIN`）。
fn k_heading_scaled(v: f64) -> f64 {
    K_HEADING * clamp(V_REF_HEADING / v.max(V_MIN_HEADING), K_SCALE_MIN, 1.0)
}

/// `K_YAW_DAMP` の速度スケジュール版（[`k_heading_scaled`] と同じ形）。
fn k_yaw_damp_scaled(v: f64) -> f64 {
    K_YAW_DAMP * clamp(V_REF_HEADING / v.max(V_MIN_HEADING), K_SCALE_MIN, 1.0)
}
/// アンダーステア勾配 [rad / (m/s²)]。要求横加速度に比例して舵角を足す（PDC-5）。
///
/// 実車のアンダーステア勾配は 0.001〜0.003 rad/(m/s²) 程度。ダウンフォース込みの
/// このマシンはやや低めから。TASK-2-3 で実物理に合わせて調整する。
const K_UNDERSTEER: f64 = 0.0018;
/// スロットル P ゲイン（速度誤差 [m/s] / 実効速度 [m/s]）。
const K_THROTTLE: f64 = 2.2;
/// ブレーキ P ゲイン。
const K_BRAKE: f64 = 1.4;
/// ブレーキ誤差の正規化スケール [m/s]。
const BRAKE_SCALE_MS: f64 = 8.0;
/// ペダル・スロットルのデッドバンド [m/s]（ヒステリシス付き）。
const DEADBAND_MS: f64 = 0.3;
/// トレイルブレーキングの最小残し割合。
const TRAIL_MIN: f64 = 0.35;
/// トレイルブレーキングが効き始めるトラジェクトリ曲率 [1/m]。
const KAPPA_TRAIL: f64 = 0.03;
/// 発進クラッチを当てる速度上限 [m/s]。
const LAUNCH_SPEED_MS: f64 = 3.0;
/// 静止発進時のクラッチ値（`0` = 全接続 / `1` = 全切断）。
///
/// `speed = 0` では `1 - speed/LAUNCH_SPEED_MS` が恒等的に `1.0`（全切断）になり
/// `axle_torque ≡ 0` で車が動けない（`sim-vehicle` の `engaged = 1 - clutch`）。
/// 半クラッチのバイト点から始めて `LAUNCH_SPEED_MS` で全接続へ閉じる。
/// TASK-2-3 契約 PDC-1（Architect 承認 2026-09-09）。この値は Part F の
/// 調整対象（範囲 `[0.3, 1.0]`）。エンジン回転は idle にクランプされるため
/// バイト点を上げたときの制約はエンジンのボギングではなく駆動輪のホイールスピン。
const LAUNCH_CLUTCH_BITE: f64 = 0.6;
/// アップシフト回転数割合（`limiter_rpm` に対する）。
///
/// TASK-2-3 Part F: `0.97` からわずかに下げる（`[0.90, 0.97]` の範囲で Architect 承認）。
/// 変速には `shift_time_s` のトルクカット時間があるので、リミッターに当ててから
/// 上げるより少し早めに上げたほうが実効加速がよい。トラクション制限（PDC-3）が
/// 効いたあとは `est_rpm`（車速由来）はほぼ正確で、リミッター当てが残る場合は
/// それ自体が Design Concern 2 の証拠として T-CORE-AI-07 で数値報告する
/// （しきい値を下げて隠さない）。
const UPSHIFT_FRACTION: f64 = 0.95;
/// トラクション制限に使う縦グリップの摩擦係数。
///
/// TASK-2-3 PDC-3 / PDC-4（Architect 承認 2026-09-09）。`sim-core` の `RacingLine` が
/// SpeedProfile 用に使う実効 μ（`mu0 / (1 + LS·0.5)` = `1.50 / 1.14` ≒ 1.316）と揃える。
/// 縦横で同じグリップ像を使わないと、片方を最適化するともう片方が破綻する
/// （実際に、SpeedProfile が楽観的 μ、こちらが保守的 μ で T2/T3 を曲がれなかった）。
const MU_TRACTION: f64 = 1.316;
/// スライド中にスロットル上限を絞る深さ（`0` = 絞らない / `1` = 全閉）。
///
/// TASK-2-3 PDC-3 随伴（Architect 承認）: 元は式中のリテラル `0.3` で、`beta` しきい値を
/// またぐたびに 1.0↔0.3 のバンバン制御になり縦荷重移動で横方向を揺すっていた。深さを
/// 浅くして名前付き定数にする。実際の絞りはこの後の `move_towards`（`pedal_rate`）で
/// レート制限されるので過渡は滑らか。
const SLIDE_CUT_DEPTH: f64 = 0.5;
/// スレッショルドブレーキング上限の安全率（`1.0` = 推定ロック限界ちょうど）。
///
/// TASK-2-4 Phase 2（Opus 監査ラウンド）: 本車（`gt_proto_a`）は ABS を持たず、
/// `brake = 1.0` の制動トルクは中低速で前後軸とも縦グリップを超える。ヘアピン
/// （s≈3230〜3315）と T3 進入（s≈1430〜1456）で実測すると前輪 `slip_ratio = -1.0`
/// （完全ロック）が数十 m 続き、ロック中は操舵が効かず（フルロックでも曲がらない）
/// 減速度も摩擦ピークから滑り摩擦へ落ちていた。[`Controller::brake_lock_cap`] は
/// `sim-vehicle` と同じ荷重感度式で推定したロック限界にこの率を掛ける。
const BRAKE_LOCK_MARGIN: f64 = 0.95;
/// ダウンシフト後に許す最大回転数割合。
const DOWNSHIFT_TARGET_FRACTION: f64 = 0.92;
/// ダウンシフトを起動する現在ギアの回転数割合（これを下回ると 1 段落とす）。
const DOWNSHIFT_TRIGGER_FRACTION: f64 = 0.60;
/// 変速の最小滞在時間 [s]（ハンチング防止）。
const MIN_GEAR_DWELL_S: f64 = 0.25;
/// 入力精度ノイズの低域通過時定数 [s]。
const PRECISION_NOISE_TAU: f64 = 0.5;
/// `max_steer_rate` の下限フロア [1/s]（TASK-2-4 Phase 2 残り・ヘアピン脱出診断）。
///
/// `lerp(2.5, 6.0, precision)` の下限 `2.5` は、ヘアピン脱出（s≈3377）でレーシングラインが
/// 急速に横へ流れる区間（加速で速度が伸びながら `t` が ~0.2 m/m で動く）を低 `precision`
/// （`0.5·consistency + 0.5·cornering_skill`）のドライバーが追い切れず、乱数（`steer_noise`）が
/// ゼロでも `error_rate = 0`（ミス無し）のまま**決定論的に**コリドーを割ることをテレメトリで
/// 確認した（`slip_ratio` はロックしておらず、純粋にステアリングレートの追従遅れ）。
/// `precision` 全域を底上げすると `t_ai_07`（反応遅れによるラップタイム差 ≥0.1 s。
/// `precision = 0.75` で測る）の差が縮んで割れるため（実測 0.100 s ちょうどで境界割れ）、
/// `lerp` 全体を平行移動する代わりに**下限のみ** `max` でクランプする。この定数は
/// `(LOW_PRECISION_STEER_RATE_FLOOR - 2.5) / 3.5` 未満の `precision` にしか効かないので、
/// `t_ai_07` の `precision = 0.75` は無変更（`lerp` の値がフロアを上回るため `max` が効かない）。
const LOW_PRECISION_STEER_RATE_FLOOR: f64 = 5.1;
/// `consistency = 0` のときの操舵精度ノイズの標準偏差（正規化操舵 `-1..1` に対して）。
const STEER_NOISE_MAX: f64 = 0.02;

/// 制動 / 駆動の上限（[`Controller::brake_lock_cap`] / [`Controller::traction_throttle_cap`]）が
/// 摩擦円の横成分と横荷重移動に使う曲率 [1/m]。
///
/// 両上限は「いまタイヤが横に負担している力」を差し引いて縦に使える残りを求める。計画曲率
/// `kappa_traj` はライン上を計画速度で走っているときだけその力を表す。ラインから外れて戻る /
/// ヘディング誤差を修正する / スライドしている間は、車体が実際に回っているヨーレート `r` から
/// `a_lat ≈ v·r` の方が大きく、計画曲率で見積もると縦の残りを過大評価する（TASK-2-4 Phase 4:
/// ヘアピン出口で `κ_traj` 由来 6 m/s² に対し `v·r` = 16.5 m/s²、リアの摩擦円は横で既に飽和して
/// いたのにトラクション上限は 0.57 を許し、内側後輪がスリップ率 9 まで空転してスピンした）。
/// 横加速度が大きい方の曲率（`r / v`）を返す。符号は内輪 / 外輪の写像に使うので保つ。
/// 知覚は安定化経路（前庭感覚 = 体に掛かる横 G）のみ。
fn load_curvature(speed: f64, yaw_rate: f64, kappa_traj: f64) -> f64 {
    let v = speed.abs();
    if v < 1.0 {
        return kappa_traj;
    }
    let kappa_yaw = yaw_rate / v;
    if kappa_yaw.abs() > kappa_traj.abs() {
        kappa_yaw
    } else {
        kappa_traj
    }
}

/// ダウンフォースの前後軸への配分（`cl·A` 換算 [m^2]、`(front, rear)`）。
///
/// `sim-vehicle::aero` はフロント / リアのダウンフォースを**圧力中心**（重心から `cop_front_x` /
/// `cop_rear_x`、前方が正）に作用させる。軸荷重はその力を重心前後の軸位置
/// （前軸 `+a = L·(1 − d_f)`・後軸 `−b = −L·d_f`、`d_f` = 静的前荷重配分）へモーメントで配分したもの:
/// 力 `F` が `x` に作用すると前軸 `F·(x + b)/L`、後軸 `F·(a − x)/L`。
/// `cl_front·A` / `cl_rear·A` をそのまま軸荷重とみなすと `gt_proto_a` では前軸を 21 % 過大
/// （2.05 → 1.69 m²）、後軸を 11 % 過小（3.02 → 3.38 m²）に見積もる。
fn aero_axle_cl_a(params: &VehicleParams) -> (f64, f64) {
    let l = params.dimensions.wheelbase.max(1e-6);
    let d_f = params.mass.distribution_front.clamp(0.0, 1.0);
    let a = l * (1.0 - d_f);
    let b = l * d_f;
    let aero = &params.aero;
    let f_front = aero.cl_front * aero.frontal_area;
    let f_rear = aero.cl_rear * aero.frontal_area;
    let front = (f_front * (aero.cop_front_x + b) + f_rear * (aero.cop_rear_x + b)) / l;
    let rear = (f_front * (a - aero.cop_front_x) + f_rear * (a - aero.cop_rear_x)) / l;
    (front, rear)
}

/// H3（PDC-13）: 4 輪それぞれの位置の路面 grip 倍率（`1.0` = 舗装）。`+t` が左。
struct WheelGrip {
    front_left: f64,
    front_right: f64,
    rear_left: f64,
    rear_right: f64,
}

/// 縦方向のモード（デッドバンドのヒステリシス用）。
#[derive(Clone, Copy, PartialEq, Eq)]
enum LongMode {
    Coast,
    Throttle,
    Brake,
}

/// Controller 層の状態。
pub struct Controller {
    // --- 車両定数（`new` で `VehicleParams` から写す）---
    wheelbase: f64,
    max_steer_angle: f64,
    gear_ratios: Vec<f64>,
    final_drive: f64,
    limiter_rpm: f64,
    tyre_radius: f64,
    // --- トラクション制限フィードフォワード（PDC-3）---
    mass_kg: f64,
    /// リア軸の静的荷重配分 `0..1`。
    rear_weight_frac: f64,
    /// リアのダウンフォース係数 × 前面投影面積 [m^2]。`F_down_rear = 0.5 ρ v² · cl_a_rear`。
    cl_a_rear: f64,
    /// トルクカーブのピーク値 [Nm]（フルスロットル駆動力の保守的な見積もりに使う）。
    peak_drive_torque: f64,
    /// 駆動系伝達効率 `0..1`。
    driveline_eff: f64,
    /// LSD のパワー側バイアス（`sim-vehicle::distribute_lsd` と同じ入力。H3 トラクション側）。
    lsd_power_ratio: f64,
    // --- スレッショルドブレーキング上限（Opus 監査ラウンド）---
    /// フロントのダウンフォース係数 × 前面投影面積 [m^2]。
    cl_a_front: f64,
    /// `brake = 1.0` のときのフロント軸（2 輪）の制動力 [N]。`sim-vehicle` の導出と同式。
    brake_force_front: f64,
    /// `brake = 1.0` のときのリア軸（2 輪）の制動力 [N]。
    brake_force_rear: f64,
    /// 重心高 / ホイールベース（縦荷重移動の比）。
    cg_over_wheelbase: f64,
    /// 重心高 [m]（横荷重移動）。
    cg_height: f64,
    /// フロント / リアのトレッド [m]（横荷重移動）。
    track_front: f64,
    track_rear: f64,
    /// タイヤ基準摩擦係数 `mu0`（`sim-vehicle` の荷重感度式と同じ入力）。
    mu0: f64,
    /// 荷重感度係数 `LS`。
    load_sensitivity: f64,
    /// 荷重感度の基準 1 輪荷重 [N]（`None` なら静的 1 輪平均 = `sim-vehicle` と同じ既定）。
    nominal_load: f64,
    /// 重心 → フロント / リア軸の距離 [m]（H3 の車輪位置推定。静的荷重配分から）。
    cg_to_front: f64,
    cg_to_rear: f64,
    // --- ドライバー由来のゲイン ---
    precision: f64,
    cornering_skill: f64,
    braking_skill: f64,
    consistency: f64,
    // --- 内部状態 ---
    prev_steer: f64,
    steer_filt: f64,
    steer_noise: f64,
    prev_beta: f64,
    prev_throttle: f64,
    prev_brake: f64,
    long_mode: LongMode,
    current_gear: i8,
    gear_dwell: u32,
    min_gear_dwell: u32,
}

impl Controller {
    /// `model` からゲイン、`params` から車両定数を写して構築する。
    pub fn new(model: &DriverModel, params: &VehicleParams) -> Controller {
        Controller {
            wheelbase: params.dimensions.wheelbase,
            max_steer_angle: params.steering.max_steer_angle,
            gear_ratios: params.drivetrain.gear_ratios.clone(),
            final_drive: params.drivetrain.final_drive,
            limiter_rpm: params.engine.limiter_rpm,
            tyre_radius: 0.5 * (params.tyre.front.radius + params.tyre.rear.radius),
            mass_kg: params.mass.total_kg,
            rear_weight_frac: (1.0 - params.mass.distribution_front).clamp(0.0, 1.0),
            cl_a_rear: aero_axle_cl_a(params).1,
            peak_drive_torque: params
                .engine
                .torque_curve
                .iter()
                .map(|pt| pt[1])
                .fold(0.0_f64, f64::max),
            driveline_eff: params.drivetrain.driveline_efficiency,
            lsd_power_ratio: params.drivetrain.lsd_power_ratio.clamp(0.0, 0.499),
            cl_a_front: aero_axle_cl_a(params).0,
            brake_force_front: {
                let b = &params.brakes;
                let ref_bias = b.max_torque_front / (b.max_torque_front + b.max_torque_rear);
                2.0 * b.max_torque_front * (b.bias_front / ref_bias) / params.tyre.front.radius
            },
            brake_force_rear: {
                let b = &params.brakes;
                let ref_bias = b.max_torque_front / (b.max_torque_front + b.max_torque_rear);
                2.0 * b.max_torque_rear * ((1.0 - b.bias_front) / (1.0 - ref_bias))
                    / params.tyre.rear.radius
            },
            cg_over_wheelbase: params.mass.cg_height / params.dimensions.wheelbase,
            cg_height: params.mass.cg_height,
            track_front: params.dimensions.track_front,
            track_rear: params.dimensions.track_rear,
            mu0: params.tyre.mu0,
            load_sensitivity: params.tyre.load_sensitivity,
            nominal_load: params
                .tyre
                .nominal_load
                .unwrap_or(params.mass.total_kg * GRAVITY * 0.25)
                .max(1.0),
            cg_to_front: params.dimensions.wheelbase
                * (1.0 - params.mass.distribution_front).clamp(0.0, 1.0),
            cg_to_rear: params.dimensions.wheelbase
                * params.mass.distribution_front.clamp(0.0, 1.0),
            precision: model.precision().clamp(0.0, 1.0),
            cornering_skill: model.cornering_skill.clamp(0.0, 1.0),
            braking_skill: model.braking_skill.clamp(0.0, 1.0),
            consistency: model.consistency.clamp(0.0, 1.0),
            prev_steer: 0.0,
            steer_filt: 0.0,
            steer_noise: 0.0,
            prev_beta: 0.0,
            prev_throttle: 0.0,
            prev_brake: 0.0,
            long_mode: LongMode::Coast,
            current_gear: 1,
            gear_dwell: u32::MAX / 2,
            min_gear_dwell: (MIN_GEAR_DWELL_S / SIM_DT).ceil() as u32,
        }
    }

    /// 現在ギア（読み出し）。
    pub fn gear(&self) -> i8 {
        self.current_gear
    }

    /// 1 Simulation Tick 分の操作を生成する。**`dt` を引数に取らない**（[`SIM_DT`] 固定）。
    ///
    /// `perceived` は予見経路（遅い）、`stabilise` は安定化経路（短遅延）。
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &mut self,
        plan: &Plan,
        perceived: &PerceivedSelf,
        stabilise: &PerceivedSelf,
        trajectory: &Trajectory,
        track: &Track,
        state: &DriverState,
        rng: &mut Rng,
    ) -> ControlInput {
        // ================= 横方向 =================
        // 1) Pure Pursuit。aim 点を車両ローカルへ写して曲率を作る。
        let he = perceived.heading_error;
        // Planner がクランプ済みの aim_s を渡すが、ラップ済みであることをここでも保証する。
        let aim_s = track.wrap_s(plan.aim_s);
        let aim_t = trajectory.t_at(aim_s);
        let lon = plan.lookahead_m.max(1e-3);
        let lat = aim_t - perceived.t; // + が左
        let x_v = he.cos() * lon + he.sin() * lat;
        let y_v = -he.sin() * lon + he.cos() * lat; // + が左（車両ローカル）
        let alpha = y_v.atan2(x_v.max(1e-3));
        let delta_pp = (2.0 * self.wheelbase * alpha.sin()).atan2(plan.lookahead_m.max(1e-3));

        // 2) 曲率フィードフォワード（トラジェクトリ曲率。センターライン曲率は使わない）。
        //
        // Ackermann 項 `atan(L·κ)` はスリップ角ゼロのプラント（TASK-2-2 の運動学自転車）
        // でだけ正しく、実タイヤでは高速コーナーで舵不足になる（`δ = L/R + K_us·a_lat`）。
        // アンダーステア勾配項を要求横加速度 `a_lat = v²·κ_traj` から足す（TASK-2-3 PDC-5・
        // Architect 承認 2026-09-09）。フィードフォワードなので位相遅れを持ち込まない。
        let kappa_traj = trajectory.curvature_at(perceived.s);
        let a_lat_demand = perceived.speed * perceived.speed * kappa_traj;
        let delta_ff = clamp(
            (self.wheelbase * kappa_traj).atan() + K_UNDERSTEER * a_lat_demand,
            -self.max_steer_angle,
            self.max_steer_angle,
        );

        // 3) 逆操舵（TASK-1B-1 C-1 対策・必須）。安定化経路の beta を使う。
        // TASK-2-4 Phase 2: `beta` のみだとヨー運動に 90° 遅れるため、`beta_dot`
        // （前 tick との単純差分。SIM_DT 固定なので決定的）を加えた予測項で位相を進める。
        // `t_drv_02` は sideslip 一定（`beta_dot ≈ 0` へ収束）の定常テストなので符号は不変。
        let beta = stabilise.sideslip;
        let beta_dot = (beta - self.prev_beta) / SIM_DT;
        self.prev_beta = beta;
        let beta_lead = beta + K_CS_LEAD_S * beta_dot;
        let beta_lim = BETA_LIMIT_RAD * lerp(0.8, 1.2, self.cornering_skill);
        let excess = (beta_lead.abs() - beta_lim).max(0.0);
        let delta_cs = -K_COUNTERSTEER * beta_lead.signum() * excess;
        // スライド中はスロットル上限を絞る（無いと限界付近で素直にスピンする）。
        // 滑らかに絞る（PDC-3 随伴。深さは SLIDE_CUT_DEPTH、過渡は後段の move_towards）。
        let throttle_slide_cap = 1.0 - SLIDE_CUT_DEPTH * saturate(excess / beta_lim);

        // 3b) ヘディング / ヨーレート安定化（安定化経路 = 短遅延）。
        //     heading_error + = 車体が目標より左 → 右へ戻す（road angle 負）。
        //     必要ヨーレート ≈ speed·κ_traj。それを超える分だけ減衰する。
        let desired_yaw_rate = stabilise.speed * kappa_traj;
        let delta_hd = -k_heading_scaled(stabilise.speed) * stabilise.heading_error
            - k_yaw_damp_scaled(stabilise.speed) * (stabilise.yaw_rate - desired_yaw_rate);

        // 4) 合成 → 正規化。road-wheel angle は + が左、steer 出力は + が右。
        let delta_target = delta_pp + delta_ff + delta_cs + delta_hd + state.mistake_steer_bias;
        let mut steer_raw = clamp(-delta_target / self.max_steer_angle, -1.0, 1.0);

        // 入力精度ノイズ（「原因」にのみ作用。低域に落としてから足す）。
        let noise_target = rng.normal(0.0, STEER_NOISE_MAX * (1.0 - self.consistency).max(0.0));
        self.steer_noise =
            approach_exponential(self.steer_noise, noise_target, PRECISION_NOISE_TAU, SIM_DT);
        steer_raw = clamp(steer_raw + self.steer_noise, -1.0, 1.0);

        // 5) ★構造的保証: レート制限 → 腕の一次遅れ。
        //    max_steer_rate / STEER_TAU は precision に依存（§6）。
        //    VehicleParams::steering.time_constant は「ラックの機構遅れ」であって
        //    「ドライバーの腕」ではない。役割が違うので二重補正ではない。
        let max_steer_rate = lerp(2.5, 6.0, self.precision).max(LOW_PRECISION_STEER_RATE_FLOOR); // [1/s]
        let steer_tau = lerp(0.10, 0.04, self.precision); // [s]
        let rate_limited = move_towards(self.prev_steer, steer_raw, max_steer_rate * SIM_DT);
        self.steer_filt = approach_exponential(self.steer_filt, rate_limited, steer_tau, SIM_DT);
        let steer = self.steer_filt;
        self.prev_steer = steer;

        // ================= 縦方向 =================
        let e = plan.v_target - perceived.speed;
        // デッドバンド + ヒステリシス。
        self.long_mode = match self.long_mode {
            LongMode::Throttle if e < -DEADBAND_MS => LongMode::Brake,
            LongMode::Brake if e > DEADBAND_MS => LongMode::Throttle,
            LongMode::Coast if e > DEADBAND_MS => LongMode::Throttle,
            LongMode::Coast if e < -DEADBAND_MS => LongMode::Brake,
            other => other,
        };
        let (mut throttle_raw, mut brake_raw) = match self.long_mode {
            LongMode::Throttle => (saturate(K_THROTTLE * e / perceived.speed.max(5.0)), 0.0),
            LongMode::Brake => (0.0, saturate(K_BRAKE * (-e) / BRAKE_SCALE_MS)),
            LongMode::Coast => (0.0, 0.0),
        };

        // トレイルブレーキング（§6）。下手なドライバーは進入で残せない。
        let trail = lerp(1.0, TRAIL_MIN, saturate(kappa_traj.abs() / KAPPA_TRAIL));
        let reduction = (1.0 - trail) * lerp(1.0, 0.6, self.braking_skill);
        brake_raw *= 1.0 - reduction;
        // スレッショルドブレーキング（Opus 監査ラウンド）: 推定ロック限界を超えて踏まない。
        // ミス（`mistake_brake_bias`）はこの上限の後に足す = ロックアップはミスとしてのみ起きる。
        // H3（PDC-13）: 上限は 4 輪それぞれの路面 grip（縁石 / 芝 / グラベル）で割り引く。
        let grip = self.wheel_surface_grip(track, stabilise.s, stabilise.t);
        brake_raw = brake_raw.min(self.brake_lock_cap(stabilise.speed, kappa_traj, &grip));
        brake_raw = saturate(brake_raw + state.mistake_brake_bias);

        // スライド中のスロットル絞り。
        throttle_raw = throttle_raw.min(throttle_slide_cap);

        // トラクション制限フィードフォワード（PDC-3・Architect 承認 2026-09-09）。
        // フルスロットル要求がリアタイヤのグリップ円（縦方向の残り）を超えるときだけ
        // スロットル上限を絞る。**`v_target` には一切触らない**（Planner + SpeedProfile が
        // 唯一の権限。ここは「いま何割開けてよいか」だけを決める）。
        // バンク / 標高勾配の補正はしない（二重補正禁止。SpeedProfile の担当）。
        let kappa_load = load_curvature(stabilise.speed, stabilise.yaw_rate, kappa_traj);
        throttle_raw = throttle_raw.min(self.traction_throttle_cap(
            stabilise.speed,
            kappa_load,
            self.drive_axle_grip(&grip),
        ));

        // ★構造的保証: ペダルもレート制限を通す。
        let pedal_rate = lerp(3.0, 8.0, self.precision); // [1/s]
        let throttle = move_towards(self.prev_throttle, throttle_raw, pedal_rate * SIM_DT);
        let brake = move_towards(self.prev_brake, brake_raw, pedal_rate * SIM_DT);
        self.prev_throttle = throttle;
        self.prev_brake = brake;

        // ================= ギア / クラッチ =================
        let speed = perceived.speed.max(0.0);
        self.update_gear(speed);
        let clutch = if speed < LAUNCH_SPEED_MS && self.current_gear == 1 {
            // 半クラッチ発進: バイト点から始めて LAUNCH_SPEED_MS で全接続へ閉じる。
            LAUNCH_CLUTCH_BITE * (1.0 - saturate(speed / LAUNCH_SPEED_MS))
        } else {
            0.0
        };

        ControlInput {
            steer,
            throttle,
            brake,
            clutch,
            gear: self.current_gear,
            drs: false, // Phase 2 は常に false。
        }
    }

    /// トラクション制限フィードフォワード（PDC-3）。
    ///
    /// フルスロットルで現在ギアが要求する駆動力が、リアタイヤのグリップ円の
    /// 縦方向の残り（横力を摩擦円で差し引いたあと）を超えるとき、その比で
    /// スロットル上限を返す（超えないなら `1.0`）。**グリップは低めに、駆動力は
    /// ピークトルクで高めに見積もる**（保守側）。`v_target` は変えない。
    fn traction_throttle_cap(&self, speed: f64, kappa_traj: f64, surface_grip: f64) -> f64 {
        let v = speed.abs();

        // リア軸で使えるグリップ [N]（静荷重 + ダウンフォース）。
        let rear_static = self.mass_kg * GRAVITY * self.rear_weight_frac;
        let rear_downforce = 0.5 * AIR_DENSITY * v * v * self.cl_a_rear;
        let rear_grip = MU_TRACTION * surface_grip * (rear_static + rear_downforce);

        // 軌跡追従に要る横力のうちリア軸の負担分（静的配分で近似）。
        let lat_force = self.mass_kg * v * v * kappa_traj.abs();
        let rear_lat = lat_force * self.rear_weight_frac;

        // 摩擦円の残り = 縦方向に使えるリアグリップ。
        let long_avail = (rear_grip * rear_grip - rear_lat * rear_lat)
            .max(0.0)
            .sqrt();

        // 現在ギアでフルスロットルが要求する駆動力（ピークトルクで保守的に）。
        let gi = (self.current_gear.max(1) as usize - 1).min(self.gear_ratios.len() - 1);
        let drive_full =
            self.peak_drive_torque * self.gear_ratios[gi] * self.final_drive * self.driveline_eff
                / self.tyre_radius.max(1e-3);

        if drive_full > long_avail && drive_full > 1.0 {
            saturate(long_avail / drive_full)
        } else {
            1.0
        }
    }

    /// スレッショルドブレーキング上限（Opus 監査ラウンド・PDC-3 の制動側の対）。
    ///
    /// ペダル `b` の制動力 `b·F_axle` が、その軸の縦グリップ
    /// `μ(Fz)·Fz_axle`（`Fz_axle` = 静荷重 + ダウンフォース ± 縦荷重移動 `b·(F_f+F_r)·h/L`）を
    /// 摩擦円で横力分だけ差し引いた残りを超えない最大の `b` を前後軸それぞれ求め、小さい方を返す。
    /// 同じ軸の左右は同じ制動トルクなので、軸の限界は横荷重移動で荷重が抜ける**旋回内輪**で決まる
    /// （トレイルブレーキング中に内側前輪だけがロックするのを実測で確認）。
    ///
    /// `μ(Fz)` は `sim-vehicle` と同じ荷重感度式 `mu0 / (1 + LS·(Fz_wheel/Fz_nom − 1))`。
    /// 一定 μ（[`MU_TRACTION`] = 1 輪 1.5 倍荷重相当）だと、制動中に荷重が乗るフロント
    /// （1 輪 ≈ 1.8 倍荷重・実効 μ ≈ 1.22）を過大評価してロックする（実測で確認）。
    /// `μ` が `b` に依存するので固定点反復（決定的・3 回）で解く。空力抗力・エンジンブレーキは
    /// 無視し、残差は [`BRAKE_LOCK_MARGIN`] で吸収する。`v_target` は変えない。
    ///
    /// H3（PDC-13・TASK-2-4 Phase 2 Part 3）: 各輪の μ にその輪の位置の路面 grip を掛ける
    /// （`sim-vehicle::tyre.rs::effective_mu` と同じ `mu0 · grip · sensitivity`）。旋回内輪 / 外輪は
    /// `kappa_traj` の符号で左右へ写す（`+κ` = 左カーブ = 左が内輪）。同じ軸の左右は同じ制動トルク
    /// なので、片側 2 輪だけ縁石・芝・グラベルに落ちた split-μ 制動ではその側が先にロックして
    /// ヨーを生む（F-4 の T3 系）— 軸の上限は弱い側で決まる。
    fn brake_lock_cap(&self, speed: f64, kappa_traj: f64, grip: &WheelGrip) -> f64 {
        let v = speed.max(0.0);
        let q = 0.5 * AIR_DENSITY * v * v;
        let front_frac = 1.0 - self.rear_weight_frac;
        let weight = self.mass_kg * GRAVITY;
        let front_base = weight * front_frac + q * self.cl_a_front;
        let rear_base = weight * self.rear_weight_frac + q * self.cl_a_rear;
        let f_total = self.brake_force_front + self.brake_force_rear;
        let lat_force = self.mass_kg * v * v * kappa_traj.abs();

        // 横荷重移動のロールモーメント `m·a_lat·h` [N·m]。軸ごとの 1 輪荷重変化は
        // `モーメント × 軸配分 / トレッド`（ロール剛性配分は静的荷重配分で近似）。
        let lat_transfer_total = lat_force * self.cg_height;

        // 1 輪（荷重 `fz`・横力 `lat`）で縦方向に使えるグリップ [N]（荷重感度 + 摩擦円）。
        let wheel_long_grip = |fz: f64, lat: f64, surface: f64| {
            let fz = fz.max(0.0);
            let mu = self.mu0 * surface
                / (1.0 + self.load_sensitivity * (fz / self.nominal_load - 1.0)).max(0.1);
            let cap = mu * fz;
            (cap * cap - lat * lat).max(0.0).sqrt()
        };
        // 軸の縦グリップ上限 = 弱い側（旋回内輪、または低 grip 路面の輪）が 1 輪分の制動力
        // `F_axle/2` を受け止められる限界 ×2。同じ軸の左右は同じ制動トルクなので、弱い側が
        // ロックした時点で軸としてロックが始まる。`(g_left, g_right)` は H3 の路面 grip。
        let left_inner = kappa_traj > 0.0;
        let axle_long_grip = |axle_n: f64, lat_axle: f64, d_lat: f64, g_left: f64, g_right: f64| {
            let axle_n = axle_n.max(1e-9);
            let (s_in, s_out) = if left_inner {
                (g_left, g_right)
            } else {
                (g_right, g_left)
            };
            let inner = 0.5 * axle_n - d_lat;
            let outer = 0.5 * axle_n + d_lat;
            let g_in = wheel_long_grip(inner, lat_axle * inner.max(0.0) / axle_n, s_in);
            let g_out = wheel_long_grip(outer, lat_axle * outer.max(0.0) / axle_n, s_out);
            2.0 * g_in.min(g_out)
        };

        let d_lat_f = lat_transfer_total * front_frac / self.track_front.max(0.1);
        let d_lat_r = lat_transfer_total * self.rear_weight_frac / self.track_rear.max(0.1);
        let mut b = 1.0_f64;
        for _ in 0..3 {
            let transfer = b * f_total * self.cg_over_wheelbase;
            let grip_f = axle_long_grip(
                front_base + transfer,
                lat_force * front_frac,
                d_lat_f,
                grip.front_left,
                grip.front_right,
            );
            let grip_r = axle_long_grip(
                rear_base - transfer,
                lat_force * self.rear_weight_frac,
                d_lat_r,
                grip.rear_left,
                grip.rear_right,
            );
            let cap_f = grip_f / self.brake_force_front.max(1e-9);
            let cap_r = grip_r / self.brake_force_rear.max(1e-9);
            b = saturate(cap_f.min(cap_r));
        }
        saturate(BRAKE_LOCK_MARGIN * b)
    }

    /// H3 トラクション側（TASK-2-4 Phase 4）: 駆動軸（後軸）の実効路面 grip 倍率。
    ///
    /// `sim-vehicle::distribute_lsd` は弱い側の車輪にも最低 `T·(1/2 − bias)` を配るので、弱い側が
    /// 空転し始める軸トルクは `g_min / (1 − 2·bias)` 相当、両輪の合計で使えるのは平均 `(g_l+g_r)/2`
    /// 相当 — 小さい方が軸の上限（第 4 ラウンド記録の式。`gt_proto_a` の bias 0.45 では実質平均）。
    fn drive_axle_grip(&self, grip: &WheelGrip) -> f64 {
        let avg = 0.5 * (grip.rear_left + grip.rear_right);
        let weak = grip.rear_left.min(grip.rear_right);
        avg.min(weak / (1.0 - 2.0 * self.lsd_power_ratio))
    }

    /// H3（PDC-13）: 4 輪それぞれの位置の路面 grip 倍率（`SurfaceKind::properties().grip_multiplier`）。
    ///
    /// 車輪位置は安定化経路の `(s, t)`（重心）から、軸は `s ± 重心–軸距離`、左右は `t ± トレッド/2`
    /// で推定する（ヨー角による軸の横ずれは無視）。**track limits（`Corridor::limit_bounds`）とは
    /// 独立**: limits は「車体中心の合法性」の定義であり、実タイヤがどの路面に載っているかは
    /// `sim-core::TrackGround::probe` と同じく `Track::surface_at` だけで決まる（PDC-13 裁定）。
    fn wheel_surface_grip(&self, track: &Track, s: f64, t: f64) -> WheelGrip {
        let g = |ds: f64, dt: f64| {
            track
                .surface_at(TrackCoord::new(track.wrap_s(s + ds), t + dt))
                .properties()
                .grip_multiplier
        };
        let hf = 0.5 * self.track_front;
        let hr = 0.5 * self.track_rear;
        WheelGrip {
            front_left: g(self.cg_to_front, hf),
            front_right: g(self.cg_to_front, -hf),
            rear_left: g(-self.cg_to_rear, hr),
            rear_right: g(-self.cg_to_rear, -hr),
        }
    }

    /// 現在速度から推定エンジン回転数 [rpm]。`gear` は前進ギア番号（1..=n）。
    fn est_rpm(&self, gear: i8, speed: f64) -> f64 {
        if gear < 1 {
            return 0.0;
        }
        let ratio = self.gear_ratios[(gear as usize - 1).min(self.gear_ratios.len() - 1)];
        let wheel_rps = speed / self.tyre_radius.max(1e-3) / (2.0 * std::f64::consts::PI);
        wheel_rps * ratio * self.final_drive * 60.0
    }

    /// 変速の状態機械（`limiter_rpm` 割合 + 最小滞在時間ヒステリシス）。
    fn update_gear(&mut self, speed: f64) {
        let n = self.gear_ratios.len() as i8;
        if self.gear_dwell >= self.min_gear_dwell {
            let cur = self.est_rpm(self.current_gear, speed);
            if self.current_gear < n && cur > UPSHIFT_FRACTION * self.limiter_rpm {
                self.current_gear += 1;
                self.gear_dwell = 0;
            } else if self.current_gear > 1 {
                let post = self.est_rpm(self.current_gear - 1, speed);
                if cur < DOWNSHIFT_TRIGGER_FRACTION * self.limiter_rpm
                    && post < DOWNSHIFT_TARGET_FRACTION * self.limiter_rpm
                {
                    self.current_gear -= 1;
                    self.gear_dwell = 0;
                }
            }
        }
        self.gear_dwell = self.gear_dwell.saturating_add(1);
    }
}

#[cfg(all(test, feature = "serde"))]
mod tests {
    use super::*;

    const SPEC_JSON: &str = include_str!("../../../assets/vehicles/gt_proto_a.spec.json");

    fn grip(fl: f64, fr: f64, rl: f64, rr: f64) -> WheelGrip {
        WheelGrip {
            front_left: fl,
            front_right: fr,
            rear_left: rl,
            rear_right: rr,
        }
    }

    /// H3（PDC-13）: 制動上限は路面 grip の弱い側で決まり、内輪 / 外輪の写像は `kappa_traj` の符号に従う。
    #[test]
    fn brake_lock_cap_is_split_mu_aware() {
        let params = VehicleParams::from_json_str(SPEC_JSON).expect("spec loads");
        let c = Controller::new(&DriverModel::balanced(), &params);
        let paved = grip(1.0, 1.0, 1.0, 1.0);

        // 直線（κ = 0）・右 2 輪だけ芝（grip 0.45）: 軸の上限は芝側で決まり大きく下がる。
        let clean = c.brake_lock_cap(30.0, 0.0, &paved);
        let right_grass = c.brake_lock_cap(30.0, 0.0, &grip(1.0, 0.45, 1.0, 0.45));
        assert!(clean > 0.3, "paved cap {clean}");
        assert!(
            right_grass < 0.6 * clean && right_grass > 0.3 * clean,
            "split-mu cap {right_grass} vs paved {clean}"
        );
        // 直線では左右対称。
        let left_grass = c.brake_lock_cap(30.0, 0.0, &grip(0.45, 1.0, 0.45, 1.0));
        assert!((left_grass - right_grass).abs() < 1e-12);

        // 左カーブ（κ > 0 → 左が荷重の抜ける内輪）: 内輪側の縁石の方が外輪側の縁石より上限を下げる。
        let kappa = 0.01;
        let inner_kerb = c.brake_lock_cap(25.0, kappa, &grip(0.9, 1.0, 0.9, 1.0));
        let outer_kerb = c.brake_lock_cap(25.0, kappa, &grip(1.0, 0.9, 1.0, 0.9));
        let paved_turn = c.brake_lock_cap(25.0, kappa, &paved);
        assert!(
            inner_kerb < outer_kerb && outer_kerb <= paved_turn,
            "inner {inner_kerb} / outer {outer_kerb} / paved {paved_turn}"
        );
        // 右カーブでは写像が反転する。
        let r_inner_kerb = c.brake_lock_cap(25.0, -kappa, &grip(1.0, 0.9, 1.0, 0.9));
        assert!((r_inner_kerb - inner_kerb).abs() < 1e-12);
    }

    /// TASK-2-4 Phase 4: トラクション上限は「実際に回っている」横負荷と駆動輪の路面で割り引く。
    /// 11b の level 0.3 / seed 3 ヘアピン出口の実測値（v ≈ 15.7 m/s、r ≈ 1.05 rad/s、κ_traj ≈ 0.012）。
    #[test]
    fn traction_cap_uses_actual_yaw_load_and_drive_surface() {
        let params = VehicleParams::from_json_str(SPEC_JSON).expect("spec loads");
        let c = Controller::new(&DriverModel::balanced(), &params);
        let (v, r, kappa) = (15.7, -1.05, -0.012);
        // 計画曲率だけならまだ半分以上開けてよいと見積もる（旧挙動）…
        let planned = c.traction_throttle_cap(v, kappa, 1.0);
        assert!(planned > 0.4, "planned-curvature cap {planned}");
        // …が、ヨーレート由来の横 G ではリアの摩擦円が横で埋まっており、ほぼ開けられない。
        let k_load = load_curvature(v, r, kappa);
        assert!(
            (k_load - r / v).abs() < 1e-12,
            "sign/magnitude of yaw curvature"
        );
        let actual = c.traction_throttle_cap(v, k_load, 1.0);
        assert!(
            actual < 0.1 * planned,
            "yaw-load cap {actual} vs planned {planned}"
        );
        // ライン上（ヨーレートが計画どおり）では計画曲率がそのまま使われる（11a を変えない）。
        assert_eq!(load_curvature(40.0, 40.0 * 0.01, 0.012), 0.012);
        // 静止付近は計画曲率へ戻す（ゼロ割回避）。
        assert_eq!(load_curvature(0.5, 2.0, 0.003), 0.003);
        // 駆動輪が芝（0.45）なら上限はその分下がる。LSD bias 0.45 では片輪芝 ≈ 左右平均。
        let straight = c.traction_throttle_cap(20.0, 0.0, 1.0);
        let grass = c.traction_throttle_cap(20.0, 0.0, 0.45);
        assert!(
            grass < 0.5 * straight + 1e-9,
            "grass {grass} vs asphalt {straight}"
        );
        let half = c.drive_axle_grip(&grip(1.0, 1.0, 1.0, 0.45));
        assert!((half - 0.725).abs() < 1e-9, "split-mu drive grip {half}");
    }

    /// TASK-2-4 Phase 4: ダウンフォースの軸配分は圧力中心から（`sim-vehicle::aero` と同じ作用点）。
    #[test]
    fn aero_axle_split_matches_pressure_centres() {
        let params = VehicleParams::from_json_str(SPEC_JSON).expect("spec loads");
        let (f, r) = aero_axle_cl_a(&params);
        let total = (params.aero.cl_front + params.aero.cl_rear) * params.aero.frontal_area;
        assert!(
            (f + r - total).abs() < 1e-9,
            "split must conserve total downforce"
        );
        // gt_proto_a: 前 1.691 m² / 後 3.379 m²（`cl·A` 直読みの 2.048 / 3.023 ではない）。
        assert!(
            (f - 1.691).abs() < 5e-3 && (r - 3.379).abs() < 5e-3,
            "front {f} rear {r}"
        );
    }
}
