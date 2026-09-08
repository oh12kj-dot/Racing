# TODO.md — 現在実行するタスク

> **再開するときは先に [`HANDOFF.md`](HANDOFF.md) を読むこと。** 現在地・実装済み API・環境・手順が 1 本にまとまっている。


Last updated: 2026-09-08
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
| TASK-1A-4 | Engineering View（トラック可視化） | Opus 5 | ✅ **完了・APPROVED** |
| TASK-1A-5 | 曲率リップル解消と平滑性テスト | **Sonnet 5** | ⬅ **NEXT** |

### Phase 0.5（並行）

| Task | 内容 | 担当 | 状態 |
|------|------|------|------|
| TASK-05-1 | UE5 Code-First 構築 + M1〜M9 実測 | Sonnet 5 | 📄 仕様済 `docs/phase-0.5-tasks.md` |
| TASK-05-2 | Blender 車両生成パイプライン | Sonnet 5 | ✅ **完了・APPROVED** `2ec80c9`（M9 達成） |

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

# TASK-1A-4 — 完了報告 / レビュー記録

**実装**: Opus 5（本セッションの runtime は model 別 subagent の起動が禁止されていたため、
Architect が実装も担当した。TASK-1A-1 と同じ例外運用）／ **監査**: 同一セッションで全項目を再実行

> **運用上の注記**: 実装者と監査者が同一のため、「他人の報告を鵜呑みにしない」という
> 通常の担保が効かない。これを補うため、**独立検証器を 2 本**書いて結論を裏取りした
> （Menger 曲率による曲率の独立計算、CDP 経由のブラウザ内数値検証）。

### Implemented Files

```
Cargo.toml                       members に crates/sim-wasm を追加
.gitignore                       /view-engineering/pkg/ を追加
crates/sim-wasm/Cargo.toml
crates/sim-wasm/src/lib.rs       TrackView（純 Rust）+ WasmTrack（境界）+ テスト 7 本
view-engineering/index.html      import map と CSS。ビルドツールなし
view-engineering/src/main.js     シーン構築・入力・ホバー読み取り
view-engineering/src/track_mesh.js  WasmTrack -> Three.js。カラーマップ
view-engineering/src/overlay.js  数値 HUD
view-engineering/package.json    依存は three のみ
view-engineering/README.md
```

**Toolchain used**: `wasm-pack` 0.15.0（既に導入済みだった。仕様の「未導入」は誤り。
`wasm-bindgen-cli` へのフォールバックは不要だった）

### Test Results（監査での再実行）

```
cargo test --release
  sim-math : vec_quat 12 / spline 14 / rng_util 11 / doc-test 1 = 38
  sim-track: track 16 / io 12                                   = 28
  sim-wasm : lib tests                                          =  7
  ----------------------------------------------------------------
  合計 73 passed / 0 failed（既存 66 に退行なし）

cargo build --release                                : 0 warnings
cargo clippy --all-targets -- -D warnings            : 0
cargo fmt --check                                    : clean
cargo build -p sim-wasm --target wasm32-unknown-unknown --release : OK
cargo build -p sim-track --no-default-features       : OK（退行なし）
手書き unsafe                                         : 0 行
git diff --stat crates/sim-math crates/sim-track docs assets *.md : 空（凍結遵守）
view-engineering/node_modules                        : three のみ（ビルドツールなし）
```

### ブラウザでの実測（headless Chrome + CDP による自動検証）

スクリーンショットは `build/engineering-view/` に保存（gitignore 済み）。

| ファイル | 内容 |
|---------|------|
| `01-overview-curvature.png` | 全景・曲率カラーマップ |
| `02-hairpin-curvature.png` | ヘアピン拡大。**リップルが縞として見える** |
| `03-banking.png` | T7 バンク区間（負 = 外側が高い） |
| `04-elevation-tilted.png` | 標高カラーマップ + y=0 グリッド |

ブラウザ内で読み出した値が、アセットの設計値と一致することを機械的に確認した。

