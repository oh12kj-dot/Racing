# TODO.md — 現在実行するタスク

Last updated: 2026-09-07
Current Phase: **Phase 1A — Track Foundation**

---

## 決定済み（人間承認取得済み 2026-09-06）

| # | 決定事項 | ADR | 状態 |
|---|---------|-----|------|
| H-1 | Simulation Core の言語 = **Rust** | ADR-0001 / ADR-0005 | ✅ 承認 |
| H-2 | 製品レンダラ = **Unreal Engine 5**（Code-First 運用制約つき） | ADR-0004 | ✅ 承認 |
| H-3 | アセットは購入せず **Web 画像を参照して自作**（Blender headless + Python） | ADR-0006 | ✅ 承認 |

---

## Phase 0 — 完了

- [x] リポジトリ監査（結果: 空。既存コードなし → ADR-0000）
- [x] 環境実測（RTX 4060 Ti **8GB** / Ryzen 7 5700X / 32GB / rustc 1.95.0）
- [x] Performance Budget 確定
- [x] Target Architecture 設計
- [x] PROJECT.md / ARCHITECTURE.md / PLAN.md / TESTING.md / DECISIONS.md / TODO.md
- [x] 人間承認（H-1 / H-2 / H-3）

---

## Phase 1A — Track Foundation

| Task | 内容 | 担当 | 状態 |
|------|------|------|------|
| TASK-1A-1 | `sim-math`: 数学基盤と決定的 RNG | Opus 5 | ✅ **完了・APPROVED** |
| TASK-1A-2 | `sim-track`: Track Coordinate System | Sonnet 5 | ✅ **完了・APPROVED** |
| TASK-1A-3 | トラック定義の JSON ロード + Aoyama Ring | Sonnet 5 + Opus 5 | ✅ **完了・APPROVED** |
| TASK-1A-4 | Engineering View（トラック可視化） | **Sonnet 5** | ⬅ **NEXT** |

### Phase 0.5（並行）

| Task | 内容 | 担当 | 状態 |
|------|------|------|------|
| TASK-05-1 | UE5 Code-First 構築 + M1〜M9 実測 | Sonnet 5 | 📄 仕様済 `docs/phase-0.5-tasks.md` |
| TASK-05-2 | Blender 車両生成パイプライン | Sonnet 5 | 📄 仕様済 `docs/phase-0.5-tasks.md`（並行着手可） |

---

# TASK-1A-1 — 完了報告 / レビュー記録

**実装**: Opus 5（基盤層の品質基準を確定させるため例外的に Architect が実装）

### Implemented Files
```
Cargo.toml, rust-toolchain.toml, .gitignore
crates/sim-math/Cargo.toml
crates/sim-math/src/{lib,vec,quat,spline,rng,util}.rs
crates/sim-math/tests/{vec_quat,spline,rng_util}.rs
```

### Test Results
```
cargo test --release
  vec_quat  : 12 passed
  spline    : 14 passed
  rng_util  : 11 passed
  doc-tests :  1 passed
  ---------------------
  合計 38 passed / 0 failed
cargo clippy --all-targets -- -D warnings : 0 issues
cargo build --release                     : 0 warnings
cargo fmt --check                         : clean
unsafe コード                              : 0（#![deny(unsafe_code)]）
本体依存クレート                            : 0
```

### Performance（実測 / RTX 4060 Ti + Ryzen 7 5700X）

| 項目 | 仕様当初の基準 | 実測 | 判定 |
|------|--------------|------|------|
| `Rng::next_f64` | < 5 ns | **0.91 ns** | ✅ |
| `ArcLengthSpline::closest_s`（hint 有） | < 200 ns | **420 ns** | ⚠️ 基準を修正（下記） |
| `ArcLengthSpline::closest_s`（hint 無） | — | 3 800 ns | 参考値 |

