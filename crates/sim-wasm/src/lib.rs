//! `sim-wasm` — Engineering View 向けの WASM 境界。
//!
//! この crate はロジックを持たず、型変換だけを行う。
//!
//! - **トラック幾何は読み出し専用**（[`TrackView`] / [`WasmTrack`]）。書き込み経路はない
//! - [`WorldView`] / [`WasmWorld`] は [`sim_core::World`] を保持して進めるが、
//!   外部から渡せるのは [`sim_vehicle::ControlInput`] 相当の数値列だけである。
//!   Transform / Position / Velocity を書く公開メソッドは存在しない。
//!   これは実シミュレーションの駆動経路そのものであって、Presentation が
//!   Simulation を書き換える別経路ではない（DECISIONS.md ADR-0003、
//!   `HANDOFF.md` §3-1、および ARCHITECTURE.md の依存方向 `sim-wasm -> sim-core`）
//!
//! # 構成
//!
//! | 層 | 型 | 役割 |
//! |----|----|------|
//! | 純 Rust | [`TrackView`] | トラック幾何のサンプリング。`wasm_bindgen` に依存しない |
//! | 境界 | [`WasmTrack`] | [`TrackView`] への薄いラッパ。型変換のみ |
//! | 純 Rust | [`WorldView`] | [`sim_core::World`] の保持と読み出し。`wasm_bindgen` に依存しない |
//! | 境界 | [`WasmWorld`] | [`WorldView`] への薄いラッパ。型変換のみ |
//!
//! テストは純 Rust 層（[`TrackView`] / [`WorldView`]）に対して書く。これにより
//! ネイティブの `cargo test -p sim-wasm` でロジックを検証できる。
//!
//! # サンプリングの規約
//!
//! `step_m` を受け取る関数はすべて同一の **ステーション列** を共有する。
//! 全長 `L`、`n = ceil(L / step_m)` として
//!
//! ```text
//! s_i = i * L / n     (i = 0 ..= n)
//! ```
//!
//! すなわちステーション数は `n + 1` で、実際の間隔 `L / n` は `step_m` 以下になる。
//! 最後のステーション `s_n = L` は [`sim_track::Track::frame_at`] の `wrap_s` により
//! `s_0 = 0` と厳密に一致するため、閉じたトラックの継ぎ目が正確に閉じる。
//!
//! `sample_curvature` / `sample_banking` の `i` 番目の値は、
//! `sample_line` の `i` 番目の点、`sample_surface` の `2i` / `2i+1` 番目の頂点に対応する。

#![deny(unsafe_code)]
#![warn(missing_docs)]

use sim_core::{World, WorldError};
use sim_math::Vec3;
use sim_track::{Track, TrackCoord, TrackIoError};
use sim_vehicle::{ControlInput, VehicleParams, VehicleParamsError, WheelIndex};

/// ステーション数の上限。これを超える `step_m` の指定は不正として空を返す。
///
/// Engineering View はブラウザ上で動く。極端に小さい `step_m` を渡されたときに
/// 数 GB の配列を確保してタブを落とすのではなく、空配列で失敗させる。
/// 4 km のトラックに対して 200 000 ステーションは 2 cm 間隔に相当する。
const MAX_STATIONS: usize = 200_000;

/// トラック幾何のサンプリング。`wasm_bindgen` に依存しない純 Rust 層。
pub struct TrackView {
    track: Track,
}

impl TrackView {
    /// トラック定義 JSON 文字列から構築する。
    ///
    /// [`sim_track::track_from_json_str`] がスキーマバージョンと構築可能性を
    /// 検証するため、不正なデータはここで弾かれる。
    pub fn from_json(track_json: &str) -> Result<TrackView, TrackIoError> {
        let def = sim_track::track_from_json_str(track_json)?;
        let track = Track::build(&def).map_err(TrackIoError::Invalid)?;
        Ok(TrackView { track })
    }

    /// 内部の [`Track`] への参照。テストと検証用。
    pub fn track(&self) -> &Track {
        &self.track
    }

    /// `step_m` に対応するステーションの `s` 列。
    ///
    /// `step_m` が非有限・非正、またはステーション数が [`MAX_STATIONS`] を
    /// 超える場合は空を返す。
    pub fn stations(&self, step_m: f64) -> Vec<f64> {
        if !step_m.is_finite() || step_m <= 0.0 {
            return Vec::new();
        }
        let length = self.track.length();
        let segments = (length / step_m).ceil();
        if !segments.is_finite() || segments < 1.0 || segments >= MAX_STATIONS as f64 {
            return Vec::new();
        }
        let n = segments as usize;
        (0..=n).map(|i| (i as f64) * length / (n as f64)).collect()
    }

