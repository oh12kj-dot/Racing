# DECISIONS.md — Architecture Decision Record

各 ADR は次を必ず含む:
`Current State / Problem / Requirements / Alternatives / Pros / Cons / Migration Cost / Migration Risk / Expected Benefit / Recommendation / Status`

Status 種別: `PROPOSED` / `AWAITING HUMAN APPROVAL` / `ACCEPTED` / `REJECTED` / `SUPERSEDED` / `DEFERRED`

---

## ADR-0000: Discovery Baseline — 本プロジェクトは Greenfield である

- **Date**: 2026-09-06
- **Status**: ACCEPTED

### Current State
`C:\AI\App_Dev\Racing` は監査時点で**完全に空**（隠しファイル・git リポジトリを含め 0 件）。

### Problem
初期指示には「AI車両がコースを無視する / Waypoint へ過剰に向かう / Steering が不自然 / Waypoint index が暴走する」等の
既存不具合が存在する可能性が示されていた。

### 検証結果
既存コードが存在しないため、これらは**現存する不具合ではない**。
ただし当該不具合群は Waypoint 追従型 AI の典型的失敗モードであり、
**再発防止すべき既知のアンチパターン**として Architecture 制約に昇格させる（ARCHITECTURE.md §Racing Line / §Driver AI）。

### Decision
- 既存コード監査・再利用分析・技術的負債分析は **N/A（対象なし）**
- 「以前そうだったはず」を根拠に設計しない。上記は Architecture 制約として明文化する
- 環境実測値（RTX 4060 Ti 8GB / Ryzen 7 5700X / 32GB RAM）を Performance Budget の基準とする

---

## ADR-0001: Simulation Core は Rust の engine-agnostic な headless crate とする

- **Date**: 2026-09-06
- **Status**: **ACCEPTED**（人間承認済み 2026-09-06。ADR-0005 で UE5 採用下でも再確認）

### Current State
コードなし。言語未選定。

### Problem
本プロジェクトは相反する 2 つの要求を同時に満たす必要がある。

1. **Simulation** — 決定的・テスト可能・高信頼。コード量の 60〜70% を占め、反復回数が最も多い
2. **Photorealism** — レンダリングエンジンの機能とアセット品質に依存し、コードで解決する部分は小さい

この 2 つで最適な技術が**一致しない**。Photorealism に最良の環境（Unreal Engine / C++ / エディタ中心）は、
AI エージェント主導の実装・テスト反復には最悪に近い（ビルド数分、バイナリ .uasset、エディタ GUI 必須）。

### Requirements
- R1: Rendering / UI / Camera への依存ゼロ（PROJECT.md Q6）
- R2: ビット一致の決定的再現（Q8）
- R3: headless でのユニット / シナリオテストが高速に回る
- R4: 24 台 × 240 Hz 物理を 2 ms 以内（Q7）
- R5: GC による stop-the-world hitch がない（Q5）
- R6: 将来 UE5 / Unity / Web いずれのレンダラにも**書き直さず**接続できる
- R7: AI エージェント（Sonnet 5）が高い正確性で実装でき、Opus のレビュー負荷が小さい

### Alternatives

| 案 | R1 | R2 | R3 | R4 | R5 | R6 | R7 |
|----|----|----|----|----|----|----|----|
| A. **Rust crate（推奨）** | ◎ | ◎ | ◎ | ◎ | ◎ | ◎ FFI 必要 | ○ |
| B. C++20 crate | ◎ | ◎ | ○ | ◎ | ◎ | ◎ UE と同一言語 | △ UB リスク |
| C. C# class library (Unity 前提) | ◎ | ○ | ◎ | ○ | △ GC | △ UE へは不可 | ◎ |
| D. TypeScript (Web 前提) | ◎ | ○ | ◎ | △ | △ GC | ✕ 要書き直し | ◎ |

### Pros（案 A: Rust）
- **メモリ安全性・データ競合の不在がコンパイル時に保証される。** AI が書いたコードを Opus が全件レビューする本体制では、
  「Simulation が破綻する」クラスのバグ（dangling ref / iterator invalidation / UB / data race）が
  **原理的に混入し得ない**ことの価値が非常に大きい。レビュー面積が実質的に縮小する
