//! 固定タイムステップのシミュレーション本体。
//!
//! - [`World::step`] は **1 物理 tick**（`PHYSICS_DT`）を進める。`WasmWorld::step` と
//!   `core.rs` の T-CORE-01〜09 がこの意味に依存するため、挙動は変えない。
//! - [`World::step_sim_tick`] は **1 Simulation Tick**（`SIM_DT` = 60 Hz）を進める。
//!   Driver フェーズ（AI ごとに `Driver::update` を **1 回**）→ 物理フェーズ
//!   （同じ [`ControlInput`] を [`PHYSICS_TICKS_PER_SIM_TICK`] 物理 tick 保持 =
//!   zero-order hold）。`Driver::update` を物理 tick ごとに呼ぶと実時間あたりの
//!   操舵レートが 4 倍になり T-AI-02 の構造的保証が壊れる（TASK-2-3 契約 Part B）。

use crate::ground::TrackGround;
use crate::racing_line::RacingLine;
use sim_driver::{
    Driver, DriverModel, DriverModelError, DriverObservation, PHYSICS_TICKS_PER_SIM_TICK,
};
use sim_math::{Rng, Vec3};
use sim_track::{detect_lap_crossing, LapCrossing, Track, TrackCoord};
use sim_vehicle::{ControlInput, Vehicle, VehicleParams, VehicleParamsError, PHYSICS_DT};

/// [`detect_lap_crossing`] にテレポートと判定させる、1 tick あたりの
/// **センターライン弧長 `s` の変化量**のしきい値 [m]。
///
/// 比較対象は `s`（センターライン弧長）の差であって世界空間の変位ではない。
/// オフセット `t` にいる車の経路長素片は `dl_path = (1 - κ t) · dl_center` なので、
/// カーブ内側では `ds_center = dl_path / (1 - κ t)` が `MAX_SPEED · dt`
/// （≈ 0.83 m）より大きくなりうる。Aoyama Ring の最悪ケース（コーナー進入の
/// 曲率オーバーシュートで κ ≈ 0.075 /m、コース半幅 t ≈ 8 m）で増幅率は
/// `1 / (1 - 0.075·8) ≈ 2.5`。これに余裕を見て係数 3 とする。
///
/// - 正当な前進跨ぎ（実測 0.1〜1.7 m/tick、理論最悪 ≈ 2.1 m/tick）は確実に通す
/// - リセット / テレポート（スタート位置へ戻す等、数十 m 以上のジャンプ）は
///   [`LapCrossing::Suspect`] にしてラップ加算を抑止する
pub const LAP_MAX_DS: f64 = sim_vehicle::vehicle::MAX_SPEED * PHYSICS_DT * 3.0;

/// 車両の識別子。[`World::vehicles`] / [`World::spawn`] の添字と一致する。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct VehicleId(pub usize);

/// [`World`] が保持する 1 台ぶんの**物理**状態。
///
/// Driver AI はここに入れない（`VehicleEntry` は物理の記録であって AI ではない。
/// また `&self.vehicles` を読みつつ `&mut driver` を取るために借用を分ける必要がある）。
pub struct VehicleEntry {
    /// 車両本体。状態を変えるのは [`Vehicle::step`] だけ。
    pub vehicle: Vehicle,
    /// 現在のトラック局所座標。毎 tick 更新される。
    pub coord: TrackCoord,
    /// 完了ラップ数。
    pub laps_completed: u32,
    /// 直近のラップ跨ぎ判定。
    pub last_crossing: LapCrossing,
}

impl VehicleEntry {
    /// 新しいトラック局所座標を反映し、ラップ跨ぎを処理する。
    ///
    /// [`World::step`] が毎 tick 呼ぶ経路そのもの。テレポート相当の入力を
    /// 与えて [`LapCrossing::Suspect`] の抑止を確認できるよう公開している
    /// （[`World::step`] からは物理的に Suspect を発生させられないため）。
    ///
    /// - 跨ぎ判定は [`detect_lap_crossing`] に一本化する（自前の剰余計算をしない）
    /// - [`LapCrossing::Suspect`] のときはラップを加算しない
    pub fn sync_track_position(
        &mut self,
        track: &Track,
        new_coord: TrackCoord,
        max_ds: f64,
    ) -> LapCrossing {
        let crossing = detect_lap_crossing(track, self.coord.s, new_coord.s, max_ds);
        match crossing {
            LapCrossing::Forward => self.laps_completed += 1,
            // Backward / Suspect / None は laps_completed を動かさない。
            //
            // 対称化しない（Backward で -1 しない）ため、スタート/フィニッシュ線上で
            // 前後に振動する車は 1 往復ごとに +1 される（laps 5 の車が 5 往復で 10 に
            // なる）。一方 u32 での対称カウンタ（Backward で saturating_sub）は 0 で
            // 飽和するため「ライン後方発進 → 逆走 → 前進」で幻の 1 周を生む。
            // どちらも単独では正しくない。周回数の確定は Phase 3 のレース状態機械で
            // 「正規のセクター通過順」と併せて設計する（TASK-1B-2 は Forward のみ +1 で
            // 確定。振動を踏む経路は Driver AI / レース状態機械が未実装のため現状ゼロ）。
            LapCrossing::Backward | LapCrossing::None | LapCrossing::Suspect => {}
        }
        self.last_crossing = crossing;
        self.coord = new_coord;
        crossing
    }
}