    /// 幅に対する比 `ratio` の横位置に沿った線。平坦な `[x, y, z, ...]` を返す。
    ///
    /// `ratio` は `-1.0` で右端、`0.0` でセンターライン、`+1.0` で左端。
    /// コース幅が `s` によって変わるため、絶対値ではなく比で指定する。
    pub fn sample_line(&self, lateral_offset_ratio: f64, step_m: f64) -> Vec<f64> {
        let stations = self.stations(step_m);
        let mut out = Vec::with_capacity(stations.len() * 3);
        for s in stations {
            let f = self.track.frame_at(s);
            let t = lateral_offset(lateral_offset_ratio, f.width_left, f.width_right);
            push_vec3(&mut out, f.position + f.lateral * t);
        }
        out
    }

    /// 路面ポリゴン用。左端と右端を交互に並べた三角形ストリップ用頂点列。
    ///
    /// 頂点数は `2 * (ceil(length / step_m) + 1)`、要素数はその 3 倍。
    pub fn sample_surface(&self, step_m: f64) -> Vec<f64> {
        let stations = self.stations(step_m);
        let mut out = Vec::with_capacity(stations.len() * 6);
        for s in stations {
            let f = self.track.frame_at(s);
            push_vec3(&mut out, f.position + f.lateral * f.width_left);
            push_vec3(&mut out, f.position - f.lateral * f.width_right);
        }
        out
    }

    /// 各ステーションの曲率 [1/m]。左カーブが正。
    pub fn sample_curvature(&self, step_m: f64) -> Vec<f64> {
        self.stations(step_m)
            .into_iter()
            .map(|s| self.track.frame_at(s).curvature)
            .collect()
    }

    /// 各ステーションのバンク角 [rad]。左端が持ち上がる向きが正。
    pub fn sample_banking(&self, step_m: f64) -> Vec<f64> {
        self.stations(step_m)
            .into_iter()
            .map(|s| self.track.frame_at(s).banking)
            .collect()
    }

    /// ワールド座標 -> トラック座標。
    ///
    /// ビューアはマウスホバーごとに単発で呼ぶだけで、前 tick の `s` を持たない。
    /// したがって `hint` は渡さない（[`sim_track::Track::world_to_track`] は
    /// hint 無しでも厳密に解を返す）。
    pub fn world_to_track(&self, p: Vec3) -> TrackCoord {
        self.track.world_to_track(p, None)
    }
}

/// 1 回の [`WorldView::step`] で進めてよい物理 tick 数の上限。
///
/// `32 * PHYSICS_DT ≈ 133 ms`。ブラウザのタブが背面から復帰したときに
/// 数秒ぶんの `dt` がまとめて来ても、1 表示フレームで消化する量をここで頭打ちにして
/// タブをフリーズさせない。超過ぶんは捨てる（見た目のスローモーションを許容する）。
pub const MAX_STEPS_PER_CALL: u32 = 32;

/// [`WorldView::step`] が 1 台ぶんの入力として読む要素数。
///
/// 並びは `[steer, throttle, brake, clutch, gear, drs]`。
pub const INPUT_STRIDE: usize = 6;

/// [`WorldView`] の構築 / スポーンのエラー。
#[derive(Debug)]
pub enum WorldViewError {
    /// トラック定義 JSON の読み込みに失敗した。
    Track(TrackIoError),
    /// 車両スペック JSON の読み込みに失敗した。
    Vehicle(VehicleParamsError),
    /// [`sim_core::World`] の操作に失敗した（スポーン座標が非有限など）。
    World(WorldError),
}

impl core::fmt::Display for WorldViewError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            WorldViewError::Track(e) => write!(f, "track JSON: {e}"),
            WorldViewError::Vehicle(e) => write!(f, "vehicle spec JSON: {e}"),
            WorldViewError::World(e) => write!(f, "world: {e}"),
        }
    }
}

impl std::error::Error for WorldViewError {}

impl From<TrackIoError> for WorldViewError {
    fn from(e: TrackIoError) -> Self {
        WorldViewError::Track(e)
    }
}
impl From<VehicleParamsError> for WorldViewError {
    fn from(e: VehicleParamsError) -> Self {
        WorldViewError::Vehicle(e)
    }
}
impl From<WorldError> for WorldViewError {
    fn from(e: WorldError) -> Self {
        WorldViewError::World(e)
    }
}