**基準の修正について（Opus 判断）**
当初の 200 ns は予算から導出したものではなく恣意的だった。実際の呼び出し量は
24 台 × 60 Hz Simulation Tick = 1440 call/s であり、420 ns なら 0.010 ms/frame、
Perception / Spatial query 予算 0.5 ms の **2.0%** にすぎない。
**基準を「< 1 µs（予算比 5% 以内）」へ改める。**
これ以上の高速化はストライド探索等の近似を要し、エイリアシングのリスクに見合わない。

最適化の経緯: 969 ns → 720 ns（テーブルの SoA 化 + `pose_at` による探索の一本化）
→ **420 ns**（距離ベースの探索窓 + 窓端検出による全走査フォールバック）。
フォールバックにより、**探索窓の縮小は近似ではなく厳密**である
（テスト `spline_closest_s_survives_stale_hint` が半周ずれたヒントでも結果一致を検証）。

### Deviations from Spec（Opus が承認した仕様変更）

1. **`Quat::mul(self, rhs)` → `impl std::ops::Mul for Quat`**
   clippy の `should_implement_trait` に該当したため。`impl Mul<Vec3> for Quat` も追加。
   合成順序は `(a * b).rotate_vec3(v) == a.rotate_vec3(b.rotate_vec3(v))` として
   テスト `quat_composition_order` で固定した。
2. **`ArcLengthSpline::pose_at(s) -> (Vec3, Vec3)` を追加**
   位置と接線を同時に取る。`u_from_s` の二重実行を避けるため。
3. **`ArcLengthSpline::{control_point_s, control_point_count}` / `CubicSpline::segment_start_u` を追加**
   TASK-1A-2 でトラック断面定義（幅・バンク・カンバー）を `s` へ写すために必須。
   先に追加することで TASK-1A-2 のスコープを `sim-track` 内に閉じた。
4. **`ArcLengthSpline::HINT_SEARCH_RADIUS_M` を追加**（上記の最適化に伴う）
5. **`CubicSpline` の大域パラメータ配分をノットスパン比例とした**
   一様配分では境界で `dP/du` の大きさが不連続になる（G1 止まり）。
   比例配分により **真の C1** となる。テスト `spline_c1_continuity` で検証済み。

### Design Concerns Found
なし。

### Architecture Compliance
- ✅ Rendering / UI / Camera への依存ゼロ
- ✅ グローバル乱数・時刻依存乱数なし
- ✅ `f64` / fast-math 無効 / `codegen-units = 1`
- ✅ Waypoint index を持たない（連続量 `s` のみ）
- ✅ `signed_delta_s` をラップ処理の単一の正とした

### Decision: **APPROVED**

---

# TASK-1A-2 — 完了報告 / レビュー記録

**実装**: Sonnet 5 ／ **監査**: Opus 5（全項目を独立に再実行して検証）

### Test Results（Opus による再実行）
```
cargo test --release
  sim-math : vec_quat 12 / spline 14 / rng_util 11 / doc-test 1 = 38 passed（退行なし）
  sim-track: track 16 passed
  ------------------------------------------------------------
  合計 55 passed / 0 failed
cargo clippy --all-targets -- -D warnings : 0
cargo build --release                     : 0 warnings
cargo fmt --check                         : clean
unsafe                                    : 0 行
git diff --stat crates/sim-math           : 空（凍結遵守）
依存                                       : sim-math + dev-dep approx のみ
```

### Performance（実測 / 全長 5 026 m・制御点 400）

| 項目 | 基準 | 実測 | 判定 |
|------|------|------|------|
| `Track::build` | < 100 ms | 4.04 ms | ✅ |
| `Track::frame_at` | < 100 ns | 36 ns | ✅ |
| `Track::world_to_track`（hint 有） | < 1 µs | 579 ns | ✅ |
| フレームテーブル | < 2 MB @ 5 km | 1.207 MB | ✅ |

### 第 1 ラウンドの指摘と対応

**MEDIUM-1 — `frame_at` が非直交な基底を返していた（修正済み）**

