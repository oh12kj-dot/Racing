# PLAN.md — Development Roadmap

Last updated: 2026-09-06
Current Phase: **Phase 0 — Discovery / Architecture（完了間近）**

---

## Phase 構成の変更点と理由

初期指示の Phase 0〜12 に対し、Audit 結果を踏まえて以下を変更した。

| 変更 | 理由 |
|------|------|
| **Phase 0.5「Renderer Spike」を新設** | プロジェクトが Greenfield かつエンジン未選定。実測なしでエンジンを選ぶのは最大の不可逆リスク（ADR-0002） |
| **Phase 1 を 1A（Track）/ 1B（Vehicle Physics）に分割** | Track Coordinate System が他の全システムの前提。ここを固めずに物理へ進むと全体が壊れる |
| **Phase 8（Broadcast Camera）の一部を Phase 3 へ前倒し** | Phase 2〜5 の AI 挙動を人間が評価するには「見て分かる」カメラが必要。ただし最小限に留める |
| **Engineering View を Phase 1A に前倒し** | AI 挙動・物理の検証手段が無ければ Phase 2 以降を検収できない（ADR-0003） |
| Phase 10（Visual Fidelity Pass）を継続的作業に変更 | エンジン選定後は継続的に磨く性質のもので、単一フェーズに閉じない |

---

## Phase 0 — Discovery / Audit / Architecture ★現在地

**Goal**: 実装を開始できる状態を作る。

- [x] リポジトリ監査（結果: 空。既存コードなし）
- [x] 実行環境実測（RTX 4060 Ti 8GB / Ryzen 7 5700X / 32GB）
- [x] Performance Budget 確定
- [x] Target Architecture 設計
- [x] PROJECT.md / ARCHITECTURE.md / PLAN.md / TODO.md / DECISIONS.md / TESTING.md 起草
- [x] **ADR-0001（言語=Rust）/ ADR-0004（エンジン=UE5）の人間承認**（2026-09-06 取得）
- [x] Rust toolchain 確認（rustc 1.95.0 導入済み）

**Exit Criteria**: 達成。Phase 1A へ移行。

---

## Phase 0.5 — UE5 Feasibility Spike（Phase 1〜2 と並行）

エンジンは ADR-0004 により **Unreal Engine 5 に確定**。本フェーズは *比較* ではなく
**採用済みエンジンの実現可能性検証**である。

**Goal**: UE5 の 2 つの残存リスクを、深くコミットする前に実測で潰す。

| リスク | 検証項目 | 合格基準 |
|--------|---------|---------|
| **8GB VRAM で目標画質に届くか** | M1 画質 / M2 反射 / M3 GPU time / M4 VRAM / M5 モーション / M6 物理カメラ | GPU <= 14.0 ms, VRAM <= 7.0 GB @1080p DLSS Quality, 車両 24 台 |
| **Code-First 運用が実務で回るか** | **M7**: 「車両 1 台を配置しマテリアルを設定しライティングを組む」を **Python スクリプトのみ**で実行 | 人間のエディタ GUI 作業ゼロで完了する |
| FFI が繋がるか | M8: `sim-ffi` 経由で Rust core から Transform を受け取り描画 | 動作すること |

| **自作アセットのパイプラインが回るか** | **M9**: `spec.json` -> Blender Python -> glTF -> UE5 インポート -> マテリアル適用 を**全自動**で通す | 人間の GUI 作業ゼロで車両 1 台が UE5 に立つ（ADR-0006） |

**Scope**: UE5 インストール、Blender LTS 4.5 導入、`Config/DefaultEngine.ini` によるレンダラ設定、
`tools/ue_python/` および `tools/blender/` のスクリプト群、
最小シーン（直線 + 1 コーナー、車両 24 台、動的太陽、放送カメラ 1 台）

**Out of Scope**: 製品用アセットの作り込み、ゲームプレイ実装、Unity との比較。

