# ARCHITECTURE.md

> **再開するときは先に [`HANDOFF.md`](HANDOFF.md) を読むこと。** 現在地・実装済み API・環境・手順が 1 本にまとまっている。


Status: **設計確定 / 実装未着手**（Phase 0）
Last updated: 2026-09-06

本書は「現在の Architecture」を記述する。実装と乖離した場合は、実装 / Git History / Tests を裏付けにして本書を更新する。

---

## 1. Layering — 最上位の構造

```
+---------------------------------------------------------------+
|  PRESENTATION LAYER            (engine-specific, 差し替え可能)  |
|  Rendering / Camera / CameraDirector / Audio / UI / Replay View |
+---------------------------------------------------------------+
                          | reads only (immutable snapshot)
                          v
+---------------------------------------------------------------+
|  SIMULATION CORE               (Rust, headless, deterministic) |
|  Track / RacingLine / Physics / Controller / DriverAI /        |
|  Perception / Tyre / Weather / RaceControl / Timing / Strategy |
+---------------------------------------------------------------+
```

### Dependency Direction（不可侵）

```
Presentation     ---->   Simulation Core      (許可: 読み取りのみ)
Simulation Core  --X-->  Presentation         (禁止: 参照すら持たない)
```

Simulation Core の crate は Rendering / Camera / UI / Audio の型を**一切 import しない**。
これはコンパイル時に強制される（依存グラフに presentation crate が存在しない）。

Presentation は毎フレーム `WorldSnapshot`（immutable な値のコピー）を受け取り、それを描画する。
Presentation が Simulation の状態を書き換える経路は存在しない。

---

## 2. Crate / Module 構成

```
racing/
  crates/
    sim-math/          ベクトル・スプライン・数値ユーティリティ・決定的 RNG
    sim-track/         Track Geometry / Track Coordinate System / Surface
    sim-line/          Racing Corridor / Trajectory / Speed Profile
    sim-vehicle/       Vehicle Physics / Tyre / Powertrain / Aero / Suspension
    sim-driver/        Perception / Decision / Planner / VehicleController
    sim-race/          RaceControl / Timing / Classification / Strategy / Weather
    sim-core/          World 統合・固定タイムステップ・Snapshot 生成
    sim-ffi/           C-ABI ラッパ（UE5 / Unity 接続用）
    sim-wasm/          wasm-bindgen ラッパ（Engineering View 用）
  view-engineering/    Three.js テレメトリビューア（デバッグ専用・製品レンダラではない）
  assets/tracks/       トラック定義データ (RON/JSON)
  assets/vehicles/     車両セットアップ定義
  tests/               scenario / determinism / regression テスト
  docs/
```

### 依存グラフ（一方向・循環禁止）

```
sim-math  <-  sim-track  <-  sim-line  <-  sim-driver  <-  sim-core
    ^             ^                            ^              ^
    +------  sim-vehicle  ----------------------+              |
                  ^                                            |
              sim-race  ------------------------------------- +

sim-ffi  -> sim-core          sim-wasm -> sim-core
```

**禁止**: `sim-vehicle` が `sim-driver` を知ること（物理はドライバーを知らない）。
**禁止**: `sim-driver` が車両の内部状態を直接書き換えること（`ControlInput` を返すのみ）。

---

## 3. Track Coordinate System

World 座標だけでレースロジックを組んではならない。**すべてのレースロジックはトラック局所座標で行う。**

```rust
/// トラック上の位置。レースロジックの唯一の正。
pub struct TrackCoord {
    pub s: f64,   // センターライン沿いの弧長 [m], 0 <= s < track_length
    pub t: f64,   // 横方向オフセット [m], 左が正 / 右が負
}

/// s における幾何フレーム。事前計算テーブル + 補間で O(1) 取得。
pub struct TrackFrame {
    pub position:    Vec3,        // World
    pub tangent:     Vec3,        // 進行方向
    pub normal:      Vec3,        // 路面法線（バンク・カンバー込み）
    pub lateral:     Vec3,        // 横方向基底
    pub curvature:   f64,         // 1/R [1/m], 符号付き
    pub banking:     f64,         // [rad]
    pub camber:      f64,         // [rad]
    pub elevation:   f64,         // [m]
    pub width_left:  f64,         // センターラインから左端 [m]
    pub width_right: f64,
    pub surface:     SurfaceKind, // Asphalt / Kerb / Grass / Gravel / PitLane
}
```

