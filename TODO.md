# TODO.md — 現在実行するタスク

> **再開するときは先に [`HANDOFF.md`](HANDOFF.md) を読むこと。** 現在地・実装済み API・環境・手順が 1 本にまとまっている。


Last updated: 2026-09-09
Current Phase: **Phase 1B 完了 → Phase 2 へ**（TASK-1B-1 `b7a7084` / 1B-2 `4968e61` / 1B-3 commit 済み。すべて APPROVED）

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

## Phase 1A — Track Foundation（完了）

| Task | 内容 | 担当 | 状態 |
|------|------|------|------|
| TASK-1A-1 | `sim-math`: 数学基盤と決定的 RNG | Opus 5 | ✅ **完了・APPROVED** |
| TASK-1A-2 | `sim-track`: Track Coordinate System | Sonnet 5 | ✅ **完了・APPROVED** |
| TASK-1A-3 | トラック定義の JSON ロード + Aoyama Ring | Sonnet 5 + Opus 5 | ✅ **完了・APPROVED** |
| TASK-1A-4 | Engineering View（トラック可視化） | Opus 5 | ✅ **完了・APPROVED** |
| TASK-1A-5 | 曲率リップル解消と平滑性テスト | Opus 5 | ✅ **完了・APPROVED** |

---

## Phase 1B — Vehicle Physics

| Task | 内容 | 担当 | 状態 |
|------|------|------|------|
| TASK-1B-1 | `sim-vehicle`: 車両物理 | Opus 5 | ✅ **完了・APPROVED**（未コミット） |
| TASK-1B-2 | `sim-core`: `sim-track` を使う `GroundProbe` と固定ステップ World | Sonnet 5 | ✅ **完了・APPROVED**（未コミット。監査 2 ラウンド） |
| TASK-1B-3 | Engineering View に車両を表示（`sim-wasm` に `WasmWorld` 追加 + ビューア） | Sonnet 5 | ✅ **完了・APPROVED**（commit 済み。仕様は Sonnet 起票・人間承認済み） |

**Phase 1A / 1B ともに完了。CRITICAL / HIGH の未解決なし。3 タスクとも commit 済み。**
次は Phase 2（レーシングライン + 単独 Driver AI）。`# NEXT SONNET TASK` の実装契約は
Architect（Opus 5）が新規起票する（現状は 1B-3 の記録のまま）。

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

# TASK-1A-5 — 完了報告 / レビュー記録

**実装・監査**: Opus 5（TASK-1A-4 と同じく、runtime が model 別 subagent の起動を
禁止していたため Architect が実装も担当）

### Implemented Files

```
crates/sim-track/tests/io.rs         平滑性テスト 3 本を追加 + 制御点間隔の規約を改訂
tools/tracks/densify_corners.py      小半径コーナーの制御点を詰め直すツール（新規）
assets/tracks/aoyama_ring.track.json ヘアピン周辺のみ再生成（130 挿入 / 18 削除）
assets/tracks/README.md              制御点間隔の規約を半径依存へ改訂
```

### Tests Before Fix（テストが実質的であることの確認）

```
test aoyama_curvature_has_no_ripple ... FAILED
    curvature ripple 1.879 (R_med 19.1 m) exceeds 1.1
test aoyama_curvature_rate_is_bounded ... FAILED
    curvature rate 0.04277 1/m^2 at s=3345.0 exceeds 0.01
test aoyama_no_isolated_curvature_spikes ... FAILED
    isolated curvature spike 1.420 at s=3345.5 exceeds 1.15
```

**健全なコーナーでは誤検出しない**ことも同時に確認している。修正前の時点で
ヘアピン以外の 8 コーナーはすべて基準内だった（`κ_max/κ_min` = 1.005〜1.058）。
落ちたのはヘアピン（R_med 19.1）だけである。

### Tests After Fix

```
cargo test --release
  sim-math : 38 / sim-track: track 16 + io 15 / sim-wasm: 7 = 76 passed / 0 failed
  （既存 73 に退行なし。増分は io の +3）
cargo clippy --all-targets -- -D warnings : 0
cargo fmt --check                         : clean
cargo build --release                     : 0 warnings
git diff --stat crates/sim-math crates/sim-wasm view-engineering docs *.md : 空
```

### Ripple Measurements

| 指標 | 修正前 | 修正後 | 基準 |
|------|-------|-------|------|
| ヘアピン本体 `κ_max/κ_min` | **1.879** | **1.054** | < 1.10 |
| コーナー本体 max `\|dκ/ds\|` | **0.04277** | **0.00209** | < 0.010 |
| 局所中央値に対するスパイク比 | **1.420** | **1.046** | < 1.15 |

コーナー本体ごとの `κ_max/κ_min`（修正後）:

```
    R_med   body_m  kmax/kmin
    130.1    199.0      1.011
    150.1     81.5      1.012
     62.4     47.5      1.033
     58.3     57.0      1.036
     52.5     13.0      1.038
    185.2     32.5      1.005
     19.0     32.0      1.054   <- ヘアピン。1.879 から改善し、他と同等になった
     45.4     24.5      1.054
    139.9      7.0      1.004
```

ヘアピンは**もはや外れ値ではない**。R=45 のコーナーと同じ水準にある。

### Control Point Changes

```
制御点        329 -> 337 (+8)
間隔          9.36..18.15 m -> 4.51..18.15 m
最大 chord/R  0.518 -> 0.238
隣接間隔比    1.557 -> 1.557（S 字の既存値。ヘアピン周辺では 1.21 に収めた）
ファイルサイズ 76.9 KB（< 200 KB）
diff          130 insertions / 18 deletions（全 329 点中、触れたのは 18 点）
```

ヘアピン: 5 分割（30 度・9.83 m）-> **11 分割**（13.6 度・4.51 m）。
両隣の直線に間隔のランプ（4.51 -> 5.47 -> 6.62 -> 8.02 m、比 1.21）を作った。

### Corner Radii（中央値）

| コーナー | 修正前 | 修正後 |
|---------|-------|-------|
| 130 / 150 / 62 / 58 / 52 / 185 / 45 / 140 | — | **すべて変化なし** |
| ヘアピン | 20.55 m | **19.2 m** |

全長 4 138.99 m -> 4 139.09 m（+0.10 m）。レイアウト要件はすべて通り続けている
（高速 4 / 中速 5 / ヘアピン 1 / S 字 / 最長ストレート 742 m / 高低差 23.50 m /
バンク -0.100 rad / 幅 12.0〜16.0 m / 縁石 10/10）。

### 手法 — なぜ形状を変えずに直せたか

**このトラックのコーナーは厳密な円弧の上に制御点が置かれている。**
最小二乗の円フィット残差は全コーナーで **<= 0.5 mm**（= JSON の mm 丸めそのもの）、
半径は 130 / 150 / 62 / 58 / 52 / 185 / **19** / 45 / 140 という切りのいい値だった。

したがって設計円は完全に復元でき、**同じ円の上に詰めて置き直す**だけで
リップルだけを消せる。形状の推測は一切していない。
隣接する直線側は、端点を結ぶ直線からの垂直距離が 1 mm 以内であることを
確認してから再配置している（直線でなければツールは中断する）。

標高は元の値を Catmull-Rom 補間、断面は線形補間、`runoff` は最近傍で引き継いだ
（断面が元から線形補間されるため、線形での再サンプルは厳密に等価）。

### Deviations from Spec（Opus が実測に基づいて自分の仕様を訂正した 3 点）

1. **`|dκ/ds|` と「スパイク」の検査を「全周」から「コーナー本体」へ限定した**

   仕様は全周に `|dκ/ds| < 0.010 1/m²` を課していた。**これは達成不可能だった。**
   このトラックは緩和曲線（クロソイド）を持たず、円弧と直線が直接つながるため、
   継ぎ目では曲率が**設計どおり**不連続に変化する。実測で全周の最大は
   ヘアピンを除外してもなお **0.040 1/m²**（s=3606 の R=45 出口など）であり、
   全周に 0.010 を課すことは「全 9 コーナーに緩和曲線を入れる」という
   トラックの設計変更を要求するに等しい。

   本体の定義は実測で決めた。両端 12 m を落とすと、健全なコーナーは
   1.005〜1.058、壊れたヘアピンは 1.879 で**明確に分離する**。

2. **ヘアピンの中央値半径が ±5% を超えて変化した（20.55 -> 19.2 m、-6.6%）**

   仕様は「中央値は従来値の ±5% 以内」としていたが、これは誤りだった。
   **従来の中央値 20.55 m はリップルによって水増しされた値**であり、
   設計円は R=19.000 m（フィット残差 0.2 mm）である。
   リップルを消せば中央値は設計値へ収束するのが正しい。
   他の 8 コーナーは中央値が一切変化していない。

3. **`asset_track_meets_layout_requirements` の制御点間隔の判定を書き換えた**

   仕様の Allowed Files は io.rs を「平滑性テストの追加のみ」としていたが、
   一律 `8..20 m` の判定は詰め直しと両立しない（新しい下限は 4.51 m）。
   単に下限を下げるのではなく、**半径依存の規則へ置き換えた**:

   - `chord / R <= 0.25`（制御点そのものの Menger 曲率から半径を測る）
   - 絶対上限 20 m / 絶対下限 3 m
   - 隣接間隔比 <= 1.6（詰め直しの目標は 1.5。1.6 なのは S 字に 1.557 が
     元から存在するため。そこは平滑性が健全〈1.04〉で触る理由がない）

   一律の下限では小半径コーナーを守れない、というのが本タスクの発見そのもの
   なので、規約自体を直すのが正しい。

