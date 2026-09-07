# HANDOFF.md — 引き継ぎ資料

Last updated: 2026-09-07
このファイルは **セッションを跨いで作業を再開するための単一の入口**である。
新しいセッション / 別の AI は **まずこれを読むこと。**

---

## 0. 30 秒で把握する

- **何を作っているか**: Realistic Race Spectator Simulator。プレイヤーは運転せず**観戦**する。
  目標は「実際のモータースポーツ中継に見え、よく見ると各 AI が本当にレースをしている」こと
- **今どこか**: **Phase 1A（Track Foundation）進行中**。Phase 0（設計）と `sim-math` / `sim-track` は完了
- **次に何をするか**: **TASK-1A-3**（トラック JSON ロード + オリジナル・サーキット 1 本）。
  完全な実装仕様は `TODO.md` の `# NEXT SONNET TASK` セクションにある
- **役割**: Opus 5 = Architect / Reviewer / Quality Gate。Sonnet 5 = Implementation Engineer。
  重大な技術変更は人間の承認が必要

---

## 1. ドキュメントの読む順番

| # | File | 役割 |
|---|------|------|
| 1 | **`HANDOFF.md`**（本書） | 再開の入口。現在地と作業手順 |
| 2 | `PROJECT.md` | 目的・品質目標・性能予算・不可侵原則 |
| 3 | `ARCHITECTURE.md` | 現在の Architecture。**§3 §4 §6 §12 は必読** |
| 4 | `TODO.md` | 現在のタスクと**次の実装仕様の全文** |
| 5 | `DECISIONS.md` | ADR-0000〜0006。なぜこの技術選定なのか |
| 6 | `PLAN.md` | Phase 0〜12 のロードマップと Risk Register |
| 7 | `TESTING.md` | Test Strategy と受け入れ基準 T-TRK / T-VEH / T-AI / T-RACE |
| 8 | `docs/phase-0.5-tasks.md` | TASK-05-1 / TASK-05-2 の実装仕様（UE5 / Blender） |

**Documentation Rule**: コードと文書が矛盾したら、どちらかを推測で正としない。
実装 / Git History / Runtime Behaviour / Tests から裏付けを取る。

---

## 2. 現在の状態

### 完了済み

| Task | 内容 | 状態 | Commit |
|------|------|------|--------|
| Phase 0 | Discovery / Architecture / 6 文書 | ✅ | `9c13af8` |
| ADR-0004/0005/0006 | UE5 / Rust / 自作アセットの決定 | ✅ 人間承認済 | `856d0bd` |
| TASK-1A-1 | `sim-math`（数学基盤・決定的 RNG） | ✅ APPROVED | `85f6c6f` |
| TASK-1A-2 | `sim-track`（トラック局所座標系） | ✅ APPROVED | `4fc4c48` |

### 検証コマンド（再開時に必ず実行して健全性を確認すること）

```bash
cd /c/AI/App_Dev/Racing
cargo test --release      # 55 passed / 0 failed が期待値
cargo clippy --all-targets -- -D warnings   # 0
cargo build --release     # warnings 0
cargo fmt --check         # clean
```

期待値: **55 tests**（sim-math 38 + sim-track 16 + doc-test 1）。
これを下回る / 失敗する場合は、先に原因を特定すること。新機能より退行の解消が優先。

### 実装済みの crate

```
crates/sim-math/   Vec2/Vec3, Quat(YXZ), CubicSpline, ArcLengthSpline, Rng, util
                   依存ゼロ / unsafe ゼロ / #![deny(unsafe_code)]
crates/sim-track/  TrackCoord{s,t}, TrackFrame, SurfaceKind, TrackDefinition,
                   Track(build/frame_at/track_to_world/world_to_track/...),
                   detect_lap_crossing
                   依存は sim-math のみ
```

**`crates/sim-math` は APPROVED 済みで凍結中。** 変更が必要なら `BLOCKED BY ARCHITECTURE` として起票する。

---

## 3. 作業の進め方（この契約を守ること）

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
に加えて、**IMPORTANT IMPLEMENTATION CONTRACT**（設計変更禁止 / `PROPOSED DESIGN CHANGE` /
`BLOCKED BY ARCHITECTURE` / リファクタリング禁止）の全文。