/// [`sim_core::World`] を保持し、Engineering View 用の読み出しを提供する純 Rust 層。
///
/// 状態を変える経路は [`WorldView::step`]（[`ControlInput`] を渡す）だけである。
/// これは実シミュレーションの駆動経路そのものであり、Presentation から
/// Simulation を書き換える別経路ではない（`HANDOFF.md` §3-1）。
pub struct WorldView {
    world: World,
    /// スポーンのたびに複製する車両パラメータ（[`World::spawn`] が値で受け取るため）。
    params: VehicleParams,
}

impl WorldView {
    /// トラック定義 JSON と車両スペック JSON から構築する。車両は 0 台。
    pub fn from_json(
        track_json: &str,
        vehicle_spec_json: &str,
    ) -> Result<WorldView, WorldViewError> {
        let def = sim_track::track_from_json_str(track_json)?;
        let track = Track::build(&def).map_err(TrackIoError::Invalid)?;
        let params = VehicleParams::from_json_str(vehicle_spec_json)?;
        Ok(WorldView {
            world: World::new(track),
            params,
        })
    }

    /// トラック局所座標 `(s, t)` に 1 台配置する。戻り値は添字（= `VehicleId.0`）。
    pub fn spawn(&mut self, start_s: f64, start_t: f64) -> Result<usize, WorldViewError> {
        let id = self.world.spawn(self.params.clone(), start_s, start_t)?;
        Ok(id.0)
    }

    /// `steps` 物理 tick 進める。
    ///
    /// `inputs` は 1 台あたり [`INPUT_STRIDE`] 要素
    /// （`[steer, throttle, brake, clutch, gear, drs]`）を平坦に並べたもの。
    /// 車両数ぶんに満たない分は [`ControlInput::default`]。
    /// `steps` は [`MAX_STEPS_PER_CALL`] でクランプし、超過分は捨てる。
    /// `dt` は [`sim_vehicle::PHYSICS_DT`] 固定で、引数に取らない。
    pub fn step(&mut self, steps: u32, inputs: &[f64]) {
        let controls = parse_inputs(inputs);
        let steps = steps.min(MAX_STEPS_PER_CALL);
        for _ in 0..steps {
            self.world.step(&controls);
        }
    }

    /// 進んだ tick 数。
    pub fn tick(&self) -> u64 {
        self.world.tick()
    }

    /// 配置済みの車両数。
    pub fn vehicle_count(&self) -> usize {
        self.world.vehicles().len()
    }

    /// トラック全長 [m]。
    pub fn track_length(&self) -> f64 {
        self.world.track().length()
    }

    /// 車体重心のワールド姿勢。`[px,py,pz, qx,qy,qz,qw]`（7 要素 × 台数）。
    ///
    /// 値は [`sim_vehicle::VehicleState`] の `position` / `orientation` そのまま。
    pub fn body_poses(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.world.vehicles().len() * 7);
        for entry in self.world.vehicles() {
            let s = entry.vehicle.state();
            push_vec3(&mut out, s.position);
            push_quat(&mut out, s.orientation);
        }
        out
    }

    /// 車輪のワールド姿勢。1 台あたり 4 輪 ×`[px,py,pz, qx,qy,qz,qw]` = 28 要素。
    ///
    /// 車輪順は [`WheelIndex::ALL`]（FL, FR, RL, RR）。値は
    /// [`sim_vehicle::Vehicle::wheel_world_transform`] そのまま。
    pub fn wheel_poses(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.world.vehicles().len() * 28);
        for entry in self.world.vehicles() {
            for w in WheelIndex::ALL {
                let (pos, rot) = entry.vehicle.wheel_world_transform(w);
                push_vec3(&mut out, pos);
                push_quat(&mut out, rot);
            }
        }
        out
    }

    /// テレメトリ。1 台あたり以下を平坦に並べる（順序固定・計 25 要素 × 台数）:
    ///
    /// `s, t, laps, forward_speed, engine_rpm, gear, in_steer, in_throttle, in_brake`
    /// のあと、[`WheelIndex::ALL`] 順に `[load, slip_ratio, slip_angle, grip_usage]`。
    pub fn telemetry(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.world.vehicles().len() * 25);
        for entry in self.world.vehicles() {
            let s = entry.vehicle.state();
            out.push(entry.coord.s);
            out.push(entry.coord.t);
            out.push(entry.laps_completed as f64);
            out.push(s.forward_speed());
            out.push(s.engine_rpm);
            out.push(s.gear as f64);
            out.push(s.last_input.steer);
            out.push(s.last_input.throttle);
            out.push(s.last_input.brake);
            for w in WheelIndex::ALL {
                let ws = &s.wheels[w as usize];
                out.push(ws.load);
                out.push(ws.slip_ratio);
                out.push(ws.slip_angle);
                out.push(ws.grip_usage);
            }
        }
        out
    }

    /// 順位。[`World::standings`] の添字列をそのまま返す（`(laps, s)` の辞書順）。
    pub fn standings(&self) -> Vec<usize> {
        self.world.standings().into_iter().map(|id| id.0).collect()
    }

    /// 内部の [`World`] への参照。テストと検証用（読み出しのみ。
    /// `&World` の公開メソッドで状態は変えられない）。
    pub fn world(&self) -> &World {
        &self.world
    }
}