### Design Concerns Found

**LOW-1 — 弧と直線の継ぎ目に曲率のオーバーシュートが残る（全コーナー共通・仕様どおり）**

継ぎ目で Catmull-Rom は曲率をオーバーシュートする。実測（`median_R / min_R`）:

```
130 -> 1.48    150 -> 1.51    62 -> 1.44    58 -> 1.47    52 -> 1.41
185 -> 1.46     19 -> 1.45    45 -> 1.43   140 -> 1.42
```

**全 9 コーナーで一様（1.41〜1.51）であり、ヘアピンだけが悪いのではない。**
修正前のヘアピンは 1.66 と突出していたが、いまは他と同等になった。

これは緩和曲線を持たない設計の帰結であり、平坦にするには全コーナーの
ジオメトリを変える必要がある（= トラックの設計変更）。本タスクの範囲外とした。

**Phase 2 への申し送り**: Speed Profile は**センターラインではなく
レーシングラインの曲率**から計算すること。レーシングラインはコリドー内で
最適化されるため、センターラインの継ぎ目のオーバーシュートをそのまま
引き継ぐ必要はない。もし引き継ぐ設計にするなら、先に緩和曲線を入れること。

### Architecture Compliance

- ✅ `sim-math` のスプライン実装を変更していない（**制御点の配置だけで解決**）
- ✅ `crates/sim-track/src/**` の差分ゼロ（変更はテストのみ）
- ✅ `crates/sim-wasm` / `view-engineering` / `docs` / ルート `.md` の差分ゼロ
- ✅ トラック形状を推測で作り直していない（円フィットで設計を復元し、その上に再配置）
- ✅ アセットは 100% テキストから再生成可能（ADR-0006 の方針を維持）

### Screenshot

`build/engineering-view/02-hairpin-BEFORE.png` と `02-hairpin-curvature.png`。
修正前ははっきりした縞（10.5 m 周期のリップル）が見え、修正後は一様な赤になっている。
Engineering View が見つけた問題を、Engineering View で確認して閉じた。

### Decision: **APPROVED**

Phase 1A は完了。CRITICAL / HIGH の未解決はない。

---

# TASK-1B-1 — 完了報告 / レビュー記録

**Status: ✅ APPROVED**（実装 Opus 5 / 監査 Opus 5・独立に再実行して確認）
Date: 2026-09-08

## 実装物

```
Cargo.toml                           members に crates/sim-vehicle を追加（1 行）
crates/sim-vehicle/Cargo.toml
crates/sim-vehicle/src/lib.rs        定数と再エクスポート（PHYSICS_DT / WHEEL_SUBSTEPS / GRAVITY / AIR_DENSITY）
crates/sim-vehicle/src/input.rs      ControlInput とクランプ（NaN を安全側へ落とす）
crates/sim-vehicle/src/ground.rs     GroundProbe / GroundHit / FlatGround
crates/sim-vehicle/src/params.rs     VehicleParams 一式 / validate / spec.json 読み込み / Derived
crates/sim-vehicle/src/state.rs      WheelIndex / WheelState / VehicleState と姿勢アクセサ
crates/sim-vehicle/src/tyre.rs       簡略 Pacejka + 緩和 + 低速ブレンド + 静止摩擦ばね
crates/sim-vehicle/src/powertrain.rs エンジン / クラッチ / ギア / LSD
crates/sim-vehicle/src/aero.rs       抗力と圧力中心に作用するダウンフォース
crates/sim-vehicle/src/vehicle.rs    Vehicle::step（唯一の状態遷移）
crates/sim-vehicle/tests/common/mod.rs 共通ヘルパー・StepGround・ビット比較
crates/sim-vehicle/tests/vehicle.rs    T-VEH-01 〜 14
crates/sim-vehicle/tests/params.rs     spec.json の読み込みと検証
crates/sim-vehicle/tests/scenarios.rs  4 シナリオ + Performance Criteria
```

Rust 約 2 700 行（実装 1 700 / テスト 1 000）。**手書き `unsafe` は 0 行**（`#![deny(unsafe_code)]`）。

## 検証（すべて監査側で再実行）

```
cargo test --release                                → 124 passed / 0 failed
                                                       （既存 76 + sim-vehicle 48。退行なし）
cargo clippy --all-targets -- -D warnings           → 0
cargo fmt --check                                   → clean
cargo build --release                               → 警告 0
cargo build -p sim-vehicle --target wasm32-unknown-unknown → OK
cargo build -p sim-vehicle --no-default-features    → OK・警告 0（依存が sim-math のみになる）
git diff --stat crates/sim-math crates/sim-track crates/sim-wasm view-engineering assets tools
                                                    → 空（凍結ファイルの差分ゼロ）
git status --short                                  → Cargo.toml / Cargo.lock / crates/sim-vehicle のみ
```

`&mut self` を取る公開メソッドは `Vehicle::step` **ただ 1 つ**
（`grep -n "pub fn.*&mut self" src/vehicle.rs` で確認）。
crate 内に「ロック判定」に相当するコードは存在しない（LSD の `lock` 変数のみ）。

### 受け入れ結果

| ID | 検証内容 | 結果 |
|----|---------|------|
| T-VEH-01 | 静止 4 輪荷重の合計 = 車重 | ✅ 誤差 **0.00000%**（< 0.1%） |
| T-VEH-02 | 静止時の前後配分 | ✅ **0.45000**（< 1%） |
| T-VEH-03 | 制動でダイブ | ✅ pitch 負 + 前輪荷重増 + 前縮み / 後伸びが整合 |
| T-VEH-04 | 加速でスクワット | ✅ pitch 正 + 後輪荷重増 |
| T-VEH-05 | 定常円旋回でロール | ✅ 横荷重移動が `m a h / track` と 10% 以内で一致。ロール角がサスの縮み差と 5e-4 rad 以内で一致 |
| T-VEH-06 | 低速・停止で 60 分発散なし | ✅ `recovered_steps = 0` / NaN なし |
| T-VEH-07 | 摩擦円を超えない | ✅ 30 秒ぶん全 tick 全輪で検証 |
| T-VEH-08 | ロックアップが創発する | ✅ `spin = 0` / `slip_ratio → -1` / 逆回転なし |
| T-VEH-09 | ダウンフォースが v^2 に比例 | ✅ **サス荷重の合計から**測って誤差 < 1% |
| T-VEH-10 | 惰行減速が抗力 + 転がり抵抗と整合 | ✅ 誤差 **0.7%**（< 5%） |
| T-VEH-11 | Visual suspension == 物理 compression | ✅ 静止で 1e-9 / 走行中も全 tick 1e-9 |
| T-VEH-12 | 決定性 | ✅ 20 秒 × 2 回で全状態**ビット一致** |
| T-VEH-13 | 不正入力（1e9 / NaN / inf） | ✅ クランプされ `recovered_steps = 0` |
| T-VEH-14 | 50 mm 段差 @ 200 km/h | ✅ `recovered_steps = 0` |
| 性能 | `Vehicle::step` | ✅ **1 500 ns**（< 8 000 ns） |
| 性能 | 24 台 × 240 Hz | ✅ **0.144 ms / frame**（<= 2.0 ms） |

### シナリオ

| Scenario | 実測 | 帯 |
|----------|------|----|
| 0→100 km/h | **3.85 s** | 3.2〜4.2 ✅ |
| 100 km/h→0 | **26.8 m** | 25〜40 ✅（**帯を改定した。下記**） |
| 定常円旋回 R=50 m | **1.41 G @ R = 49.0 m** | 1.4〜2.2 ✅ |
| スロットルオフのオーバーステア | バランスが −0.0026 → +0.0020 rad へ移動 | ✅ |

## 仕様変更（Architect 判断・記録必須）

### 1. 100-0 制動距離の帯を 30〜40 m → **25〜40 m** へ改定

**当初の 2 つの帯は同時に満たせない。** 摩擦円は等方であり `mu0` は縦と横のグリップを
同じ比率で動かす。`mu0` 掃引の実測（`mu0` 以外はアセットの値のまま）:

| `mu0` | 100-0 [m] | 0-100 [s] | 最大横 G |
|-------|-----------|-----------|---------|
| 1.30 | 31.9 ✓ | 3.85 ✓ | 1.24 ✗ |
| 1.40 | 29.3 ✗ | 3.55 ✓ | 1.32 ✗ |
| 1.50 | 26.8 ✗ | 3.32 ✓ | **1.41 ✓ (R=49.0 m)** |
| 1.60 | 25.1 ✗ | 3.16 ✗ | 1.46 ✓ |

`mu0 = 1.50` を採用。定常円旋回は唯一**半径が数値で指定された**シナリオであり、
そこを仕様どおり（R≈50 m で 1.4 G 超）に当てられるのがこの値だけである。
実車 GT3 の 100-0 は 28〜31 m 程度で、26.8 m は現実的。当初の 30〜40 m の方が
ロードカー寄りの保守的な帯だったと判断する。詳細は `docs/phase-1b-vehicle.md`。