- `cargo test` による高速な headless テスト。Scenario Test / Determinism Test の基盤として最良
- GC なし・予測可能なフレームタイム
- **移植性が最も広い**: `wasm32` (Engineering View), C-ABI `cdylib` (UE5 / Unity / Godot いずれにも接続可)
- 数値型・オーバーフロー・浮動小数の扱いが厳密で、決定性の担保がしやすい

### Cons（案 A: Rust）
- **UE5 を最終レンダラに選んだ場合、C FFI 境界の実装・保守コストが発生する**（案 B なら不要）
- Rust に不慣れな実装者では 1 タスクあたりの実装速度が C#/TS より落ちる
- Rust エコシステムに既製のレースゲーム資産はほぼ無い（ただし本 crate は自作前提なので影響小）

### Migration Cost / Risk
Greenfield のため **Migration Cost = 0**。ただし後から言語を変えると Simulation Core 全体の書き直しになるため、
**この決定は事実上不可逆**。よって人間承認を必須とする。

### Mitigation（Cons への対処）
`sim-ffi`（C-ABI ラッパ crate）を **Phase 1 の時点で最小構成で作り、UE/Unity 接続可能性を早期に実証する**。
FFI 境界を Phase 8 まで先送りして「後から繋がらない」事故を防ぐ。

### Expected Benefit
Simulation Core がレンダリングエンジンから完全に独立することで、
**エンジン選定が「全プロジェクトを賭ける決断」から「プレゼンテーション層だけの決断」に格下げされる。**
これが本プロジェクト最大のリスク低減施策である。

### Recommendation
**案 A（Rust）を採用する。**

案 B（C++20）を選ぶべき条件 — 人間が以下に該当すると判断する場合は B に切り替えるべき:
- UE5 を最終レンダラとすることが**既に確定**しており、かつ
- FFI 境界の保守コストを Rust の安全性メリットより重く見る場合

---

## ADR-0002: Photorealistic Renderer の選定を Phase 0.5 スパイクまで意図的に保留する

- **Date**: 2026-09-06
- **Status**: **PARTIALLY SUPERSEDED by ADR-0004**（Godot / Web の除外は有効。UE5 vs Unity の保留は解除され UE5 に確定）

### Current State
エンジン未選定。開発機に Unreal / Unity / Godot いずれもインストールされていない。

### Problem
Photorealism を担うエンジンは、実際のワークロード（24 台・トラック・放送カメラ・8GB VRAM）で
評価しなければ正しく選べない。にもかかわらず、エンジン選定は最も不可逆な決断である。

一方で ADR-0001 により Simulation Core はエンジン非依存なので、
**Phase 1〜5（プロジェクトの最難関部分）はエンジン選定なしで進行できる。**

### Requirements
- 24 台の photorealistic 車両、1080p60、VRAM 7 GB 以内
- 物理ベースのカーペイント（clear coat / metallic flake）、カーボン、ガラス、ブレーキディスク
- 動的太陽 / 大気 / 間接光 / 高品質反射
- **実焦点距離・絞り・センサーサイズを持つ物理カメラ**（放送カメラ言語のために必須）
- 高品質なパーオブジェクト Motion Blur と、回転ホイールで破綻しない Temporal 処理
- AI エージェントによるテキストベース実装との相性

### Alternatives

| Engine | Visual Fidelity | Lighting | Materials | 物理カメラ | 8GB 適合 | AI Coding 相性 | Editor 依存 |
|--------|-----------------|----------|-----------|-----------|---------|---------------|------------|
| **Unreal Engine 5.5+** | ◎ 最高 | ◎ Lumen HW-RT | ◎ 自動車系が強い | ◎ CineCamera | △ 要規律 | **△ 最弱** | 高（.uasset バイナリ） |
| **Unity 6 HDRP** | ○ 高 | ○ RTGI/RT Reflection | ○ ClearCoat Lit | ◎ Physical Camera | ○ | **◎ 最強**（.unity/.prefab は YAML テキスト、コード生成可） | 中 |
| Godot 4.x | △ | △ SDFGI ノイジー / HW-RT なし | △ | △ | ◎ | ◎ | 低 |
| Web 3D (Three/Babylon + WebGPU) | ✕ | ✕ | △ | ✕ | ◎ | ◎ | なし |