/// 平坦な入力配列を 1 台ぶんずつ [`ControlInput`] へ切り出す。
///
/// [`INPUT_STRIDE`] に満たない端数は無視する（不完全な最終要素を捨てる）。
fn parse_inputs(inputs: &[f64]) -> Vec<ControlInput> {
    inputs
        .chunks_exact(INPUT_STRIDE)
        .map(|c| ControlInput {
            steer: c[0],
            throttle: c[1],
            brake: c[2],
            clutch: c[3],
            gear: c[4] as i8,
            drs: c[5] != 0.0,
        })
        .collect()
}

/// `Quat` を平坦な `[x, y, z, w]` として追加する。
fn push_quat(out: &mut Vec<f64>, q: sim_math::Quat) {
    out.push(q.x);
    out.push(q.y);
    out.push(q.z);
    out.push(q.w);
}

/// 幅の比 `ratio` を横オフセット `t` [m] へ変換する。`+t` は左。
fn lateral_offset(ratio: f64, width_left: f64, width_right: f64) -> f64 {
    if ratio >= 0.0 {
        ratio * width_left
    } else {
        ratio * width_right
    }
}

/// `Vec3` を平坦な `f64` 配列へ追加する。
fn push_vec3(out: &mut Vec<f64>, v: Vec3) {
    out.push(v.x);
    out.push(v.y);
    out.push(v.z);
}

// `wasm_bindgen` のマクロ展開は `unsafe extern "C"` を生成するため、
// crate 全体の `#![deny(unsafe_code)]` を満たせない。
// 例外をこのモジュールだけに閉じ込めることで、
// 「手書きの unsafe はどこにも無い」ことを構造的に保証する。
#[allow(unsafe_code)]
mod bindings {
    use super::TrackView;
    use sim_math::Vec3;
    use wasm_bindgen::prelude::*;

    /// トラックを WASM 側で保持し、JS から幾何を読み出すためのハンドル。
    ///
    /// 書き込み用のメソッドは意図的に存在しない。
    #[wasm_bindgen]
    pub struct WasmTrack {
        view: TrackView,
    }

    #[wasm_bindgen]
    impl WasmTrack {
        /// トラック定義 JSON から構築する。失敗時は `JsError`。
        #[wasm_bindgen(constructor)]
        pub fn new(track_json: &str) -> Result<WasmTrack, JsError> {
            let view =
                TrackView::from_json(track_json).map_err(|e| JsError::new(&e.to_string()))?;
            Ok(WasmTrack { view })
        }

        /// トラック名。
        pub fn name(&self) -> String {
            self.view.track().name().to_string()
        }

        /// 全長 [m]。
        pub fn length(&self) -> f64 {
            self.view.track().length()
        }

        /// セクター境界の `s` [m]。
        pub fn sector_boundaries(&self) -> Vec<f64> {
            self.view.track().sector_boundaries().to_vec()
        }

        /// スタート/フィニッシュ線の `s` [m]。
        pub fn start_finish_s(&self) -> f64 {
            self.view.track().start_finish_s()
        }

        /// 幅に対する比 `lateral_offset_ratio` の線。平坦な `[x, y, z, ...]`。
        ///
        /// `-1.0` で右端、`0.0` でセンターライン、`+1.0` で左端。
        pub fn sample_line(&self, lateral_offset_ratio: f64, step_m: f64) -> Vec<f64> {
            self.view.sample_line(lateral_offset_ratio, step_m)
        }

        /// 路面ポリゴン用。左端と右端を交互に並べた三角形ストリップ用頂点列。
        pub fn sample_surface(&self, step_m: f64) -> Vec<f64> {
            self.view.sample_surface(step_m)
        }

