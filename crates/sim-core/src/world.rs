//! 固定タイムステップのシミュレーション本体。

use crate::ground::TrackGround;
use sim_math::Vec3;
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

/// [`World`] が保持する 1 台ぶんの状態。
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

/// [`World::spawn`] のエラー。
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
}

impl core::fmt::Display for WorldError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            WorldError::Params(e) => write!(f, "vehicle params invalid: {e}"),
            WorldError::InvalidSpawn { field, value } => {
                write!(f, "spawn coordinate {field} must be finite (got {value})")
            }
        }
    }
}

impl std::error::Error for WorldError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            WorldError::Params(e) => Some(e),
            WorldError::InvalidSpawn { .. } => None,
        }
    }
}

impl From<VehicleParamsError> for WorldError {
    fn from(e: VehicleParamsError) -> Self {
        WorldError::Params(e)
    }
}

/// 固定タイムステップのシミュレーション世界。
///
/// トラックを所有し、複数の車両を [`sim_vehicle::PHYSICS_DT`] で進める。
/// レンダリング / カメラ / UI は知らない。乱数を持たない。
pub struct World {
    track: Track,
    vehicles: Vec<VehicleEntry>,
    tick: u64,
}

impl World {
    /// トラックを渡して空の世界を作る。
    pub fn new(track: Track) -> Self {
        World {
            track,
            vehicles: Vec::new(),
            tick: 0,
        }
    }

    /// 参照しているトラック。
    #[inline]
    pub fn track(&self) -> &Track {
        &self.track
    }

    /// 進んだ tick 数。
    #[inline]
    pub fn tick(&self) -> u64 {
        self.tick
    }

    /// 全車両の状態。添字が [`VehicleId`] に一致する。
    #[inline]
    pub fn vehicles(&self) -> &[VehicleEntry] {
        &self.vehicles
    }

    /// トラック局所座標で車両を配置する。静的つり合いの車高に置く。
    ///
    /// `start_s` は [`Track::wrap_s`] で正規化される。ヨーはセンターラインの
    /// 接線（`+s` 方向）から導く。車両は静止状態で構築される。
    pub fn spawn(
        &mut self,
        params: VehicleParams,
        start_s: f64,
        start_t: f64,
    ) -> Result<VehicleId, WorldError> {
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
        let id = VehicleId(self.vehicles.len());
        self.vehicles.push(VehicleEntry {
            vehicle,
            coord: TrackCoord::new(s, start_t),
            laps_completed: 0,
            last_crossing: LapCrossing::None,
        });
        Ok(id)
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
