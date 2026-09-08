# HANDOFF.md — 引き継ぎ資料

Last updated: 2026-09-08 / HEAD `3a4ba0a` + 未コミットの TASK-1A-5
**このファイル 1 本で作業を再開できるように書いてある。**
他の文書は「必要になったときだけ」開けばよい（どこに何があるかは §2 に記載）。

---

## 0. 30 秒で把握する

| | |
|---|---|
| **何を作っているか** | Realistic Race Spectator Simulator。プレイヤーは運転せず**観戦**する。「実際のモータースポーツ中継に見え、よく見ると各 AI が本当にレースをしている」ことが目標 |
| **今どこか** | **Phase 1A（Track Foundation）は完了**（1A-1〜1A-5）。Phase 0.5 の TASK-05-2（Blender）も完了。次は Phase 1B |
| **次に何をするか** | **TASK-1B-1（`sim-vehicle` 車両物理）**。物理の全文仕様は `docs/phase-1b-vehicle.md`、タスク契約は `TODO.md` の `# NEXT SONNET TASK` |
| **役割** | Opus 5 = Architect / Reviewer / Quality Gate。Sonnet 5 = Implementation Engineer。重大な技術変更は人間承認が必要 |
| **健全性確認** | `cargo test --release` → **76 passed / 0 failed** |

### 最初にやること

```bash
cd /c/AI/App_Dev/Racing
cargo test --release      # 76 passed が期待値。下回ったら先に原因を特定する
```

これが通れば、リポジトリは既知の健全な状態にある。

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
| TASK-1A-5 | 曲率リップル解消と平滑性テスト | ✅ APPROVED | **未コミット** |
| **TASK-1B-1** | **`sim-vehicle`（車両物理）** | ⬅ **次。仕様済** | — |
| TASK-05-1 | UE5 Code-First 構築 + M1〜M9 実測 | 📄 仕様済 | — |
| Phase 1B | `sim-vehicle` 実装 | 📄 仕様済 | — |

### ファイル構成（全体。これがすべて）

```
PROJECT.md ARCHITECTURE.md PLAN.md TODO.md DECISIONS.md TESTING.md HANDOFF.md
docs/phase-0.5-tasks.md      TASK-05-1(UE5) / TASK-05-2(Blender) の実装仕様
docs/phase-1b-vehicle.md     Phase 1B (sim-vehicle) の実装仕様
crates/sim-math/             Vec2/Vec3, Quat, CubicSpline, ArcLengthSpline, Rng, util
crates/sim-track/            TrackCoord, TrackFrame, Track, SurfaceKind, io(JSON), lap
crates/sim-wasm/             読み出し専用 WASM 境界（TrackView / WasmTrack）
view-engineering/            デバッグ用計測器（Three.js）。製品レンダラではない
assets/tracks/               aoyama_ring.track.json（オリジナル 4 139 m サーキット）
assets/vehicles/             gt_proto_a.spec.json（見た目と物理の共通仕様）
tools/blender/               車両メッシュ生成パイプライン（稼働中）
tools/tracks/                トラックの制御点を詰め直すツール（densify_corners.py）
build/                       生成物。gitignore 済み。コミットしない
```

Rust 約 5 900 行 / Python 約 1 800 行 / JS 約 900 行。

---

## 2. 他の文書に何が書いてあるか（必要なときだけ開く）

| File | 開くべきとき |
|------|------------|
| `TODO.md` | **次のタスクを実装するとき**（NEXT SONNET TASK に全文仕様）／過去のレビュー記録を見たいとき |
| `docs/phase-0.5-tasks.md` | UE5（TASK-05-1）に着手するとき |
| `docs/phase-1b-vehicle.md` | 車両物理（Phase 1B）に着手するとき |
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

> 以下は TASK-1A-4 完了時点のスナップショット。**正はソース**だが、
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

### `sim-wasm`（依存は sim-math + sim-track + wasm-bindgen）