- センターラインは**弧長パラメータ化された 3 次スプライン**。0.5 m 間隔で事前サンプリングしテーブル化
- `world_to_track()` は空間ハッシュで近傍サンプルを取得 → 局所ニュートン法で s を精緻化
- `track_to_world(s, t)` は解析的

### なぜこれが最重要か

| 従来の失敗モード | 本設計での解決 |
|-----------------|---------------|
| Waypoint index が暴走する | **index を持たない。** 位置は連続量 `s` |
| ラップカウントが誤る | `s` のラップ跨ぎ検出（単調増加 + 1 tick 最大 Δs でガード） |
| 順位ソートが不正 | 順位は `(laps_completed, s)` の辞書順のみで決まる |
| Waypoint へ瞬間旋回する | AI の出力は横方向目標 `t(s)` の連続関数。制御器がステア角に変換 |

---

## 4. Racing Line System — 単一 Waypoint 列の禁止

3 つの概念を厳密に分離する。

```rust
/// 1) 走行可能な回廊。物理的にどこを走ってよいか。
pub struct Corridor {
    // s -> (t_min, t_max)。縁石を使うか否かで 2 種類保持
    inner: Vec<(f64, f64)>,   // 白線内
    outer: Vec<(f64, f64)>,   // 縁石含む track limits
}

/// 2) 走行軌跡。どこを走ろうとするか。
pub struct Trajectory {
    pub kind: TrajectoryKind,  // Reference / Defensive / Overtake(Inside|Outside) / Wet / Recovery / PitIn / PitOut
    lateral: Vec<f64>,         // s -> t, C1 連続
}

/// 3) 速度プロファイル。どれだけの速度で走れるか。
pub struct SpeedProfile {
    v_max: Vec<f64>,           // s -> 限界速度 [m/s]
}
```

### Speed Profile の生成（乱数を使わない物理由来の計算）

1. 各 s で横 G 限界から `v_corner(s) = sqrt(mu_eff(s) * g_eff(s) / |kappa(s)|)`
   - `g_eff` にバンク角とダウンフォース（速度依存 → 数回反復して収束）を含める
2. **後退パス**: ブレーキ減速度限界で上流へ伝播（→ ブレーキングポイントが物理的に決まる）
3. **前進パス**: エンジン出力・トラクション限界で下流へ伝播（→ コーナー脱出加速が決まる）

これにより「ブレーキングポイント」を数値定数としてハードコードしない。

### Trajectory の合成

Driver AI は**単一の線を選ばない**。重み付きブレンドで目標横位置を作る。

```
t_target(s) = clamp(
      w_ref * t_reference(s)
    + w_def * t_defensive(s)
    + w_ovt * t_overtake(s)
    + t_avoidance(s),
    corridor.t_min(s) + margin,
    corridor.t_max(s) - margin )
```

重み `w_*` は Decision 層が**時間的に平滑化して**変化させる（ステップ変化禁止 → ステア不連続の根本防止）。

---

## 5. Vehicle Physics

### 剛体構成
- スプラングマス 1 個（6 DOF: 位置 3 + 姿勢 3）+ アンスプラングマス 4 個（各 上下 1 DOF + 車輪回転 1 DOF）
- 慣性テンソルは箱近似 + 実測寄せの補正係数

### サスペンション（Pitch / Roll / 荷重移動を「創発」させる）

```
per wheel:
  compression = ray/shape cast による路面までの距離から算出
  F_spring    = k * compression                    (progressive rate 対応)
  F_damper    = c_bump / c_rebound * d(compression)/dt
  F_arb       = k_arb * (compression_L - compression_R)
  F_z         = F_spring + F_damper + F_arb        -> タイヤ垂直荷重
```

**Pitch / Roll / 荷重移動を直接計算して代入しない。** サスペンション力の合力として自然に生じさせる。
これにより加速時のスクワット、ブレーキ時のダイブ、コーナーのロール、縁石での跳ねが**すべて同一機構から出る**。

Visual Suspension は物理の `compression` をそのまま使う（別系統で偽装しない）。

### タイヤモデル — 簡略 Pacejka Magic Formula