**Exit Criteria**: M1〜M8 の実測結果が記録され、合格基準を満たす。
**Deadline**: **Phase 3 完了時まで**。ここで不合格の場合は ADR-0004 の Fallback
（Unity 6 HDRP へ退避。Simulation Core は無傷）を発動するか人間に判断を仰ぐ。

---

## Phase 1A — Track Foundation

**Goal**: トラック座標系と幾何が、以降の全システムの信頼できる基盤になる。

**Components**: `sim-math`, `sim-track`, `view-engineering`(最小)
**Deliverables**:
- 弧長パラメータ化スプライン、`TrackFrame` テーブル
- `world_to_track` / `track_to_world` の相互変換
- サーフェス種別、コース幅、標高、バンク、カンバー
- テスト用トラック 1 本（実在サーキットを模さないオリジナル：直線 + 高速コーナー + 低速ヘアピン + 複合 + 高低差）
- Engineering View: トラック描画 + centerline + corridor 境界

**Acceptance**: TESTING.md T-TRK-01〜06 全通過。
**Out of Scope**: 車両、AI、縁石メッシュ、ピットレーン（データ構造の予約のみ）。

---

## Phase 1B — Vehicle Physics

**Goal**: 1 台の車が、人間の入力に対して物理的に妥当に振る舞う。

**Components**: `sim-vehicle`
**Deliverables**: 剛体 + サスペンション + Pacejka タイヤ + パワートレイン + 空力 + ブレーキ
**Acceptance**:
- 加速でスクワット、制動でダイブ、旋回でロールが**創発**する（直接代入していない）
- 定常円旋回でアンダー/オーバーが荷重とスリップから出る
- 60 分連続実行で NaN / 発散なし
- TESTING.md T-VEH-01〜10 全通過
**Out of Scope**: タイヤ摩耗・温度、燃料消費、ダメージ、車車間衝突。

---

## Phase 2 — Racing Line + Single Driver AI

**Goal**: 1 台の AI が、人間らしく 1 周を走りきる。

**Components**: `sim-line`, `sim-driver`
**Deliverables**: Corridor / Trajectory / SpeedProfile（前進・後退パス）、Perception、Decision(FreeAir のみ)、
Planner、Pure Pursuit + 縦方向制御、Driver Model 能力値の作用
**Acceptance**:
- コース逸脱なしで 20 周完走
- ステア角の 1 次・2 次差分が閾値内（振動なし）
- 能力値の異なる 3 名でラップタイムに**創発的な**差が出る（定数で差をつけていない）
- 同一 Seed で完全再現
- TESTING.md T-AI-01〜08 全通過
**Out of Scope**: 他車、追い抜き、ピット、天候。

---

## Phase 3 — Multiple Cars + Basic Race System

**Goal**: 20 台以上が同時に走り、レースとして成立する。

**Components**: `sim-race`, `sim-core`
**Deliverables**: グリッド、スタート、ラップカウント、セクター計測、順位、Gap/Interval、
Classification、フィニッシュ、車車間衝突（基本）、簡易 Broadcast Camera（Trackside + Chase）
**Acceptance**:
- 24 台 60 分レースが破綻なく完走
- 順位・Gap が常に整合
- Simulation 予算 4.0 ms 以内
- TESTING.md T-RACE-01〜10 全通過
**Exit Criteria**: **ここで Phase 0.5 の UE5 実現可能性検証を締める。** 不合格なら Fallback を発動。

---

## Phase 4 — Following + Traffic Awareness

**Goal**: 車が「前車を認識して走る」。

**Deliverables**: Following モード、車間維持、スリップストリーム、ダーティエア、
衝突回避、Blue Flag、周回遅れ処理
**Acceptance**: 追突が発生しない。不自然な車間の詰まり・離れが起きない。

---

## Phase 5 — Overtaking + Defending + Side-by-side