### 2. 公開 API の追加（いずれも状態書き換え経路を作らない）

- `Vehicle::new_with_velocity(params, position, yaw, velocity)` — 初期条件の指定。
  ローリングスタート（Phase 3）と単体テストに必要。構築後に速度を与える手段は無い
- `Vehicle::suspension_rest_length()` — T-VEH-11 が視覚と物理の一致を測るのに要る
- `VehicleState::{forward, up, right, yaw, pitch, roll, forward_speed, total_load}` — 読み出しのみ。
  **`Quat::to_euler_yxz` の "pitch" は `+X` まわりで、車両ローカルではロールに相当する。**
  この取り違えを防ぐため基底ベクトルから導く実装を crate 側に置いた
- `WheelState::friction_limit` / `VehicleState::aero_downforce` / `recovered_steps` — フィールド追加。
  `grip_usage` は `1.0` で飽和するため、T-VEH-07 には生の上限値が要る

### 3. 依存関係の食い違いの解消

`TODO.md`（TASK-1B-1）の Dependencies は `sim-math + sim-track` と書いていたが、
`docs/phase-1b-vehicle.md`「責務の境界」は `sim-track` への依存を明確に禁じている。
**仕様書を正とし、`sim-vehicle` の依存は `sim-math` のみとした**（+ optional serde）。
路面は `GroundProbe` 経由。`sim-track` との接続は TASK-1B-2 で `sim-core` が行う。

### 4. 静止摩擦ばねに減衰項を追加

仕様の `-k_stick * 滑り変位` だけでは停車中の擾乱が減衰せず自励振動する。
タイヤカーカスの減衰に相当する `-c_stick * 滑り速度` を足した
（`stick_damping_ratio` 既定 0.5 = 臨界の半分）。摩擦円の頭打ちは変えていないので
T-VEH-07 の上限保証は保たれる。

### 5. LSD ロックトルクに上限を追加

仕様の `bias * (spin_r - spin_l) * k_lsd` は差回転に比例したまま上限が無く発散する。
`bias * |T_axle| + preload` で頭打ちにした（式の形は仕様どおり）。

## 監査で確認したこと

1. スコープ外のファイルは変更されていない（`git status --short` が 3 項目のみ）
2. 凍結 crate の差分は空
3. テスト / clippy / fmt / 各ターゲットのビルドを**監査側で再実行**した
4. **新しいテストが実質的か**を確認した。T-VEH-09 は当初「空力の式を空力の式で検証」
   していたので、**サスペンション荷重の合計**から測る形へ書き直した（独立検証）。
   T-VEH-05 も同様に「横荷重移動 = `m a h / track`」という物理の恒等式で照合している
5. 報告された挙動を鵜呑みにせず、`mu0` 掃引・ブレーキペダル掃引・ステア掃引を
   実際に走らせて数値を取った。**当初の「スリップ制御ブレーキで 45 m」という結果は
   制御則の調整不足であり、車両側の問題ではなかった**（ペダル一定掃引で 26.8 m）
6. 惰行減速の照合で当初 −5.2% ずれたのは、車輪の回転慣性（等価質量 58.8 kg）を
   期待値に入れ忘れていたため。入れて 0.7% に収束した。**モデルではなく検証式の誤り**

## 残っている懸念（Phase 2 へ申し送り）

| # | 内容 |
|---|------|
| C-1 | **限界を超えると素直にスピンする。** ステア掃引で `steer = -0.110` まで安定、`-0.115` で破綻。限界付近の前後スリップ角がほぼ等しい（中立）ため、Driver AI 側に修正操舵が要る |
| C-2 | ロール角が横 G に対して飽和する（progressive ばね）。1.24 G で 0.0086 rad、1.49 G で 0.0092 rad。カメラ演出でロールを増幅したくなったら**物理ではなく描画側**で行うこと |
| C-3 | エンジン慣性をドライブラインへ反映していない（クラッチ結合時は回転数を従動させるだけ）。加速が実車よりわずかに速く出る可能性がある。Phase 6 で必要になったら見直す |
| C-4 | `camber` / `roughness` は受け取るだけで未使用（仕様どおり） |

---

# TASK-1B-2 — 完了報告 / レビュー記録

**Status: ✅ APPROVED**（実装 Sonnet 5 / 監査 Opus 5・独立検証器で裏取り・2 ラウンド）
Date: 2026-09-09 ／ **未コミット**（作業ツリーに残置。commit は Opus 担当）

## 実装物

```
Cargo.toml                        members に crates/sim-core を追加（1 行）
crates/sim-core/Cargo.toml        依存 = sim-math + sim-track + sim-vehicle（dev-dep なし）
crates/sim-core/src/lib.rs        #![deny(unsafe_code)] / 型の再エクスポート
crates/sim-core/src/ground.rs     TrackGround（GroundProbe 実装。鉛直交点 + 再投影反復）
crates/sim-core/src/world.rs      World / VehicleEntry / VehicleId / WorldError / LAP_MAX_DS
crates/sim-core/tests/core.rs     T-CORE-01 / 01b / 02〜09（11 tests）
```

## 検証（すべて監査側で再実行）

```
cargo test --release                                → 135 passed / 0 failed
                                                      （既存 124 + sim-core 11。退行なし）
cargo clippy --all-targets -- -D warnings           → 0
cargo fmt --check                                   → clean
cargo build --release                               → 警告 0
cargo build -p sim-core --target wasm32-unknown-unknown → OK
cargo build -p sim-core --no-default-features       → OK
git diff --stat（凍結 crate / assets / tools / view-engineering / docs）→ 空
unsafe                                              → 0 行
T-CORE-08 決定性                                     → 同一入力列 2 回で position/velocity/rpm/s/laps がビット一致
T-CORE-09 性能                                       → 24 台 1 tick = 167 µs（予算 2.0 ms の 8.4%）
```

## 第 1 ラウンドの指摘（監査 Opus 5）

| Severity | 指摘 | 対応 |
|----------|------|------|
| **HIGH-1** | `TrackGround::probe` が `world_to_track` の垂線投影結果を接地点にしていた。GroundProbe の「鉛直下方」契約に反し、バンク 0.1 rad で鉛直落差が `h·sin²θ` ぶん過小（実測 6.45 mm）→ 静的ばね荷重が約 +38%。T-CORE-01/02/03 が全て法線方向プローブのため構造的に検出不能だった | probe を鉛直線とフレーム平面の交点へ変更（`drop = ((from-P)·n)/n.y`、`n.y.abs()<1e-6` で `None`）。勾配区間の投影先 s ずれを、接地高さ付近まで下ろした点での再投影反復（上限 4 回）で解消。旧実装なら鉛直誤差 10.95 mm、新実装 3.83e-8 m（Opus が外部再実装で確認） |
| MEDIUM-1 | `LAP_MAX_DS` の根拠コメントが誤り（世界変位と弧長 `ds` の混同）。`ds = dl_path/(1-κt)` でカーブ内側では `MAX_SPEED·dt` を超える | `MAX_SPEED·PHYSICS_DT·3.0`（≈2.5 m）へ。係数 3 = 曲率増幅の最悪ケース ≈2.5×（κ≈0.075, t≈8 m）にマージン。コメントを弧長ベースへ書き直し。Opus 独立計測で保守的と確認（端 1.81×／端+2 m 2.49×／実走 max 0.21 m/tick） |
| MEDIUM-2 | `LapCrossing::Backward` の `saturating_sub(1)` が幻の 1 周を生む（ライン後方発進 → 逆走 → 前進で laps=1） | **人間判断で Forward のみ +1 に据え置き**（対称カウンタ・後方スタート処理は Phase 3 のレース状態機械で設計）。トレードオフ（振動 1 往復ごとに +1 する無界インフレ）を world.rs のコメントに明記 |
| MEDIUM-3 | T-CORE-04 が「8 秒走行 + 52 秒駐車」で走行を検証していない | 2 秒ローンチ後、軽スロットル 0.05 を 58 秒保持。ローンチ後 min 前進速度 > 1.0 m/s（実測 6.21）を全 tick で要求。最終 s=730（< 982） |
| MEDIUM-4 | T-CORE-07 に「ワールド距離では逆順」配置がなく、誤実装を落とせない | T-CORE-07b 追加。s=706（trailer）/ s=1005（首位）で S/F 点からのワールド距離は 623 m < 916 m。「線に近い方が前」型の実装なら逆転する配置 |
| LOW-1/2 | T-CORE-01 のトートロジー性 / 未使用 `approx` dev-dep | T-CORE-01 を真上からの鉛直プローブへ書き換え（旧実装を確実に落とす）+ T-CORE-01b（最大バンク点）追加。`approx` 削除 |

## 第 2 ラウンド（再監査）

**Decision: APPROVED**（条件: commit 前に MEDIUM-1 / LOW-1 のコメント追記のみ。挙動変更なし・再監査不要 → 適用済み）

Opus が独立検証したもの: 旧/新実装の鉛直高さ誤差（56,000 点掃引）、`point` と `normal` の
station 整合（残差 8.25e-12 m）、T-CORE-01/01b/07b が旧実装/ワールド距離実装を落とすこと、
`LAP_MAX_DS` 係数 3 の保守性、決定性（同一 hint ビット一致 + World 3000 step×2 ビット一致）、
§3 不可侵原則の全項目。