### Cons（各案）
- **UE5**: 8GB VRAM で Nanite + VSM + Lumen は余裕が薄い。何よりマテリアル・ライティング・トラック配置・カメラリグの
  大部分が**エディタ GUI 作業**であり、AI エージェントが実行できない。人間が全アセット作業のボトルネックになる
- **Unity 6 HDRP**: 映像の最高到達点は UE5 に一歩劣る。HDRP のセットアップは複雑。RT 機能の成熟度が UE より低い
- **Godot 4**: Photorealism 要件（Q3）を満たせない。**主レンダラとしては不採用**
- **Web 3D**: Q3 を満たせない。**主レンダラとしては不採用**

### Decision（本 ADR で決めること）
1. **Godot 4 と Web 3D を主レンダラ候補から除外する**（Q3 を満たせないことが明確なため）
2. **UE5 と Unity 6 HDRP の二者択一を Phase 0.5 スパイクの実測結果まで保留する**
3. スパイクの評価軸と合否基準を先に確定する（下記）
4. **決定期限を Phase 3 完了時とする。**それ以降の保留は禁止（保留の恒久化を防ぐガード）

### Phase 0.5 Renderer Spike — 評価プロトコル
両エンジンで**同一の最小シーン**を構築し実測する。

シーン内容: 直線 + 1 コーナー、車両 24 台（うち 6 台は近景 LOD0）、動的太陽、路面、ガードレール、放送カメラ 1 台

| 評価軸 | 測定方法 | 合格基準 |
|--------|---------|---------|
| M1 Visual Fidelity | 同一構図の静止画比較（人間判定） | 実写中継のスクショと並べて遜色ないか |
| M2 車体反射品質 | クリアコート面の反射の安定性 | 走行中に反射がちらつかない |
| M3 GPU frame time | エンジン内プロファイラ | <= 14.0 ms @1080p DLSS Quality |
| M4 VRAM | nvidia-smi 実測 | <= 7.0 GB |
| M5 Motion Quality | 高速パン + 回転ホイールの録画確認 | ghosting / smearing / ホイール artifact なし |
| M6 物理カメラ | 焦点距離 300mm 相当の望遠ショット | 実際の中継の圧縮感が再現できる |
| M7 **AI Coding 適合度** | 「車両 1 台をコードのみで配置しマテリアルを設定」を Sonnet が実行 | **人間のエディタ作業なしで完了できるか** |
| M8 外部 Sim 接続 | `sim-ffi` 経由で Rust core から Transform を受け取り描画 | 動作すること |

**M7 は本プロジェクト固有の最重要軸である。** 一般的なエンジン比較記事には現れないが、
実装主体が AI エージェントである以上、ここで劣るエンジンは実際の開発速度で大きく不利になる。

### Migration Cost / Risk
ADR-0001 が承認されている限り、**エンジン変更コストは Presentation 層のみ**に限定される
（Simulation Core・テスト・トラックデータ・AI ロジックは影響を受けない）。
これがエンジン選定を後回しにできる根拠であり、同時にこの ADR の前提条件である。

### Expected Benefit
- 推測ではなく**実測**でエンジンを選べる
- Phase 1〜5（最難関）を、エンジンのインストール・学習・エディタ作業に一切ブロックされず進行できる
- 「Unreal の方が高性能そう」という理由での選定を構造的に排除できる

### Recommendation
**保留を承認し、Phase 0.5 スパイクを Phase 1〜2 と並行実施する。**
現時点の暫定的な見立て: **M1〜M6 は UE5 有利、M7 は Unity 6 が大幅有利。** M7 の実測結果が決定を左右する。

---

## ADR-0003: Engineering View（Rust->WASM + Three.js）を恒久的なデバッグ基盤として構築する

- **Date**: 2026-09-06
- **Status**: ACCEPTED（ADR-0001 承認により確定 2026-09-06）

### Problem
ADR-0002 でエンジン選定を保留する場合、Phase 1〜5 の間、シミュレーションを**目視確認する手段が必要**になる。