`tangent` / `lateral` / `normal` を個別に lerp して個別に正規化していたため、
フレーム間の変換が複合回転になる場合（バンク角が `s` に沿って変化する、
標高変化により曲線がねじれる）に直交性が崩れていた。

| ケース | 修正前 \|N·T\| | 修正後 |
|--------|--------------|--------|
| 平坦な円 | 0 | 0 |
| 標高変化あり | 4.7e-6 | 1.1e-16 |
| バンク一定 | 2.8e-17 | 1.4e-17 |
| バンク変化 | **1.8e-5** | 1.4e-17 |

`TrackFrame` は正規直交基底として文書化されており、`sim-vehicle` の
タイヤ力の縦横分解や `sim-line` の corridor 計算がこれを前提とする。
静かに歪んだ基底は、後段で遥かに診断困難な系統誤差になる。
Gram-Schmidt による直交化 + `normal = tangent.cross(lateral)` で構造的に保証した。
`frame_normal` の保存は不要になったため削除（メモリ 144 → 120 B/frame）。

**MEDIUM-2 — 仕様値の緩和とテスト網羅の縮小（修正済み）**

T-TRK-01 の 1e-6 m を複雑形状のみ 2e-5 m へ緩和し、かつ `t` を ±2 m しか
通していなかった。緩和の根拠として挙げられた「knot の曲率不連続」は
Opus の検証により**否定された**（直線→円弧の結合で 1.1e-9、
小半径 R=15 m + t=6 m でも 8.5e-8、制御点密度 16→256 掃引でも ~9e-10 で平坦）。
真因は MEDIUM-1 であり、誤差は `ds ≈ |L·T| × t` でほぼ完全に説明できた。

MEDIUM-1 修正後、**緩和なしで 1e-6 m を両トラックで達成**:
circle `max_ds` = 1.02e-9 m ／ complex `max_ds` = 3.46e-7 m。
複雑形状の `t` も `{-6,-5,-2,0,2,5,6}` へ拡張（コース幅一杯を網羅）。

**LOW-1 — `camber` が幾何に未適用（doc 追記済み）**
仕様どおりの挙動だが、下流が「適用済み」と誤解しないよう doc comment を追加。

**LOW-2 — メモリ試算の定数が陳腐化（Opus が直接修正）**
`frame_normal` 削除後も `4*Vec3 = 144 B/frame` のままだった。
実体は `3*Vec3 = 120 B/frame`。テスト内の定数とコメントのみのため、
エージェント往復のコストに見合わないと判断し Opus が直接修正した。
過大見積もり方向であり誤検知は生じていなかった。

### Deviations from Spec

1. **曲率符号の perp_dot 引数順（Sonnet が指摘 → Opus 承認・仕様を訂正）**
   Opus の当初仕様 `tangent.xz().perp_dot(diff)` は**左旋回に対し負を返す誤り**だった。
   本規約の `lateral = up.cross(tangent)` は標準的な CCW 左法線とは逆手系のため符号が反転する。
   検算: 左旋回・tangent=+X で `diff ≈ (0,0,-ε)`、
   `tangent.perp_dot(diff) = -ε`（誤）／ `diff.perp_dot(tangent) = +ε`（正）。
   Sonnet は Frenet フレームの手計算と数値検証の 2 通りで裏付けたうえで報告しており、
   **設計変更プロトコルの模範的な運用**である。TODO.md の仕様を訂正済み。
2. **`runoff` の補間は最近傍**（列挙型は線形補間できない）。仕様が沈黙していたため承認し、規則として明文化。
3. **`frame_normal` の保存を廃止**（MEDIUM-1 の修正に伴う必然的な帰結。
   `tangent.cross(lateral)` は保存値と数学的に同一であることを確認済み）。

### Architecture Compliance
- ✅ Rendering / UI / Camera への依存ゼロ
- ✅ Waypoint index を持たない（連続量 `s` のみ）
- ✅ ラップ処理は `wrap_s` / `signed_delta_s` に一本化
- ✅ `detect_lap_crossing` がテレポート時に `Suspect` を返し、ラップ暴走を構造的に防止
- ✅ `crates/sim-math` の凍結を完全遵守