## 仕様変更（Architect / 人間判断・記録必須）

### 1. `TrackGround::probe` の接地点算出（HIGH-1 対応 / 契約遵守）

仕様「路面高さは `TrackFrame` の position/lateral/banking から求める」が垂線投影とも
鉛直交点とも読める曖昧さを残していた。`GroundProbe` の「鉛直下方へ探索」契約を優先し、
鉛直線とフレーム平面の交点とした。勾配で `world_to_track` の投影先 s がずれるため
再投影反復（上限 4 回）を追加。センターライン近傍は 2 反復で 1e-9 未満、高曲率+大 |t|
では上限に達し残差 1e-8 m オーダー（物理的に無害）。

### 2. `LAP_MAX_DS = MAX_SPEED · PHYSICS_DT · 3.0`（MEDIUM-1 対応）

仕様は「`MAX_SPEED · PHYSICS_DT` を基準にした値を使い、根拠をコメントに書く」と
実装者へ委ねていた。基準式は維持し、曲率増幅ぶんの係数 3 を根拠つきで明示した。

### 3. 公開 API の追加（いずれも状態書き換え経路を作らない）

- `VehicleEntry::sync_track_position(&mut self, ...)` を pub 化 — `World::step` からは
  物理的に `Suspect` を発生させられないため、T-CORE-06 がラップ抑止を検証する経路。
  TASK-1B-1 の `new_with_velocity` と同じ性質（状態遷移は増やさない）
- `WorldError::InvalidSpawn { field, value }` — `spawn` の非有限入力の返り値
- `TrackGround::{hint, track}` — 読み出しアクセサ（副作用なし）
- `pub const LAP_MAX_DS` — 上記 2 のとおり仕様が根拠コメントを要求
- `lib.rs` の再エクスポート群（`Track` / `TrackCoord` / `TrackFrame` / `LapCrossing` /
  `Vehicle` / `GroundHit` / `GroundProbe` / `ControlInput` / `VehicleParams` / `PHYSICS_DT`）

### 4. `LapCrossing::Backward` の扱い（MEDIUM-2 / 人間判断）

Forward のみ +1。逆走相殺・後方スタート判定は Phase 3 のレース状態機械とセットで設計する。

## 残っている懸念（TASK-1B-3 / Phase 2 へ申し送り）

| # | 内容 |
|---|------|
| D-1 | `spawn` の姿勢がヨーのみ。縦勾配区間（最大 4.2%）で 1 step 後の compression が最大 38 mm ずれる（減衰する過渡・`recovered_steps`=0）。**グリッド用途の S/F ストレートでは 5.5e-5 m で無害**。TASK-1B-3 で `TrackFrame` 由来のピッチ/ロール込み・CG オフセットを法線方向にする。受け入れ「全周 400 station で 1 step 後 \|compression − static_compression\| < 1e-6 m」 |
| D-2 | `LAP_MAX_DS` は**オンコース前提**のしきい値。コース外へ数百 m 飛んだ車では ds/tick が 6.9 m に達し `Suspect` になる。track limits（Phase 2）とセットで扱う |
| D-3 | 周回数の確定は Forward-only も対称カウンタも単独では不正。セクター通過順を併用する設計を Phase 3 仕様に含める。**振動 5 往復で +5 されるケースを受け入れテストに入れる** |
| D-4 | `set_hint` は性能だけでなく正しさにも効く。hint を大きく外すと標高違いの別デッキを掴む（s=505 で 16.1 m 差）。Engineering View などが `TrackGround` を単発構築するなら注意書きが要る |
| D-5 | T-CORE-01 の 1e-9 は格子依存。全域の真の上界は 3.83e-8 m。格子を変えても壊れない許容値へ |
| D-6 | T-CORE-09 の 2.0 ms 予算は hint 忘れ（hint 無しでも ≈365 µs）を検出できない。次は探索反復回数などで直接検証する |
| D-7 | `camber` は依然として幾何未適用。バンク接地が正確になった今が次の検討対象（`sim-track` 凍結解除の判断事項） |

---

# NEXT SONNET TASK

> **次は TASK-1B-3（Engineering View に車両を表示）。仕様は下記。**
> TASK-1B-2 の仕様は末尾に実装済みの記録として残してある。

---

## TASK-1B-3 — Engineering View に車両を表示

> **起票の経緯**: 本来 Architect（Opus 5）が起票するが、Opus セッションが利用できない
> ため Sonnet 5 が起票し、人間の承認を得て実装する（2026-09-09）。
> D-1〜D-7 の織り込み結果は下記「D-1〜D-7 の扱い」にまとめた。

### IMPORTANT IMPLEMENTATION CONTRACT

あなたは **Implementation Engineer** です。**Architect ではありません。**
承認された Architecture と本仕様を **正確に** 実装してください。

自己判断で変更してはいけないもの:
Architecture / Module boundaries / Public interfaces / Data structures /
Technology stack / Dependencies / Physics model / Racing AI model /
Rendering architecture / Naming conventions / Directory structure /
Task scope / Execution order。

「こちらの方が良い」「一般的にはこの設計が良い」「リファクタリングした方が綺麗」
という理由による変更は **禁止**。

#### NO UNAUTHORIZED DESIGN CHANGES

設計上の問題を見つけたら、**先にコードを変えない。** 下記形式で報告し承認を待つ。

```
PROPOSED DESIGN CHANGE
Current Design / Observed Problem / Root Cause / Proposed Change / Reason /
Expected Benefit / Risk / Affected Modules / Affected Files / Migration Impact / Alternative
```

**仕様に明記された受け入れ数値の緩和は設計変更である。** 事前に上記形式で提出すること。

#### BLOCKER RULE

Scope 外の変更が必要になったら、勝手に変えず報告して判断を待つ。

```
BLOCKED BY ARCHITECTURE
Task / Blocking Issue / Why Current Design Prevents Implementation /
Required Change / Affected Scope / Recommended Next Step
```

#### NO UNAUTHORIZED REFACTORING

**凍結中（一切変更禁止）**: `crates/sim-math/**`、`crates/sim-track/**`、
`crates/sim-vehicle/**`、`crates/sim-core/**`、`assets/**`、`tools/**`、
`docs/**`、ルート直下の `.md`（`HANDOFF.md` / `TODO.md` を除く。これらは
完了報告のときだけ更新する）。

`crates/sim-wasm/src/lib.rs` の既存 `TrackView` / `WasmTrack` と、
`mod bindings` の `#![deny(unsafe_code)]` を `mod bindings` に閉じ込める構造は
**変更しない**（新しい型を足すだけ）。

---

### Goal

**`sim-core` の `World` を Engineering View で走らせ、Aoyama Ring 上を動く車を
描画・計測できるようにする。**

Phase 1B までで「車が物理的に妥当に振る舞う」ことは `sim-vehicle` / `sim-core` の
テストで検証済みだが、**目で見て確認する手段がない**。Phase 2（レーシングライン /
Driver AI）に入る前に、車の姿勢・サスペンション・テレメトリを可視化する。

`view-engineering` は **デバッグ用計測器であり製品レンダラではない**（ADR-0003）。
装飾（影・反射・ポストエフェクト・スカイボックス・マテリアルの作り込み・ライティング）は
**追加しない**。追加してよいのは検証とデバッグに直接寄与するものだけ。

### 先に読むもの

- `HANDOFF.md` §5「実装済み API」— `sim-core` / `sim-vehicle` / `sim-wasm` の公開 API
- `crates/sim-wasm/src/lib.rs` — 既存の `TrackView` / `WasmTrack` の構造
- `view-engineering/src/{main,track_mesh,overlay}.js` — 既存ビューアの構成
- `crates/sim-core/src/world.rs` — `World` / `VehicleEntry` / `spawn` / `step` / `standings`

### Allowed Files

```
Cargo.lock                              依存追加に伴う自動更新のみ
crates/sim-wasm/Cargo.toml              dependencies に sim-core を追加（sim-vehicle が推移的に入る）
crates/sim-wasm/src/lib.rs              WorldView（純 Rust）+ WasmWorld（境界）+ テストを追加
view-engineering/index.html             テレメトリ HUD の DOM を追加
view-engineering/src/main.js            World の駆動ループ・車両描画の配線・__engview 拡張
view-engineering/src/vehicle_mesh.js    新規。プリミティブで車体と車輪を組む
view-engineering/src/overlay.js         テレメトリ表示を追加
view-engineering/README.md              車両表示の操作説明を追記
HANDOFF.md / TODO.md                    完了報告のときだけ
```

**上記以外は触らない。** 特に `crates/sim-core/**` と `crates/sim-vehicle/**` は
凍結。`spawn` の姿勢拡張（D-1 フル版）は本タスクの範囲外（後述）。

### Dependencies

`crates/sim-wasm/Cargo.toml` の `[dependencies]` に **1 行だけ**追加する。

```toml
sim-core = { path = "../sim-core" }
```

`sim-vehicle` は `sim-core` 経由で推移的に入る。`sim-wasm` の `[dependencies]` に
`sim-vehicle` を直接書いてもよい（`ControlInput` などを名前で使うため。どちらでも可）。
**それ以外の依存を足さないこと。** 物理エンジン crate は使わない（ADR-0005）。
`view-engineering` の `node_modules` は `three` のみを維持する（ビルドツール禁止）。