| 項目 | 実測 | 期待 |
|------|------|------|
| `length()` | 4 138.991 m | 4 139 m |
| `sample_surface(1.0)` 頂点数 | 8 280 | `2*ceil(L/1)+2` = 8 280 |
| `world_to_track` ラウンドトリップ `t` | 1.5e-12 m | ≈ 0 |
| 同 `s` 誤差 | 8.0e-10 m | ≈ 0 |
| コース幅 | 12.000〜16.000 m | 12〜16 m |
| 標高 | -0.0005〜23.4999 m | 高低差 23.5 m |
| バンク | -0.100〜0.000 rad | -0.100 rad |
| console errors | 0 | 0 |

### Performance

| 項目 | 基準 | 実測 | 判定 |
|------|------|------|------|
| `sample_surface(1.0)`（4 km） | < 50 ms | **0.3 ms** | ✅ |
| ビューアの表示 | 60 fps | **60.6 fps** | ✅ |

**fps は SwiftShader（CPU ソフトウェアラスタライザ）での実測**である。
実 GPU（RTX 4060 Ti）ではこれを大きく上回る。三角形数 8 278 は些少で、
ボトルネックにならない。

### Deviations from Spec

1. **`serde` / `serde-wasm-bindgen` を依存から外した**（Opus の判断）
   仕様の依存表には両者が挙がっていたが、確定した公開 API を通る値は
   `f64` / `String` / `Vec<f64>` だけで、`Vec<f64>` は `wasm-bindgen` が
   `Float64Array` へ直接変換する。JSON 形の値が境界を渡らないため両者とも
   未使用になる。未使用依存はビルド時間を増やすだけで利点がない。
   構造化された戻り値が必要になった時点で追加すれば足りる（追加は 2 行）。

2. **`TrackView`（純 Rust）と `WasmTrack`（境界）に二層化した**
   仕様は「テストは `#[cfg(test)]` で `wasm_bindgen` に依存しない形にすること」を
   要求している。サンプリング実装を `TrackView` に置き、`WasmTrack` を
   型変換だけの薄いラッパにすることでこれを構造的に満たした。
   公開 API（`WasmTrack` のメソッド名・シグネチャ）は仕様どおりで変更していない。

3. **`window.__engview` デバッグハンドルを追加**（Opus の判断）
   計測器を外から操作できないと、表示の正しさを機械的に確認できない
   （受け入れ基準 7 のスクリーンショットも手作業になる）。
   読み出しと視点操作のみを公開し、シミュレーション状態は変更しない。
   上記のブラウザ内実測はすべてこのハンドル経由で行った。

4. **`stations` / `sample_*` は不正な `step_m` に対して空配列を返す**（仕様が沈黙）
   `panic` は `profile.release` の `panic = "abort"` により WASM では回復不能になる。
   非有限・非正、およびステーション数が `MAX_STATIONS`（200 000）を超える指定を
   空で失敗させる。テスト `invalid_step_returns_empty` で固定した。

5. **曲率カラーマップの正規化に `signed sqrt` を採用**（仕様は正規化方法に沈黙）
   線形正規化ではヘアピン（κ ≈ 0.081）が値域を支配し、高速コーナーが
   すべて灰色に潰れて**発見対象のスパイクが見えなくなる**。
   `sqrt` は 0 付近の勾配を立てるため、微小な曲率の跳ねほど見つけやすい。
   凡例に実数値を併記し、正規化方法も画面に明記している。

### Design Concerns Found

**MEDIUM-1 — Aoyama Ring のヘアピンに 10 m 周期の曲率リップルがある（未修正・要対応）**

**Engineering View が最初の起動で発見した。** `build/engineering-view/02-hairpin-curvature.png`
に縞として視認できる。アセットは凍結対象のため、本タスクでは修正せず報告に留める。

ヘアピン本体（s = 3316〜3343）で曲率が制御点間隔とほぼ同じ **周期 10.5 m** で振動する。

