# HANDOFF.md — 引き継ぎ資料

Last updated: 2026-09-09 / Phase 1B commit 済み（`b7a7084` / `4968e61` / `908fea3`）+ 未コミットの TASK-2-1（`sim-line`）/ TASK-2-2（`sim-driver`）/ **TASK-2-3（PDC-6 込みで land 済み・Architect 最終監査待ち。cargo test 181 passed）** + TASK-2-4 起票（人間承認待ち）+ 並行して TASK-05-1（UE5 スパイク）スキャフォルド。cargo test **181 passed**
**このファイル 1 本で作業を再開できるように書いてある。**
他の文書は「必要になったときだけ」開けばよい（どこに何があるかは §2 に記載）。

---

## 0. 30 秒で把握する

| | |
|---|---|
| **何を作っているか** | Realistic Race Spectator Simulator。プレイヤーは運転せず**観戦**する。「実際のモータースポーツ中継に見え、よく見ると各 AI が本当にレースをしている」ことが目標 |
| **今どこか** | **Phase 2 実装中・全て未コミット。TASK-2-1 / TASK-2-2 実装完了。TASK-2-3 は PDC-6 込みで land 済み（Architect 最終監査待ち）。** Architect Round-2 裁定 = (a): s≈3150 の lateral weave の根因は Controller ではなく `sim-line::Trajectory::reference` の**未収束基準ライン**（直線区間で κ_traj が ±0.006・波長 70 m）。PDC-6（`planner.rs` の摩擦楕円制動計画）は独立に正しく T3 を解消したので land、残りは **TASK-2-4**（`# NEXT SONNET TASK` に起票・**人間承認待ち**）。PDC-7 は撤回。`world_ai.rs` は診断テスト削除 + T-CORE-AI-04/05/07/08/09/10 追加。cargo test **181 passed** / clippy 0 / fmt clean / no-default-features / wasm32 OK |
| **次に何をするか** | **① Architect（Opus 5）が TASK-2-3 を最終監査 → APPROVED → 人間の go → commit（順序: TASK-2-1 → 2-2 → 2-3。`.gitignore`/`tools/ue_python/`/`ue/`/`docs/phase-0.5-results.md` は TASK-05-1 の別 commit）。② TASK-2-4 は人間承認（`sim-line/src/trajectory.rs` と `sim-driver/tests/**` の凍結解除）が下りてから着手。契約は `TODO.md`「# NEXT SONNET TASK」。③ 並行: TASK-05-1（UE5 スパイク）— `build_scene.py` の `SCENE_STEPS` を 1 つずつ実装 → `import_vehicle.py`/`capture.py`/`measure.py` → M1〜M9 実測** |
| **役割** | Opus 5 = Architect / Reviewer / Quality Gate。Sonnet 5 = Implementation Engineer。重大な技術変更は人間承認が必要 |
| **健全性確認** | `cargo test --release` → **181 passed / 0 failed**（従来 177 − 診断 2 本 + T-CORE-AI-04/05/07/08/09/10）。clippy 0 / fmt clean |

### 最初にやること

```bash
cd /c/AI/App_Dev/Racing
cargo test --release      # 181 passed が期待値。下回ったら先に原因を特定する
```

これが通れば、リポジトリは既知の健全な状態にある。

**TASK-2-3 は land 済み**（Architect 最終監査待ち）。要点 — Architect Round-2 裁定 (a)（2026-09-09）:
PDC-6（`planner.rs` の `plan_brake_decel` = 摩擦楕円 running-min。`MU_LOAD_DERATE=0.877` /
`A_BRAKE_FLOOR=1.0`）で **T3（R63・s≈1470）はクリーン通過**（clean 基準ドライバーで s≈3150 まで逸脱ゼロ）。
残る s≈3150 の lateral weave の根因は **`sim-line::Trajectory::reference` の未収束基準ライン**
（直線区間で κ_traj が ±0.006・波長 70 m）→ **TASK-2-4**（人間承認待ち）。PDC-7 は撤回済み。
`world_ai.rs` は診断テスト削除 + T-CORE-AI-04/05/07/08/09/10 追加（T-CORE-AI-03 / T-AI-01R/05R/07R は
TASK-2-4 へ繰り越し）。詳細は `TODO.md`「TASK-2-3 — 進捗メモ / land 完了報告」。

---

## 1. 現在の到達点

| Task | 内容 | 状態 | Commit |
|------|------|------|--------|
| Phase 0 | Discovery / Architecture / 文書一式 | ✅ | `9c13af8` |
| ADR-0001〜0006 | Rust / UE5 / 自作アセットの決定 | ✅ 人間承認済 | `856d0bd` |
| TASK-1A-1 | `sim-math`（数学基盤・決定的 RNG） | ✅ APPROVED | `85f6c6f` |
| TASK-1A-2 | `sim-track`（トラック局所座標系） | ✅ APPROVED | `4fc4c48` |
| TASK-1A-3 | トラック JSON ロード + Aoyama Ring | ✅ APPROVED | `cf3d7dd` |
| TASK-05-2 | Blender 車両生成パイプライン（**M9 達成**） | ✅ APPROVED | `2ec80c9` |
| Phase 1B 仕様 | `sim-vehicle` 実装仕様 | ✅ 作成済 | `60c1577` |
| TASK-1A-4 | Engineering View（`sim-wasm` + ビューア） | ✅ APPROVED | `3a4ba0a` |
| TASK-1A-5 | 曲率リップル解消と平滑性テスト | ✅ APPROVED | `16ec799` |
| TASK-1B-1 | `sim-vehicle`（車両物理） | ✅ APPROVED | `b7a7084` |
| TASK-1B-2 | `sim-core`（トラック路面 + 固定ステップ World） | ✅ APPROVED（監査 2 ラウンド） | `4968e61` |
| TASK-1B-3 | Engineering View 車両表示（`sim-wasm` に `WasmWorld` + ビューア） | ✅ APPROVED | `908fea3` |
| TASK-2-1 | `sim-line`（Corridor / Trajectory / SpeedProfile） | ✅ Opus 監査 → 修正適用 → 再検証 pass。**人間の commit go 待ち** | **未コミット** |
| TASK-2-2 | `sim-driver`（Perception / Decision / Planner / Controller） | ✅ 実装完了。PDC-1/3/5/6 + 定数再調整を同梱（`sim-driver` は untracked）。**人間の commit go 待ち** | 未コミット |
| TASK-2-3 | `sim-core`+`sim-wasm`+EV 配線 + PDC-6（`planner.rs` 摩擦楕円制動計画）+ `world_ai.rs`（T-CORE-AI-04/05/07/08/09/10） | ✅ **Architect APPROVED**（2026-09-09・監査 3 ラウンド）。T3 通過・181 passed。**人間の commit go 待ち**。K-1（T3 安定余裕ゼロ）は §10 参照 | 未コミット |
| **TASK-2-4** | `sim-line::Trajectory::reference` の収束欠陥修正（per-sweep 更新量 → 曲率残差）+ 実物理ラップ完走 + テスト基盤の実物理移行 | ⬅ **契約起票済み**（`TODO.md`「# NEXT SONNET TASK」）。**凍結解除 A/B/C は人間承認待ち（§10 H-5）。A が下りるまで着手禁止** | — |
| **TASK-1B-4** | `spawn` 姿勢の完全化（D-1 フル版。`sim-vehicle` 凍結解除が前提） | ⬅ 保留。Architect / 人間承認事項 | — |
| TASK-05-1 | UE5 Code-First 構築 + M1〜M9 実測 | 🔶 スキャフォルド + ヘッドレス Python 疎通 + `build_scene.py` step 1〜2（レベル/ライティング/保存）。road 以降は未着手（`docs/phase-0.5-results.md`） | — |

### ファイル構成（全体。これがすべて）

```
PROJECT.md ARCHITECTURE.md PLAN.md TODO.md DECISIONS.md TESTING.md HANDOFF.md
docs/phase-0.5-tasks.md      TASK-05-1(UE5) / TASK-05-2(Blender) の実装仕様
docs/phase-1b-vehicle.md     Phase 1B (sim-vehicle) の実装仕様
crates/sim-math/             Vec2/Vec3, Quat, CubicSpline, ArcLengthSpline, Rng, util
crates/sim-track/            TrackCoord, TrackFrame, Track, SurfaceKind, io(JSON), lap
crates/sim-vehicle/          ControlInput, GroundProbe, VehicleParams, Vehicle（車両物理）
crates/sim-line/             Corridor, Trajectory, SpeedProfile, PerformanceEnvelope（走行計画。乱数なし）
crates/sim-core/             TrackGround（GroundProbe 実装）, World（固定ステップ）, VehicleEntry
crates/sim-wasm/             WASM 境界。TrackView/WasmTrack（読み出し専用）+ WorldView/WasmWorld（World を進める）
view-engineering/            デバッグ用計測器（Three.js）。トラック + 走る車両を表示。製品レンダラではない
assets/tracks/               aoyama_ring.track.json（オリジナル 4 139 m サーキット）
assets/vehicles/             gt_proto_a.spec.json（見た目と物理の共通仕様）
tools/blender/               車両メッシュ生成パイプライン（稼働中）
tools/tracks/                トラックの制御点を詰め直すツール（densify_corners.py）
build/                       生成物。gitignore 済み。コミットしない
```