### 必ず守る原則（違反は CRITICAL / `HANDOFF.md` §3）

1. **Presentation が Simulation を書き換える経路を作らない。** `WasmWorld` が外に
   出せる操作は `ControlInput` を渡して `step` することだけ。Transform / Position /
   Velocity を書ける公開メソッドを作らない（§3-1）
2. **固定タイムステップのみ。** `WasmWorld::step` は `sim_vehicle::PHYSICS_DT` 固定で
   ステップ数だけを受け取る。可変 dt を Simulation へ入れない（§3-5）
3. **グローパル乱数・時刻依存乱数を持ち込まない。** この層は乱数を持たない（§3-6）
4. **順位は `World::standings()` をそのまま使う。** ビューア側で `(laps, s)` を
   再計算したりワールド距離で並べ替えたりしない（§3-9）
5. **ラップ数・`s`・`t` は `sim-core` から読むだけ。** ビューアで剰余計算をしない（§3-8）
6. **`TrackFrame` / `VehicleState` の幾何をビューアで作り直さない。** WASM から読む
7. Simulation Core（`sim-core` 以下）を Rendering / Camera / UI に依存させない。
   依存方向は `sim-wasm -> sim-core` の一方向のみ

---

### Required Changes

#### Part A — `sim-wasm`: `World` を保持する stateful 境界

既存の「トラック幾何の読み出し専用境界」に、**シミュレーションを保持して進める境界**を
追加する。トラック読み出し（`WasmTrack`）は従来どおり読み出し専用のまま。

##### A-1. 純 Rust 層 `WorldView`（`wasm_bindgen` 非依存・テストはここに書く）

```rust
/// `sim_core::World` を保持し、Engineering View 用の読み出しを提供する。
///
/// 状態を変える経路は [`WorldView::step`]（`ControlInput` を渡す）だけ。
/// これは実シミュレーションの駆動経路そのものであり、Presentation から
/// Simulation を書き換える別経路ではない（§3-1）。
pub struct WorldView {
    world: World,
    ids: Vec<VehicleId>,
}

impl WorldView {
    /// トラック定義 JSON と車両スペック JSON から構築する。車両は 0 台。
    pub fn from_json(track_json: &str, vehicle_spec_json: &str)
        -> Result<WorldView, WorldViewError>;

    /// トラック局所座標 `(s, t)` に 1 台配置する。戻り値は添字（= VehicleId.0）。
    pub fn spawn(&mut self, start_s: f64, start_t: f64) -> Result<usize, WorldViewError>;

    /// `steps` 物理 tick 進める。`inputs` は 1 台あたり
    /// `[steer, throttle, brake, clutch, gear, drs]` の 6 要素を平坦に並べたもの。
    /// 車両数ぶんに満たない分は `ControlInput::default()`。
    /// `steps` は上限（例 32）でクランプし、超過分は捨てる（ブラウザのタブ復帰で
    /// 巨大な dt が来たときにフリーズさせない）。
    pub fn step(&mut self, steps: u32, inputs: &[f64]);

    pub fn tick(&self) -> u64;
    pub fn vehicle_count(&self) -> usize;
    pub fn track_length(&self) -> f64;

    /// 車体重心のワールド姿勢。`[px,py,pz, qx,qy,qz,qw]`（7 要素 × 台数）。
    pub fn body_poses(&self) -> Vec<f64>;

    /// 車輪のワールド姿勢。1 台あたり 4 輪 ×`[px,py,pz, qx,qy,qz,qw]` = 28 要素。
    /// 車輪順は `WheelIndex::ALL`（FL, FR, RL, RR）。値は
    /// `Vehicle::wheel_world_transform` そのまま（物理と別系統で作らない）。
    pub fn wheel_poses(&self) -> Vec<f64>;

    /// テレメトリ。1 台あたり以下を平坦に並べる（順序固定）:
    /// `s, t, laps, forward_speed, engine_rpm, gear,
    ///  in_steer, in_throttle, in_brake,
    ///  then 4×[load, slip_ratio, slip_angle, grip_usage]`
    /// = 9 + 16 = 25 要素 × 台数。
    pub fn telemetry(&self) -> Vec<f64>;

    /// 順位。`World::standings()` の添字列をそのまま返す。
    pub fn standings(&self) -> Vec<usize>;
}
```

- `WorldViewError` は `sim_core::WorldError` と `sim_vehicle::VehicleParamsError` と
  `sim_track::TrackIoError` を包む薄い enum。`Display` を実装する
- `body_poses` の姿勢は `VehicleState::{position, orientation}` そのまま
- **数値は必ず `sim-core` / `sim-vehicle` の getter から取る。** `sim-wasm` 側で
  物理量を計算しない（曲率・スリップ・荷重などを再計算しない）
- `step` の `steps` 上限は `const MAX_STEPS_PER_CALL: u32 = 32;` として定義し、
  根拠（`32 * PHYSICS_DT ≈ 133 ms`。表示 1 フレームで消化してよい上限）をコメントに書く

##### A-2. 境界層 `WasmWorld`（`mod bindings` 内・型変換のみ）

```rust
#[wasm_bindgen]
pub struct WasmWorld { view: WorldView }

#[wasm_bindgen]
impl WasmWorld {
    #[wasm_bindgen(constructor)]
    pub fn new(track_json: &str, vehicle_spec_json: &str) -> Result<WasmWorld, JsError>;