```
s=3320  κ=0.047687  R=20.97      ← 谷
s=3325  κ=0.061026  R=16.39      ← 山
s=3330  κ=0.047673  R=20.98      ← 谷
s=3335  κ=0.061435  R=16.28      ← 山
s=3340  κ=0.047641  R=20.99      ← 谷
```

さらに進入端 s=3315 と脱出端 s=3346 に **1〜2 サンプルの尖ったピーク**がある
（κ = 0.0807 / R = 12.4 m、κ = 0.0777 / R = 12.9 m）。

**独立検証**: `curvature_at` を一切使わず、サンプル点 3 点の外接円から求めた
Menger 曲率で裏取りした。本体のリップルは両者が 1% 以内で一致する（実在する）。
尖ったピークのみ Menger（±2 m ステンシル）が平滑化して 0.0713 を返す
（= ピークが極めて局所的であることの証拠）。

**根本原因**: centripetal Catmull-Rom は円弧を厳密に再現しない。逸脱量は
おおむね `(chord / R)^2` に比例する。

| コーナー | R | 制御点間隔 | chord/R | 本体のリップル |
|---------|---|-----------|---------|--------------|
| 高速 T1 | 130 m | 約 10 m | 0.077 | **0.8%**（R = 129.35〜130.38。実質なし） |
| ヘアピン | 約 19.4 m | 約 10.5 m | **0.52** | **±13%**（R = 16.3〜21.0） |

直線も健全（s = 400〜900 で max |κ| = 1.27e-4、R = 7 900 m）。
**問題は「小半径コーナーでの制御点間隔」に限定される。全周の系統的欠陥ではない。**

**なぜ既存テストが通ったか**: TASK-1A-3 はコーナー半径を**中央値**で測る
（継ぎ目スパイクを拾わないための正しい判断）。中央値 ≈ 20.6 m は
リップルの包絡線の上側におり、設計値と一致してしまう。
**中央値は半径の測定には正しいが、滑らかさの測定にはならない。**

**Phase 2 への影響**: Speed Profile は κ から限界速度 `v = sqrt(mu*g*R)` を出す。
R が 16.3 ↔ 21.0 m で 10 m 周期に振動すると、速度指令が **±13% 相当**で
同周期に振動する。さらに R=12.4 m の 1 サンプルスパイクは
`sqrt(12.4/19.4) = 0.80`、すなわち **20% の偽の減速**になる。
ヘアピン通過中に不自然なスロットル／ブレーキの脈動として現れ、
本プロジェクトの中核目標「車が自然に走る」に直接反する。

**severity 判定**: **MEDIUM**。現時点でどの契約・テストも破っておらず、
影響は最もタイトな 1 コーナーに限局する。ただし
**Phase 2 の Speed Profile 着手前に必ず解消すること**（TASK-1A-5 として起票済み）。

### Architecture Compliance

- ✅ `sim-wasm` は**読み出し専用**。書き込み用メソッドを持たない
- ✅ Simulation Core は Rendering / UI / Camera を知らない（依存は sim-wasm → sim-track の一方向）
- ✅ ビューアは曲率・バンクを再計算せず、すべて WASM から読む
- ✅ 手書き `unsafe` 0 行。`wasm_bindgen` の展開だけを `bindings` モジュールに閉じ込め、
  crate 全体は `#![deny(unsafe_code)]` を維持する構造にした
- ✅ 装飾なし（ライティング・影・反射・ポストエフェクト・スカイボックスをすべて不使用）。
  路面は `MeshBasicMaterial` + 頂点カラーで、**表示された色 = データの値**
- ✅ 凍結ファイルの差分ゼロ
- ✅ ビルドツール未導入（`node_modules` は `three` のみ）

### Decision: **APPROVED**

Phase 1A の実装は完了。MEDIUM-1 はアセットの品質課題であり、
本タスクの実装に起因するものではない。TASK-1A-5 として分離して対応する。

---

# NEXT SONNET TASK

## TASK-1A-5 — 小半径コーナーの曲率リップル解消と平滑性テスト

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