Rust 約 11 800 行 / Python 約 1 800 行 / JS 約 900 行。

---

## 2. 他の文書に何が書いてあるか（必要なときだけ開く）

| File | 開くべきとき |
|------|------------|
| `TODO.md` | **次のタスクを実装するとき**（NEXT SONNET TASK に全文仕様）／過去のレビュー記録を見たいとき |
| `docs/phase-0.5-tasks.md` | UE5（TASK-05-1）に着手するとき |
| `docs/phase-1b-vehicle.md` | 車両物理を触るとき。**実装後の追記（実装ノート / 制動距離の帯の改定）が末尾にある** |
| `PROJECT.md` | 性能予算・決定性契約の数値を確認したいとき |
| `ARCHITECTURE.md` | 新しい crate を足す／モジュール境界を判断するとき |
| `DECISIONS.md` | 「なぜこの技術なのか」を問われたとき（ADR-0000〜0006） |
| `PLAN.md` | Phase の全体像・Risk Register を見たいとき |
| `TESTING.md` | 受け入れ基準 T-TRK / T-VEH / T-AI / T-RACE の一覧 |
| `assets/tracks/README.md` | トラックデータ形式を扱うとき |
| `tools/blender/README.md` | Blender パイプラインを触るとき |
| `view-engineering/README.md` | Engineering View を起動する／触るとき |

**Documentation Rule**: コードと文書が矛盾したら、どちらかを推測で正としない。
実装 / Git History / Runtime Behaviour / Tests から裏付けを取る。

---

## 3. 絶対に破ってはいけない原則

違反はレビューで **CRITICAL** 判定。

1. **AI が Vehicle の Transform / Position / Velocity を直接書き換えてはならない。**
   AI が出せるのは `steering / throttle / brake / gear / clutch / drs` のみ。
   最終的な挙動は物理システムだけが決める
2. **Lap Time を乱数生成して順位を決めてはならない。** 結果は Tick の積み重ねから創発させる
3. **乱数は「結果」ではなく「原因」に作用させる**
   （reaction / decision / confidence / risk / mistake / precision / consistency）
4. **Simulation Core は Rendering / UI / Camera を知らない。** crate 依存グラフで機械的に強制する
5. **固定タイムステップのみ。** 可変 dt を Simulation Core に入れない
6. **グローバル乱数・時刻依存乱数は禁止。** すべて `Rng` の明示的な派生で
7. **トラック上の位置は Waypoint index ではなく連続量 `s`（弧長 [m]）**
8. **ラップ処理は `wrap_s` / `signed_delta_s` に一本化。** 各所で自前の剰余計算をしない
9. **順位は `(laps_completed, s)` の辞書順のみで決まる。** ワールド距離で並べない
10. 巨大な `GameManager` / `RaceManager` へ責務を集中させない

---

## 4. 座標系と単位の規約（変更禁止）

```
右手系 / +Y が上 / 単位はすべて SI (m, kg, s, N, rad) / 角度はラジアン
車両ローカル: +X 前方, +Y 上, +Z 右
トラック局所: TrackCoord { s: 弧長[m], t: 横オフセット[m] }  ← +t が左
曲率: 左カーブが正
バンク: 正で左端が持ち上がる（左旋回では外側=右を上げるので負にする）
```

**`lateral = up.cross(tangent)`** が左を向く。これは標準的な CCW 左法線とは逆手系なので、
曲率符号の判定は `diff.perp_dot(tangent)`（引数順を逆にすると符号が反転する。実際に踏んだ）。

浮動小数は状態と積算をすべて `f64`。fast-math 最適化は禁止（`Cargo.toml` の release profile で
`codegen-units = 1` / `lto = "thin"` を設定済み。変更するなら ADR を起票すること）。

---

## 5. 実装済み API（ソースを読まずに済むように）

> 以下は TASK-1B-2 完了時点のスナップショット。**正はソース**だが、
> 通常はこれで足りる。詳細な doc comment は各 `.rs` にある。

### `sim-math`（依存ゼロ / unsafe ゼロ / wasm32 ビルド確認済み）

```rust
// vec.rs
struct Vec2 { x, y }   struct Vec3 { x, y, z }
  定数: ZERO, X, Y, Z(Vec3のみ), UP(=Y)
  new splat dot cross(Vec3) perp_dot(Vec2) perp(Vec2)
  length length_squared normalize try_normalize->Option distance distance_squared
  lerp project_onto reject_from angle_between signed_angle_to(Vec2)
  xz()->Vec2  horizontal()->Vec3  to_xz()->Vec3(Vec2)  is_finite
  演算子: + - * / 単項- と各Assign版、f64 * Vec も可

// quat.rs — オイラー順序は YXZ (Ry(yaw)*Rx(pitch)*Rz(roll))
struct Quat { x, y, z, w }
  IDENTITY new from_axis_angle from_euler_yxz to_euler_yxz(ジンバルロックでroll=0に固定)
  conjugate inverse norm norm_squared normalize dot rotate_vec3 to_mat3 slerp is_finite
  演算子: Quat * Quat（合成。(a*b) は b を適用してから a）、Quat * Vec3（= rotate_vec3）

// spline.rs — centripetal Catmull-Rom。真の C1（大域uをノットスパン比例配分）
struct CubicSpline
  new(points, closed)->Result<_, SplineError>   ※4点未満/重複点/非有限でErr
  is_closed segment_count segment_start_u eval derivative second_derivative tangent curvature
struct ArcLengthSpline               // 弧長 s [m] でアクセスする再パラメータ化
  DEFAULT_SAMPLES_PER_SEGMENT=64  HINT_SEARCH_RADIUS_M=5.0
  new with_default_samples total_length is_closed samples_per_segment spline()
  control_point_s(i) control_point_count      // 制御点 -> s の対応
  wrap_s signed_delta_s                        // ★ラップ処理の唯一の正
  u_from_s s_from_u position_at tangent_at curvature_at
  pose_at(s)->(位置,接線)                      // 位置と接線が両方要るときはこれ
  closest_s(p, hint)->f64                      // hint有 420ns / 無 3.8us
                                               // 窓端で全走査へ自動フォールバック（近似ではなく厳密）

// rng.rs — xoshiro256** + SplitMix64。グローバル状態なし
struct Rng
  from_seed(u64)  derive(&self, label)->Rng    // ★親状態を変えない。派生順に依存しない
  next_u64 next_f64 range_f64 range_i64 bool_with_probability
  normal normal_clamped                        // Box-Muller。キャッシュを持たない（意図的）
  state_hash()                                 // 状態を消費しない。決定性テスト用

// util.rs
EPSILON=1e-9 clamp saturate lerp inverse_lerp remap smoothstep smootherstep
move_towards(current,target,max_delta)                   // ★レート制限
approach_exponential(current,target,time_constant,dt)    // ★一次遅れ（フレームレート非依存）
wrap_angle signed_angle_delta is_finite_within
```

`move_towards` と `approach_exponential` は Driver AI の制御出力に必ず通すこと。
**この 2 つが「Steering が不連続に振動しない」の構造的保証**（TESTING.md T-AI-02）。

### `sim-track`（依存は sim-math + optional serde。wasm32 ビルド確認済み）

