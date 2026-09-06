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
- **Status**: **AWAITING HUMAN APPROVAL**（Programming Language 選定のため）

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
- **Status**: **AWAITING HUMAN APPROVAL**（Game Engine 選定のため）

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
- **Status**: PROPOSED（ADR-0001 承認後に ACCEPTED 化）

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