`TODO.md` の TASK-1A-3 セクションがそのままテンプレートとして使える。

### 監査で必ず確認すること

1. `git diff --stat` で**スコープ外のファイルが変更されていないか**
2. 凍結 crate（`sim-math`）の差分が空か
3. テスト / clippy / fmt / warnings を**自分で再実行**する（報告を鵜呑みにしない）
4. 新しいテストが**実質的か**（修正前なら落ちるか）を確認する
5. 報告された「根本原因」が正しいか。**疑わしければ自分で計測する**

Severity は `CRITICAL / HIGH / MEDIUM / LOW`。
**CRITICAL または HIGH が残っている Phase を Complete にしてはならない。**

---

## 4. 実行環境（実測済み・推測しないこと）

| 項目 | 値 |
|------|-----|
| GPU | **NVIDIA RTX 4060 Ti 8 GB** ← 最大のハード制約。全ての映像設計がこれに従う |
| CPU / RAM | AMD Ryzen 7 5700X (8C/16T) / 32 GB |
| OS / Shell | Windows 11 / PowerShell 5.1 + Git Bash |
| Rust | 1.95.0（stable, `rust-toolchain.toml` で固定） |
| Unreal Engine | **5.8** — `C:\Program Files\Epic Games\UE_5.8` |
| UE ヘッドレス | `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe` |
| Blender | **5.2.1 LTS**（Microsoft Store / MSIX 版）— 起動方法は下記 |

### Blender の起動方法（厳守）

```
%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe ^
    --background --factory-startup --python <script.py> -- <args...>
```

- **実行体を直接叩かないこと。** `C:\Program Files\WindowsApps\...\Blender\blender.exe` は
  存在するが ACL により **Access Denied** になる。必ずエイリアス経由
- **stdout / stderr は転送されない（0 バイト）。** `print()` は届かない
- したがって Blender スクリプトは **必ず JSON サマリファイルを書き出す**こと。
  呼び出し側は「終了コード」と「サマリファイルの内容」の両方で成否を判定する
- 動作確認済み: `bpy` 利用 / `--` 以降の引数受け渡し / メッシュ生成 / **glTF(GLB) エクスポート**

詳細は `DECISIONS.md` の「ADR-0006 追記」を参照。

---

## 5. 次にやること

### TASK-1A-3（次の実装タスク）

**仕様の全文は `TODO.md` の `# NEXT SONNET TASK` にある。** そのまま Sonnet へ渡せる。

概要: `sim-track` に optional feature `serde` を追加し、トラック定義を JSON から
ロードできるようにする。あわせて**オリジナルのテスト用サーキット 1 本**
（`assets/tracks/aoyama_ring.track.json`）を作る。

- 形式は **JSON**。RON ではない。**Blender Python と Engineering View(JS) が
  追加ライブラリなしで同じファイルを読む必要がある**ため。これは決定事項
- serde は `optional` + feature 越し。`--no-default-features` で依存ゼロの core が残ること
- サーキットは全長・コーナー半径・高低差・バンク・幅まで数値要件があり、**テストで機械検証**させる

### その後の予定

| Task | 内容 |
|------|------|
| TASK-1A-4 | `sim-wasm` + `view-engineering`（Three.js テレメトリビューア。**デバッグ専用・製品レンダラではない**） |
| TASK-05-1 | UE5 プロジェクトの Code-First 構築 + M1〜M9 実測 — **仕様は `docs/phase-0.5-tasks.md`** |
| TASK-05-2 | Blender 車両生成パイプライン — **仕様は `docs/phase-0.5-tasks.md`**（先に着手可） |
| Phase 1B | `sim-vehicle`（サスペンション + Pacejka タイヤ + パワートレイン + 空力） |

Phase 1A 完了の判定基準は `TESTING.md` の T-TRK-01〜06 と `PLAN.md` Phase 1A の Acceptance。

---

## 6. 再導出すると高くつく知見（重要）

### 設計上の要点