        /// 各サンプル点の曲率 [1/m]。`sample_surface` と同じ `step_m` で対応する。
        pub fn sample_curvature(&self, step_m: f64) -> Vec<f64> {
            self.view.sample_curvature(step_m)
        }

        /// 各サンプル点のバンク角 [rad]。
        pub fn sample_banking(&self, step_m: f64) -> Vec<f64> {
            self.view.sample_banking(step_m)
        }

        /// ワールド座標からトラック座標を求める。`[s, t]` を返す。
        pub fn world_to_track(&self, x: f64, y: f64, z: f64) -> Vec<f64> {
            let c = self.view.world_to_track(Vec3::new(x, y, z));
            vec![c.s, c.t]
        }
    }

    /// [`sim_core::World`] を WASM 側で保持し、JS から進めて読み出すためのハンドル。
    ///
    /// 状態を変える公開メソッドは [`WasmWorld::step`]（`ControlInput` 相当の数値列を
    /// 渡す）だけである。位置・速度・姿勢を直接書くメソッドは意図的に存在しない。
    #[wasm_bindgen]
    pub struct WasmWorld {
        view: super::WorldView,
    }

    #[wasm_bindgen]
    impl WasmWorld {
        /// トラック定義 JSON と車両スペック JSON から構築する。失敗時は `JsError`。
        #[wasm_bindgen(constructor)]
        pub fn new(track_json: &str, vehicle_spec_json: &str) -> Result<WasmWorld, JsError> {
            let view = super::WorldView::from_json(track_json, vehicle_spec_json)
                .map_err(|e| JsError::new(&e.to_string()))?;
            Ok(WasmWorld { view })
        }

        /// トラック局所座標 `(start_s, start_t)` に 1 台配置する。戻り値は添字。
        pub fn spawn(&mut self, start_s: f64, start_t: f64) -> Result<usize, JsError> {
            self.view
                .spawn(start_s, start_t)
                .map_err(|e| JsError::new(&e.to_string()))
        }

        /// `steps` 物理 tick 進める。`inputs` は 1 台あたり 6 要素
        /// `[steer, throttle, brake, clutch, gear, drs]` を平坦に並べた `Float64Array`。
        pub fn step(&mut self, steps: u32, inputs: &[f64]) {
            self.view.step(steps, inputs);
        }

        /// 進んだ tick 数。JS 側の扱いを単純にするため `f64` で返す
        /// （デバッグ用途では 2^53 tick まで正確で十分）。
        pub fn tick(&self) -> f64 {
            self.view.tick() as f64
        }

        /// 配置済みの車両数。
        pub fn vehicle_count(&self) -> usize {
            self.view.vehicle_count()
        }

        /// トラック全長 [m]。
        pub fn track_length(&self) -> f64 {
            self.view.track_length()
        }

        /// 車体重心のワールド姿勢。`[px,py,pz, qx,qy,qz,qw]` × 台数。
        pub fn body_poses(&self) -> Vec<f64> {
            self.view.body_poses()
        }

        /// 車輪のワールド姿勢。1 台あたり 4 輪 × 7 要素（FL, FR, RL, RR 順）。
        pub fn wheel_poses(&self) -> Vec<f64> {
            self.view.wheel_poses()
        }

        /// テレメトリ。1 台あたり 25 要素（並びは [`WorldView::telemetry`] を参照）。
        pub fn telemetry(&self) -> Vec<f64> {
            self.view.telemetry()
        }

        /// 順位（`(laps, s)` の辞書順の添字列）。
        pub fn standings(&self) -> Vec<usize> {
            self.view.standings()
        }
    }
}

pub use bindings::{WasmTrack, WasmWorld};

#[cfg(test)]
mod tests {
    use super::*;

    /// Aoyama Ring。アセットが唯一の正であり、テストは同梱した実体を使う。
    const AOYAMA: &str = include_str!("../../../assets/tracks/aoyama_ring.track.json");

    const STEP: f64 = 1.0;

    fn view() -> TrackView {
        TrackView::from_json(AOYAMA).expect("aoyama ring must load")
    }