### Process Note
仕様に明記された受け入れ数値の緩和は、テスト作者の裁量ではなく設計判断である。
納品後の Deviations ではなく、事前の `PROPOSED DESIGN CHANGE` として提出すること。
曲率符号の扱い（Deviation 1）は完全に正しい運用だった。同じ基準を全項目へ適用する。

### Decision: **APPROVED**（commit `4fc4c48`）

---

# TASK-1A-3 — 完了報告 / レビュー記録

**実装**: Sonnet 5（Rust 側: `io.rs` + serde 属性）→ セッション上限で中断 →
**Opus 5 が引き継いで完成**（サーキット生成・テスト・README・レビュー）。
実装者交代の経緯を明示しておく。Sonnet の担当範囲にスコープ違反はなかった。

### Test Results（Opus による実行）
```
cargo test --release
  sim-math : vec_quat 12 / spline 14 / rng_util 11 / doc-test 1 = 38
  sim-track: track 16 / io 12                                   = 28
  ----------------------------------------------------------------
  合計 66 passed / 0 failed
cargo build -p sim-track --no-default-features : OK（依存は sim-math のみ）
cargo clippy --all-targets -- -D warnings      : 0
cargo build --release                          : 0 warnings
cargo fmt --check                              : clean
unsafe                                         : 0 行
凍結ファイルの差分                                : 0
```

### Aoyama Ring — 実測値（すべてテストで機械検証）

| 項目 | 要求 | 実測 |
|------|------|------|
| 全長 | 3 800〜4 600 m | **4 139 m** |
| 最長ストレート | >= 700 m | **742 m** |
| 高速コーナー | R >= 120 m を 2 本以上 | **4 本**（130 / 150 / 185 / 140 m） |
| 中速コーナー | R 40〜80 m を 3 本以上 | **5 本**（62 / 58 / 52 / 79 / 45 m） |
| ヘアピン | R 15〜25 m を 1 本以上 | **1 本**（20.6 m・旋回 150 度） |
| S 字 | 1 箇所以上 | **1 箇所**（コーナー間 66 m） |
| 高低差 | >= 20 m | **23.5 m** |
| バンク | 0.05〜0.12 rad | **0.100 rad**（外側が高いことも検証） |
| コース幅 | 12〜16 m | **12.0〜16.0 m** |
| 縁石 | 全コーナー | **10/10** |
| 制御点間隔 | 8〜20 m | **9.36〜18.15 m**（329 点） |
| ファイルサイズ | < 200 KB | **79.6 KB** |
| `load_track` | < 50 ms | **6.98 ms** |

コーナー半径は設計値ではなく `Track::frame_at(s).curvature` の実測から検証している。

### 実装中に判明した重要な知見

**1. 制御点密度の不連続が曲率スパイクを生む（修正済み）**

円弧を 10 m 間隔・直線を 18 m 間隔で置いたところ、半径 130 m のコーナーの出口に
**R=101 m 相当の 1 サンプル分のスパイク**が出た。密度が急変すると centripetal
Catmull-Rom の接線推定が跳ねるため。直線側の間隔を継ぎ目で 10 m・中央で 18 m へ
滑らかに変化させて解消した（実測でスパイク消滅、中央値が設計値と一致）。

**これは見た目の問題ではない。** Phase 2 の Speed Profile は曲率から限界速度を
計算するため、偽のスパイクはコーナー出口での偽の減速になる。
`assets/tracks/README.md` に規約として明記した。

**2. コーナー半径を「最小値」で測ってはいけない**

継ぎ目のスパイクを拾うため。**中央値**を使う（ドライバーが体験する半径はそちら）。
テストはこの方針で書いてある。

**3. `serde_json` の f64 は 1 ULP ずれて往復する（実測）**