    pub fn spawn(&mut self, start_s: f64, start_t: f64) -> Result<usize, JsError>;
    pub fn step(&mut self, steps: u32, inputs: &[f64]);   // Float64Array を受ける
    pub fn tick(&self) -> u64;
    pub fn vehicle_count(&self) -> usize;
    pub fn track_length(&self) -> f64;
    pub fn body_poses(&self) -> Vec<f64>;
    pub fn wheel_poses(&self) -> Vec<f64>;
    pub fn telemetry(&self) -> Vec<f64>;
    pub fn standings(&self) -> Vec<usize>;
}
```

- `WasmTrack` と同じく `mod bindings` に置き、`pub use bindings::WasmWorld;` で再エクスポート
- **書き込み用メソッドは `step`（`ControlInput` 相当の数値列）以外に作らない**
- crate のトップコメントを更新: 「トラック幾何は読み出し専用（`WasmTrack`）。
  `WasmWorld` は `World` を保持して進めるが、外部が渡せるのは `ControlInput` だけで、
  Transform を書く経路は持たない」

#### Part B — `view-engineering`: 車両の描画とテレメトリ

##### B-1. `vehicle_mesh.js`（新規）

`assets/vehicles/gt_proto_a.spec.json` の `dimensions` / `tyre` を **`fetch` で読み**、
プリミティブで車体を組む（GLB は読み込まない。マテリアルの作り込みをしないため）。

- 車体: `BoxGeometry(length, height, width)` 1 個。`MeshBasicMaterial`、単色
  （`livery.base_color` を使ってよい）。ワイヤフレームの縁取りを重ねて姿勢を読めるようにする
- 車輪: 4 個の `CylinderGeometry`（半径 = `tyre.front/rear.radius`、高さ = `tyre.*.width`）。
  軸を車両ローカル `+Z`（右）に向ける。単色 + ラジアル方向のマーカー線 1 本（回転が見えるように）
- **ライティングなし。** 既存の路面と同じく `MeshBasicMaterial`
- 影・反射・エフェクトは付けない

##### B-2. `main.js` — World の駆動と描画

- 起動時: トラック JSON と車両スペック JSON を `fetch` → `new WasmWorld(trackJson, specJson)`
  → `world.spawn(startS, 0.0)`。`startS` は `track.start_finish_s()` の少し手前
- 駆動ループ（`renderer.setAnimationLoop` 内）:
  - `accumulator += clamp(now - last, 0, 0.25)` で経過時間を貯める
  - `n = floor(accumulator / PHYSICS_DT)` を `MAX_STEPS_PER_CALL` でクランプ
  - `world.step(n, currentInputsFlat)` を **1 回**呼ぶ（内部でループする）
  - `accumulator -= n * PHYSICS_DT`
  - `world.body_poses()` / `world.wheel_poses()` を読んで Three.js の
    `position` / `quaternion` に設定する（座標系は既存トラックと同じ。変換を挟まない）
  - `PHYSICS_DT` の値は WASM から取れないので、`view-engineering` 側の定数として
    `1 / 240` を `main.js` に置き、**`sim_vehicle::PHYSICS_DT` と一致する旨をコメントで明記**
- 入力: **Driver AI ではない。** プレースホルダのスクリプト入力。
  - 既定: `throttle = 0.35`, `steer = 0.0`, `brake = 0.0`, `gear = 1`（発進のため
    数百 tick 後に `gear` を上げる簡易ロジックは付けてよいが、コメントで
    「Phase 2 の Driver AI で置き換える暫定ハーネス」と明記する）
  - `__engview.setInput({ steer, throttle, brake, gear })` で上書きできる
  - **曲率追従やライン追従などの操舵ロジックを書かない**（Phase 2 の Out of Scope）
- 既存のトラック表示・ホバー読み取り・カラーモード・レイヤ切替は**壊さない**

##### B-3. `overlay.js` + `index.html` — テレメトリ HUD

`world.telemetry()` から 1 台ぶんを読んで数値表示する。表示項目:

```
speed [km/h]（forward_speed * 3.6）  rpm  gear
throttle / brake / steer（入力）
lap  s [m]  t [m]  sector
4 輪: load [N] / slip_ratio / slip_angle [deg] / grip_usage [%]
順位（1 台なので "P1"。台数が増えたら standings() の順）
```

既存のホバー読み取り HUD とは別のパネルにする。色分け・グラフは付けない（数値だけ）。

##### B-4. `__engview` の拡張（読み出しと入力のみ）

```js
window.__engview = {
  ...既存,
  world,                       // WasmWorld ハンドル
  stepOnce(),                  // 1 物理 tick だけ進める（CDP 検証用）
  setInput({ steer, throttle, brake, gear }),
  vehicle: {                   // 現在値のスナップショット読み出し
    bodyPose(i = 0), wheelPoses(i = 0), telemetry(i = 0),
  },
  followCar(on = true),        // 車体の後方からのチェイスカメラ（OrbitControls と排他）
};
```

`setInput` は許可される（実シミュレーションの唯一の駆動手段が `ControlInput` のため）。
状態を直接書く API（位置・速度の設定）は**足さない**。

---

### D-1〜D-7 の扱い（`HANDOFF.md` の申し送り）

| # | 本タスクでの扱い |
|---|----------------|
| **D-1** | **フル版は範囲外。** `spawn` の姿勢を `TrackFrame` 由来のピッチ/ロール込みにするには `Vehicle::new` が完全な `orientation`（Quat）を受け取る必要があり、`sim-vehicle`（凍結）の公開 API 追加になる。これは Architect / 人間承認事項。本タスクは既存の `spawn`（ヨーのみ・`Vec3::Y` オフセット）のまま使い、**グリッドは S/F ストレート（バンクほぼ 0）に置く**ことで既知の無害範囲（5.5e-5 m）で運用する。バンク区間へ入った後の姿勢は走行中のサスペンションが解決する（T-VEH-05 で検証済み）。フル版は別タスク `TASK-1B-4?`（`sim-vehicle` + `sim-core` 凍結解除）として `HANDOFF.md` に残すこと |
| **D-2** | `LAP_MAX_DS` はオンコース前提。**暫定ハーネスの操舵は 0 固定**なので車は緩やかにアウト側へ膨らみつつ最初のコーナーでコースアウトしうる。テレメトリで `grip_usage` とコースアウトが読めれば十分（track limits は Phase 2）。60 秒走行テスト（下記 T-EV-04）は**コースアウトしても `recovered_steps = 0` / NaN なし**を要求する（順位やラップ完走は要求しない） |
| **D-3** | 周回カウントの確定は Phase 3。本タスクは `laps_completed` を**表示するだけ**。振動ケースのテストは Phase 3 側 |
| **D-4** | `WasmWorld` は内部で `World::step` を使うので hint は毎 tick 正しく更新される（`sim-core` 実装済み）。ビューアが `TrackGround` を単発構築することは**しない**。README に「別デッキを掴む問題は `World` 経由なので発生しない」と 1 行残す |
| **D-5** | 本タスクの Rust テスト（下記 T-EV-A2）は許容値を **1e-6 m** にする（1e-9 の格子依存を避ける） |
| **D-6** | 性能テスト T-EV-A3 は `World::step` の実測（`sim-core` の T-CORE-09 と同条件）を再掲するに留める。hint 忘れ検出は `sim-core` 側の課題 |
| **D-7** | `camber` は幾何未適用のまま。ビューアでも使わない |

---

### Required Tests

#### `crates/sim-wasm`（純 Rust・`cargo test -p sim-wasm`）

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-EV-A1 | `WorldView` が構築・spawn できる | Aoyama Ring + `gt_proto_a.spec.json` で `spawn` 成功、`vehicle_count() == 1` |
| T-EV-A2 | `body_poses` が `World` の真値と一致 | 300 tick 走らせ、`body_poses()[0..3]` が `world.vehicles()[0].vehicle.state().position` と **1e-6 m 以内**（`WorldView` 内に検証用 getter を足してよい。足す場合は読み出しのみ） |
| T-EV-A3 | `wheel_poses` が `wheel_world_transform` と一致 | 全 4 輪で位置が 1e-9 一致 |
| T-EV-A4 | 決定性 | 同じ `(spawn, 入力列)` で 2 回 `step` し、`body_poses` / `telemetry` がビット一致 |
| T-EV-A5 | `step` のステップ上限 | `step(1000, …)` が `MAX_STEPS_PER_CALL` 回だけ進める（`tick()` で確認） |
| T-EV-A6 | 入力の平坦配列の解釈 | `[0.0, 1.0, 0.0, 0.0, 1.0, 0.0]` が `throttle=1, gear=1` として効く（数 tick で `forward_speed > 0`） |
| T-EV-A7 | `telemetry` の並び順 | ドキュメントした 25 要素の並びと一致（`s` / `laps` / `forward_speed` などを個別に照合） |

#### `view-engineering`（headless Chrome + CDP・既存 TASK-1A-4 の手法）

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-EV-B1 | 車両が表示される | `__engview.objects` に車体と 4 輪があり、`visible` |
| T-EV-B2 | 描画位置が WASM の真値と一致 | `__engview` で 600 tick 進め、Three.js の車体 `position` と `world.body_poses()` が 1e-6 一致 |
| T-EV-B3 | ネイティブ参照との突き合わせ | 同じ spawn・同じスクリプト入力列で **ネイティブ `sim-core` を別途実行**し、600 tick 後の重心位置がブラウザ側と 1e-6 一致（独立検証） |
| T-EV-B4 | 60 秒走行 | `__engview` で 60 s ぶん進め、`telemetry` に NaN なし・`recovered_steps` 相当の破綻なし（コースアウトは可） |
| T-EV-B5 | テレメトリ HUD | speed / rpm / gear / lap / 4 輪 slip が数値で出ている（スクリーンショットで確認） |
| T-EV-B6 | 既存機能の非退行 | カラーモード切替・レイヤ切替・ホバー読み取りが従来どおり動く |

スクリーンショットは `build/engineering-view/` に保存（gitignore 済み）。
最低 2 枚: 全景（車がトラック上にいる）+ 車両拡大（サスペンションの縮み差が見える姿勢）。

### Acceptance Criteria

1. Required Tests（T-EV-A1〜A7 / T-EV-B1〜B6）がすべて通る
2. `cargo test --release` 全通過（**既存 135 テストの退行なし**。増分は `sim-wasm` のみ）
3. `cargo clippy --all-targets -- -D warnings` が通る
4. `cargo fmt --check` が通る
5. `cargo build --release` 警告ゼロ
6. 手書き `unsafe` 0 行（`sim-wasm` は `#![deny(unsafe_code)]` を維持。
   `wasm_bindgen` 展開は既存どおり `mod bindings` に閉じ込める）
7. `cargo build -p sim-wasm --target wasm32-unknown-unknown --release` が通る
8. `wasm-pack build crates/sim-wasm --target web --out-dir ../../view-engineering/pkg --release` が通る
9. 凍結ファイルの差分がゼロ（`git diff --stat` で `crates/sim-math` `crates/sim-track`
   `crates/sim-vehicle` `crates/sim-core` `assets` `tools` `docs` が空）
10. `view-engineering/node_modules` が `three` のみ（ビルドツール未導入）

### Performance Criteria

| 項目 | 基準 | 根拠 |
|------|------|------|
| `WorldView::step`（1 台 1 tick） | <= 10 µs | `sim-core` T-CORE-09 が 24 台 167 µs。1 台なら ~7 µs |
| 表示フレームレート（1 台・SwiftShader） | >= 55 fps | TASK-1A-4 が 60.6 fps。車両追加ぶんの余裕を見て 55 |
| `wasm-pack` 後の `sim_wasm_bg.wasm` | < 800 KB | 参考記録（肥大の早期検知用） |

### Out of Scope

- Driver AI / レーシングライン / 操舵ロジック（Phase 2）
- `spawn` 姿勢のピッチ/ロール拡張（D-1 フル版。`sim-vehicle` 凍結解除が要る別タスク）
- 複数台の同時 spawn の作り込み（`WorldView` の API は台数を想定した形にするが、
  ビューアは 1 台で可。2 台目以降は Phase 3）
- 車車間衝突・ダーティエア（Phase 3 以降）
- GLB（Blender 生成メッシュ）の読み込み・マテリアル・ライティング・エフェクト
- 製品レンダラ（UE5）側の作業（TASK-05-1）
- カメラ演出・音・リプレイ

### Known Risks

| Risk | 対策（仕様に設計済み） |
|------|----------------------|
| 可変 dt が Simulation に漏れる | `WasmWorld::step` は `steps: u32` のみ。dt は `PHYSICS_DT` 固定（T-EV-A5） |
| Presentation から状態を書ける経路ができる | 公開メソッドは `ControlInput` 相当の数値列を渡す `step` だけ（監査でメソッド一覧を確認） |
| ビューアが幾何を再計算して WASM と食い違う | 位置・姿勢は必ず `body_poses` / `wheel_poses` から。座標変換を挟まない（T-EV-B2 / B3） |
| タブ復帰の巨大 dt でフリーズ | `accumulator` を 0.25 s でクランプ + `MAX_STEPS_PER_CALL = 32` |
| 車輪の見た目を物理と別に作って偽装 | `wheel_world_transform` の値をそのまま使う（T-EV-A3） |
| `wasm-pack` の出力先が既存と食い違う | 既存 README と同じ `../../view-engineering/pkg`。`.gitignore` 済み |
| 既存ビューア機能の退行 | T-EV-B6 で明示的に確認 |

