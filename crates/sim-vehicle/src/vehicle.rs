//! 車両本体。[`Vehicle::step`] が唯一の状態遷移である。
//!
//! # 1 ステップの処理順（決定性のため順序を変えないこと）
//!
//! 1. 入力のクランプ（[`ControlInput::sanitized`]）
//! 2. ステアリングラックの一次遅れ -> 実舵角
//! 3. サスペンション: 接地探索 -> `compression` -> 減衰速度の平滑化 -> `load`
//! 4. パワートレイン: エンジン -> クラッチ -> ギア -> LSD -> 各輪の駆動トルク
//! 5. 車輪 / タイヤを [`crate::WHEEL_SUBSTEPS`] 分割して 960 Hz で解く
//! 6. 空力と重力を足し、剛体を半陰的オイラーで 240 Hz 積分
//! 7. 破綻検知。不変条件が破れていたらこの tick の更新を丸ごと破棄する

use crate::aero::aero_loads;
use crate::ground::GroundProbe;
use crate::input::ControlInput;
use crate::params::{Derived, VehicleParams, VehicleParamsError};
use crate::powertrain::{step_powertrain, Powertrain, RPM_TO_RAD_PER_S};
use crate::state::{VehicleState, WheelIndex, WheelState};
use crate::tyre::{step_tyre, TyreInput, TyreMemory};
use crate::{GRAVITY, PHYSICS_DT, WHEEL_SUBSTEPS};
use sim_math::util::approach_exponential;
use sim_math::{Quat, Vec3};

/// `compression_velocity` の平滑化時定数 [s]。
///
/// 生の差分は縁石で数値的に跳ね、ダンパ力が発散する。
pub const COMPRESSION_VELOCITY_TIME_CONSTANT: f64 = 0.005;

/// ダンパ力の安全弁。静的荷重に対する倍率。
pub const DAMPER_FORCE_LIMIT_RATIO: f64 = 8.0;

/// 破綻とみなす速度 [m/s]。
pub const MAX_SPEED: f64 = 200.0;

/// 破綻とみなす角速度 [rad/s]。
pub const MAX_ANGULAR_SPEED: f64 = 50.0;

/// 1 輪ぶんの接地情報。1 ステップの中だけで使う。
#[derive(Clone, Copy)]
struct Contact {
    grounded: bool,
    point: Vec3,
    normal: Vec3,
    grip: f64,
    rolling_resistance: f64,
    /// 車輪の前方向を接地面へ射影して正規化したもの。
    forward: Vec3,
    /// 車輪の右方向（接地面内）。
    right: Vec3,
    /// 接地点のワールド速度 [m/s]。
    velocity: Vec3,
}

impl Default for Contact {
    fn default() -> Self {
        Contact {
            grounded: false,
            point: Vec3::ZERO,
            normal: Vec3::Y,
            grip: 1.0,
            rolling_resistance: 0.0,
            forward: Vec3::X,
            right: Vec3::Z,
            velocity: Vec3::ZERO,
        }
    }
}

/// 車両。
///
/// 状態を変える公開メソッドは [`Vehicle::step`] のみである。
/// Transform / Position / Velocity を外部から書き換える経路は存在しない。
#[derive(Clone, Debug)]
pub struct Vehicle {
    params: VehicleParams,
    derived: Derived,
    state: VehicleState,
    tyre: [TyreMemory; 4],
    powertrain: Powertrain,
    /// 最初の step でサスペンションの差分速度に偽のスパイクを出さないためのフラグ。
    initialized: bool,
}

impl Vehicle {
    /// パラメータと初期姿勢から構築する。`params.validate()` を内部で呼ぶ。
    ///
    /// `position` は**重心**のワールド座標。`yaw` は `+X` を 0 とし左回りが正。
    pub fn new(
        params: VehicleParams,
        position: Vec3,
        yaw: f64,
    ) -> Result<Self, VehicleParamsError> {
        Self::new_with_velocity(params, position, yaw, Vec3::ZERO)
    }