```
slip ratio  kappa = (omega * r_eff - v_x) / max(|v_x|, v_eps)
slip angle  alpha = atan2(v_y, |v_x|)

Fx0 = D_x * sin(C_x * atan(B_x * kappa_relaxed))
Fy0 = D_y * sin(C_y * atan(B_y * alpha_relaxed))
D_x, D_y は垂直荷重 Fz の非線形関数（load sensitivity）

combined slip: 摩擦円で正規化
  sigma = sqrt((kappa/kappa_peak)^2 + (alpha/alpha_peak)^2)
  Fx = Fx0 * (kappa/kappa_peak) / sigma
  Fy = Fy0 * (alpha/alpha_peak) / sigma
```

**安定性の要（既知の破綻ポイント。実装時に必ず守ること）**

- **Relaxation length**: `kappa` `alpha` を一次遅れでフィルタ（`L_relax ≈ 0.3 m`）。低速での発散を防ぐ
- **低速正則化**: `v_x -> 0` でスリップ比が発散するため `v_eps` でクランプし静止摩擦へブレンド
- **サブステップ**: 物理 240 Hz、タイヤ・車輪回転のみさらに 4 分割（実効 960 Hz）

### パワートレイン

エンジントルクカーブ（rpm → Nm）→ クラッチ → ギア比 → ファイナルドライブ → デフ（LSD トルクバイアス）→ 駆動輪トルク

- レブリミッター、シフト中のトルクカット、オートブリッピング
- ブレーキ: 前後配分。**ロックアップは Pacejka から創発させる**（別途「ロック判定」を書かない）

### 空力

```
F_drag        = 0.5 * rho * v^2 * Cd * A          (進行方向逆向き)
F_down_front / F_down_rear                        (Cl と aero balance から、圧力中心に作用)
```

ダウンフォースを圧力中心に作用させることでピッチにも影響する。
将来拡張: dirty air 係数（前方車との距離・横オフセットから `Cl` 低減 + `Cd` 変化）、スリップストリーム（`Cd` 低減）。

### 統合

半陰的オイラー、固定 dt = 1/240 s。`f64`。fast-math 禁止。

### 拡張予約（インターフェースだけ先に切る）

`fuel_load` `tyre_compound` `tyre_temperature` `tyre_wear` `brake_temperature`
`damage` `aero_damage` `dirty_air` `slipstream` `weather` `track_grip` `water`

---

## 6. Driver AI — 4 層パイプライン

```
  WorldState (真値)
     |  [ Perception ]   遅延バッファ + 認知誤差 + 視野制限
     v
  PerceivedWorld
     |  [ Decision ]     Utility 評価 -> DriverIntent
     v
  DriverIntent { mode, target_gap, engagement, risk_budget }
     |  [ Planner ]      Trajectory ブレンド + 目標速度決定
     v
  Plan { t_target(s), v_target }
     |  [ Controller ]   Pure Pursuit + 縦方向制御
     v
  ControlInput { steer, throttle, brake, gear, clutch, drs }
     |
     v
  Vehicle Physics
```

### Perception

- `reaction_time`（0.15〜0.35 s、ドライバー個体差）分のリングバッファ遅延を通して他車情報を取得
- `spatial_awareness` により死角・後方認知の精度が変わる。**全知にしない**
- 認識対象: track position / boundaries / racing line / corner geometry / own speed / target speed /
  vehicle state / tyre condition / weather / nearby cars / closing speed / relative position /
  available space / flags / pit entry / pit exit

### Decision（Utility ベース + 状態機械のハイブリッド）

モード: `FreeAir` / `Following` / `Attacking` / `Defending` / `SideBySide` / `Avoiding` /
`Recovering` / `PitIn` / `PitOut` / `UnderYellow` / `SafetyCar` / `BlueFlag`

モード遷移には**ヒステリシス**と**最小滞在時間**を必須とする（ちらつき防止）。

### Controller — Waypoint 瞬間旋回を構造的に防ぐ

```
横方向:  Pure Pursuit（先読み距離 = f(speed)）+ 曲率フィードフォワード -> steer_target
         steer は「レート制限」+「一次遅れ」を通す（人間の腕の帯域を模擬）
             d(steer)/dt <= max_steer_rate    （ドライバーの precision に依存）

縦方向:  v_target との誤差 -> throttle / brake
         トレイルブレーキング: コーナー進入で brake を曲率に応じて逓減
         ブレーキング開始点 = SpeedProfile の後退パス + driver.braking_skill による誤差
```