**読み出し専用の境界。ロジックを持たない。書き込み用メソッドは存在しない。**

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

// 境界層（型変換のみ。JS からはこちらが見える）
#[wasm_bindgen] struct WasmTrack
  new(track_json) name length sector_boundaries start_finish_s
  sample_line sample_surface sample_curvature sample_banking
  world_to_track(x,y,z)->Vec<f64>       // [s, t]
```

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
- **`camber` は現在データとして保持のみで、幾何には未適用。** 下流はこれを前提にしないこと
- **`serde_json` の f64 は 1 ULP ずれて往復する**（実測）。
  「保存→再読込でビット一致」と仮定しないこと。アセット JSON が唯一の正であり
  実行時に再生成しないため、決定性契約には影響しない

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

# Rust（期待値: 76 passed / clippy 0 / warnings 0 / fmt clean）
cargo test --release
cargo clippy --all-targets -- -D warnings
cargo build --release
cargo fmt --check

# 依存ゼロの core が壊れていないか（WASM/FFI 向け）
cargo build -p sim-track --no-default-features       # 依存が sim-math のみになる
cargo build -p sim-track --target wasm32-unknown-unknown
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
| Engineering View の表示 | 60.6 fps（**SwiftShader**。実 GPU ではさらに上） | 60 fps |

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

---

## 11. 次にやること

### TASK-1B-1 — `sim-vehicle`（車両物理）

**Phase 1A は完了した。次はここが中核である。**

物理モデルの全文仕様は **`docs/phase-1b-vehicle.md`（430 行）**にある。
タスク契約（Allowed Files / 凍結 / 受け入れ基準 / 報告フォーマット）は
`TODO.md` の `# NEXT SONNET TASK`。**両方読んでから着手すること。**

要点だけ:

- 依存は `sim-math` + `sim-track` のみ。**物理エンジン crate は使わない**（ADR-0005）
- `assets/vehicles/gt_proto_a.spec.json` の物理側フィールドを**初めて読む実装**になる
- 決定性が受け入れ基準に入っている（同一シード・同一入力で**ビット一致**）
- **最大リスクは低速での Pacejka 発散。** 緩和長 0.30 m + 低速ブレンド 2.0 m/s +
  静止摩擦ばね + 車輪のみ 960 Hz サブステップで対処する設計が仕様書にある。
  **ここを自己流にするとグリッドスタートとピットで必ず破綻する**

### まだコミットしていない作業がある

TASK-1A-5 は APPROVED 済みだが**作業ツリーに残っている**。
`assets/tracks/`、`crates/sim-track/tests/io.rs`、`tools/tracks/`、
`TODO.md`、`HANDOFF.md`、`CLAUDE.md` が対象。

### 並行して着手可能

- **TASK-05-1**（UE5 Code-First 構築 + M1〜M9 実測）— `docs/phase-0.5-tasks.md`
  UE 5.8 導入済み。**UE 5.8 の cvar 名は推測で書かず、適用後の値を読み出して検証すること**
- **Phase 1B**（`sim-vehicle`）— `docs/phase-1b-vehicle.md`
  最大リスクは低速での Pacejka 発散。緩和長 0.30 m + 低速ブレンド 2.0 m/s +
  静止摩擦ばね + 車輪のみ 960 Hz サブステップで対処する設計になっている

### Phase の全体像（`PLAN.md` 参照）

```
0 Discovery ✅ / 0.5 UE5 Spike(05-2 ✅) / 1A Track(1A-4 が最後) / 1B Vehicle
2 RacingLine+単独AI / 3 複数台+レース / 4 追走 / 5 追い抜き・防御  ← ここまでが中核
6 タイヤ・戦略 / 7 天候 / 8 放送カメラ / 9 TV Director / 10 映像 / 11 音・リプレイ / 12 最適化
```

**Phase 1〜5 が安定するまで UI / メニュー / 演出 / コンテンツ量産へ工数を使わない。**
まず「車が自然に走る」「複数台が自然に競う」を完成させる。