    /// 初速つきで構築する。ローリングスタートと単体テスト用。
    ///
    /// 車輪は転がり状態（スリップ 0）で初期化される。
    /// これは初期条件の指定であって、外部からの状態書き換え経路ではない
    /// （構築後に速度を与える手段は存在しない）。
    pub fn new_with_velocity(
        params: VehicleParams,
        position: Vec3,
        yaw: f64,
        velocity: Vec3,
    ) -> Result<Self, VehicleParamsError> {
        params.validate()?;
        let derived = Derived::new(&params);
        let orientation = Quat::from_axis_angle(Vec3::Y, yaw);
        let forward = orientation * Vec3::X;
        let forward_speed = velocity.dot(forward);

        let mut wheels = [WheelState::default(); 4];
        for w in WheelIndex::ALL {
            let i = w as usize;
            wheels[i].spin = forward_speed / derived.tyre_radius[i];
        }

        let state = VehicleState {
            position,
            orientation,
            velocity,
            angular_velocity: Vec3::ZERO,
            wheels,
            engine_rpm: params.engine.idle_rpm,
            gear: 0,
            last_input: ControlInput::default(),
            aero_downforce: 0.0,
            recovered_steps: 0,
        };

        Ok(Vehicle {
            powertrain: Powertrain::new(params.engine.idle_rpm),
            params,
            derived,
            state,
            tyre: [TyreMemory::default(); 4],
            initialized: false,
        })
    }

    /// 現在の状態。
    pub fn state(&self) -> &VehicleState {
        &self.state
    }

    /// パラメータ。
    pub fn params(&self) -> &VehicleParams {
        &self.params
    }

    /// 車輪の取り付け点（車体ローカル）。可視化とデバッグ用。
    pub fn wheel_mount_local(&self, w: WheelIndex) -> Vec3 {
        self.derived.mount_local[w as usize]
    }

    /// サスペンションの自由長 [m]。`wheel_world_transform` の検証に使う。
    pub fn suspension_rest_length(&self) -> f64 {
        self.derived.rest_length
    }

    /// 車輪の現在のワールド姿勢。
    ///
    /// **Visual Suspension はこれを使う**（物理と別系統で偽装しないこと）。
    /// 位置は取り付け点から車体上方向へ `rest_length - compression` だけ下げた点であり、
    /// `compression` は物理が決めた値そのものである（T-VEH-11）。
    pub fn wheel_world_transform(&self, w: WheelIndex) -> (Vec3, Quat) {
        let i = w as usize;
        let s = &self.state;
        let mount_world = s.position + s.orientation * self.derived.mount_local[i];
        let travel = self.derived.rest_length - s.wheels[i].compression;
        let center = mount_world - s.up() * travel;
        // ステアは +Y まわり。+Y 正回転は左向きなので実舵角（右が正）を反転する。
        let steer = Quat::from_axis_angle(Vec3::Y, -s.wheels[i].steer_angle);
        // 転がりは車軸（車輪ローカル +Z）まわり。前進で -Z 回転。
        let spin = Quat::from_axis_angle(Vec3::Z, -s.wheels[i].rotation);
        (center, s.orientation * steer * spin)
    }

    /// 1 物理ステップ進める。`dt` は必ず [`PHYSICS_DT`]。
    ///
    /// `dt` が非有限または非正の場合、状態を変えずに戻る。
    pub fn step(&mut self, input: &ControlInput, ground: &dyn GroundProbe, dt: f64) {
        debug_assert!(
            !(dt.is_finite() && dt > 0.0) || (dt - PHYSICS_DT).abs() < 1.0e-12,
            "sim-vehicle は固定タイムステップのみを受け付ける"
        );
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }

        let input = input.sanitized(self.params.drivetrain.gear_ratios.len());
        let snapshot = self.state.clone();
        let tyre_snapshot = self.tyre;
        let powertrain_snapshot = self.powertrain;

        self.apply_steering(&input, dt);
        let contacts = self.solve_suspension(ground, dt);
        self.solve_wheels(&input, &contacts, dt);
        self.integrate_body(&contacts, dt);

        self.state.last_input = input;
        self.state.gear = self.powertrain.gear;