**曲率が「設計半径どおり」であるだけでなく「滑らかである」ことを、機械的に保証する。**

TASK-1A-4 の Engineering View が、Aoyama Ring のヘアピン本体に
制御点間隔とほぼ同じ **周期 10.5 m・振幅 ±13% の曲率リップル**を発見した
（詳細と実測値は上の TASK-1A-4 レビュー記録 MEDIUM-1 を参照。
`build/engineering-view/02-hairpin-curvature.png` に縞として視認できる）。

Phase 2 の Speed Profile は κ から限界速度を出すため、このリップルは
ヘアピン通過中の**偽のスロットル／ブレーキ脈動**になる。
Phase 2 に着手する前に解消する。

### 対応する 2 つの欠落

1. **アセット**: ヘアピン付近の制御点が疎すぎる（`chord / R = 0.52`）
2. **テスト**: 半径を**中央値**で測る検査しかなく、**滑らかさを測る検査が無い**。
   中央値は半径の測定には正しいが、リップルは素通しする

**2 を先に作ること。** テストが無いまま 1 を直しても、直ったことを証明できない。

### Allowed Files

```
crates/sim-track/tests/io.rs            平滑性テストの追加のみ
assets/tracks/aoyama_ring.track.json    ヘアピン周辺の制御点の再生成
assets/tracks/README.md                 制御点間隔の規約の更新
tools/tracks/**                         生成スクリプトを置く場合（新規作成可）
```

### Do Not Change

`crates/sim-math/**`、`crates/sim-track/src/**`（**スプライン実装は変更しない**）、
`crates/sim-wasm/**`、`view-engineering/**`、ルート直下の `.md`、`docs/`。

> **`sim-math` の `CubicSpline` を「円弧を厳密に通るスプライン」へ差し替えてはならない。**
> それは基盤 crate の設計変更であり、`ArcLengthSpline` / `Track` / 既存 38 テストの
> 全体に波及する。必要と判断した場合は着手せず `PROPOSED DESIGN CHANGE` を提出すること。
> 本タスクは**制御点の配置だけで**解決する。

### Dependencies

なし（既存の crate のみ）。

### Required Changes

#### 1. 平滑性テスト（先に書く。修正前に落ちることを確認すること）

`crates/sim-track/tests/io.rs` に追加する。
`Track::frame_at(s).curvature` を **0.5 m 間隔**（= `FRAME_SPACING_M`）で全周サンプルする。

| Test | 内容 | 基準 |
|------|------|------|
| `aoyama_curvature_has_no_ripple` | `\|κ\| > 1/100`（R < 100 m）の**コーナー本体**区間で、局所極大と隣接する局所極小の比 `κ_max / κ_min` | **< 1.10** |
| `aoyama_curvature_rate_is_bounded` | 全周で `\|dκ/ds\|`（0.5 m 差分） | **< 0.010 1/m²** |
| `aoyama_no_isolated_curvature_spikes` | 各サンプルの κ と、前後 ±3 m の中央値との比 | **< 1.15** |

**「コーナー本体」の定義**: `\|κ\| > 1/100` が 15 m 以上連続する区間の、
両端から 5 m を除いた部分。進入・脱出の遷移で κ が 0 から立ち上がるのは
正常であり、リップルと混同してはならない（TASK-1A-4 の監査で実際に一度誤検出した）。

現状の実測値（修正前。テストが実質的であることの確認に使う）:

```
ヘアピン本体 κ_max/κ_min = 0.061435 / 0.047641 = 1.29   -> 基準 1.10 を超過（落ちる）
全周 max |dκ/ds|         = 0.0410 1/m^2                 -> 基準 0.010 を超過（落ちる）
高速 T1 本体 κ_max/κ_min = 130.38 / 129.35 相当 = 1.008  -> 通る（健全な区間は誤検出しない）
直線 s=400..900 max |κ|  = 1.27e-4                       -> 通る
```

**3 本とも、修正前に落ちること／高速コーナーと直線では誤検出しないことを
実行して確認し、報告に出力を貼ること。**