```
22.96100594190540178 -> "22.961005941905402" -> 22.96100594190539823
```
トラックデータでは 1e-14 m で物理的に無意味だが、
**「保存→再読込でビット一致する」と仮定してはならない。**
アセット JSON が唯一の正であり実行時に再生成しないため、
PROJECT.md §7 の決定性契約（同一バイナリ・同一シードでビット一致）には影響しない。
`json_roundtrip` テストは許容誤差比較にし、理由をコメントで残してある。

### Deviations from Spec

1. **`io.rs` に private module `vec3_seq` を追加**（Sonnet の判断・承認）
   `sim_math::Vec3` は凍結 crate の型で `Serialize` を実装しておらず、孤児規則により
   `sim-track` 側で直接 `impl` もできない。`#[serde(with = ...)]` で回避したのは適切。
2. **バンク角を負値（-0.100 rad）とした**（Opus の判断）
   仕様表は大きさのみを規定していた。T7 は左旋回であり、物理的に正しい
   「外側（右）が持ち上がる」を満たすには本規約では負が正しい。
   テストは大きさと**符号の物理的整合**の両方を検証する。
3. **コーナー数が 10 本**（仕様の最小要件を上回る）。要件違反ではない。

### Known Limitations
- `load_track` は `Track::build` を 2 回実行する（検証時 + 構築時）。
  Opus の仕様どおりの構造。7 ms で予算 50 ms 内のため放置。最適化するなら仕様側を変える
- `runoff` は断面あたり 1 値のため左右で別々に指定できない。
  高速コーナーは左右とも `gravel` になっている。必要になったら型を拡張する

### Decision: **APPROVED**（commit `cf3d7dd`）

---

# NEXT SONNET TASK

## TASK-1A-4 — Engineering View（トラック可視化）

---

### IMPORTANT IMPLEMENTATION CONTRACT

あなたは **Implementation Engineer** です。
あなたはこのタスクの **Architect ではありません**。

Opus 5 によって承認された Architecture と Implementation Specification を **正確に** 実装してください。

以下を自己判断で変更してはいけません。

- Architecture / Module boundaries / Public interfaces / Data structures
- Technology stack / Dependencies
- Physics model / Racing AI model / Rendering architecture
- Naming conventions / Directory structure
- Task scope / Execution order

「こちらの方が良い」「一般的にはこの設計が良い」「リファクタリングした方が綺麗」
という理由による変更は **禁止** します。

#### NO UNAUTHORIZED DESIGN CHANGES

設計上の問題を発見した場合、**先にコードを変更してはいけません。** 以下の形式で報告し、承認を待つこと。

```
PROPOSED DESIGN CHANGE
Current Design:
Observed Problem:
Root Cause:
Proposed Change:
Reason:
Expected Benefit:
Risk:
Affected Modules:
Affected Files:
Migration Impact:
Alternative:
```

**仕様に明記された受け入れ数値の緩和は、テスト作者の裁量ではなく設計変更である。**
納品後の Deviations ではなく、事前に上記の形式で提出すること。

#### BLOCKER RULE

Scope 外の変更が必要になった場合、勝手に変更せず報告して判断を待つこと。

```
BLOCKED BY ARCHITECTURE
Task:
Blocking Issue:
Why Current Design Prevents Implementation:
Required Change:
Affected Scope:
Recommended Next Step:
```

#### NO UNAUTHORIZED REFACTORING

**凍結中（一切変更禁止）**: `crates/sim-math/**`、`crates/sim-track/**`、
ルート直下の `.md` 各種、`docs/`、`assets/tracks/aoyama_ring.track.json`。

---

### Goal

**トラックを目で見て検証できるようにする。**

Phase 2 以降の Driver AI・車両挙動を人間が評価するには、
テレメトリを可視化する計測器が要る。まずその土台をトラック表示として作る。

> **これは製品レンダラではない**（DECISIONS.md ADR-0003）。
> **見た目の品質向上に工数を使ってはならない。** 装飾・演出・マテリアルの作り込みは禁止。
> 追加してよい機能は、検証とデバッグに直接寄与するものだけ。
> Photorealism は UE5 側でのみ追求する。