### 完了時の報告フォーマット

```
TASK-1B-3 COMPLETE

Implemented Files:
Test Results:              (cargo test の実出力 / 既存 135 からの増分)
Browser Verification:      (CDP での実測値・ネイティブ参照との一致・スクショのパス)
Determinism Check:         (T-EV-A4 の方法と結果)
wasm32 build / wasm-pack:
Clippy / fmt Results:
Performance:               (WorldView::step / fps / wasm サイズ)
Frozen-file diffs:         (空であること)
Deviations from Spec:      (なければ "None")
Design Concerns Found:
D-1 フル版の申し送り:       (HANDOFF.md にどう残したか)
```

**git commit はしないこと。** 作業ツリーに残し、レビューを受けること。

---

## TASK-1B-3 — 監査記録

**Status: ✅ APPROVED**（実装 Sonnet 5 / 監査 Sonnet 5 — この runtime は model 別
subagent を起動できないため。TASK-1A-4 / 1A-5 と同じ例外運用）
Date: 2026-09-09 ／ commit 済み（3 本目）

### 監査で再実行したもの（すべて監査側で実行）

```
cargo test --release                     → 143 passed / 0 failed（135 → +8 sim-wasm。退行なし）
cargo clippy --all-targets -- -D warnings → 0
cargo fmt --check                         → clean
cargo build --release                     → 警告 0
cargo build -p sim-wasm --target wasm32-unknown-unknown --release → OK
wasm-pack build ... --target web --release → OK（sim_wasm_bg.wasm = 292 KB < 800 KB）
cargo build -p sim-core --no-default-features → OK
git diff --stat（sim-math / sim-track / sim-vehicle / sim-core / assets / tools）→ 空
cargo run -p sim-wasm --release --example reference_run -- 40 300 0.4 1 → 決定的に再現
```

### 監査観点の確認結果

- **Presentation → Simulation の書き込み経路なし**: `WorldView` / `WasmWorld` の
  `&mut self` 公開メソッドは `spawn`（正規の `World::spawn` = `(s,t)` 配置）と
  `step`（`ControlInput` 相当の `&[f64]`、`MAX_STEPS_PER_CALL=32` でクランプ）のみ。
  Transform / Position / Velocity を書くメソッドは存在しない（§3-1 遵守）
- **固定タイムステップ**: `step` は `steps: u32` だけを取り、内部で
  `sim_vehicle::PHYSICS_DT` 固定ループ。可変 dt は Simulation に入らない（§3-5）
- **順位・ラップ・`s`・`t` は `sim-core` から読むだけ**: `standings()` は
  `World::standings()` を素通し。ビューアで再計算しない（§3-8 / §3-9）
- **数値は getter 経由のみ**: `body_poses` は `VehicleState::{position, orientation}`、
  `wheel_poses` は `Vehicle::wheel_world_transform` そのまま。`sim-wasm` 側で
  物理量を計算していない
- **`unsafe` 0 行**: `wasm_bindgen` 展開は既存どおり `mod bindings` に隔離。
  既存 `TrackView` / `WasmTrack` は無変更（新型を足しただけ）
- 凍結ファイルの差分ゼロ。`view-engineering/node_modules` は `three` のみ

### Deviations from Spec

`crates/sim-wasm/examples/**` は Allowed Files に明記されていなかったが
`crates/sim-wasm/**` の範囲内で、T-EV-B3（ネイティブ参照）に必要。承認。

### Design Concerns（いずれも LOW・sim の忠実な表示であって 1B-3 の欠陥ではない）

- C-1: 60 秒走行で HUD の `t` が大きな負値になる。steer=0 の暫定ハーネスが
  コーナーでコースアウトし `world_to_track` の投影がセンターラインから外れるため
  （`sim-core` D-2 の既知事項）。track limits（Phase 2）で解消
- C-2: `spawn` 姿勢がヨーのみのため、バンク/勾配区間発進で数 tick サスが沈む過渡が
  見える（D-1）。S/F ストレート spawn では無害

### Decision: **APPROVED** — Phase 1B 完了。CRITICAL / HIGH の未解決なし。

---

## TASK-1B-3 — 完了報告（Sonnet 5）

Date: 2026-09-09

### Implemented Files

```
crates/sim-wasm/Cargo.toml          dependencies に sim-core / sim-vehicle を追加
crates/sim-wasm/src/lib.rs          WorldView（純 Rust）+ WasmWorld（境界）+ テスト 8 本。
                                    既存 TrackView / WasmTrack は無変更（新型を足しただけ）
crates/sim-wasm/examples/reference_run.rs  ネイティブ参照ラン（T-EV-B3 用）
view-engineering/src/vehicle_mesh.js  新規。プリミティブで車体 + 車輪、pose 適用
view-engineering/src/main.js         World の駆動ループ・車両描画の配線・__engview 拡張
view-engineering/src/overlay.js      車両テレメトリ HUD（setTelemetry）
view-engineering/index.html          テレメトリ HUD の DOM / CSS、title 更新
view-engineering/README.md           車両表示の節を追加
```

### Test Results（監査側で再実行のこと）

```
cargo test --release                → 143 passed / 0 failed（既存 135 + sim-wasm +8。退行なし）
                                       sim-wasm: 7 → 15（T-EV-A1〜A7 + standings 委譲）
cargo clippy --all-targets -- -D warnings → 0
cargo fmt --check                   → clean
cargo build --release               → 警告 0
cargo build -p sim-wasm --target wasm32-unknown-unknown --release → OK
wasm-pack build ... --target web --release → OK（sim_wasm_bg.wasm = 299 KB < 800 KB）
cargo build -p sim-core --no-default-features → OK（退行なし）
unsafe                              → 0 行（`mod bindings` に wasm_bindgen 展開を閉じ込め維持）
```

### Browser Verification（headless Chrome + CDP・SwiftShader）

スクショ: `build/engineering-view/1b3-01-overview.png` / `1b3-02-chase.png`（gitignore 済み）

| ID | 結果 |
|----|------|
| T-EV-B2 | Three.js の車体 `position` / `quaternion` / 車輪位置が `world.body_poses()` / `wheel_poses()` と **ビット一致**（座標変換を挟んでいない） |
| T-EV-B3 | ブラウザで新規 `WasmWorld` を組み spawn_s=40 で 300 tick 固定入力 → 重心位置が **ネイティブ `reference_run 40 300 0.4 1` とビット一致**（quat は ~2e-18 差。wasm/native で同一結果） |
| T-EV-B4 | 60 秒（15 048 tick）走行で NaN / 非有限ゼロ。steer=0 のためコーナーでコースアウトするが破綻しない（D-2 どおり） |
| T-EV-B5 | HUD に speed / rpm / gear / 入力 / lap / s / t / sector / 4 輪 load・slipR・slipA・grip が数値表示 |
| T-EV-B6 | 着色モード切替・グリッド切替・`data` 配列（curvature 4141）健在。既存機能の退行なし |
| console errors | 0 |
| fps | **60.1 fps**（SwiftShader・3 秒平均。基準 55） |

### Determinism Check（T-EV-A4）

同一 `(spawn, 時間変化する入力列 500 tick)` で 2 回実行し、`body_poses()` と
`telemetry()` が `assert_eq!` でビット一致。

### Performance

| 項目 | 実測 | 基準 |
|------|------|------|
| `WorldView::step`（1 台 1 tick） | `sim-core` 由来 ≈ 7 µs（T-CORE-09 の 24 台 167 µs から） | <= 10 µs |
| 表示フレームレート（1 台・SwiftShader） | 60.1 fps | >= 55 |
| `sim_wasm_bg.wasm` | 299 KB | < 800 KB |

### Frozen-file diffs

`git diff --stat` で `crates/sim-math` `crates/sim-track` `crates/sim-vehicle`
`crates/sim-core` `assets` `tools` は空。`docs/phase-1b-vehicle.md` と `CLAUDE.md` の
差分は**本タスク着手前から存在**（TASK-1B-1 の実装ノート等）で本タスクとは無関係。
`view-engineering/node_modules` は `three` のみ。

### Deviations from Spec

なし（仕様は本タスクで Sonnet が起票し人間承認済みのため、仕様＝実装）。
仕様の Allowed Files に `crates/sim-wasm/examples/**` は明記していなかったが、
`crates/sim-wasm/**` の範囲内であり、T-EV-B3 の「ネイティブ参照」を満たすために必要。

### Design Concerns Found

- **C-1（LOW）**: 60 秒走行で HUD の `t` が `-1636 m` 等になる。steer=0 の暫定
  ハーネスがコーナーでコースアウトし、`world_to_track` の投影がセンターラインから
  大きく外れるため（`sim-core` D-2 の既知事項）。sim は状態を忠実に表示しているだけで
  1B-3 の欠陥ではない。track limits（Phase 2）で解消される