### Decision
Simulation Core を `wasm32` にビルドし、ブラウザ上の軽量ビューア（Three.js）で可視化する
**Engineering View** を構築する。

表示内容（product renderer ではなく**計測器**として設計する）:
- トラック centerline / corridor 境界 / racing line
- 車両の位置・ヨー・スリップアングルベクトル
- タイヤ荷重・グリップ円の使用率
- Driver AI の decision state / target trajectory / target speed
- ステアリング・スロットル・ブレーキのトレース
- Gap / Interval / 順位テーブル
- タイムライン スクラブ（Replay の前身）

### Rationale — なぜこれが「二重の作業」でないか
Engineering View は**エンジン選定と無関係に必要**である。
PROJECT.md / TESTING.md が要求する検証（steering の連続性、コース逸脱、AI シナリオ判定、
Waypoint index の暴走検出）は、テレメトリ可視化なしでは実務上不可能。
実在のレースシムはすべて同等のデバッグビューアを持つ。

**Engineering View は製品レンダラではない。** 見た目の品質改善に工数を割いてはならない。
Photorealism は選定されたエンジン側でのみ追求する。

### Cons
- Presentation 層が最終的に 2 つ存在することになる（Engineering View と製品レンダラ）
- WASM ビルドターゲットの維持コスト

### Recommendation
採用する。ただし **Engineering View への装飾的作業は明確に禁止**とし、
機能追加はテレメトリ・検証目的に限定する。

---

## ADR-0004: Unreal Engine 5 を製品レンダラとして採用し、Code-First 運用を必須制約とする

- **Date**: 2026-09-06
- **Status**: **ACCEPTED**（人間承認済み: 2026-09-06）
- **Supersedes**: ADR-0002 の「二者択一を保留する」部分

### Current State
人間より UE5 を製品レンダラとする意向が示された。あわせて
「UE5 でエージェント実装は可能か」という問いが提起された。

### Problem
ADR-0002 で UE5 の最大の懸念として挙げたのは **M7: AI Coding 適合度** である。
UE5 のワークフローは慣習的にエディタ GUI 中心であり、素直に使うと
マテリアル・ライティング・レベル配置・カメラリグの大半が人間の手作業になり、
人間が全アセット作業のボトルネックになる。

### 調査結果 — UE5 のスクリプト可能範囲

| 領域 | 手段 | 可否 |
|------|------|------|
| ゲームプレイ / 描画ロジック | C++ | 完全に可 |
| マテリアル生成・ノード接続 | Python `unreal.MaterialEditingLibrary` | 可（冗長だが完全） |
| Material Instance / パラメータ | Python `MaterialEditingLibrary` + `EditorAssetLibrary` | 可 |
| アセットインポート (FBX/glTF/テクスチャ) | Python `AssetImportTask` / `AssetToolsHelpers` | 可 |
| レベルへのアクタ配置・プロパティ設定 | Python `EditorActorSubsystem` / `LevelEditorSubsystem` | 可 |
| ライティング (DirectionalLight / SkyLight / SkyAtmosphere / PostProcessVolume) | Python でプロパティ全設定 | 可 |
| レンダラ設定 (Lumen / Nanite / VSM / DLSS / TSR) | `Config/DefaultEngine.ini` の `r.*` | 可（純テキスト） |
| トラックメッシュ | C++ による手続き的生成（スプライン -> メッシュ） | 可。そもそも手作業でモデリングすべきでない |
| **ヘッドレス実行** | `UnrealEditor-Cmd.exe <proj>.uproject -run=pythonscript -script=<file>` | 可（GUI 不要） |
| スクリーンショット取得 / 性能計測 | `HighResShot`, `stat unit`, `stat gpu`, Automation, `-ExecCmds` | 可（視覚検証・性能検証を自動化できる） |
| Blueprint ビジュアルスクリプティング | — | **使用しない**（全ロジックを C++ に置く） |

**エージェントに実行できないもの**（ただしこれらはエンジン非依存の性質を持つ）
1. 美的判断（「この光は中継映像に見えるか」）— どのエンジンでも人間の役割
2. 3D モデリング / テクスチャ制作 — 素材調達の問題であり実装の問題ではない
3. C++ のビルド待ち時間 — 実在するコスト