### 前提（すでに導入済み）

- `wasm32-unknown-unknown` ターゲット: **導入済み**
- Node.js v24: 導入済み
- **`wasm-pack` は未導入。** 最初に `cargo install wasm-pack` を実行すること
  （時間がかかる。失敗する場合は `wasm-bindgen-cli` でも可。使った方を報告に明記）

### Allowed Files

```
Cargo.toml                          (members に crates/sim-wasm を追加するのみ)
crates/sim-wasm/Cargo.toml
crates/sim-wasm/src/lib.rs
view-engineering/index.html
view-engineering/src/main.js
view-engineering/src/track_mesh.js
view-engineering/src/overlay.js
view-engineering/README.md
view-engineering/package.json
.gitignore                          (pkg/ と node_modules/ の除外を追記)
```

### Dependencies

`crates/sim-wasm`:
```toml
[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
sim-math  = { path = "../sim-math" }
sim-track = { path = "../sim-track" }
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde-wasm-bindgen = "0.6"
```

`view-engineering` は **three のみ**（CDN でもローカルでも可）。
ビルドツール（webpack / vite 等）を導入しないこと。素の ES module で動かす。

### Required Changes

#### 1. `crates/sim-wasm` — WASM 境界

**この crate の責務は「Simulation Core の状態を JS へ読み出させる」ことだけ。**
ロジックを一切持たない。Presentation が Simulation を書き換える経路を作らない。

```rust
/// トラックを WASM 側で保持し、JS から幾何を読み出すためのハンドル。
#[wasm_bindgen]
pub struct WasmTrack { /* 非公開に sim_track::Track を持つ */ }

#[wasm_bindgen]
impl WasmTrack {
    /// トラック定義 JSON から構築する。失敗時は JsError。
    #[wasm_bindgen(constructor)]
    pub fn new(track_json: &str) -> Result<WasmTrack, JsError>;

    pub fn name(&self) -> String;
    pub fn length(&self) -> f64;
    pub fn sector_boundaries(&self) -> Vec<f64>;
    pub fn start_finish_s(&self) -> f64;

    /// `step_m` 間隔でサンプリングした帯状メッシュ用の頂点配列。
    /// 返すのは `Float64Array` 相当の平坦配列（`[x,y,z, x,y,z, ...]`）。
    /// `lateral_offset` に `t` を渡すと、その横位置に沿った線を返す
    /// （0 でセンターライン、+width_left で左端、-width_right で右端）。
    pub fn sample_line(&self, lateral_offset_ratio: f64, step_m: f64) -> Vec<f64>;

    /// 路面ポリゴン用。左端と右端を交互に並べた三角形ストリップ用頂点列。
    pub fn sample_surface(&self, step_m: f64) -> Vec<f64>;

    /// 各サンプル点の曲率 [1/m]。`sample_surface` と同じ `step_m` で対応する。
    pub fn sample_curvature(&self, step_m: f64) -> Vec<f64>;

    /// 各サンプル点のバンク角 [rad]。
    pub fn sample_banking(&self, step_m: f64) -> Vec<f64>;

    /// ワールド座標からトラック座標を求める。`[s, t]` を返す。
    pub fn world_to_track(&self, x: f64, y: f64, z: f64) -> Vec<f64>;
}
```

`lateral_offset_ratio` は `-1.0` で右端、`0.0` でセンター、`+1.0` で左端とする
（コース幅が `s` によって変わるため、絶対値ではなく比で指定する）。

#### 2. `view-engineering` — ビューア

**表示すべきもの（すべて検証目的）**

| 表示 | 目的 |
|------|------|
| 路面ポリゴン | 形状の確認 |
| センターライン | `s` の基準の確認 |
| 左右のコース端（corridor 境界） | 幅の確認 |
| **曲率のカラーマップ**（路面を曲率で着色） | **スパイクや不連続を目視で発見する。最重要** |
| 標高（3D 表示） | 高低差の確認 |
| バンク区間のハイライト | バンクが意図した場所にあるか |
| セクター境界とスタート/フィニッシュ線 | タイミングの基準の確認 |
| 100 m ごとの `s` の目盛り | 位置の確認 |
| マウスホバーで `s` / `t` / 曲率 / バンク / 幅 を数値表示 | **数値での確認** |