```rust
struct TrackCoord { s, t }            // t は左が正
struct TrackFrame {                   // ★正規直交基底。Gram-Schmidt 済み
  position tangent normal lateral     // lateral は左向き、normal = tangent.cross(lateral)
  curvature banking camber elevation width_left width_right
}
enum SurfaceKind { Asphalt, Kerb, Grass, Gravel, PitLane }
  .properties() -> SurfaceProperties { grip_multiplier, rolling_resistance, roughness, within_limits }
  既定値: Asphalt 1.00/0.012  Kerb 0.90/0.020  Grass 0.45/0.090  Gravel 0.35/0.250  PitLane 0.95/0.013
  within_limits: Asphalt/Kerb/PitLane = true, Grass/Gravel = false

struct CrossSection { width_left width_right banking camber kerb_left kerb_right runoff }
struct TrackDefinition { name centerline sections closed sector_splits start_finish }
enum TrackError { Spline, SectionCountMismatch, NonPositiveWidth, InvalidSectorSplits, InvalidStartFinish }

struct Track
  FRAME_SPACING_M = 0.5                        // フレームテーブルの間隔
  build(&TrackDefinition)->Result<Track,TrackError>
  name length is_closed
  frame_at(s)->TrackFrame                      // 36ns。テーブル補間+直交化
  track_to_world(TrackCoord)->Vec3
  world_to_track(p, hint)->TrackCoord          // 579ns。hint に前tickの s を渡すこと
  wrap_s signed_delta_s                        // ★ラップ処理はこれを通す
  surface_at(TrackCoord)->SurfaceKind  is_within_limits(TrackCoord)->bool
  sector_of(s)->usize  sector_boundaries()->&[f64]  start_finish_s()

enum LapCrossing { None, Forward, Backward, Suspect }
fn detect_lap_crossing(&Track, prev_s, new_s, max_ds) -> LapCrossing
  // ★1 tick の移動が max_ds を超えたら Suspect。**このときラップを加算してはならない**
  //   ラップカウント暴走を構造的に防ぐ仕掛け

// io.rs（feature "serde"。既定で有効。--no-default-features で依存ゼロになる）
TRACK_SCHEMA_VERSION = 1
enum TrackIoError { Io, Parse, Invalid, UnsupportedVersion }
struct TrackFile { schema_version, description, track }
track_from_json_str / track_from_json_file / load_track / track_to_json_string
  // ★読み込み時に Track::build を実行して検証する。不正データは後段へ流れない
```

### `sim-vehicle`（依存は sim-math + optional serde。**`sim-track` に依存しない**）

路面は [`GroundProbe`] トレイト経由で受け取る。これにより平面上で単体テストできる。
`sim-track` との接続は `sim-core`（TASK-1B-2）が行う。

```rust
// lib.rs
PHYSICS_DT = 1.0/240.0   WHEEL_SUBSTEPS = 4（車輪とタイヤのみ 960 Hz）
GRAVITY = 9.80665        AIR_DENSITY = 1.225

// input.rs
struct ControlInput { steer, throttle, brake, clutch, gear: i8, drs: bool }
  sanitized(gear_count) -> ControlInput   // NaN/inf を安全側へ。brake の非有限は 1.0（全制動）

// ground.rs — ★この crate が路面について知っている唯一のこと
trait GroundProbe { fn probe(&self, from: Vec3, max_distance: f64) -> Option<GroundHit>; }
struct GroundHit { point, normal, grip, rolling_resistance, roughness }  // 物理量のみ。SurfaceKind を渡さない
struct FlatGround { height, grip, rolling_resistance, roughness }
  FlatGround::asphalt(height)             // SurfaceKind::Asphalt の既定値と一致させてある

// params.rs（feature "serde" が既定。--no-default-features で依存ゼロになる）
VEHICLE_SCHEMA_VERSION = 1
struct VehicleParams { name dimensions mass tyre engine drivetrain aero brakes suspension steering }
  from_json_str / from_json_file          // ★読み込み時に validate する。不正データは後段へ流れない
  validate() -> Result<(), VehicleParamsError>
  static_wheel_load(w) spring_rate(w) tyre_radius(w) rest_length() static_compression(w)
  wheel_mount_local(w) -> Vec3            // ★静的つり合いで重心が cg_height に来る高さを逆算する
enum VehicleParamsError { Parse Io UnsupportedVersion NonPositive OutOfRange
                          NotMonotonic Empty SuspensionBottomsOut }

// state.rs — ★フィールドは公開だが書き換えてはならない
enum WheelIndex { FrontLeft=0, FrontRight=1, RearLeft=2, RearRight=3 }
  ALL is_front is_left opposite            // ALL の反復順は固定（決定性）
struct WheelState { compression compression_velocity spin rotation steer_angle load
                    slip_ratio slip_angle grounded force_long force_lat
                    friction_limit grip_usage }
  // friction_limit = mu * load。grip_usage は 1.0 で飽和するので摩擦円の検証にはこちらを使う
struct VehicleState { position orientation velocity angular_velocity wheels[4]
                      engine_rpm gear last_input aero_downforce recovered_steps }
  forward up right yaw pitch roll forward_speed total_load
  // ★pitch は正で機首上げ、roll は正で右側が沈む。基底ベクトルから導いている（下記の罠を参照）
  // ★recovered_steps は保険であって、増えること自体が不具合

// vehicle.rs
struct Vehicle
  new(params, position, yaw)                        // position は重心
  new_with_velocity(params, position, yaw, velocity) // 初期条件の指定。ローリングスタート用
  step(&input, &dyn GroundProbe, dt)                 // ★状態を変える唯一の経路。dt は PHYSICS_DT 固定
  state() params() wheel_mount_local(w) suspension_rest_length()
  wheel_world_transform(w) -> (Vec3, Quat)           // ★Visual Suspension はこれを使う
COMPRESSION_VELOCITY_TIME_CONSTANT = 0.005  DAMPER_FORCE_LIMIT_RATIO = 8.0
MAX_SPEED = 200.0  MAX_ANGULAR_SPEED = 50.0          // 破綻検知のしきい値

// tyre.rs
LOW_SPEED_BLEND = 2.0     // スリップの分母の下限。低速ブレンドの上端も兼ねる
RELAXATION_MIN_SPEED = 1.0
```

**`step()` 以外に `&mut self` を取る公開メソッドは存在しない。** この構造を壊さないこと。

### `sim-core`（依存は sim-math + sim-track + sim-vehicle。dev-dep なし）

**車（`sim-vehicle`）とトラック（`sim-track`）を繋ぐ層。** 乱数を持たない。
Rendering / UI / Camera を知らない。可変 dt を受け取らない。

```rust
// ground.rs — sim-track を使う GroundProbe 実装
struct TrackGround<'a>
  new(&'a Track)  track()  hint()->Option<f64>
  set_hint(s)                                 // ★world_to_track の探索ヒント。毎 tick 更新する
impl GroundProbe for TrackGround
  // probe: GroundProbe の「鉛直下方へ探索」契約を守る。
  //   接地点 = 鉛直線 (from.x, *, from.z) と s の路面平面（点 position・法線 normal）の交点。
  //   drop = ((from - P)·n) / n.y。n.y.abs() < 1e-6 で None。
  //   勾配で world_to_track の投影先 s がずれるため、接地高さ付近まで下ろした点で
  //   再投影する反復（上限 4 回）で補正する。センターライン近傍 2 反復で 1e-9 未満、
  //   高曲率+大 |t| は上限到達・残差 1e-8 m オーダー（物理的に無害）。
  //   ★垂線投影ではない（バンクで h·sin²θ ぶん drop が縮み、ばね荷重が約 +38% になる）
  //   normal は TrackFrame の normal をそのまま（Gram-Schmidt 済み・自前で作り直さない）。
  //   grip/rolling_resistance/roughness は surface_at(coord).properties() から詰める
  //   （sim-vehicle に SurfaceKind を渡さない）。max_distance 超で None。

// world.rs — 固定タイムステップのシミュレーション本体
struct VehicleId(pub usize)                    // vehicles() / spawn の添字
struct VehicleEntry { vehicle, coord: TrackCoord, laps_completed: u32, last_crossing: LapCrossing }
  sync_track_position(&mut self, &Track, new_coord, max_ds) -> LapCrossing
    // ★World::step が毎 tick 呼ぶ経路。テスト用に pub（World からは Suspect を作れない）
enum WorldError { Params(VehicleParamsError), InvalidSpawn { field, value } }
const LAP_MAX_DS = sim_vehicle::vehicle::MAX_SPEED * PHYSICS_DT * 3.0   // ≈ 2.5 m
  // ★比較対象はセンターライン弧長 ds であって世界変位ではない。
  //   ds = dl_path / (1 - κt) でカーブ内側は MAX_SPEED·dt を超える。係数 3 は
  //   Aoyama Ring 最悪の曲率増幅 ≈2.5×（κ≈0.075, t≈8 m）にマージン。オンコース前提。

struct World
  new(Track)  track()  tick()->u64  vehicles()->&[VehicleEntry]
  spawn(VehicleParams, start_s, start_t) -> Result<VehicleId, WorldError>
    // start_s は wrap_s で正規化。ヨーはセンターラインの接線から。静止状態で構築。
    // ★車高は静的つり合い（グリッドの S/F ストレートでは誤差 5.5e-5 m。
    //   縦勾配区間では最大 38 mm ずれる。姿勢はヨーのみ = TASK-1B-3 で拡張予定）
  step(&mut self, inputs: &[ControlInput])
    // ★dt は PHYSICS_DT 固定・引数に取らない。inputs[i] が VehicleId(i)。
    //   足りない分は ControlInput::default()。
    //   1 台の順序（決定性のため固定）:
    //   ヒント更新 → Vehicle::step → world_to_track で coord 更新
    //   → detect_lap_crossing → Forward のみ laps +1（Suspect / Backward は加算しない）
  standings() -> Vec<VehicleId>
    // ★(laps_completed, s) の辞書順の降順のみ。ワールド距離で並べない。同着はスポーン順
```