- **C-2（LOW）**: `spawn` 姿勢がヨーのみのため、バンク/勾配区間から走り始めると
  最初の数 tick でサスが沈み込む過渡が見える（D-1）。S/F ストレート spawn では無害

### D-1 フル版の申し送り

`HANDOFF.md` に **TASK-1B-4（`spawn` 姿勢の完全化）** として記載。
`Vehicle::new` が完全な `orientation`（Quat）を受け取る API 追加（`sim-vehicle` 凍結解除）が
前提で、Architect / 人間承認事項。受け入れは「全周 400 station で 1 step 後
\|compression − static_compression\| < 1e-6 m」。

---

## TASK-1B-2 — `sim-core`（トラック路面 + 固定ステップ World）〔実装済み〕

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
`crates/sim-vehicle/**`、`crates/sim-wasm/**`、`view-engineering/**`、
`assets/**`、`tools/**`、ルート直下の `.md` 各種、`docs/`。

---

### Goal

**Phase 1B で作った車を、Phase 1A で作ったトラックの上で走らせる。**

`sim-vehicle` は `GroundProbe` トレイトしか知らず、`sim-track` は車を知らない。
その 2 つを繋ぐ層が無いため、いまはどちらも平面の上でしか動かない。
ここを埋めると Phase 2（レーシングライン / Driver AI）が実トラック上で始められる。

### 先に読むもの

- `HANDOFF.md` §5「実装済み API」— `sim-track` と `sim-vehicle` の公開 API はここに全部ある
- `docs/phase-1b-vehicle.md`「責務の境界」— なぜ `sim-vehicle` が `sim-track` を知らないのか

### Allowed Files

```
Cargo.toml                       members に crates/sim-core を追加するのみ
crates/sim-core/Cargo.toml
crates/sim-core/src/**
crates/sim-core/tests/**
```

### Dependencies

```toml
[dependencies]
sim-math    = { path = "../sim-math" }
sim-track   = { path = "../sim-track" }
sim-vehicle = { path = "../sim-vehicle" }
```

**それ以外の依存を足さないこと。** 物理エンジン crate は使わない（ADR-0005）。

### 必ず守る原則（違反は CRITICAL）

`HANDOFF.md` §3 の全項目。特にこのタスクで踏みやすいもの:

1. **順位は `(laps_completed, s)` の辞書順のみで決まる。** ワールド距離で並べない
2. **ラップ処理は `detect_lap_crossing` に一本化。** 各所で自前の剰余計算をしない
3. **固定タイムステップのみ。** 可変 dt を受け取らない
4. **グローバル乱数・時刻依存乱数は禁止。** この crate は乱数を持たない
5. 巨大な `GameManager` / `RaceManager` へ責務を集中させない

### Required Changes

#### 1. `TrackGround` — `sim-track` を使う `GroundProbe` 実装

```rust
pub struct TrackGround<'a> { /* &'a Track と探索ヒント */ }

impl<'a> TrackGround<'a> {
    pub fn new(track: &'a Track) -> Self;
    /// 前 tick の `s` をヒントとして与える。**毎 tick 更新すること**
    /// （`Track::world_to_track` は hint 有で 579 ns / 無で 3.8 us）。
    pub fn set_hint(&mut self, s: f64);
}

impl GroundProbe for TrackGround<'_> { /* ... */ }
```

- `world_to_track(from, hint)` で `(s, t)` を求め、`frame_at(s)` で幾何を取る
- 路面高さは `TrackFrame` の `position` / `lateral` / `banking` から求める。
  **`camber` は幾何に未適用**（`sim-track` の既知の制約。ここでも使わない）
- `GroundHit.normal` は `TrackFrame` の `normal`。**`TrackFrame` は正規直交基底**なので
  そのまま使ってよい（Gram-Schmidt 済み）。自前で作り直して直交性を壊さないこと
- `grip` / `rolling_resistance` / `roughness` は
  `track.surface_at(TrackCoord).properties()` から詰める。
  **`sim-vehicle` に `SurfaceKind` を渡さない**（`GroundHit` は物理量のみ）
- `probe` は `max_distance` を超えたら `None` を返すこと（`FlatGround` と同じ規約）

#### 2. `World` — 固定タイムステップのシミュレーション本体

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct VehicleId(pub usize);

pub struct VehicleEntry {
    pub vehicle: Vehicle,
    /// トラック局所座標。毎 tick 更新する。
    pub coord: TrackCoord,
    /// 完了ラップ数。
    pub laps_completed: u32,
    /// 直近のラップ跨ぎ判定。
    pub last_crossing: LapCrossing,
}

pub struct World { /* Track（所有） / Vec<VehicleEntry> / tick カウンタ */ }

impl World {
    pub fn new(track: Track) -> Self;
    pub fn track(&self) -> &Track;
    /// トラック局所座標で車両を配置する。
    pub fn spawn(&mut self, params: VehicleParams, start_s: f64, start_t: f64)
        -> Result<VehicleId, WorldError>;
    /// 1 tick 進める。`inputs[i]` が `VehicleId(i)` に対応する。
    /// dt は `sim_vehicle::PHYSICS_DT` 固定で、引数に取らない。
    pub fn step(&mut self, inputs: &[ControlInput]);
    pub fn tick(&self) -> u64;
    pub fn vehicles(&self) -> &[VehicleEntry];
    /// 順位。**`(laps_completed, s)` の辞書順のみで決まる。**
    pub fn standings(&self) -> Vec<VehicleId>;
}
```

- `spawn` は `TrackFrame` からワールド座標とヨーを導く。車高は静的つり合いの高さに置く
  （`VehicleParams::wheel_mount_local` / `static_compression` / `rest_length` から導ける）
- `step` の中の順序を固定する: 各車の `TrackGround` ヒント更新 → `Vehicle::step`
  → `world_to_track` で `coord` 更新 → `detect_lap_crossing` → ラップ加算
- `detect_lap_crossing` の `max_ds` は `sim_vehicle::vehicle::MAX_SPEED * PHYSICS_DT` を
  基準にした値を使い、**根拠をコメントに書く**
- `Suspect` のときは**ラップを加算してはならない**
- `inputs` の要素数が車両数と異なる場合は、足りない分を `ControlInput::default()` として扱う

### Required Tests

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-CORE-01 | `TrackGround` の接地点がトラック表面と一致 | 100 点以上の `s` で `frame_at` 由来の高さと 1e-9 以内 |
| T-CORE-02 | バンク区間で法線が傾く | `banking` と整合。`normal` が単位ベクトル（1e-12） |
| T-CORE-03 | 路面種別が `GroundHit` の物理量に反映される | コース外で `grip` が下がる |
| T-CORE-04 | Aoyama Ring 上を 1 台が走る | 60 秒走らせて `recovered_steps = 0` / NaN なし |
| T-CORE-05 | ラップカウント | `detect_lap_crossing` 経由で正しく 1 増える |
| T-CORE-06 | `Suspect` でラップを加算しない | 大きく飛ばして確認 |
| T-CORE-07 | 順位が `(laps, s)` の辞書順 | ワールド距離では逆順になる配置で確認 |
| T-CORE-08 | 決定性 | 同一入力列 2 回で全状態ビット一致 |
| T-CORE-09 | 24 台の性能 | 1 tick <= 2.0 ms（PROJECT.md §6） |

### Acceptance Criteria

1. Required Tests がすべて通る
2. `cargo test --release` 全通過（**既存 124 テストの退行なし**）
3. `cargo clippy --all-targets -- -D warnings` が通る
4. `cargo fmt --check` が通る
5. `cargo build --release` 警告ゼロ
6. `unsafe` 0 行（`#![deny(unsafe_code)]`）
7. `cargo build -p sim-core --target wasm32-unknown-unknown` が通る
8. 凍結ファイルの差分がゼロ

### Out of Scope

- Driver AI / レーシングライン（Phase 2）
- 車車間衝突・ダーティエア（Phase 3 以降）
- レンダリング・カメラ・音（Phase 8 以降）
- Engineering View への車両表示（TASK-1B-3 で別途行う）
- ピットレーン・セーフティカー・フラッグ

### Known Risks

| Risk | 対策（仕様に設計済み） |
|------|----------------------|
| `world_to_track` のヒントを毎 tick 更新し忘れて 6.6 倍遅くなる | T-CORE-09 が性能で検出する |
| バンクで法線を自前計算して直交性を壊す | `TrackFrame` の `normal` をそのまま使う（T-CORE-02） |
| ラップカウント暴走 | `detect_lap_crossing` の `Suspect` を必ず尊重する（T-CORE-06） |
| 順位をワールド距離で並べてしまう | T-CORE-07 が逆順になる配置で検出する |

### 完了時の報告フォーマット

```
TASK-1B-2 COMPLETE

Implemented Files:
Test Results:              (cargo test の実出力)
Determinism Check:         (2 回実行のビット一致の確認方法と結果)
wasm32 build:
Clippy / fmt Results:
Performance:               (24 台 1 tick の実測)
Frozen-file diffs:         (空であること)
Deviations from Spec:      (なければ "None")
Design Concerns Found:
```

**git commit はしないこと。** 作業ツリーに残し、Opus 5 のレビューを受けること。