**Goal**: 攻防が「見ていて面白い」水準になる。**プロジェクト最大の山場。**

**Deliverables**: `Engagement` 多段モデル全フェーズ、Defending、並走、
コーナー進入/脱出バトル、遅めのブレーキング、スイッチバック、譲り、接触からの復帰
**Acceptance**: TESTING.md の Scenario Test 全 8 種で Acceptance Criteria を満たす。

> **ここまでが本プロジェクトの中核。** Phase 1〜5 が安定するまで
> UI / メニュー / 演出 / コンテンツ量産へ工数を使わない。

---

## Phase 6 — Tyres + Fuel + Strategy
compound / 温度 / 摩耗 / デグラデーション、燃料重量と消費、ピットストップ、
StrategyAI（ピットウィンドウ、アンダーカット/オーバーカット）

## Phase 7 — Weather + Dynamic Track
Clear/Cloudy/Rain/HeavyRain/Fog、路面水膜と乾き、ウェットライン、
ラバーイン、マーブル、グリップ変化、アクアプレーニング

## Phase 8 — Broadcast Camera + Timing UI
全カメラリグ、実カメラパラメータ、放送カメラ言語の作り込み、タイミングタワー、
セクターグラフ、ギャップグラフ

## Phase 9 — Automatic TV Director
ViewerInterestScore、ショット選択、カット制約、文脈継続、リプレイ挿入判断

## Phase 10 — Visual Fidelity（継続的作業）
PBR マテリアル、カーペイント/クリアコート、カーボン、ガラス、ホイール、
ライティング、反射、露出/トーンマッピング、LOD、ストリーミング、時間帯変更

## Phase 11 — Audio / Replay / Damage
エンジン音、シフト、タイヤスキール、縁石、接触、風、観客、雨、ピット。
リプレイ再生。ダメージモデル。

## Phase 12 — Performance / Balance / Polish
プロファイリング、予算遵守の確認、AI バランス調整、長時間安定性検証

---

## Risk Register

| # | Risk | 影響 | 対策 |
|---|------|------|------|
| R1 | **8GB VRAM が Photorealism の上限を規定する** | 高 | 予算を PROJECT.md に明記。共有マスターマテリアル + livery マスク方式。1080p/DLSS を主目標に |
| R2 | UE5 がエディタ作業必須で AI 実装が進まない | 高 | ADR-0004 の Code-First 運用制約 6 項目を必須化。Phase 0.5 の M7 で実測。不合格時は Unity 6 へ退避（Core は無傷） |
| R3 | Pacejka + 車輪回転の低速発散 | 高 | relaxation length、低速正則化、サブステップ。T-VEH-06 で常時検証 |
| R4 | Phase 5 の攻防が「それっぽくならない」 | 高 | Engagement を多段化。Scenario Test で客観判定。Engineering View で内部状態を可視化 |
| R5 | Rust ↔ エンジンの FFI が後で繋がらない | 中 | `sim-ffi` を Phase 1B の時点で最小構成で実証する |
| R6 | Simulation Core と Presentation の境界が浸食される | 中 | crate 依存グラフで機械的に禁止。レビューで CRITICAL 判定 |
| R7 | 実装者による無断の設計変更 | 中 | Sonnet Task に Allowed Files / Do Not Change を必ず明記。差分監査 |
| R8 | ドキュメントとコードの乖離 | 中 | Phase 完了時に ARCHITECTURE.md を実装と突き合わせて更新 |
| R9 | **自作アセットの品質上限**（ADR-0006 により購入せず自作）。特にクローズアップでメッシュ品質が律速 | 高 | 実車の工学的数値を `spec.json` に落として Blender Python でパラメトリック生成。Phase 10 の優先順位を マテリアル > ライティング > メッシュ密度 とする。観戦距離のショットを主戦場にする |
| R10 | Engineering View が肥大化して工数を食う | 低 | 装飾的作業を明確に禁止（ADR-0003） |