**周回数について**: `Backward` では減算しない（Forward のみ +1）。ライン上で振動する車は
1 往復ごとに +1 されうる（対称カウンタは逆に「後方発進 → 逆走 → 前進」で幻の +1）。
**どちらも単独では正しくない。周回数の確定は Phase 3 のレース状態機械で
セクター通過順と併せて設計する**（TODO.md D-3）。

`&mut self` を取る公開メソッドは `World::{spawn, step}` と `VehicleEntry::sync_track_position` のみ。
車両状態を変えるのは `Vehicle::step` だけ（`sim-core` は AI 出力を素通しするだけ）。

### `sim-line`（依存は sim-math + sim-track + sim-vehicle。**乱数・時刻・グローバル状態なし**）

**走行計画の静的な正**。`Track` と `VehicleParams` だけから決定的に導出される。
`sim-core` / `sim-driver` / Rendering を知らない。位置は連続量 `s` でアクセスし
**Waypoint index を公開しない**（`ARCHITECTURE.md` §4）。`--no-default-features` で
依存が sim-math のみになる（`serde` feature が既定 on で JSON ローダを有効化）。

```rust
// corridor.rs — 走行可能域。+t が左。組は (t_right, t_left) で t_right <= t_left
struct Corridor
  from_track(&Track, step_m, car_half_width, safety) -> Corridor
    // white: TrackFrame::width_* から車半幅ぶん内側。負幅はセンターライン 1 点に潰す
    // limits: Track::is_within_limits の境界を二分探索（縁石を含む track limits）
  length is_closed
  white_bounds(s)->(f64,f64)  limit_bounds(s)->(f64,f64)   // 線形補間
  clamp_white(s,t)->f64  clamp_limits(s,t)->f64
  // ★Planner の最終クランプはこれ。防御=white / 基準・追い抜き=limits

// speed.rs
struct PerformanceEnvelope { mass_kg mu cd_a cl_a_total max_brake_decel max_power_w v_max }
  from_params(&VehicleParams) -> PerformanceEnvelope   // sim-vehicle 依存はここだけ
struct SpeedProfile
  generate(&Trajectory, &Track, &PerformanceEnvelope, step_m) -> SpeedProfile
    // 1) コーナー速度 v=sqrt(a_lat/κ_traj)。ダウンフォース反復。
    //    バンク有利/不利: bank_assist = -g·sin(bank)·sign(κ_traj)  ★二重補正しない
    // 2) 後退パス（ブレーキ減速度限界を上流へ・2 周）
    // 3) 前進パス（トラクション/パワー限界を下流へ・2 周）
  v_at(s)->f64   // ★T-AI-04 の v_max_physical。Driver の v_target はこれでクランプ
  length is_closed min_v max_v

// trajectory.rs
enum TrajectoryKind { Reference Defensive OvertakeInside OvertakeOutside Wet Recovery PitIn PitOut }
struct Trajectory
  reference(&Corridor, &Track, step_m) -> Trajectory
    // limits 内で経路の曲率二乗和を最小化（Gauss-Seidel-Newton + SOR ω=1.95、
    // 収束 2 mm、その後 3-tap 平滑化 10 パス）。★合成は Planner の仕事（範囲外）
    // 起動時 1 回 96 ms。アクセサは 12 ns
  kind length is_closed
  t_at(s)->f64          // 一様 Catmull-Rom（C1）。★Waypoint index は出さない
  curvature_at(s)->f64  // 解析式のキャッシュ（offset-curve curvature。Menger と独立）
  world_at(s,&Track)->Vec3
```

**Phase 2 で必ず守る**: Speed Profile もフィードフォワードも **Trajectory の曲率**
（`curvature_at`）を使う。センターラインの曲率は継ぎ目にオーバーシュートが残る
（TASK-1A-5 LOW-1）。`reference` の生成は起動時 1 回で、`World` へは生成済みの
`Trajectory` / `SpeedProfile` を渡す（TASK-2-3）。

### `sim-wasm`（依存は sim-math + sim-track + sim-core + sim-vehicle + wasm-bindgen）

**ロジックを持たない型変換だけの境界。** トラック幾何（`WasmTrack`）は読み出し専用。
`WasmWorld` は `sim-core` の `World` を保持して進めるが、**外部が渡せるのは
`ControlInput` 相当の数値列だけ**で、Transform を書く公開メソッドは存在しない。

```rust
// 純 Rust 層（wasm_bindgen 非依存。テストはこちらに書く）
struct TrackView
  from_json(&str)->Result<TrackView, TrackIoError>
  track()->&Track
  stations(step_m)->Vec<f64>            // ★サンプリングの唯一の正
  sample_line(ratio, step_m)->Vec<f64>  // 平坦な [x,y,z,...]
  sample_surface(step_m)->Vec<f64>      // 左端/右端を交互に並べたストリップ
  sample_curvature / sample_banking(step_m)->Vec<f64>
  world_to_track(Vec3)->TrackCoord

struct WorldView                        // TASK-1B-3。sim-core::World を保持
  from_json(track_json, vehicle_spec_json)->Result<WorldView, WorldViewError>
  spawn(start_s, start_t)->Result<usize, WorldViewError>   // 添字を返す
  step(steps: u32, inputs: &[f64])      // 入力は 1 台 6 要素 [steer,throttle,brake,clutch,gear,drs]
                                        // steps は MAX_STEPS_PER_CALL=32 でクランプ。dt=PHYSICS_DT 固定
  tick() vehicle_count() track_length() standings()->Vec<usize>
  body_poses()->Vec<f64>               // 7/台 [px,py,pz, qx,qy,qz,qw]（重心姿勢）
  wheel_poses()->Vec<f64>              // 28/台 = 4輪×7。FL,FR,RL,RR。wheel_world_transform そのまま
  telemetry()->Vec<f64>               // 25/台: s,t,laps,fwd_speed,rpm,gear,in_steer,in_throttle,
                                       //   in_brake, then 4×[load,slip_ratio,slip_angle,grip_usage]
  world()->&World                      // 検証用の読み出しアクセサ
  MAX_STEPS_PER_CALL=32  INPUT_STRIDE=6

// 境界層（型変換のみ。JS からはこちらが見える）
#[wasm_bindgen] struct WasmTrack
  new(track_json) name length sector_boundaries start_finish_s
  sample_line sample_surface sample_curvature sample_banking
  world_to_track(x,y,z)->Vec<f64>       // [s, t]

#[wasm_bindgen] struct WasmWorld
  new(track_json, vehicle_spec_json) spawn(s,t) step(steps, Float64Array)
  tick()->f64 vehicle_count() track_length()
  body_poses() wheel_poses() telemetry() standings()
```

ネイティブ参照ラン: `cargo run -p sim-wasm --release --example reference_run -- <s> <steps> <throttle> <gear>`
（ブラウザ WASM の結果と突き合わせる。位置はビット一致した）。

**ステーションの規約**（全 `sample_*` が共有する）:
`n = ceil(L / step_m)`、`s_i = i * L / n`（`i = 0..=n`）。ステーション数は `n + 1`、
実際の間隔 `L / n` は `step_m` 以下。最後の `s_n = L` は `frame_at` の `wrap_s` により
`s_0 = 0` と厳密一致するので、閉じたトラックの継ぎ目が正確に閉じる。
`sample_curvature[i]` は `sample_line[i]` / `sample_surface[2i], [2i+1]` に対応する。

`step_m` が非有限・非正、またはステーション数が 200 000 を超えると **空配列**を返す
（`profile.release` の `panic = "abort"` により WASM では panic が回復不能なため）。

`ratio` は `-1.0` = 右端 / `0.0` = センター / `+1.0` = 左端
（幅が `s` によって変わるため、絶対値ではなく比で指定する）。

**手書き `unsafe` は 0 行。** `wasm_bindgen` の展開だけを `mod bindings` に
`#[allow(unsafe_code)]` で閉じ込め、crate 全体は `#![deny(unsafe_code)]` を維持している。
**この構造を壊さないこと。**

### `view-engineering/`（デバッグ用計測器。**製品レンダラではない** = ADR-0003）