**この 2 つのレート制限が「Steering が不連続に振動しない」の構造的保証**であり、
テストで数値的に検証する（TESTING.md T-AI-02）。

### Driver Model — 能力値の作用先（最高速度を直接変えるのは禁止）

| 能力値 | 作用先 |
|--------|-------|
| `pace` | corridor 内での攻め幅（v_target 係数。ただし物理限界は超えない） |
| `braking_skill` | ブレーキングポイント誤差、ブレーキ変調精度、トレイルブレーキ量、ロックアップ傾向 |
| `cornering_skill` | 目標軌跡追従精度、apex 到達精度、脱出時のトラクション使用率 |
| `racecraft` | Engagement 判断の質、スペース確保の妥当性 |
| `aggression` | risk_budget、仕掛ける閾値、隙間の最小許容幅 |
| `consistency` | ラップ間ばらつき、入力精度ノイズ、ミス発生確率 |
| `overtaking_skill` / `defending_skill` | Engagement 各フェーズの実行精度 |
| `wet_skill` | 低グリップ時の目標速度・スリップ許容量 |
| `tyre_management` | スリップ許容量とタイヤ摩耗のトレードオフ |
| `risk_tolerance` | 接触確率の許容度 |
| `reaction_time` | Perception 遅延 |
| `spatial_awareness` | 認知範囲・認知誤差 |
| `error_rate` | ミス発生の基底確率 |
| `confidence` | 直近の成否で動的に変動し、pace / aggression を変調 |

---

## 7. Overtaking / Defending — 多段 Engagement モデル

追い抜きを `if dist < X { change_lane }` としない。攻防を**共有オブジェクト**としてモデル化する。

```rust
pub struct Engagement {
    pub attacker: CarId,
    pub defender: CarId,
    pub phase: EngagementPhase,
    pub side: Side,               // Inside / Outside
    pub corner: Option<CornerId>,
    pub phase_entered_at: Tick,
}

pub enum EngagementPhase {
    Assess,     // 追いつき中。closing speed / タイヤ差 / 直線長 を評価
    Setup,      // 前コーナー脱出で有利を作る / スリップストリーム位置取り
    Commit,     // ブレーキング勝負を仕掛けると決定（撤回コスト大）
    Alongside,  // 並走。互いにスペースを残す義務が発生
    Resolve,    // 脱出で決着 / 引く / スイッチバック
    Aborted,
}
```

フェーズ遷移の判断入力:
`closing_speed` / `available_space` / `braking_zone_length` / `corner_geometry` /
`inside_outside_line` / `aggression` / `racecraft` / `risk` / `tyre_state` /
`vehicle_performance_delta` / `opponent_behaviour`

Defending も同様に、`opponent_closing_speed` / `track_geometry` / `preferred_line` /
`risk` / `aggression` / `rules (1 move rule)` / `next_corner` から判断する。

**Attacker / Defender は独立に Perception を持つ**（片方の誤認から接触が創発しうる）。

---

## 8. Race System — 責務分離

| Module | 責務 | 持たない責務 |
|--------|------|-------------|
| `RaceControl` | RaceState 遷移、フラッグ、SC、ペナルティ判定、リタイア | 順位計算、タイム計測 |
| `TimingSystem` | Lap / Sector / Gap / Interval / Fastest / PB | 順位の意味付け |
| `Classification` | 順位ソート `(laps, s)`、Gap 表示、フィニッシュ確定 | 計測 |
| `GridSystem` | グリッド配置、スタート手順、ジャンプスタート検出 | — |
| `StrategyAI` | ピットウィンドウ、燃料、タイヤ、アンダーカット判断 | 運転操作 |
| `PitSystem` | ピットイン/アウト経路、ボックス、作業時間、速度制限 | — |

`RaceState`: `Formation -> Grid -> Countdown -> Green -> SafetyCar -> Red -> Chequered -> Finished`

**Driver AI と Strategy AI は分離する。** Strategy は「いつピットに入るか」を決め、
Driver AI は「ピットに入る」という Intent を受けて運転操作に変換する。

---

## 9. Weather System — 単一の状態を全システムが参照