/// [`World::spawn`] / [`World::spawn_with_driver`] のエラー。
#[derive(Debug)]
pub enum WorldError {
    /// 車両パラメータの検証に失敗した。
    Params(VehicleParamsError),
    /// スポーン座標が非有限。
    InvalidSpawn {
        /// フィールド名（`start_s` / `start_t`）。
        field: &'static str,
        /// 実際の値。
        value: f64,
    },
    /// [`World::attach_racing_line`] を呼ぶ前に [`World::spawn_with_driver`] を呼んだ。
    NoRacingLine,
    /// [`DriverModel`] の検証に失敗した。
    Driver(DriverModelError),
}

impl core::fmt::Display for WorldError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            WorldError::Params(e) => write!(f, "vehicle params invalid: {e}"),
            WorldError::InvalidSpawn { field, value } => {
                write!(f, "spawn coordinate {field} must be finite (got {value})")
            }
            WorldError::NoRacingLine => {
                write!(
                    f,
                    "attach_racing_line must be called before spawn_with_driver"
                )
            }
            WorldError::Driver(e) => write!(f, "driver model invalid: {e:?}"),
        }
    }
}

impl std::error::Error for WorldError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            WorldError::Params(e) => Some(e),
            WorldError::InvalidSpawn { .. } | WorldError::NoRacingLine | WorldError::Driver(_) => {
                None
            }
        }
    }
}

impl From<VehicleParamsError> for WorldError {
    fn from(e: VehicleParamsError) -> Self {
        WorldError::Params(e)
    }
}

impl From<DriverModelError> for WorldError {
    fn from(e: DriverModelError) -> Self {
        WorldError::Driver(e)
    }
}

/// 固定タイムステップのシミュレーション世界。
///
/// トラックを所有し、複数の車両を [`sim_vehicle::PHYSICS_DT`] で進める。
/// レンダリング / カメラ / UI は知らない。**乱数状態を保持しない**
/// （Driver の乱数系列は呼び出し側が作って [`World::spawn_with_driver`] へ渡す）。
pub struct World {
    track: Track,
    vehicles: Vec<VehicleEntry>,
    /// `vehicles` と**並行**な Driver 列。AI を持たない車は `None`。
    /// 長さは常に `vehicles.len()` と一致する。
    drivers: Vec<Option<Driver>>,
    /// 起動時に 1 回だけ生成して取り付ける走行計画。
    racing_line: Option<RacingLine>,
    /// Driver フェーズが書き、物理フェーズが読む入力バッファ。毎 tick 再確保しない。
    input_buf: Vec<ControlInput>,
    tick: u64,
    sim_tick: u64,
}

impl World {
    /// トラックを渡して空の世界を作る。
    pub fn new(track: Track) -> Self {
        World {
            track,
            vehicles: Vec::new(),
            drivers: Vec::new(),
            racing_line: None,
            input_buf: Vec::new(),
            tick: 0,
            sim_tick: 0,
        }
    }

    /// 参照しているトラック。
    #[inline]
    pub fn track(&self) -> &Track {
        &self.track
    }

    /// 進んだ**物理** tick 数。
    #[inline]
    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// 進んだ **Simulation** tick 数（60 Hz）。
    #[inline]
    pub fn sim_tick(&self) -> u64 {
        self.sim_tick
    }

    /// 全車両の状態。添字が [`VehicleId`] に一致する。
    #[inline]
    pub fn vehicles(&self) -> &[VehicleEntry] {
        &self.vehicles
    }