素の ES module + import map のみ。**ビルドツールを導入してはならない。**
装飾（影・反射・ポストエフェクト・スカイボックス・マテリアルの作り込み）は禁止。
路面は `MeshBasicMaterial` + 頂点カラー。ライティングを使わないのは意図的で、
**表示された色 = データの値** を保つため（陰影が乗ると色を値として読めなくなる）。

起動は `view-engineering/README.md`。要点だけ:

```bash
cd view-engineering && npm install && cd ..
wasm-pack build crates/sim-wasm --target web --out-dir ../../view-engineering/pkg --release
python -m http.server 8080          # ★リポジトリルートで起動する
# http://localhost:8080/view-engineering/
```

着色モード `1`=曲率 / `2`=バンク / `3`=標高。レイヤ切替 `q w e r t y g`。
ホバーで `s / t / 曲率 / 半径 / バンク / 幅 / 標高 / セクター` を数値表示。

`window.__engview` に `{ scene, camera, controls, data, track, setMode,
setLayerVisible, focusAt(s, dist, height) }` を公開している。
**自動検証とスクリーンショット取得のためのもの**で、読み出しと視点操作のみ。

### `assets/`

- `tracks/aoyama_ring.track.json` — オリジナル 4 139 m。制御点 337。
  高速コーナー 4（130/150/185/140 m）、中速 5、ヘアピン 1（**19.2 m**・150 度）、
  S 字 1、高低差 23.5 m、バンク 0.100 rad、幅 12〜16 m、3 セクター。
  **全要件は `crates/sim-track/tests/io.rs` が実測で検証している**
- `vehicles/gt_proto_a.spec.json` — **見た目（Blender）と物理（Phase 1B）の共通の正**。
  dimensions / mass / tyre / engine / drivetrain / aero / brakes / suspension / visual を含む。
  物理側フィールドはまだ誰も読んでいないが、形式を後から変えないため先に定義してある

### `tools/blender/`（稼働中）

```bash
python tools/blender/generate.py --spec assets/vehicles/gt_proto_a.spec.json
python tools/blender/tests/test_pipeline.py     # 10 tests, 約 11 s
```
2.7 s で 71 178 三角形の GLB を生成。24 オブジェクト、マテリアルスロット 7。

---

## 6. 実行環境（実測済み。推測しないこと）

| 項目 | 値 |
|------|-----|
| GPU | **NVIDIA RTX 4060 Ti 8 GB** ← 最大のハード制約。全ての映像設計がこれに従う |
| CPU / RAM | AMD Ryzen 7 5700X (8C/16T) / 32 GB |
| OS / Shell | Windows 11 / PowerShell 5.1 + Git Bash |
| Rust | 1.95.0（`rust-toolchain.toml` で stable 固定） |
| WASM | `wasm32-unknown-unknown` / `wasm-pack` **0.15.0 導入済み**。`sim-math` `sim-track` `sim-wasm` ともビルド確認済み |
| Unreal Engine | **5.8** — `C:\Program Files\Epic Games\UE_5.8` |
| UE ヘッドレス | `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe` |
| Blender | **5.2.1 LTS**（Microsoft Store / MSIX 版） |
| Node.js | v24.15.0。`three` 0.180.0 を `view-engineering/node_modules` にローカル導入済み |
| Chrome | 152。`C:\Program Files\Google\Chrome\Application\chrome.exe`。headless + CDP でビューアを自動検証できる（下記） |

### Blender の起動方法（厳守）

```
%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe ^
    --background --factory-startup --python <script.py> -- <args...>
```

- **実行体を直接叩かない。** `C:\Program Files\WindowsApps\...\Blender\blender.exe` は
  存在するが ACL により **Access Denied** になる
- **stdout / stderr は転送されない（0 バイト）。** `print()` は届かない
  → スクリプトは **JSON サマリファイル**で報告し、呼び出し側は
  **終了コードとサマリの両方**で判定する。終了コード 0 でもサマリが無ければ失敗
- **glTF の軸変換**: `glTF.X = Blender.X` / `glTF.Y = Blender.Z` / `glTF.Z = -Blender.Y`。
  実座標 `(x_fwd, y_up, z_right)` を置くには Blender へ `(x_fwd, -z_right, y_up)` で渡す。
  **推測せず、エクスポートした GLB を読み直して確認すること**（左右反転を実際に踏んだ）

---

## 7. 作業の進め方

```
Opus が実装仕様を書く（TODO.md の NEXT SONNET TASK）
  ↓
Sonnet が実装する（commit はしない。作業ツリーに残す）
  ↓
Opus が監査する（git diff / コード読解 / テスト再実行 / 独立検証）
  ↓
APPROVED なら Opus が commit / CHANGES REQUIRED なら差し戻し
  ↓
TODO.md にレビュー記録を書き、次タスクの仕様を書く
```

### Sonnet へ渡す仕様に必ず含めるもの

`Goal` / `Allowed Files` / `Do Not Change` / `Dependencies` / `Required Changes` /
`Required Tests` / `Acceptance Criteria` / `Performance Criteria` / `Out of Scope` /
`Known Risks` / `完了時の報告フォーマット`
に加えて **IMPORTANT IMPLEMENTATION CONTRACT** の全文
（設計変更禁止 / `PROPOSED DESIGN CHANGE` / `BLOCKED BY ARCHITECTURE` / リファクタリング禁止）。

`TODO.md` の TASK-1A-4 セクションがそのままテンプレートとして使える。

### 監査で必ず確認すること

1. `git diff --stat` で**スコープ外のファイルが変更されていないか**
2. 凍結 crate の差分が空か
3. テスト / clippy / fmt / warnings を**自分で再実行**する（報告を鵜呑みにしない）
4. **新しいテストが実質的か**（修正前なら落ちるか）を確認する
5. **報告された「根本原因」が正しいか。疑わしければ自分で計測する**
   （実際に 2 回、報告された根本原因が誤っていた）
6. 実装者が書いた検証器を信用しきらない。**可能なら独立に検証器を書く**
   （TASK-05-2 では独立 GLB リーダーを書いて確認した）

Severity は `CRITICAL / HIGH / MEDIUM / LOW`。
**CRITICAL または HIGH が残っている Phase を Complete にしてはならない。**

---

## 8. 再導出すると高くつく知見

### 設計上の要点

- **`TrackFrame` は正規直交基底。** `tangent`/`lateral`/`normal` を個別に lerp して個別に
  正規化すると、バンク変化や 3D ねじれで直交性が崩れる（実測 `|N·T| = 1.8e-5`）。
  Gram-Schmidt で直交化し `normal = tangent.cross(lateral)` で導出すること。
  downstream（タイヤ力の縦横分解）がこれを前提にする
- **制御点の密度を急変させない。** 円弧 10 m / 直線 18 m のように density が跳ぶと、
  Catmull-Rom の接線推定が跳ね、継ぎ目に曲率オーバーシュートが出る
  （実測: 半径 130 m のコーナー出口に R=101 m の 1 サンプルスパイク）。
  直線側を継ぎ目 10 m・中央 18 m へ滑らかに変化させて解消した。
  **Phase 2 の Speed Profile は曲率から限界速度を出すため、偽スパイクは偽の減速になる**
- **コーナー半径を「最小値」で測らない。** 継ぎ目のスパイクを拾う。**中央値**を使う
- **中央値は半径の測定には正しいが、滑らかさの測定にはならない。**（TASK-1A-4 で発見 / 1A-5 で解消）
  ヘアピン本体に制御点間隔とほぼ同じ**周期 10.5 m・振幅 ±13% の曲率リップル**があった。
  中央値 20.6 m は設計値と一致してしまうため、既存テストは全て通っていた。
  centripetal Catmull-Rom は円弧を厳密に再現せず、逸脱は **`(chord / R)^2` に比例**する。
  **制御点間隔は絶対値ではなく `chord / R` で決めること**（規約は `chord/R <= 0.25`）。
  4.51 m へ詰めてリップルは ±2.7% になった。設計円は円フィットで完全に復元できた
  （残差 0.5 mm、半径は 130/150/62/58/52/185/19/45/140 の切りのいい値）
- **平滑性は専用のテストで測る。** `crates/sim-track/tests/io.rs` の
  `aoyama_curvature_has_no_ripple` / `aoyama_curvature_rate_is_bounded` /
  `aoyama_no_isolated_curvature_spikes` の 3 本。
  **コーナー本体（区間の両端 12 m を除いた部分）に限定して測る。**
  進入・脱出では曲率が 0 から立ち上がるのが正常であり、リップルと混同してはならない
  （監査中に実際に一度誤検出した）