    fn vertex(flat: &[f64], i: usize) -> Vec3 {
        Vec3::new(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2])
    }

    #[test]
    fn wasm_track_builds_from_asset() {
        let v = view();
        let def = sim_track::track_from_json_str(AOYAMA).expect("definition must parse");
        let track = Track::build(&def).expect("track must build");

        assert_eq!(v.track().name(), track.name());
        assert_eq!(v.track().length(), track.length());
        assert!(v.track().length() > 0.0);
    }

    #[test]
    fn sample_surface_is_consistent() {
        let v = view();
        let length = v.track().length();
        let expected_stations = (length / STEP).ceil() as usize + 1;

        let flat = v.sample_surface(STEP);
        assert_eq!(flat.len() % 3, 0);
        let vertices = flat.len() / 3;
        assert_eq!(vertices, 2 * expected_stations);
        // 仕様どおり 2 * ceil(length/step) + 2 であることを別式でも確認する。
        assert_eq!(vertices, 2 * (length / STEP).ceil() as usize + 2);

        assert!(flat.iter().all(|x| x.is_finite()), "all vertices finite");

        let stations = v.stations(STEP);
        assert_eq!(stations.len(), expected_stations);
        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            let left = vertex(&flat, 2 * i);
            let right = vertex(&flat, 2 * i + 1);
            let width = left.distance(right);
            assert!(
                (width - (f.width_left + f.width_right)).abs() < 1.0e-6,
                "station {i}: width {width} != {}",
                f.width_left + f.width_right
            );
        }

        // 閉じたトラックなので継ぎ目は厳密に一致する。
        let first_left = vertex(&flat, 0);
        let last_left = vertex(&flat, 2 * (expected_stations - 1));
        assert_eq!(first_left, last_left, "seam must close exactly");
    }

    #[test]
    fn sample_line_offsets() {
        let v = view();
        let stations = v.stations(STEP);
        let center = v.sample_line(0.0, STEP);
        let left = v.sample_line(1.0, STEP);
        let right = v.sample_line(-1.0, STEP);

        assert_eq!(center.len(), stations.len() * 3);
        assert_eq!(left.len(), center.len());
        assert_eq!(right.len(), center.len());

        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            assert!(vertex(&center, i).distance(f.position) < 1.0e-12);
            let expect_left = f.position + f.lateral * f.width_left;
            let expect_right = f.position - f.lateral * f.width_right;
            assert!(vertex(&left, i).distance(expect_left) < 1.0e-12);
            assert!(vertex(&right, i).distance(expect_right) < 1.0e-12);
        }

        // 左右の端は sample_surface と一致しなければならない。
        let surface = v.sample_surface(STEP);
        for i in 0..stations.len() {
            assert_eq!(vertex(&left, i), vertex(&surface, 2 * i));
            assert_eq!(vertex(&right, i), vertex(&surface, 2 * i + 1));
        }
    }

    #[test]
    fn sample_curvature_matches_track() {
        let v = view();
        let stations = v.stations(STEP);
        let curvature = v.sample_curvature(STEP);
        let banking = v.sample_banking(STEP);

        assert_eq!(curvature.len(), stations.len());
        assert_eq!(banking.len(), stations.len());

        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            assert_eq!(curvature[i], f.curvature);
            assert_eq!(banking[i], f.banking);
        }

        // 曲率が全区間ゼロなら着色は意味を持たない。実データであることを確認する。
        assert!(curvature.iter().any(|k| k.abs() > 1.0e-3));
        assert!(banking.iter().any(|b| b.abs() > 1.0e-3));
    }

    #[test]
    fn world_to_track_roundtrip() {
        let v = view();
        let stations = v.stations(STEP);
        let center = v.sample_line(0.0, STEP);
        let length = v.track().length();

        for (i, &s) in stations.iter().enumerate() {
            let c = v.world_to_track(vertex(&center, i));
            assert!(c.t.abs() < 1.0e-6, "station {i}: t = {}", c.t);
            let ds = v.track().signed_delta_s(v.track().wrap_s(s), c.s).abs();
            assert!(ds < 1.0e-3, "station {i}: ds = {ds} (length {length})");
        }

        // センターライン以外でも t が復元できること。
        let left = v.sample_line(1.0, STEP);
        for (i, &s) in stations.iter().enumerate() {
            let f = v.track().frame_at(s);
            let c = v.world_to_track(vertex(&left, i));
            assert!(
                (c.t - f.width_left).abs() < 1.0e-3,
                "station {i}: t = {} expected {}",
                c.t,
                f.width_left
            );
        }
    }

    #[test]
    fn invalid_json_returns_error() {
        assert!(TrackView::from_json("").is_err(), "empty");
        assert!(TrackView::from_json("{ not json").is_err(), "malformed");
        assert!(
            TrackView::from_json(r#"{"schema_version":999,"track":{}}"#).is_err(),
            "unsupported version"
        );
        assert!(
            TrackView::from_json(r#"{"schema_version":1,"track":{}}"#).is_err(),
            "missing fields"
        );
    }

    #[test]
    fn invalid_step_returns_empty() {
        let v = view();
        for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, 1.0e-9] {
            assert!(v.stations(bad).is_empty(), "stations({bad})");
            assert!(v.sample_line(0.0, bad).is_empty(), "sample_line({bad})");
            assert!(v.sample_surface(bad).is_empty(), "sample_surface({bad})");
            assert!(
                v.sample_curvature(bad).is_empty(),
                "sample_curvature({bad})"
            );
            assert!(v.sample_banking(bad).is_empty(), "sample_banking({bad})");
        }
    }

    // ------------------------------------------------------------------------------------
    // WorldView（TASK-1B-3）
    // ------------------------------------------------------------------------------------

    /// GT Proto A。物理と見た目の共通の正であるアセットをそのまま使う。
    const SPEC: &str = include_str!("../../../assets/vehicles/gt_proto_a.spec.json");

    /// スポーン地点。S/F ストレート上（バンクほぼ 0）に置く。
    const SPAWN_S: f64 = 40.0;

    fn world_view() -> WorldView {
        WorldView::from_json(AOYAMA, SPEC).expect("aoyama ring + gt proto a must load")
    }

    /// 1 台ぶんの入力（`throttle`, `gear`）を平坦配列にする。
    fn drive(throttle: f64, brake: f64, steer: f64, gear: i8) -> Vec<f64> {
        vec![steer, throttle, brake, 0.0, gear as f64, 0.0]
    }

    #[test]
    fn t_ev_a1_worldview_builds_and_spawns() {
        let mut wv = world_view();
        assert_eq!(wv.vehicle_count(), 0);
        let id = wv.spawn(SPAWN_S, 0.0).expect("spawn on S/F straight");
        assert_eq!(id, 0);
        assert_eq!(wv.vehicle_count(), 1);
        assert!((wv.track_length() - 4139.0).abs() < 2.0);

        // 不正なスペック / トラックは弾かれる。
        assert!(WorldView::from_json("{ not json", SPEC).is_err());
        assert!(WorldView::from_json(AOYAMA, r#"{"schema_version":1}"#).is_err());
        // 非有限のスポーン座標。
        assert!(world_view().spawn(f64::NAN, 0.0).is_err());
    }

    #[test]
    fn t_ev_a2_body_poses_match_world_truth() {
        let mut wv = world_view();
        wv.spawn(SPAWN_S, 0.0).unwrap();
        let inputs = drive(0.4, 0.0, 0.0, 1);
        for _ in 0..300 {
            wv.step(1, &inputs);
        }
        let poses = wv.body_poses();
        let truth = wv.world().vehicles()[0].vehicle.state();
        assert!((poses[0] - truth.position.x).abs() < 1.0e-6);
        assert!((poses[1] - truth.position.y).abs() < 1.0e-6);
        assert!((poses[2] - truth.position.z).abs() < 1.0e-6);
        assert!((poses[3] - truth.orientation.x).abs() < 1.0e-6);
        assert!((poses[4] - truth.orientation.y).abs() < 1.0e-6);
        assert!((poses[5] - truth.orientation.z).abs() < 1.0e-6);
        assert!((poses[6] - truth.orientation.w).abs() < 1.0e-6);
        // 実際に前進していること（テストが自明でないことの確認）。
        assert!(truth.forward_speed() > 1.0, "car should be moving");
    }

    #[test]
    fn t_ev_a3_wheel_poses_match_transform() {
        let mut wv = world_view();
        wv.spawn(SPAWN_S, 0.0).unwrap();
        let inputs = drive(0.3, 0.0, 0.1, 1);
        for _ in 0..200 {
            wv.step(1, &inputs);
        }
        let poses = wv.wheel_poses();
        let vehicle = &wv.world().vehicles()[0].vehicle;
        for (k, w) in WheelIndex::ALL.into_iter().enumerate() {
            let (pos, rot) = vehicle.wheel_world_transform(w);
            let b = k * 7;
            assert!((poses[b] - pos.x).abs() < 1.0e-9, "wheel {w:?} x");
            assert!((poses[b + 1] - pos.y).abs() < 1.0e-9, "wheel {w:?} y");
            assert!((poses[b + 2] - pos.z).abs() < 1.0e-9, "wheel {w:?} z");
            assert!((poses[b + 3] - rot.x).abs() < 1.0e-9, "wheel {w:?} qx");
            assert!((poses[b + 4] - rot.y).abs() < 1.0e-9, "wheel {w:?} qy");
            assert!((poses[b + 5] - rot.z).abs() < 1.0e-9, "wheel {w:?} qz");
            assert!((poses[b + 6] - rot.w).abs() < 1.0e-9, "wheel {w:?} qw");
        }
    }

    #[test]
    fn t_ev_a4_determinism() {
        let run = || {
            let mut wv = world_view();
            wv.spawn(SPAWN_S, 0.0).unwrap();
            for i in 0..500u32 {
                // 時間変化する入力で駆動する。
                let steer = if i > 200 { 0.05 } else { 0.0 };
                wv.step(1, &drive(0.5, 0.0, steer, 2));
            }
            (wv.body_poses(), wv.telemetry())
        };
        let (a_poses, a_tele) = run();
        let (b_poses, b_tele) = run();
        assert_eq!(a_poses, b_poses, "body_poses must be bit-identical");
        assert_eq!(a_tele, b_tele, "telemetry must be bit-identical");
    }

    #[test]
    fn t_ev_a5_step_count_is_capped() {
        let mut wv = world_view();
        wv.spawn(SPAWN_S, 0.0).unwrap();
        wv.step(1000, &drive(0.2, 0.0, 0.0, 1));
        assert_eq!(wv.tick(), MAX_STEPS_PER_CALL as u64);
        wv.step(5, &drive(0.2, 0.0, 0.0, 1));
        assert_eq!(wv.tick(), MAX_STEPS_PER_CALL as u64 + 5);
    }

    #[test]
    fn t_ev_a6_flat_input_layout() {
        let mut wv = world_view();
        wv.spawn(SPAWN_S, 0.0).unwrap();
        // [steer, throttle, brake, clutch, gear, drs]
        let inputs = [0.0, 1.0, 0.0, 0.0, 1.0, 0.0];
        for _ in 0..120 {
            wv.step(1, &inputs);
        }
        let tele = wv.telemetry();
        // telemetry[3] = forward_speed, telemetry[5] = gear
        assert!(tele[3] > 0.0, "throttle=1 should produce forward motion");
        assert_eq!(tele[5], 1.0, "gear should be engaged");
        // 端数の入力要素は無視される（パニックしない）。
        wv.step(1, &[0.0, 0.5, 0.0]);
    }

    #[test]
    fn t_ev_a7_telemetry_layout() {
        let mut wv = world_view();
        wv.spawn(SPAWN_S, 0.0).unwrap();
        for _ in 0..60 {
            wv.step(1, &drive(0.3, 0.0, 0.0, 1));
        }
        let tele = wv.telemetry();
        assert_eq!(tele.len(), 25, "one vehicle => 25 elements");

        let entry = &wv.world().vehicles()[0];
        let s = entry.vehicle.state();
        assert_eq!(tele[0], entry.coord.s);
        assert_eq!(tele[1], entry.coord.t);
        assert_eq!(tele[2], entry.laps_completed as f64);
        assert_eq!(tele[3], s.forward_speed());
        assert_eq!(tele[4], s.engine_rpm);
        assert_eq!(tele[5], s.gear as f64);
        assert_eq!(tele[6], s.last_input.steer);
        assert_eq!(tele[7], s.last_input.throttle);
        assert_eq!(tele[8], s.last_input.brake);
        // 4 輪 × [load, slip_ratio, slip_angle, grip_usage]
        for (k, w) in WheelIndex::ALL.into_iter().enumerate() {
            let ws = &s.wheels[w as usize];
            let b = 9 + k * 4;
            assert_eq!(tele[b], ws.load);
            assert_eq!(tele[b + 1], ws.slip_ratio);
            assert_eq!(tele[b + 2], ws.slip_angle);
            assert_eq!(tele[b + 3], ws.grip_usage);
        }
    }

    #[test]
    fn t_ev_a_standings_delegates_to_world() {
        let mut wv = world_view();
        wv.spawn(SPAWN_S, 0.0).unwrap();
        wv.spawn(SPAWN_S - 20.0, 0.0).unwrap();
        for _ in 0..120 {
            wv.step(
                2,
                &[0.0, 0.6, 0.0, 0.0, 1.0, 0.0, 0.0, 0.2, 0.0, 0.0, 1.0, 0.0],
            );
        }
        // 前方（s が大きい）の車が首位。ワールド距離では並べない。
        let standings = wv.standings();
        assert_eq!(standings.len(), 2);
        assert_eq!(standings[0], 0);
    }
}