        if !self.invariants_hold() {
            self.state = snapshot;
            self.tyre = tyre_snapshot;
            self.powertrain = powertrain_snapshot;
            self.state.recovered_steps += 1;
        }
        self.initialized = true;
    }

    // ----------------------------------------------------------------------------------
    // ステアリング
    // ----------------------------------------------------------------------------------

    fn apply_steering(&mut self, input: &ControlInput, dt: f64) {
        let target = input.steer * self.params.steering.max_steer_angle;
        let tc = self.params.steering.time_constant;
        for w in WheelIndex::ALL {
            let i = w as usize;
            let angle = if w.is_front() { target } else { 0.0 };
            self.state.wheels[i].steer_angle =
                approach_exponential(self.state.wheels[i].steer_angle, angle, tc, dt);
        }
    }

    // ----------------------------------------------------------------------------------
    // サスペンション
    // ----------------------------------------------------------------------------------

    /// 接地探索と荷重の算出。**荷重移動を直接計算して代入しない。**
    /// ピッチ / ロール / 荷重移動はここで生じる力の合力から創発する。
    fn solve_suspension(&mut self, ground: &dyn GroundProbe, dt: f64) -> [Contact; 4] {
        let mut contacts = [Contact::default(); 4];
        let mut compression = [0.0f64; 4];

        let position = self.state.position;
        let orientation = self.state.orientation;
        let velocity = self.state.velocity;
        let omega = self.state.angular_velocity;
        let susp = self.params.suspension;
        let travel_up = susp.travel_up;
        let probe_extra = self.derived.rest_length + susp.travel_down;

        // --- 1st pass: 幾何と縮み量 -----------------------------------------------------
        for w in WheelIndex::ALL {
            let i = w as usize;
            let radius = self.derived.tyre_radius[i];
            let mount_world = position + orientation * self.derived.mount_local[i];
            let hit = ground.probe(mount_world, probe_extra + radius);

            let Some(hit) = hit else {
                self.state.wheels[i].grounded = false;
                self.tyre[i].reset();
                continue;
            };

            let drop = mount_world.y - hit.point.y;
            let raw = (self.derived.rest_length + radius) - drop;
            let c = raw.clamp(0.0, travel_up);
            compression[i] = c;

            if c <= 0.0 {
                self.state.wheels[i].grounded = false;
                self.tyre[i].reset();
                continue;
            }

            let normal = hit.normal.try_normalize().unwrap_or(Vec3::Y);
            // 車輪の前方向（車体ローカル）。実舵角は右が正なので +Z 側へ向ける。
            let steer = self.state.wheels[i].steer_angle;
            let fwd_body = Vec3::new(steer.cos(), 0.0, steer.sin());
            let fwd_world = orientation * fwd_body;
            let fwd_plane = (fwd_world - normal * fwd_world.dot(normal))
                .try_normalize()
                .unwrap_or(fwd_world);
            let right_plane = fwd_plane.cross(normal);

            contacts[i] = Contact {
                grounded: true,
                point: hit.point,
                normal,
                grip: hit.grip.max(0.0),
                rolling_resistance: hit.rolling_resistance.max(0.0),
                forward: fwd_plane,
                right: right_plane,
                velocity: velocity + omega.cross(hit.point - position),
            };
        }

        // --- 2nd pass: 減衰速度とばね力 -------------------------------------------------
        // アンチロールバーが対輪の縮み量を必要とするため 2 段に分ける。
        for w in WheelIndex::ALL {
            let i = w as usize;
            let wheel = &mut self.state.wheels[i];

            if !contacts[i].grounded {
                wheel.compression = 0.0;
                wheel.compression_velocity = 0.0;
                wheel.load = 0.0;
                wheel.grounded = false;
                wheel.slip_ratio = 0.0;
                wheel.slip_angle = 0.0;
                wheel.force_long = 0.0;
                wheel.force_lat = 0.0;
                wheel.friction_limit = 0.0;
                wheel.grip_usage = 0.0;
                continue;
            }

            let c = compression[i];
            let raw_velocity = if self.initialized {
                (c - wheel.compression) / dt
            } else {
                0.0
            };
            let cv = approach_exponential(
                wheel.compression_velocity,
                raw_velocity,
                COMPRESSION_VELOCITY_TIME_CONSTANT,
                dt,
            );

            let k = self.derived.spring_rate[i];
            let f_spring = k * c * (1.0 + susp.progressive * c / travel_up);
            let damper_coeff = if cv > 0.0 {
                self.derived.damper_bump[i]
            } else {
                self.derived.damper_rebound[i]
            };
            let damper_limit = self.derived.static_load[i] * DAMPER_FORCE_LIMIT_RATIO;
            let f_damper = (damper_coeff * cv).clamp(-damper_limit, damper_limit);
            let f_arb = self.derived.arb[i] * (c - compression[w.opposite() as usize]);

            wheel.compression = c;
            wheel.compression_velocity = cv;
            // **負の荷重（引っ張り）を許すと車体が路面に吸着する。**
            wheel.load = (f_spring + f_damper + f_arb).max(0.0);
            wheel.grounded = true;
        }

        contacts
    }

    // ----------------------------------------------------------------------------------
    // 車輪とタイヤ（サブステップ）
    // ----------------------------------------------------------------------------------

    fn solve_wheels(&mut self, input: &ControlInput, contacts: &[Contact; 4], dt: f64) {
        let mut spins = [0.0f64; 4];
        for w in WheelIndex::ALL {
            spins[w as usize] = self.state.wheels[w as usize].spin;
        }

        let drive = step_powertrain(
            &self.params,
            &self.derived,
            &mut self.powertrain,
            input,
            &spins,
            dt,
        );
        self.state.engine_rpm = drive.engine_rpm;

        let sub_dt = dt / f64::from(WHEEL_SUBSTEPS);
        let mut acc_long = [0.0f64; 4];
        let mut acc_lat = [0.0f64; 4];
        let mut acc_limit = [0.0f64; 4];
        let mut acc_usage = [0.0f64; 4];
        let substeps = f64::from(WHEEL_SUBSTEPS);

        for _ in 0..WHEEL_SUBSTEPS {
            for w in WheelIndex::ALL {
                let i = w as usize;
                let inertia = self.derived.wheel_inertia[i];
                let radius = self.derived.tyre_radius[i];
                let contact = &contacts[i];

                let (force_long, resist) = if contact.grounded {
                    let load = self.state.wheels[i].load;
                    let out = step_tyre(
                        &self.params.tyre,
                        &self.derived,
                        &TyreInput {
                            load,
                            grip: contact.grip,
                            v_long: contact.velocity.dot(contact.forward),
                            v_lat: contact.velocity.dot(contact.right),
                            spin: self.state.wheels[i].spin,
                            radius,
                        },
                        &mut self.tyre[i],
                        sub_dt,
                    );
                    acc_long[i] += out.force_long;
                    acc_lat[i] += out.force_lat;
                    acc_limit[i] += out.friction_limit;
                    acc_usage[i] += out.grip_usage;
                    let rolling = contact.rolling_resistance * load * radius;
                    (out.force_long, rolling)
                } else {
                    (0.0, 0.0)
                };

                // I * dspin/dt = T_drive - Fx * r  (ここまでが加速方向)
                let mut spin = self.state.wheels[i].spin
                    + (drive.wheel_torque[i] - force_long * radius) / inertia * sub_dt;

                // ブレーキと転がり抵抗は常に減速方向。
                // **|spin| * I / dt で頭打ちにすることで符号反転による振動を防ぐ。**
                // ロックアップはこの結果として創発する（専用の判定は存在しない）。
                let brake = input.brake * self.derived.brake_torque[i];
                let opposing = (brake + resist).min(spin.abs() * inertia / sub_dt);
                let sign = if spin > 0.0 {
                    1.0
                } else if spin < 0.0 {
                    -1.0
                } else {
                    0.0
                };
                spin -= opposing * sign * sub_dt / inertia;

                self.state.wheels[i].spin = spin;
                self.state.wheels[i].rotation = (self.state.wheels[i].rotation + spin * sub_dt)
                    .rem_euclid(std::f64::consts::TAU);
            }
        }

        for w in WheelIndex::ALL {
            let i = w as usize;
            let wheel = &mut self.state.wheels[i];
            if contacts[i].grounded {
                wheel.force_long = acc_long[i] / substeps;
                wheel.force_lat = acc_lat[i] / substeps;
                wheel.friction_limit = acc_limit[i] / substeps;
                wheel.grip_usage = acc_usage[i] / substeps;
                wheel.slip_ratio = self.tyre[i].slip_ratio;
                wheel.slip_angle = self.tyre[i].slip_angle;
            }
        }
    }

    // ----------------------------------------------------------------------------------
    // 剛体積分
    // ----------------------------------------------------------------------------------

    fn integrate_body(&mut self, contacts: &[Contact; 4], dt: f64) {
        let position = self.state.position;
        let mass = self.derived.mass;

        let mut force = Vec3::new(0.0, -mass * GRAVITY, 0.0);
        let mut torque = Vec3::ZERO;

        for w in WheelIndex::ALL {
            let i = w as usize;
            if !contacts[i].grounded {
                continue;
            }
            let wheel = &self.state.wheels[i];
            let contact = &contacts[i];
            let f = contact.normal * wheel.load
                + contact.forward * wheel.force_long
                + contact.right * wheel.force_lat;
            force += f;
            torque += (contact.point - position).cross(f);
        }

        let aero = aero_loads(
            &self.params.aero,
            self.state.orientation,
            self.state.velocity,
        );
        force += aero.force;
        torque += aero.torque;
        self.state.aero_downforce = aero.downforce;

        // --- 並進（半陰的オイラー）------------------------------------------------------
        self.state.velocity += force * (dt / mass);
        self.state.position += self.state.velocity * dt;

        // --- 回転（車体ローカルの主軸系で解く）------------------------------------------
        let inv_orientation = self.state.orientation.inverse();
        let omega_body = inv_orientation * self.state.angular_velocity;
        let torque_body = inv_orientation * torque;
        let i_omega = Vec3::new(
            self.derived.inertia.x * omega_body.x,
            self.derived.inertia.y * omega_body.y,
            self.derived.inertia.z * omega_body.z,
        );
        let gyroscopic = omega_body.cross(i_omega);
        let alpha = Vec3::new(
            (torque_body.x - gyroscopic.x) * self.derived.inv_inertia.x,
            (torque_body.y - gyroscopic.y) * self.derived.inv_inertia.y,
            (torque_body.z - gyroscopic.z) * self.derived.inv_inertia.z,
        );
        let omega_body = omega_body + alpha * dt;
        self.state.angular_velocity = self.state.orientation * omega_body;

        // dq/dt = 0.5 * omega_world * q。**毎ステップ正規化する**（ノルムが漂流する）。
        let w = self.state.angular_velocity;
        let q = self.state.orientation;
        let dq = Quat::new(w.x, w.y, w.z, 0.0) * q;
        self.state.orientation = Quat::new(
            q.x + 0.5 * dq.x * dt,
            q.y + 0.5 * dq.y * dt,
            q.z + 0.5 * dq.z * dt,
            q.w + 0.5 * dq.w * dt,
        )
        .normalize();
    }

    // ----------------------------------------------------------------------------------
    // 破綻検知
    // ----------------------------------------------------------------------------------

    /// 不変条件。破れていたらこの tick の更新を破棄する。
    ///
    /// **これは「破綻しても走り続ける」ための保険であり、
    /// `recovered_steps` が増えること自体を不具合として扱う。**
    fn invariants_hold(&self) -> bool {
        let s = &self.state;
        if !(s.position.is_finite() && s.velocity.is_finite() && s.orientation.is_finite()) {
            return false;
        }
        if !s.angular_velocity.is_finite() {
            return false;
        }
        if s.velocity.length() >= MAX_SPEED || s.angular_velocity.length() >= MAX_ANGULAR_SPEED {
            return false;
        }
        for w in WheelIndex::ALL {
            let wheel = &s.wheels[w as usize];
            if !wheel.load.is_finite() || wheel.load < 0.0 {
                return false;
            }
            if !(wheel.spin.is_finite()
                && wheel.compression.is_finite()
                && wheel.force_long.is_finite()
                && wheel.force_lat.is_finite())
            {
                return false;
            }
        }
        if !s.engine_rpm.is_finite() {
            return false;
        }
        true
    }
}

