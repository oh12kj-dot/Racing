//! 観測される車両状態。
//!
//! **フィールドは公開するが、外部から書き換えてはならない。**
//! 書き換えるのは [`crate::Vehicle::step`] だけである。
//! この crate は状態を書き換える公開メソッドを一切持たない。

use crate::input::ControlInput;
use sim_math::{Quat, Vec3};

/// 車輪の識別子。配列添字としても使う。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum WheelIndex {
    /// 左前。
    FrontLeft = 0,
    /// 右前。
    FrontRight = 1,
    /// 左後。
    RearLeft = 2,
    /// 右後。
    RearRight = 3,
}

impl WheelIndex {
    /// 全車輪。**反復順はこの順で固定**（決定性のため）。
    pub const ALL: [WheelIndex; 4] = [
        WheelIndex::FrontLeft,
        WheelIndex::FrontRight,
        WheelIndex::RearLeft,
        WheelIndex::RearRight,
    ];

    /// 前輪か。
    pub fn is_front(self) -> bool {
        matches!(self, WheelIndex::FrontLeft | WheelIndex::FrontRight)
    }

    /// 左輪か（車両ローカルの `-Z` 側）。
    pub fn is_left(self) -> bool {
        matches!(self, WheelIndex::FrontLeft | WheelIndex::RearLeft)
    }

    /// 同軸の反対側の車輪。アンチロールバーで使う。
    pub fn opposite(self) -> WheelIndex {
        match self {
            WheelIndex::FrontLeft => WheelIndex::FrontRight,
            WheelIndex::FrontRight => WheelIndex::FrontLeft,
            WheelIndex::RearLeft => WheelIndex::RearRight,
            WheelIndex::RearRight => WheelIndex::RearLeft,
        }
    }
}

/// 1 輪の状態。
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WheelState {
    /// サスペンションの縮み量 [m]。`0` で伸びきり、正で縮む。
    pub compression: f64,
    /// 縮み速度 [m/s]。正で縮む方向。時定数 5 ms の一次遅れを通してある。
    pub compression_velocity: f64,
    /// 車輪の回転角速度 [rad/s]。
    pub spin: f64,
    /// 車輪の回転角 [rad]。見た目の回転に使う。`0..2pi`。
    pub rotation: f64,
    /// 実舵角 [rad]。正で右へ切る。
    pub steer_angle: f64,
    /// タイヤ垂直荷重 [N]。
    pub load: f64,
    /// 緩和後のスリップ比（無次元）。
    pub slip_ratio: f64,
    /// 緩和後のスリップ角 [rad]。正で接地点が右へ滑っている。
    pub slip_angle: f64,
    /// 接地しているか。
    pub grounded: bool,
    /// タイヤ力の縦成分（車輪の前方向が正）[N]。
    pub force_long: f64,
    /// タイヤ力の横成分（車輪の右方向が正）[N]。
    pub force_lat: f64,
    /// この tick の摩擦円の半径 `mu * load` [N]。
    ///
    /// `grip_usage` が `1.0` で飽和するため、摩擦円の検証（T-VEH-07）には
    /// 生の上限値が要る。テレメトリ表示にも使う。
    pub friction_limit: f64,
    /// 摩擦円の使用率 `0..1`。可視化とテレメトリ用。
    pub grip_usage: f64,
}

/// 車両の状態。
#[derive(Clone, Debug, PartialEq)]
pub struct VehicleState {
    /// **重心**のワールド座標。
    pub position: Vec3,
    /// 車体姿勢。
    pub orientation: Quat,
    /// 重心のワールド速度 [m/s]。
    pub velocity: Vec3,
    /// ワールド角速度 [rad/s]。
    pub angular_velocity: Vec3,
    /// 各車輪の状態。添字は [`WheelIndex`]。
    pub wheels: [WheelState; 4],
    /// エンジン回転数 [rpm]。
    pub engine_rpm: f64,
    /// 現在のギア。`-1` = リバース、`0` = ニュートラル。
    pub gear: i8,
    /// 直前に適用された（クランプ済みの）入力。テレメトリ用。
    pub last_input: ControlInput,
    /// この tick に作用した総ダウンフォース [N]。テレメトリと T-VEH-09 用。
    pub aero_downforce: f64,
    /// 破綻検知により更新を破棄した回数。
    ///
    /// **これは保険であり、増えること自体が不具合である。**
    /// 受け入れテストはこの値が `0` であることを要求する。
    pub recovered_steps: u64,
}

impl VehicleState {
    /// 車体の前方向（ワールド）。
    pub fn forward(&self) -> Vec3 {
        self.orientation * Vec3::X
    }

    /// 車体の上方向（ワールド）。
    pub fn up(&self) -> Vec3 {
        self.orientation * Vec3::Y
    }

    /// 車体の右方向（ワールド）。
    pub fn right(&self) -> Vec3 {
        self.orientation * Vec3::Z
    }

    /// ヨー角 [rad]。`+X` を 0 とし、左旋回が正（`+Y` まわりの右手系）。
    pub fn yaw(&self) -> f64 {
        let f = self.forward();
        (-f.z).atan2(f.x)
    }

    /// ピッチ角 [rad]。**正で機首上げ（スクワット）、負で機首下げ（ダイブ）。**
    ///
    /// `Quat::to_euler_yxz` の "pitch" は `+X` まわりであり、
    /// 車両ローカル（`+X` 前方）ではロールに相当する。混同しないこと。
    pub fn pitch(&self) -> f64 {
        self.forward().y.clamp(-1.0, 1.0).asin()
    }

    /// ロール角 [rad]。**正で右側が沈む。**
    pub fn roll(&self) -> f64 {
        (-self.right().y).clamp(-1.0, 1.0).asin()
    }

    /// 前進速度 [m/s]（車体前方向への射影）。
    pub fn forward_speed(&self) -> f64 {
        self.velocity.dot(self.forward())
    }

    /// 4 輪の垂直荷重の合計 [N]。
    pub fn total_load(&self) -> f64 {
        self.wheels.iter().map(|w| w.load).sum()
    }
}