### 結論
「UE5 だからエージェント不可」ではなく **「UE5 を GUI 前提で使うとエージェント不可になる」** が正しい。
本プロジェクトは最初から下記の運用制約を課すことでこれを回避する。

### Decision — UE5 Code-First 運用制約（違反はレビューで HIGH）

1. **Blueprint にロジックを書かない。** ロジックは C++ のみ。BP は必要最小限の薄いラッパのみ許可
2. **エディタ GUI での手作業を「正」としない。** レベル構築・マテリアル・ライティングは
   `tools/ue_python/*.py` のスクリプトを唯一の正とし、エディタでの変更はスクリプトへ還元する
3. **レンダラ設定は `Config/DefaultEngine.ini` にテキストで持つ。** GUI の Project Settings で直接いじらない
4. **トラックは手続き的生成。** `sim-track` のスプラインデータから C++ でメッシュを生成する
5. **視覚検証は `HighResShot` による自動スクショ取得 + 人間レビュー**の 2 段構え
6. **UE 側の C++ は薄く保つ。** ロジックは Rust Simulation Core にあるため、
   UE C++ は「Snapshot を受け取って描画状態に反映する」だけに限定する（ビルド時間の抑制）

### Migration Cost / Risk
Greenfield のため Migration Cost = 0。
残存リスクは (a) 8GB VRAM で目標画質に届くか (b) Code-First 運用が実務で回るか の 2 点。
これは Phase 0.5 で**比較ではなく検証**として実施する（ADR-0002 の評価軸 M1〜M8 を UE5 単独で実施）。

### Expected Benefit
映像品質の最高到達点（Lumen HW-RT / Nanite / CineCamera / パーオブジェクト Motion Blur /
自動車系マテリアル）を、エージェント実装の生産性を大きく損なわずに得る。

### Fallback
Phase 0.5 の検証で M4（VRAM <= 7.0 GB）または M7（Code-First 運用）が成立しないと判明した場合、
**ADR-0001 により Simulation Core は無傷のまま Unity 6 HDRP へ切り替えられる。**
この退避経路の存在が、UE5 を選ぶことのリスクを許容可能にしている。

---

## ADR-0005: UE5 採用下でも Simulation Core は Rust とする（ADR-0001 の再確認）

- **Date**: 2026-09-06
- **Status**: **ACCEPTED**

### Problem
UE5 を採用する場合、Simulation Core を C++20 にすれば FFI 境界が不要になる。
ADR-0001 で Rust の唯一の Cons として挙げたのがこの点であり、再評価が必要になった。

### 再評価

**FFI 境界の実コストは当初想定より小さい。**
本アーキテクチャの Presentation 境界は `WorldSnapshot` の一方向読み出しのみであり、
必要な C-ABI は実質的に以下だけである。

```c
SimHandle* sim_create(const SimConfig*);
void       sim_step(SimHandle*, double dt);
void       sim_snapshot(SimHandle*, SnapshotBuffer* out);   // POD の平坦配列
void       sim_destroy(SimHandle*);
```

これは **narrow / data-only / 低頻度更新** という FFI の理想形であり、
オブジェクトグラフを往復させる chatty な境界とは性質が全く異なる。
実装量は約 300 行で、以降ほとんど変更されない。

### 一方で Rust 側の利点は UE5 採用によりむしろ増す

1. **UE C++ を薄く保つ制約（ADR-0004-6）と整合する。** ロジックが Rust 側にあるほど
   C++ ビルド待ちが減り、UE5 最大の生産性コストが緩和される
2. **`cargo test` による高速な headless 検証**が UE から完全に独立して回る。
   UE のビルド・起動を伴わずに Phase 1〜5 の全検証が可能
3. **Engineering View (WASM) が Phase 1〜5 の唯一の可視化手段**となる。
   Rust -> wasm32 は標準的だが、C++ -> Emscripten は同等の手間ではない
4. **メモリ安全性の価値はコード規模とともに増大する。** 本 Core は数万行規模になり、
   その大半を AI が実装し Opus が全件レビューする。UB / dangling ref / data race が
   原理的に混入しないことは、レビュー面積の実質的な縮小を意味する