    /// 走行計画を取り付ける。AI 車をスポーンする前に 1 回呼ぶ。
    ///
    /// 2 回目以降の呼び出しは前の計画を置き換える（スポーン済みの車がいなければ安全）。
    pub fn attach_racing_line(&mut self, line: RacingLine) {
        self.racing_line = Some(line);
    }

    /// 取り付け済みの走行計画（読み出し）。
    #[inline]
    pub fn racing_line(&self) -> Option<&RacingLine> {
        self.racing_line.as_ref()
    }

    /// AI を持つ車の直近の [`Driver`]（読み出しのみ）。
    #[inline]
    pub fn driver(&self, id: VehicleId) -> Option<&Driver> {
        self.drivers.get(id.0).and_then(|d| d.as_ref())
    }

    /// トラック局所座標で車両を配置する（AI なし・静的つり合いの車高）。
    ///
    /// `start_s` は [`Track::wrap_s`] で正規化される。ヨーはセンターラインの
    /// 接線（`+s` 方向）から導く。車両は静止状態で構築される。
    pub fn spawn(
        &mut self,
        params: VehicleParams,
        start_s: f64,
        start_t: f64,
    ) -> Result<VehicleId, WorldError> {
        let (vehicle, coord) = self.build_vehicle(params, start_s, start_t)?;
        Ok(self.push_entry(vehicle, coord, None))
    }

    /// AI 付きで車両を配置する。
    ///
    /// `rng` は「この個体の」Driver 系列（`crate::rng::driver_rng` で用意する）。
    /// [`World::attach_racing_line`] 未実施なら [`WorldError::NoRacingLine`]。
    /// `model` の検証に失敗したら [`WorldError::Driver`]。
    pub fn spawn_with_driver(
        &mut self,
        params: VehicleParams,
        start_s: f64,
        start_t: f64,
        model: DriverModel,
        rng: Rng,
    ) -> Result<VehicleId, WorldError> {
        if self.racing_line.is_none() {
            return Err(WorldError::NoRacingLine);
        }
        // Driver::new は PerformanceEnvelope / Controller に params を要するので先に複製する。
        let driver = Driver::new(model, &params, rng)?;
        let (vehicle, coord) = self.build_vehicle(params, start_s, start_t)?;
        Ok(self.push_entry(vehicle, coord, Some(driver)))
    }

    /// スポーン座標を検証し、静的つり合いの車高で [`Vehicle`] を構築する。
    fn build_vehicle(
        &self,
        params: VehicleParams,
        start_s: f64,
        start_t: f64,
    ) -> Result<(Vehicle, TrackCoord), WorldError> {
        if !start_s.is_finite() {
            return Err(WorldError::InvalidSpawn {
                field: "start_s",
                value: start_s,
            });
        }
        if !start_t.is_finite() {
            return Err(WorldError::InvalidSpawn {
                field: "start_t",
                value: start_t,
            });
        }

        let s = self.track.wrap_s(start_s);
        let frame = self.track.frame_at(s);

        // 重心のワールド座標。路面点（position + lateral*t、banking は lateral.y に内包）
        // から鉛直に cg_height だけ持ち上げる。こう置くと初 step で各輪の縮み量が
        // ちょうど static_compression になり、偽の過渡が出ない（sim-vehicle の
        // wheel_mount_local が静的つり合いを幾何で作り込んでいるため）。
        let surface = frame.position + frame.lateral * start_t;
        let position = surface + Vec3::Y * params.mass.cg_height;

        // ヨーは接線の水平成分から。VehicleState::yaw() と同じ式。
        let yaw = (-frame.tangent.z).atan2(frame.tangent.x);

        let vehicle = Vehicle::new(params, position, yaw)?;
        Ok((vehicle, TrackCoord::new(s, start_t)))
    }

    /// 構築済みの [`Vehicle`] と Driver を並行列へ追加する。
    fn push_entry(
        &mut self,
        vehicle: Vehicle,
        coord: TrackCoord,
        driver: Option<Driver>,
    ) -> VehicleId {
        let id = VehicleId(self.vehicles.len());
        self.vehicles.push(VehicleEntry {
            vehicle,
            coord,
            laps_completed: 0,
            last_crossing: LapCrossing::None,
        });
        self.drivers.push(driver);
        id
    }