/// エンジン回転数 [rpm] を角速度 [rad/s] へ。テストと診断用。
pub fn rpm_to_rad_per_s(rpm: f64) -> f64 {
    rpm * RPM_TO_RAD_PER_S
}

#[cfg(test)]
pub(crate) mod tests_support {
    use crate::params::*;

    /// `assets/vehicles/gt_proto_a.spec.json` と同じ値をコードで組んだもの。
    ///
    /// serde feature 無効でも単体テストが回るようにするため。
    /// JSON 側との一致は `tests/params.rs` が検証する。
    pub(crate) fn sample_params() -> VehicleParams {
        VehicleParams {
            name: "GT Proto A".to_string(),
            dimensions: Dimensions {
                length: 4.72,
                width: 2.05,
                height: 1.18,
                wheelbase: 2.75,
                track_front: 1.68,
                track_rear: 1.64,
                front_overhang: 0.98,
                rear_overhang: 0.99,
                ride_height_front: 0.075,
                ride_height_rear: 0.085,
            },
            mass: MassParams {
                total_kg: 1245.0,
                distribution_front: 0.45,
                cg_height: 0.42,
                unsprung_kg_per_wheel: 42.0,
                k_roll: DEFAULT_K_ROLL,
                k_pitch: DEFAULT_K_PITCH,
                k_yaw: DEFAULT_K_YAW,
            },
            tyre: TyreParams {
                front: TyreSize {
                    radius: 0.345,
                    width: 0.30,
                    rim_diameter_in: 18.0,
                },
                rear: TyreSize {
                    radius: 0.355,
                    width: 0.31,
                    rim_diameter_in: 18.0,
                },
                mu0: 1.50,
                load_sensitivity: 0.28,
                nominal_load: None,
                bx: 12.0,
                cx: 1.65,
                by: 9.0,
                cy: 1.35,
                relaxation_length: 0.30,
                stick_stiffness_per_n: 40.0,
                stick_damping_ratio: 0.5,
                wheel_inertia_factor: 0.35,
            },
            engine: EngineParams {
                idle_rpm: 1200.0,
                max_rpm: 7500.0,
                limiter_rpm: 7600.0,
                torque_curve: vec![
                    [1000.0, 380.0],
                    [3000.0, 520.0],
                    [5000.0, 560.0],
                    [6500.0, 530.0],
                    [7500.0, 470.0],
                ],
                inertia: 0.22,
                engine_brake_torque: 55.0,
            },
            drivetrain: DrivetrainParams {
                layout: DrivetrainLayout::Rwd,
                gear_ratios: vec![3.15, 2.19, 1.63, 1.29, 1.03, 0.84],
                final_drive: 3.44,
                reverse_ratio: 3.00,
                shift_time_s: 0.06,
                lsd_power_ratio: 0.45,
                lsd_coast_ratio: 0.25,
                driveline_efficiency: 0.92,
                lsd_torque_per_rad: 30.0,
                lsd_preload: 60.0,
            },
            aero: AeroParams {
                frontal_area: 1.95,
                cd: 0.62,
                cl_front: 1.05,
                cl_rear: 1.55,
                cop_front_x: 1.20,
                cop_rear_x: -1.35,
            },
            brakes: BrakeParams {
                max_torque_front: 3600.0,
                max_torque_rear: 2100.0,
                bias_front: 0.62,
                disc_radius_front: 0.190,
                disc_radius_rear: 0.180,
            },
            suspension: SuspensionParams {
                spring_rate_front: 145000.0,
                spring_rate_rear: 160000.0,
                damper_bump_front: 6500.0,
                damper_rebound_front: 9500.0,
                damper_bump_rear: 7000.0,
                damper_rebound_rear: 10500.0,
                arb_front: 32000.0,
                arb_rear: 24000.0,
                travel_up: 0.055,
                travel_down: 0.070,
                progressive: 0.50,
                rest_length: None,
            },
            steering: SteeringParams::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::tests_support::sample_params;
    use super::*;
    use crate::ground::FlatGround;

    #[test]
    fn sample_params_are_valid() {
        sample_params().validate().expect("sample params valid");
    }

    #[test]
    fn rejects_non_positive_mass() {
        let mut p = sample_params();
        p.mass.total_kg = 0.0;
        assert!(p.validate().is_err());
    }

    #[test]
    fn rejects_non_decreasing_gear_ratios() {
        let mut p = sample_params();
        p.drivetrain.gear_ratios = vec![3.0, 3.0, 2.0];
        assert!(p.validate().is_err());
    }

    #[test]
    fn zero_dt_does_not_change_state() {
        let p = sample_params();
        let mut v = Vehicle::new(p, Vec3::new(0.0, 0.42, 0.0), 0.0).unwrap();
        let before = v.state().clone();
        v.step(&ControlInput::default(), &FlatGround::asphalt(0.0), 0.0);
        assert_eq!(&before, v.state());
    }

    #[test]
    fn rpm_conversion_round_trips() {
        assert!((rpm_to_rad_per_s(60.0) - std::f64::consts::TAU).abs() < 1.0e-12);
    }
}