- **弧と直線の継ぎ目には曲率のオーバーシュートが残っている（全コーナー共通・設計どおり）。**
  このトラックは緩和曲線を持たない。実測で `median_R / min_R` は全 9 コーナーで
  1.41〜1.51 と一様。**Phase 2 の Speed Profile はセンターラインではなく
  レーシングラインの曲率から計算すること**。センターラインの継ぎ目を引き継ぐ設計に
  するなら、先に緩和曲線を入れる必要がある
- **曲率の検証には独立検証器を使う。** `curvature_at` の値を `curvature_at` で
  検証しても意味がない。サンプル点 3 点の外接円から求める **Menger 曲率**なら
  スプライン実装に一切依存せず裏取りできる（TASK-1A-4 で実際に使い、
  リップルが実在することと、尖ったピークが極めて局所的であることを確認した）
- **緩和ソルバの収束は「位置許容」ではなく「曲率許容」で判定する。**
  波長 λ の位置残差 ε は曲率残差を **`Δκ ≈ ε·(2π/λ)²` 倍**に増幅する。`sim-line` の
  `Trajectory::reference`（曲率二乗和最小化の 4 階緩和）は「1 スイープの最大更新量 < 2 mm」で
  打ち切っていたが、4 階作用素の長波長モードは最も遅く収束するため、per-sweep delta は
  真の収束のはるか手前で閾値を割る。結果、センターラインが完全な直線の区間で基準ラインが
  波長 70 m・振幅 ±1.1 m で蛇行し、κ_traj が ±0.006（R≈165 m）まで残留した。下流
  （SpeedProfile / Pure Pursuit / 横 G 要求）が読むのは位置ではなく **κ** なので、
  収束判定は勾配ノルムベース + 曲率許容（`|Δκ| ≤ 1e-4 [1/m]`）にすること（TASK-2-4）。
  トラックアセット（TASK-1A-5）に続いて `sim-line` で同じ罠を踏んだ
- **`camber` は現在データとして保持のみで、幾何には未適用。** 下流はこれを前提にしないこと
- **`serde_json` の f64 は 1 ULP ずれて往復する**（実測）。
  「保存→再読込でビット一致」と仮定しないこと。アセット JSON が唯一の正であり
  実行時に再生成しないため、決定性契約には影響しない

### 車両物理（TASK-1B-1 で判明したこと）

- **緩和長は「タイヤの過渡特性」であると同時に「陽解法を安定させる仕掛け」でもある。**
  車輪回転を陽解法で解くと、低速（`v = 2 m/s`）では `dFx/dspin ≈ 13 700 N/(rad/s)` となり
  1 サブステップの利得が 2.9 に達して**発散する**。これを止めているのが緩和長で、
  緩和の時定数 `L_relax / max(|v|, 1) = 0.15 s` はサブステップ `1/960 s` よりはるかに長いため、
  実効利得が `2.9 × 0.0069 = 0.02` に落ちる。
  **`relaxation_length` を小さくすると低速で破綻する。触ったら必ず T-VEH-06 を回すこと**
- **`Quat::to_euler_yxz` の "pitch" は `+X` まわりであり、車両ローカル（`+X` 前方）では
  ロールに相当する。** そのまま使うとピッチとロールが入れ替わる。
  `VehicleState::{pitch, roll}` は基底ベクトルから導いてあるので**そちらを使うこと**
- **静的つり合いは幾何で作り込める。** 車輪取り付け点の高さを
  `tyre_radius + rest_length - static_compression - cg_height` と置くと、
  静止状態で重心がちょうど `cg_height` に来る。T-VEH-01 / 02 が誤差 0.00000% で通るのは
  偶然ではなくこの設計による。**初 step で差分速度に偽のスパイクが出ないよう
  `initialized` フラグで初回の `compression_velocity` を 0 にしている**
- **摩擦円は等方なので `mu0` は縦と横のグリップを同時に動かす。**
  「100-0 で 30〜40 m」と「R=50 m で 1.4 G 以上」は同時に満たせなかった。
  掃引の実測と採用理由は `docs/phase-1b-vehicle.md`。**帯を 25〜40 m へ改定した**
- **車両の能力を測るときは、入力を全開固定にしない。** ブレーキ全開では 4 輪ロックで 43 m、
  スロットル全開では 1 速でホイールスピンして 8 s になる。
  受け入れテストはペダル掃引とスリップ制御で測っている（`tests/common/mod.rs`）。
  **これはテストハーネスであって Driver AI ではない**
- **惰行減速を照合するときは車輪の回転慣性を等価質量として足すこと。**
  `I / r^2 = factor * m_unsprung`（半径によらない）で 1 輪 14.7 kg、4 輪で 58.8 kg。
  忘れると実測が 5% ずれて見える（実際にそう見えた。**モデルではなく検証式の誤りだった**）
- **仕様の式に上限が無いところは実装時に必ず頭打ちを入れる。**
  静止摩擦ばね（減衰項が無いと停車中に自励振動）と LSD ロックトルク
  （差回転に比例したまま発散）で実際に必要になった
- **限界を超えると素直にスピンする。** ステア掃引で `-0.110` まで安定、`-0.115` で破綻。
  限界付近の前後スリップ角がほぼ等しい（中立）ため、Driver AI 側に修正操舵が要る

### トラック路面と World（TASK-1B-2 で判明したこと）

- **`GroundProbe` は「鉛直下方へ探索」する契約。** 接地点を `world_to_track` の
  垂線投影で作ると、`from`（路面から鉛直に持ち上げた点）の投影先が路面法線方向に
  ずれ、鉛直落差が `h·sin²(bank)` ぶん縮む。バンク 0.1 rad で 6.45 mm、
  `static_compression`（16.5〜18 mm）比で**ばね荷重が約 +38%**。バンクコーナーだけ
  不自然に速くなる。**鉛直線と s の路面平面の交点**（`drop = ((from-P)·n)/n.y`）で解く。
  監査は旧/新実装を外部に再実装して 56,000 点で掃引し、10.95 mm → 3.83e-8 m を確認した
- **勾配があると `world_to_track` の投影先 s が接地点の s からずれる**（接線に直交する
  平面へ落とすため、鉛直に持ち上げた点は別 station に落ちる）。**接地高さ付近まで
  下ろした点で `world_to_track` を引き直す反復**（上限 4 回）で二次以下に落ちる。
  センターライン近傍は 2 反復で 1e-9 未満、高曲率+大 |t| は上限到達・残差 1e-8 m
  オーダー（38 nm 相当・物理的に無害）
- **`set_hint` は性能だけでなく正しさに効く。** hint を半周ぶん外すと、標高差のある
  区間で 16 m 上の別デッキを掴み grip も 1.00→0.35 になる。`World::step` は毎 tick
  `prev_s` を渡すので安全だが、単発構築する側（Engineering View 等）は注意
- **`LAP_MAX_DS` はセンターライン弧長 `ds` のしきい値であって世界変位ではない。**
  オフセット `t` の車の弧長変化は `ds = dl_path/(1-κt)` で、カーブ内側では
  `MAX_SPEED·dt`（≈0.83 m）を超える。Aoyama Ring 最悪 ≈2.5×（κ≈0.075, t≈8 m）。
  係数 3（≈2.5 m）でマージン。**オンコース前提**——コース外へ数百 m 飛ぶと ds/tick が
  6.9 m に達し `Suspect` になる（track limits が入る Phase 2 までは無視してよい）
- **周回数は Forward のみ +1。** `Backward` で減算する対称カウンタは u32 が 0 で
  飽和するため「ライン後方発進 → 逆走 → 前進」で幻の +1 を生む。Forward-only は
  逆に「ライン上で振動する車が 1 往復ごとに +1」。**どちらも単独では不正**で、
  周回数の確定は Phase 3 のレース状態機械でセクター通過順と併せて設計する
- **`spawn` の姿勢はヨーのみ。** 縦勾配区間（最大 4.2%）で 1 step 後の compression が
  最大 38 mm ずれる（減衰する過渡）。グリッドを並べる S/F ストレートでは 5.5e-5 m で
  無害だが、TASK-1B-3 で `TrackFrame` 由来のピッチ/ロール込みへ拡張する

### 性能基準の考え方

**性能基準は予算から導出すること。恣意的な数値を置かない。**
例: `closest_s` を当初 200 ns としたが根拠が無く、実測 420 ns。
実際の呼び出しは 24 台 × 60 Hz = 1440 call/s で予算比 2% だったため「< 1 µs」へ改めた。

逆に、**仕様に明記された受け入れ数値を実装者が勝手に緩めるのは設計変更**であり、
`PROPOSED DESIGN CHANGE` として事前に起票させること（実際に発生した）。

### 環境上の落とし穴