5. **ADR-0004 の Fallback（Unity 6 への退避）を維持できる。** C++ 核でも技術的には可能だが、
   Rust の方が退避コストが低い

### Decision
**Simulation Core は Rust とする。** `sim-ffi` crate で C-ABI を提供し、
UE5 側は生成された C ヘッダ経由でリンクする。

**`sim-ffi` は Phase 1B の時点で最小構成を実装し、UE5 との接続可能性を早期に実証する。**
FFI 境界の検証を Phase 8 まで先送りして「後から繋がらない」事故を起こさない。

---

## ADR-0006: アセットは購入せず、Web 画像を参照して自作する（Blender headless + Python）

- **Date**: 2026-09-06
- **Status**: **ACCEPTED**（人間指示 2026-09-06「車やコースのモデルなどは web 上の画像などを参考にして作成してください」）
- **Relates to**: PLAN.md Risk R9

### Current State
アセット調達方針は未定であった（R9 として「エンジン確定後に ADR 化」と保留していた）。

### Decision
**車両・トラック・トラックサイドのモデルは購入・ダウンロードではなく自作する。**
実在のモータースポーツの写真・図面・オンボード映像を **参照資料** として用いる。

### Toolchain — なぜ Blender headless + Python か

| 対象 | 生成方法 | エージェント実行可否 |
|------|---------|------------------|
| **トラック路面・縁石・ランオフ・バリア・フェンス** | `sim-track` のスプラインデータから **UE5 C++ で手続き的生成** | ◎ 完全にコード |
| **車両ボディ・ウイング・ホイール・ディスク・キャリパー** | **Blender Python API（`bpy`）でパラメトリック生成** -> glTF/FBX で UE5 へ | ◎ 完全にコード |
| グランドスタンド・ピットビル・標識・タイヤウォール | Blender Python でパラメトリック生成 + インスタンシング | ◎ |
| 植生・遠景 | UE5 の PCG / Foliage を Python 設定 | ◎ |
| **マテリアル（カーペイント/カーボン/ガラス/ゴム）** | UE5 Python `MaterialEditingLibrary` | ◎ |

Blender は `blender --background --python build_car.py -- --spec cars/gt3_a.json` の形で
**GUI なしで実行できる**。ADR-0004 の Code-First 運用制約と完全に整合する。

**導入**: `winget install BlenderFoundation.Blender.LTS.4.5`（LTS を使う。API 安定性のため）

### Reference Workflow（Web 画像の使い方）

1. 参照対象の**実測寸法**を収集する（ホイールベース、トレッド、全長・全幅・全高、
   最低地上高、タイヤサイズ、ウイング幅、重量、重心高、空力係数）
2. それを `assets/vehicles/<name>.spec.json` に**数値仕様**として記述する
3. Blender Python がその spec からメッシュを生成する
4. **同じ spec ファイルを `sim-vehicle` の物理パラメータにも使う**
   -> 見た目と物理が同一の実寸法から導出され、乖離しない

これは「絵に寄せてモデリングする」のではなく
**「実車の工学的数値を正として、そこから見た目と物理を同時に導出する」**方式である。
Q2（Realistic Vehicle Behaviour）と Q3（Photorealistic Visual Quality）を同じ根から出す。

### IP Policy（遵守必須）

**許可**: 実在車両の寸法・比率・空力形状・断面形状・素材構成・
実在サーキットのコーナー構成の考え方・実際の中継のカメラ言語 を**参照すること**

**禁止**: 実在チーム名 / 実在ドライバー名 / スポンサーロゴ / 特定チームのリバリー配色 /
実在サーキットの名称 を、そのまま製品へ含めること

-> **チーム・ドライバー・リバリー・サーキットはすべてオリジナルを作成する。**
実車の寸法に忠実であることが写実性の本体であり、この方針で写実性は一切損なわれない。

### Cons — 正直な品質上の限界

| 項目 | 影響 |
|------|------|
| 自作メッシュの品質はスキャンベースの購入アセットに劣る | **極端なクローズアップ（オンボード / 静止したディテールショット）で差が出る** |
| パラメトリック生成は有機的な曲面の作り込みが苦手 | ボディの微妙な面質感が単純になりがち |
| 制作工数が発生する | Phase 10 の作業量が増える |