    /// 1 物理 tick 進める。`inputs[i]` が [`VehicleId`]`(i)` に対応する。
    ///
    /// `dt` は [`sim_vehicle::PHYSICS_DT`] 固定で、引数に取らない。
    /// `inputs` が車両数より短ければ、足りない分は [`ControlInput::default`]。
    ///
    /// 1 台ぶんの順序は固定（決定性のため変えない）:
    /// ヒント更新 → [`Vehicle::step`] → `world_to_track` で `coord` 更新
    /// → [`detect_lap_crossing`] → ラップ加算。
    pub fn step(&mut self, inputs: &[ControlInput]) {
        // track と vehicles を分離して借りる（TrackGround が &track を持つ間に
        // vehicles を可変で回すため）。
        let World {
            track,
            vehicles,
            tick,
            ..
        } = self;

        let mut ground = TrackGround::new(track);

        for (i, entry) in vehicles.iter_mut().enumerate() {
            let input = inputs.get(i).copied().unwrap_or_default();

            let prev_s = entry.coord.s;
            ground.set_hint(prev_s);
            entry.vehicle.step(&input, &ground, PHYSICS_DT);

            let new_coord = track.world_to_track(entry.vehicle.state().position, Some(prev_s));
            entry.sync_track_position(track, new_coord, LAP_MAX_DS);
        }

        *tick += 1;
    }

    /// **1 Simulation Tick（[`SIM_DT`](sim_driver::SIM_DT) 固定）進める。`dt` を引数に取らない。**
    ///
    /// [`World::step_sim_tick_with`]`(&[])` と厳密に等価。
    pub fn step_sim_tick(&mut self) {
        self.step_sim_tick_with(&[]);
    }

    /// AI を持たない車へ手動入力を与えつつ 1 Simulation Tick 進める。
    ///
    /// `manual[i]` は [`VehicleId`]`(i)` に対応し、**AI 付きの車では無視される**。
    ///
    /// 実行順序（決定性のため固定・変えない）:
    /// 1. Driver フェーズ（60 Hz・[`VehicleId`] 昇順に 1 回ずつ）
    /// 2. 物理フェーズ（240 Hz・[`PHYSICS_TICKS_PER_SIM_TICK`] 回・同じ入力を保持 = zero-order hold）
    /// 3. `sim_tick += 1`
    pub fn step_sim_tick_with(&mut self, manual: &[ControlInput]) {
        // 入力バッファをいったん取り出す（Driver フェーズで &mut drivers と
        // &vehicles / &track を同時に借りるため、self からフィールドを分けて借りる）。
        let mut inputs = std::mem::take(&mut self.input_buf);
        inputs.clear();
        inputs.reserve(self.vehicles.len());

        {
            let World {
                track,
                vehicles,
                drivers,
                racing_line,
                ..
            } = &mut *self;
            let track: &Track = track;

            for (i, driver_slot) in drivers.iter_mut().enumerate() {
                let input = match driver_slot {
                    Some(driver) => {
                        // AI 付きの車が存在するなら racing_line は必ず取り付け済み
                        // （spawn_with_driver が保証する）。防御的に unwrap しない。
                        let line = racing_line
                            .as_ref()
                            .expect("racing line present when a driver exists");
                        let entry = &vehicles[i];
                        let obs = DriverObservation {
                            track,
                            corridor: line.corridor(),
                            trajectory: line.trajectory(),
                            speed_profile: line.speed_profile(),
                            state: entry.vehicle.state(),
                            coord: entry.coord,
                        };
                        driver.update(&obs)
                    }
                    None => manual.get(i).copied().unwrap_or_default(),
                };
                inputs.push(input);
            }
        }

        // 物理フェーズ: 同じ ControlInput を PHYSICS_TICKS_PER_SIM_TICK 物理 tick 保持する。
        for _ in 0..PHYSICS_TICKS_PER_SIM_TICK {
            self.step(&inputs);
        }

        self.sim_tick += 1;
        self.input_buf = inputs;
    }

    /// 順位（先頭が首位）。**`(laps_completed, s)` の辞書順の降順のみ**で決まる。
    /// ワールド距離では並べない。同着はスポーン順を保つ（安定ソート）。
    pub fn standings(&self) -> Vec<VehicleId> {
        let mut ids: Vec<VehicleId> = (0..self.vehicles.len()).map(VehicleId).collect();
        ids.sort_by(|&VehicleId(a), &VehicleId(b)| {
            let ea = &self.vehicles[a];
            let eb = &self.vehicles[b];
            eb.laps_completed.cmp(&ea.laps_completed).then_with(|| {
                eb.coord
                    .s
                    .partial_cmp(&ea.coord.s)
                    .unwrap_or(core::cmp::Ordering::Equal)
            })
        });
        ids
    }
}