- **Bash の heredoc がこの環境では長文・特殊文字で失敗することがある**
  （`unexpected EOF while looking for matching quote`）。
  長いファイルは **Write ツール**で書くか、scratchpad にファイルを作って `cat >>` で連結する
- **PowerShell 5.1 には `if` 式がない。** `$x = if (...) {...}` はパースエラー。
  `&&` `||` も使えない。`;` と `if ($?) { }` を使う
- `git` の `LF will be replaced by CRLF` 警告は無害。無視してよい
- 一時ファイルは scratchpad ディレクトリへ置く（プロジェクトを汚さない）

---

## 9. 検証コマンド一覧

```bash
cd /c/AI/App_Dev/Racing

# Rust（期待値: 143 passed / clippy 0 / warnings 0 / fmt clean）
cargo test --release
cargo clippy --all-targets -- -D warnings
cargo build --release
cargo fmt --check

# 依存ゼロの core が壊れていないか（WASM/FFI 向け）
cargo build -p sim-track   --no-default-features     # 依存が sim-math のみになる
cargo build -p sim-vehicle --no-default-features     # 同上
cargo build -p sim-core    --no-default-features     # 同上（sim-math + sim-track + sim-vehicle）
cargo build -p sim-track --target wasm32-unknown-unknown
cargo build -p sim-vehicle --target wasm32-unknown-unknown
cargo build -p sim-core --target wasm32-unknown-unknown
cargo build -p sim-wasm  --target wasm32-unknown-unknown --release

# Engineering View（詳細は view-engineering/README.md）
wasm-pack build crates/sim-wasm --target web --out-dir ../../view-engineering/pkg --release
python -m http.server 8080                           # ★リポジトリルートで起動
# http://localhost:8080/view-engineering/

# トラックの制御点を詰め直す（chord/R <= 0.25 を満たすまで）
PYTHONIOENCODING=utf-8 python tools/tracks/densify_corners.py \
    --track assets/tracks/aoyama_ring.track.json [--dry-run]

# Blender パイプライン
python tools/blender/generate.py --spec assets/vehicles/gt_proto_a.spec.json
python tools/blender/tests/test_pipeline.py          # 10 tests

# 凍結ファイルの確認（レビュー時）
git diff --stat crates/sim-math
git status --short
```

### 実測されている性能値

| 項目 | 実測 | 予算 |
|------|------|------|
| `Rng::next_f64` | 0.91 ns | < 5 ns |
| `ArcLengthSpline::closest_s`（hint 有） | 420 ns | < 1 µs |
| `Track::frame_at` | 36 ns | < 100 ns |
| `Track::world_to_track`（hint 有） | 579 ns | < 1 µs |
| `Track::build`（5 km） | 4.0 ms | < 100 ms |
| フレームテーブル（5 km） | 1.21 MB | < 2 MB |
| `load_track`（4 km） | 7.0 ms | < 50 ms |
| 車両 GLB 生成 | 2.7 s / 71 178 tri | 60k〜150k tri |
| `WasmTrack::sample_surface(1.0)`（4 km） | 0.3 ms | < 50 ms |
| `Vehicle::step`（1 台 1 tick・平面上） | 1.5 µs | < 8 µs |
| 24 台 × 4 tick / render frame（平面上） | 0.144 ms | <= 2.0 ms |
| `World::step`（24 台 1 tick・実トラック上、`TrackGround` 込み） | 167 µs | <= 2.0 ms |
| Engineering View の表示 | 60.6 fps（**SwiftShader**。実 GPU ではさらに上） | 60 fps |

`World::step` の 167 µs は `TrackGround::probe` の再投影反復（`world_to_track` を
probe あたり 1→2 回）ぶんを含む。反投影なし（垂線投影）の旧案は 101 µs だったが
バンクでばね荷重が約 +38% 狂うため採らない。

### Engineering View をヘッドレスで自動検証する

`window.__engview` を CDP から叩けば、スクリーンショットとブラウザ内の
数値検証を人手なしで行える（TASK-1A-4 の受け入れ確認はこれで実施した）。

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --no-sandbox \
  --disable-gpu --enable-unsafe-swiftshader --remote-debugging-port=9222 about:blank &