**緩和**: 写実性への寄与度は **マテリアル・ライティング・反射 > メッシュ密度** である。
観戦シミュレーターのショットの大半は放送距離（10〜100 m）であり、その距離では
正しい寸法比 + 高品質マテリアル + 正しいライティングが支配的に効く。
メッシュ密度が律速になるのはクローズアップのみ。
そのため **Phase 10 の優先順位は マテリアル > ライティング > メッシュ密度** とする。

### Migration Cost / Risk
Greenfield のためコスト 0。将来「やはり購入アセットを使う」と判断した場合も、
`spec.json` -> メッシュ の構造は維持したまま、生成器を差し替えるだけで済む。

### Expected Benefit
- アセットが 100% テキスト（spec + 生成スクリプト）から再生成可能になり、
  git で完全にバージョン管理できる
- 見た目と物理が同一の実寸法仕様から導出され、乖離しない
- 人間の GUI モデリング作業がボトルネックにならない
- IP リスクがない

### Follow-up Tasks
- Phase 0.5: Blender 導入、`tools/blender/` 生成スクリプト基盤、車両 1 台の生成 -> UE5 インポート実証
- Phase 1A: `sim-track` データからの手続き的トラックメッシュ生成
- Phase 10: マテリアル品質の作り込み（最優先）

---

## ADR-0006 追記: 導入環境の確定と Microsoft Store 版 Blender の不適合

- **Date**: 2026-09-07
- **Status**: ACCEPTED（ADR-0006 の実装制約として追加）

### 確定した導入環境

| ツール | 実測 | パス |
|--------|------|------|
| Unreal Engine | **5.8** | `C:\Program Files\Epic Games\UE_5.8` |
| UE ヘッドレス実行 | 確認済 | `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe` |
| Rust | 1.95.0 | — |

ADR-0004 の Code-First 運用制約で前提とした `UnrealEditor-Cmd.exe -run=pythonscript` の
実行体が存在することを確認した。

### 問題: Microsoft Store 版 Blender は headless パイプラインに使用できない

導入された Blender は **MSIX（Microsoft Store）パッケージ**であった。

```
Name            : BlenderFoundation.Blender
PackageFullName : BlenderFoundation.Blender_5.2.1.0_x64__ppwjx1n5r4v9t
InstallLocation : C:\Program Files\WindowsApps\BlenderFoundation.Blender_5.2.1.0_x64__ppwjx1n5r4v9t
```

**観測された事実**

1. 実行エイリアスとして公開されているのは `blender-launcher.exe` のみで、`blender.exe` は存在しない
2. `blender-launcher.exe --background --version` は**何も出力しない**
   （通常のビルドはバージョン文字列を標準出力へ返す）
3. `C:\Program Files\WindowsApps\...` は ACL により列挙できず、実行体を直接叩けない

**根本原因**: MSIX パッケージはサンドボックス化され、ファイルシステムが仮想化されるうえ、
公開されるのは GUI 起動用ランチャーのみである。ADR-0006 が前提とする
`blender --background --python build_car.py -- --spec ...` の形式が成立しない。

**影響範囲**: TASK-05-2（Blender 生成基盤）および以降のアセット生成タスク全般。
**`sim-track` 以降の Simulation Core 側タスクには影響しない**（Blender に依存しないため）。

### Decision

**スタンドアロン（MSI）版の Blender LTS 4.5 を使用する。** Store 版は使用しない。

```
winget install --id BlenderFoundation.Blender.LTS.4.5 --source winget
```

インストール後の想定パス: `C:\Program Files\Blender Foundation\Blender 4.5\blender.exe`

LTS を指定する理由は ADR-0006 のとおり `bpy` API の安定性である。
Store 版の 5.2.1 は最新リリース版であり、LTS ではない点でも本プロジェクトの方針と合わない。

**検証コマンド**（TASK-05-2 の前提条件とする）:
```
"C:\Program Files\Blender Foundation\Blender 4.5\blender.exe" --background --version
```
これがバージョン文字列を返すことを確認してから TASK-05-2 に着手する。