```rust
pub struct WeatherState {
    pub kind: WeatherKind,     // Clear / Cloudy / Rain / HeavyRain / Fog
    pub rain_intensity: f64,   // 0..1
    pub wetness: Vec<f64>,     // s -> 路面水膜量。区間ごとに独立に乾く
    pub puddles: Vec<Puddle>,
    pub air_temp: f64,
    pub track_temp: f64,
    pub wind: Vec2,
    pub visibility: f64,
}
```

この**同一インスタンス**を Rendering / VehiclePhysics / TyreSystem / DriverAI / Strategy / Camera / Audio が読む。
「見た目だけ雨」を構造的に不可能にする。

---

## 10. Presentation Layer

### WorldSnapshot（唯一の境界）

```rust
pub struct WorldSnapshot {
    pub tick: u64,
    pub sim_time: f64,
    pub cars: Vec<CarSnapshot>,  // transform, wheels, suspension compression, slip, rpm, gear, brake temp...
    pub race: RaceSnapshot,      // state, flags, positions, gaps, timing
    pub weather: WeatherState,
    pub events: Vec<SimEvent>,   // Overtake / Contact / Lockup / PitEntry / FastestLap / Retirement ...
}
```

Presentation は毎描画フレーム、最新 Snapshot と 1 つ前の Snapshot を**補間**して描画する
（Sim 60 Hz / Render 60〜144 fps の分離を吸収）。

### Camera System

```
CameraRig (抽象)
 +- TvBroadcastCamera    焦点距離 / 絞り / センサーサイズ / パン追従の慣性
 +- TracksideCamera
 +- LongLensCamera       300-800mm 相当。圧縮効果と浅い被写界深度
 +- PanningCamera
 +- HelicopterCamera / DroneCamera
 +- ChaseCamera / OnboardCamera / CockpitCamera / BumperCamera
 +- PitLaneCamera / ReplayCamera
```

すべて**実カメラパラメータ**（focal length, f-stop, sensor size, focus distance）で駆動する。
FOV 直指定は禁止。パン・チルトは慣性 + わずかな追従遅れを持たせる（人間のカメラマン模擬）。
ゲーム的な過剰演出（急激なズーム、無意味なシェイク、スローモーション多用）は禁止。

### CameraDirector

```
候補ストーリー生成 -> ViewerInterestScore 計算 -> 制約適用 -> ショット選択
```

`ViewerInterestScore` の評価要素:
`close_battle` / `overtake_probability` / `side_by_side` / `incident` / `pit_stop` /
`fastest_sector` / `fastest_lap` / `race_leader` / `strategy_battle` / `weather_change`

制約: `camera_cut_cooldown`（最短 3 s）、`minimum_shot_duration`、`context_continuity`
（同一バトルを追っている間は不必要に切らない）、`leader_bias` は弱く（トップ固定表示の禁止）。

**Director は Simulation を一切変更しない。** 純粋に `WorldSnapshot -> ShotSelection` の関数。

### Replay

`WorldSnapshot` の時系列リングバッファを保持するだけで実現する。
Simulation Core は Replay の存在を知らない。

---

## 11. Time Architecture

| Loop | 周波数 | 内容 |
|------|--------|------|
| Physics Tick | 240 Hz 固定 | 車両物理・タイヤ・サスペンション |
| Simulation Tick | 60 Hz 固定 | Driver AI / Perception / RaceControl / Timing / Strategy |
| Render Frame | 可変（60〜144） | 描画・カメラ・音声。Snapshot 補間 |

Simulation は専用ワーカースレッドで走る。**GPU 負荷が AI 判断・物理安定性・レースタイムに影響しない。**
Render が遅延しても Simulation は固定ステップを維持する（描画側がフレームをスキップする）。

---

## 12. 禁止アンチパターン（レビューで CRITICAL 判定）

1. 巨大な `GameManager` / `RaceManager` / `MainController` への責務集中
2. AI による Transform / Position / Velocity の直接操作
3. Waypoint index を保持する AI（`s` を使うこと）
4. Lap Time / 順位の乱数生成・事前決定
5. Simulation Core からの Rendering / Camera / UI 参照
6. 可変 dt を Simulation Core に流し込むこと
7. グローバル / 時刻依存乱数
8. Trajectory 重みのステップ変化（ステア不連続の原因）
9. 「ロックアップ判定」「アンダーステア判定」などの現象を物理から独立に実装すること
10. Visual Suspension を物理と別系統で偽装すること