# node から ws://localhost:9222 へ接続し、Runtime.evaluate と Page.captureScreenshot
```

`--enable-unsafe-swiftshader` が無いと WebGL が起動せず、真っ黒な画像が撮れる。

---

## 10. 決定事項（ADR の要約。詳細は `DECISIONS.md`）

| ADR | 決定 | 一行理由 |
|-----|------|---------|
| 0000 | 本プロジェクトは Greenfield | 監査時点でリポジトリは完全に空だった |
| 0001/0005 | **Simulation Core は Rust** | メモリ安全性がコンパイル時に保証され、AI 実装+全件レビュー体制でバグ面積が実質縮小する。WASM/C-ABI 両対応で UE5・Unity・Web いずれにも書き直しなしで接続できる |
| 0002 | Godot / Web 3D を主レンダラ候補から除外 | Photorealism 要件（Q3）を満たせない |
| 0003 | Engineering View を恒久的なデバッグ基盤とする | テレメトリ可視化なしでは AI 挙動を検収できない。**製品レンダラではない。装飾禁止** |
| 0004 | **製品レンダラは Unreal Engine 5**（Code-First 運用制約 6 項目つき） | 映像の最高到達点。ただし Blueprint 禁止・エディタ GUI を正としない・レンダラ設定は ini・トラックは手続き的生成・視覚検証は自動スクショ・UE C++ は薄く保つ |
| 0006 | **アセットは購入せず自作**（Blender headless + Python） | 実車の工学数値を `spec.json` に落とし、見た目と物理を同じ根から導出する。100% テキストから再生成可能。IP リスクなし |

**人間承認が必要な変更**（Opus 単独で実行してはならない）:
Game Engine 変更 / 言語変更 / 主要フレームワーク置換 / 物理アーキテクチャ置換 /
リポジトリ全体の書き換え / プロジェクト目標の変更。

### 未解決の人間判断

| # | 内容 | 期限 |
|---|------|------|
| H-4 | Phase 0.5 の M1〜M9 実測結果に基づく UE5 続行判定 | **Phase 3 完了時**。不合格なら Unity 6 HDRP へ退避（Simulation Core は無傷） |
| H-5 | TASK-2-4 の凍結解除承認（A: `sim-line/src/trajectory.rs`、B: `sim-driver/tests/**`、C: `PerformanceEnvelope` 荷重感度）| **TASK-2-4 着手前**。A が下りるまで着手禁止 |

### 既知の問題 / リスク

| # | Severity | 内容 |
|---|----------|------|
| **K-1** | **HIGH** | **T3（s≈1543）の閉ループ安定余裕は実質ゼロ。** `T-CORE-AI-10` が緑（`CONTAIN_TOL_M = 0.0`）なのは `level 0.6 / consistency 1.0` の **1 点のみ**。`consistency 0.5`（操舵ノイズ σ≈1%）でも、能力値 0.6 → 0.5（3 seed とも s=1543 で決定論的）でも breach する。**安全側の変更（`braking_skill`↓ = 早めのブレーキ、`pace`↓ = 低い `v_target`）で悪化する非単調挙動。** `CONTAIN_TOL_M = 0.0` の緑を堅牢性の証拠として読まないこと。Architect 監査 2026-09-09 が軸別実測で確認。根治は **TASK-2-4**（未収束基準ライン + lateral inner loop の実タイヤ検証。受け入れは T-CORE-AI-11 モデルスイープ） |
| K-2 | HIGH | `sim-line::Trajectory::reference` の収束判定が per-sweep 更新量ベースで、4 階緩和の長波長モードが未収束のまま返る（直線区間で κ_traj ±0.006・波長 70 m）。s≈3150 の lateral weave の根因。TASK-2-4 Phase 1 で対応 |
| K-3 | MEDIUM | 周回数は Forward-only カウンタ（`Backward` で減算しない）。ライン上で振動する車が 1 往復ごとに +1 されうる。確定は Phase 3 のレース状態機械でセクター通過順と併せて（D-3）|
| K-4 | LOW | Engineering View の Driver HUD パネルが左の凡例と少し重なる（`overlay.js`）。機能は読める。CSS 微調整は任意 |

---

## 11. 次にやること

### ① TASK-2-1（`sim-line`）を commit する（人間の go 待ち）

Opus 監査完了 = **CHANGES REQUIRED（test/docs のみ・`src/` ロジック不変）**。
Sonnet が R1〜R5・R7 を適用し Dev 7〜10 を記録・契約文言を訂正・再検証 pass。
Opus 裁定「その条件を満たせば再監査不要・commit 可」を満たした。

- 監査の全文と適用結果: `TODO.md`「TASK-2-1 — Opus 5 Quality Gate 裁定（2026-09-09）」
- 完了報告: `TODO.md`「TASK-2-1 — 完了報告」（Deviations 7〜10 を追記済み）
- 再検証: `cargo test --release` **154 passed** / clippy 0 / fmt clean / release 警告 0 /
  `--no-default-features` / wasm32 / T-LINE-10 ビット一致。スコープは
  `Cargo.toml`(1行) / `Cargo.lock` / `TODO.md` / `HANDOFF.md` + 新規 `crates/sim-line/` のみ。
- `sim-line/src` の diff は**コメント 2 行のみ**（`LIMIT_BISECTION_ITERS` / `DF_ITERS` の doc）。
  ロジック・公開 API・設計は不変。

**commit メッセージ案**: `feat(sim-line): corridor, reference trajectory, physics-derived speed profile`
（`Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`）。

**申し送り（R8・LOW・Phase 2 で対応）**: Speed Profile は標高勾配の along-track 重力成分
（Aoyama 最大 4.15% ≈ 0.407 m/s²、制動 ~15 m/s² の約 2.7%）を無視している。下り braking zone が
わずかに楽観的。**TASK-2-2（`sim-driver`）で Driver の縦方向モデルと二重補正しないこと。**

### ② TASK-2-2（`sim-driver`）— **契約起票済み。次は Sonnet が実装する**

契約全文は `TODO.md` の `# NEXT SONNET TASK` 直下
「TASK-2-2 — `sim-driver`: Driver AI 4 層パイプライン（単独走行）」。
Sonnet へ渡すときは **IMPORTANT IMPLEMENTATION CONTRACT を含めて全文**を渡すこと。

`ARCHITECTURE.md` §6 の 4 層パイプライン（Perception / Decision(FreeAir のみ) /
Planner / Controller）+ Driver Model。`sim-line` の `Trajectory` / `SpeedProfile` /
`Corridor` を入力に取る。契約に織り込んだ申し送り:
- Speed Profile もフィードフォワードも **`trajectory.curvature_at`** を使う（§5 sim-line）
- 制御出力は必ず `move_towards` / `approach_exponential` に通す（T-AI-02。§5 sim-math）
- `v_target` は `SpeedProfile::v_at(s)` でクランプ（T-AI-04）
- Planner の最終クランプは `Corridor::clamp_*`
- 限界付近で車は素直にスピンする（前後スリップ角が中立）。修正操舵が要る（1B-1 C-1）
- バンク有利/不利は Speed Profile に織り込み済み。Driver 側で二重補正しない
- **標高勾配の along-track 重力（~0.4 m/s²）は Speed Profile が未考慮**（R8）。
  下り braking zone がわずかに楽観的。Driver の縦方向モデルで二重補正しないこと
- 暫定 `spawn` はヨーのみ。グリッドは S/F ストレートに置く（D-1）

### ③ TASK-2-3 — 配線 + PDC-6（✅ land 済み・Architect 最終監査待ち）

`World` が車ごとに `sim-driver` を回して `ControlInput` → `Vehicle::step`。構造配線
（`RacingLine` / `driver_rng` / `spawn_with_driver` / `step_sim_tick` / zero-order hold /
`sim-wasm` 追加 API / Engineering View の racing-line・aim・Driver HUD）+ **PDC-6**（`planner.rs` の
`plan_brake_decel` = 摩擦楕円 `√(a_tyre²−a_lat²)` の先読み running-min。`MU_LOAD_DERATE=0.877` /
`A_BRAKE_FLOOR=1.0`）で **T3（R63・s≈1470）クリーン通過**、clean 基準ドライバーで s≈3150 まで逸脱ゼロ。

- **Architect Round-2 裁定 (a)**: s≈3150 の lateral weave の根因は Controller ではなく
  `sim-line::Trajectory::reference` の**未収束基準ライン**（直線区間で κ_traj が ±0.006・波長 70 m・
  30〜40 m ごとに符号反転。Architect が独立サンプルで確認）。(b′) の曲率平滑化 / ゲイン速度
  スケジュール / lookahead 延長はいずれも欠陥の隠蔽なので却下。→ **TASK-2-4** へ。
- PDC-7 は撤回済み（`t_ai_01` を壊す + weave に無関係）。
- `world_ai.rs`: `smoke_trace` / `probe_track_profile` + env フック削除。
  **T-CORE-AI-04 / 05 / 07 / 08 / 09** と、`s < S_VALIDATED_M(=3100)` 限定の **T-CORE-AI-10**（`CONTAIN_TOL_M=0.0`）を追加。
  **T-CORE-AI-03 / T-AI-01R/05R/07R は TASK-2-4 へ繰り越し**。
- `cargo test --release` **181 passed** / clippy 0 / fmt clean / no-default-features / wasm32 OK。
- **詳細は `TODO.md`「TASK-2-3 — 進捗メモ / land 完了報告」**（PDC-1〜6 履歴・定数表・
  Deviations・s≈3150 の細粒度トレース・commit 順）。

### TASK-2-4 — 基準走行ラインの収束欠陥修正 + 実物理ラップ完走（⚠ 人間承認待ち）

契約全文は `TODO.md`「# NEXT SONNET TASK」（Architect Round-2 起票）。3 フェーズ:
① `sim-line/src/trajectory.rs` の収束判定を per-sweep 更新量 → **曲率残差**（`|Δκ| ≤ 1e-4`）へ。
② Phase 1 後に実物理再計測（リップル除去だけで完走の可能性大）。必要なら lateral ループの速度スケジュール。
③ `sim-driver/tests` の運動学プラント廃止 → 実物理閉ループへ移行。
**着手前に人間承認が必要**: A=`sim-line/src/trajectory.rs` 凍結解除、B=`sim-driver/tests/**` 凍結解除、
C=`PerformanceEnvelope` 荷重感度対応。A の承認まで着手禁止。

### TASK-1B-4 — `spawn` 姿勢の完全化（D-1 フル版・保留）

1B-3 では `spawn` はヨーのみのまま（グリッドを S/F ストレートに置いて無害範囲で運用）。
フル版は `Vehicle::new` が完全な `orientation`（Quat）を受け取る API 追加が必要で、
**`sim-vehicle`（凍結）の公開 API 変更 = Architect / 人間承認事項**。
受け入れ「全周 400 station で 1 step 後 `|compression − static_compression| < 1e-6 m`」。
Phase 2 でバンクコーナーの単独走行を詰める前にやるのが望ましい。

### 並行して着手可能

- **TASK-05-1**（UE5 Code-First 構築 + M1〜M9 実測）— `docs/phase-0.5-tasks.md`。
  **スキャフォルド着手済み**（2026-09-09）: `ue/RaceSpectator.uproject`（content-only・
  `GLTFImporter` は UE 5.8 に無いので不使用）/ `ue/Config/*.ini`（レンダラ設定 intent ベース・
  全キーに `; VERIFY[Mxx]`）/ `tools/ue_python/{ue_env.py, build_scene.py, README.md}` /
  `docs/phase-0.5-results.md`。**ヘッドレス Python パイプライン疎通確認済み**
  （`UnrealEditor-Cmd -run=pythonscript` で editor 起動 → `unreal` import → summary 契約 OK・
  UE 5.8.2・11.6 s）。踏んだ罠 2 件は `ue_env.py` の docstring と results.md に記録:
  ① `-script=` の値は `\t` `\u` を unescape する → **全パスを forward slash で渡す**、
  ② `-script="<path> <args>"` の args は argv に届かない → **env 変数（`UE_SPIKE_SUMMARY` /
  `UE_SPIKE_ARGS`）で渡す**。次は `build_scene.py` の `SCENE_STEPS` を 1 つずつ実装。
  **UE 5.8 の cvar 名は推測で書かず、適用後の値を読み出して検証すること**

### Phase の全体像（`PLAN.md` 参照）

```
0 Discovery ✅ / 0.5 UE5 Spike(05-2 ✅) / 1A Track ✅ / 1B Vehicle ✅ / 次 Phase 2
2 RacingLine+単独AI（2-1 sim-line 🔍監査待ち / 2-2 sim-driver / 2-3 配線）
3 複数台+レース / 4 追走 / 5 追い抜き・防御  ← ここまでが中核
6 タイヤ・戦略 / 7 天候 / 8 放送カメラ / 9 TV Director / 10 映像 / 11 音・リプレイ / 12 最適化
```

**Phase 1〜5 が安定するまで UI / メニュー / 演出 / コンテンツ量産へ工数を使わない。**
まず「車が自然に走る」「複数台が自然に競う」を完成させる。