#### 2. 制御点の再配置

**方針**: 制御点間隔を半径に応じて決める。目標は全コーナーで `chord / R <= 0.25`。

`(chord/R)^2` に比例して逸脱するため、`chord/R` を 0.52 -> 0.25 にすれば
リップルはおよそ 1/4.3、±13% -> 約 ±3% になる。基準 1.10（= ±5%）に収まる。

| R | 上限間隔 |
|---|---------|
| < 30 m | **R * 0.25**（ヘアピン R≈20 m なら 5 m） |
| 30〜80 m | 8 m |
| > 80 m | 従来どおり 10 m |
| 直線 | 継ぎ目 = 隣接コーナーの間隔、中央 18 m |

**密度を急変させないこと（TASK-1A-3 の既知の落とし穴）。**
隣接する制御点間隔の比を **1.5 倍以内**に保ち、遷移は滑らかにする。
密度の跳びは、それ自体が接線推定を跳ねさせて偽スパイクを生む。

トラック全体の形状・全長・コーナー配置は**変えない**。
既存の `io.rs` の全要件テスト（全長 3 800〜4 600 m、高速 4 本、中速 5 本、
ヘアピン 1 本、S 字、高低差 >= 20 m、バンク、幅、縁石、ファイルサイズ）が
**すべて通り続けること**。中央値半径は従来値の ±5% 以内に保つ。

#### 3. `assets/tracks/README.md` の規約更新

「制御点間隔 8〜20 m」を、上の**半径依存の規則**へ置き換える。
理由（`(chord/R)^2` の逸脱、Speed Profile への影響）を 3 行程度で残すこと。
制御点数が増えるためファイルサイズ上限（< 200 KB）を再確認する。

### Acceptance Criteria

1. 追加した 3 テストが、**修正前に落ち／修正後に通る**（両方の出力を報告に貼る）
2. `cargo test --release` 全通過（**既存 73 テストの退行なし**。増分のみ）
3. `cargo clippy --all-targets -- -D warnings` / `cargo fmt --check` が通る
4. Engineering View（`view-engineering/`）で**ヘアピンの縞が消えている**ことを
   スクリーンショットで確認する。手順は `view-engineering/README.md`
5. 中央値コーナー半径が従来値の ±5% 以内
6. `aoyama_ring.track.json` < 200 KB / `load_track` < 50 ms
7. 凍結ファイルの差分がゼロ

### Out of Scope

- `sim-math` のスプライン実装の変更（**明確に禁止**。上記 Do Not Change を参照）
- 他のトラックの追加
- Engineering View の機能追加
- Speed Profile そのものの実装（Phase 2）

### Known Risks

| Risk | 対策 |
|------|------|
| 密度を上げた結果、継ぎ目に新しいスパイクが出る | 隣接間隔比 1.5 倍以内。追加した `aoyama_no_isolated_curvature_spikes` が検出する |
| 制御点数が増えてファイルが 200 KB を超える | 増えるのは小半径区間のみ。超えたら報告すること |
| 基準 1.10 が達成できない | **勝手に緩めない。** `PROPOSED DESIGN CHANGE` として実測値つきで提出する |

### 完了時の報告フォーマット

```
TASK-1A-5 COMPLETE

Implemented Files:
Tests Before Fix:          (3 テストが落ちる出力)
Tests After Fix:           (cargo test の実出力)
Control Point Changes:     (点数の増減、間隔の分布、chord/R の最大)
Corner Radii (median):     (修正前 -> 修正後。±5% 以内であること)
Ripple Measurements:       (ヘアピン本体の κ_max/κ_min、全周 max |dκ/ds|)
File Size / load_track:
Clippy / fmt Results:
Frozen-file diffs:         (空であること)
Screenshot:                (ヘアピン。縞が消えていること)
Deviations from Spec:      (なければ "None")
Design Concerns Found:
```

**git commit はしないこと。** 作業ツリーに残し、Opus 5 のレビューを受けること。