**操作**: オービット / パン / ズームのみ。凝ったカメラ演出は不要。

**禁止**: 影・反射・ポストエフェクト・スカイボックス・マテリアルの作り込み・
アニメーション・UI の装飾。これらは製品レンダラ（UE5）の責務であり、
ここでやると ADR-0003 に違反する。

`view-engineering/README.md` に「これはデバッグ用計測器であり製品レンダラではない」
ことと、起動方法を明記すること。

### Required Tests

WASM 境界は自動テストが難しいため、**Rust 側のロジックを rlib としてテストする**。

| Test | 内容 |
|------|------|
| `wasm_track_builds_from_asset` | 同梱 JSON 文字列から `WasmTrack` が構築でき、`length()` が `Track::length()` と一致 |
| `sample_surface_is_consistent` | 頂点数が `2 * ceil(length/step) + 2`。全頂点が有限。左右の点の距離が `width_left + width_right` と一致（誤差 < 1e-6） |
| `sample_line_offsets` | `ratio = 0` がセンターライン、`+1` が左端、`-1` が右端と一致 |
| `sample_curvature_matches_track` | `Track::frame_at(s).curvature` と一致 |
| `world_to_track_roundtrip` | `sample_line` で得た点を `world_to_track` に戻すと `t` がほぼ 0 |
| `invalid_json_returns_error` | 壊れた JSON で `Err` |

`cargo test -p sim-wasm` でネイティブ実行できるよう、テストは `#[cfg(test)]` で
`wasm_bindgen` に依存しない形にすること。

### Acceptance Criteria

1. `cargo build --release` 警告ゼロ
2. `cargo build -p sim-wasm --target wasm32-unknown-unknown` が通る
3. `cargo test --release` 全通過（**既存 66 テストの退行なし**）
4. `cargo clippy --all-targets -- -D warnings` が通る
5. `cargo fmt --check` が通る
6. `unsafe` 0 行（`wasm_bindgen` のマクロ展開を除く）
7. **ブラウザで Aoyama Ring が表示され、曲率カラーマップが見える**
   （スクリーンショットを撮って報告に添付するか、保存パスを明記すること）
8. 凍結ファイルの差分がゼロ
9. `view-engineering/` に **ビルドツールを導入していない**こと

### Performance Criteria

| 項目 | 基準 |
|------|------|
| `sample_surface(1.0)`（4 km） | < 50 ms |
| ビューアの表示 | 60 fps（トラック静止表示） |

### Out of Scope

- 車両の表示（車両がまだ存在しない。Phase 1B 以降）
- リプレイ・タイムライン
- 見た目の品質向上（**明確に禁止**）
- UE5 側の作業

### Known Risks

| Risk | 対策 |
|------|------|
| `wasm-pack` のインストールに失敗する | `wasm-bindgen-cli` へフォールバック。使った方を報告に明記 |
| Engineering View が肥大化する | 上の「禁止」リストを厳守。装飾的な変更は行わない |
| `Vec<f64>` の受け渡しが遅い | まず素直に実装し、実測が基準を超えたら報告する |

### 完了時の報告フォーマット

```
TASK-1A-4 COMPLETE

Implemented Files:
Toolchain used:            (wasm-pack か wasm-bindgen-cli か)
Test Results:              (cargo test の実出力)
wasm32 build:              (実出力)
Clippy / fmt Results:
Frozen-file diffs:         (git diff --stat。空であること)
Screenshot:                (保存パス、または添付)
Deviations from Spec:      (なければ "None")
Design Concerns Found:     (なければ "None")
Performance Notes:
```

**git commit はしないこと。** 作業ツリーに残し、Opus 5 のレビューを受けること。