- **トラック上の位置は Waypoint index ではなく連続量 `s`（弧長 [m]）。**
  これが「Waypoint index が暴走する」類のバグを構造的に防ぐ根拠
- **ラップ処理は `wrap_s` / `signed_delta_s` に一本化する。** 各所で自前の剰余計算をしない
- **順位は `(laps_completed, s)` の辞書順のみで決まる。** ワールド距離で並べない
- **曲率の符号**: 左カーブが正。`lateral = up.cross(tangent)` は標準的な CCW 左法線とは
  **逆手系**なので、`perp_dot` の引数順は `diff.perp_dot(tangent)`。
  逆にすると符号が反転する（TASK-1A-2 で実際に踏んだ）
- **`TrackFrame` は正規直交基底。** `tangent`/`lateral`/`normal` を個別に lerp して個別に
  正規化すると、バンク変化や 3D ねじれで直交性が崩れる（実測 |N·T| = 1.8e-5）。
  Gram-Schmidt で直交化し `normal = tangent.cross(lateral)` で導出すること
- **`camber` は現在データとして保持のみで、幾何には未適用。** 下流はこれを前提にしないこと

### 性能基準の考え方

性能基準は**予算から導出すること。** 恣意的な数値を置かない。
例: `closest_s` は当初 200 ns としたが根拠が無く、実測 420 ns。
実際の呼び出しは 24 台 × 60 Hz = 1440 call/s で予算比 2% だったため
「< 1 µs」へ改めた。**基準を緩めるときは必ず予算に基づく根拠を書く。**

逆に、**仕様に明記された受け入れ数値を実装者が勝手に緩めるのは設計変更**であり、
`PROPOSED DESIGN CHANGE` として事前に起票させること（TASK-1A-2 で実際に発生した）。

### 環境上の落とし穴

- **Bash の heredoc がこの環境では長文・特殊文字で失敗することがある**
  （`unexpected EOF while looking for matching quote`）。
  長いファイルは **Write ツール**で書くか、scratchpad にファイルを作って `cat >>` で連結する
- **PowerShell 5.1 には `if` 式がない。** `$x = if (...) {...}` はパースエラー。
  `&&` `||` も使えない。`;` と `if ($?) { }` を使う
- `git` の `LF will be replaced by CRLF` 警告は無害。無視してよい
- 一時ファイルは scratchpad ディレクトリへ置く（プロジェクトを汚さない）

---

## 7. 人間の判断が必要な事項

| # | 内容 | 状態 |
|---|------|------|
| H-1 | Simulation Core の言語 = Rust | ✅ 承認済（ADR-0001/0005） |
| H-2 | 製品レンダラ = Unreal Engine 5（Code-First 制約つき） | ✅ 承認済（ADR-0004） |
| H-3 | アセットは自作（Blender headless + Python） | ✅ 承認済（ADR-0006） |
| H-4 | Phase 0.5 の M1〜M9 実測結果に基づく UE5 続行判定 | ⏳ Phase 3 完了時が期限 |

以下は Opus 単独で実行してはならない（`PROJECT.md` §10）。
Game Engine 変更 / 言語変更 / 主要フレームワーク置換 / 物理アーキテクチャ置換 /
リポジトリ全体の書き換え / プロジェクト目標の変更。

---

## 8. 絶対に破ってはいけない原則（`PROJECT.md` §4 §5 より）

1. **AI が Vehicle の Transform / Position / Velocity を直接書き換えてはならない。**
   AI が出せるのは `steering / throttle / brake / gear / clutch / drs` のみ
2. **Lap Time を乱数生成して順位を決めてはならない。** 結果は Tick の積み重ねから創発させる
3. 乱数は「結果」ではなく「原因」に作用させる（reaction / decision / confidence / risk /
   mistake / precision / consistency）
4. **Simulation Core は Rendering / UI / Camera を知らない。** crate 依存グラフで機械的に強制する
5. 固定タイムステップのみ。可変 dt を Simulation Core に入れない
6. グローバル乱数・時刻依存乱数は禁止。すべて `Rng` の明示的な派生で

違反はレビューで **CRITICAL** 判定。
