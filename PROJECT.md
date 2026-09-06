# PROJECT.md — Realistic Race Spectator Simulator

Status: Phase 0 (Discovery / Architecture) — 実装未着手
Last updated: 2026-09-06

---

## 1. Vision

**REALISTIC RACE SPECTATOR SIMULATOR**

プレイヤーは車を運転しない。**レースを観戦する。**

目標は「ゲーム内で車が走っているように見せる」ことではない。

> 実際のモータースポーツ中継を見ているように見え、
> よく観察すると各AIドライバーが本当にレースをしている

と感じられるシミュレーターを作る。

「映像だけリアルでAIが不自然」も
「AIだけ高度で映像が簡素」も、**どちらも失敗**とする。

---

## 2. Top-Level Quality Targets

| # | Target | 定義（何をもって達成とするか） |
|---|--------|------------------------------|
| Q1 | Believable Race Behaviour | 30分観戦して「AIっぽい」不自然な挙動が観測されない |
| Q2 | Realistic Vehicle Behaviour | 荷重移動・スリップ・トラクション限界が挙動として観測できる |
| Q3 | Photorealistic Visual Quality | 静止画で実写中継のスクリーンショットと混同しうる |
| Q4 | Broadcast-quality Spectator Experience | カメラワークが実際の中継のカメラ言語に従う |
| Q5 | Stable Simulation | 60分レースを完走して破綻（NaN/貫通/順位不整合）ゼロ |
| Q6 | Maintainable Architecture | Simulation Core が Rendering/UI/Camera を一切知らない |
| Q7 | High Performance | 下記 Performance Budget を満たす |
| Q8 | Deterministic / Testable Core | 同一 Seed + 同一 Input で同一結果がバイナリ一致で再現 |

---

## 3. Non-Goals（やらないこと）

- プレイヤーによる車両操作を主目的にしない（Driver View は観戦カメラとして提供、操作は将来の任意拡張）
- プロ向け車両シミュレーター（rFactor/AC 級のタイヤモデル）を目指さない
- 実在チーム／実在ドライバー／実在サーキットの権利物を無断で使用しない
- Phase 1〜5 が安定する前に UI / メニュー / 演出 / コンテンツ量産へ工数を使わない

---

## 4. Core Simulation Principle（不可侵）

```
Track Geometry
  -> Racing Line / Driving Corridor
    -> Driver Perception
      -> Driver Decision
        -> Target Trajectory
          -> Target Speed
            -> Vehicle Controller
              -> Vehicle Physics
                -> Actual Vehicle Motion
```

**禁止事項（違反は CRITICAL）**

- AI が Vehicle Transform / Position / Velocity を直接書き換えること
- AI が Waypoint へ直接向かうだけの制御
- Lap Time を乱数生成して順位を決めること
- レース結果を事前決定すること
- Rendering / Camera / UI がレース結果に影響すること

通常走行中に Driver AI が生成してよい出力は
`steering / throttle / brake / gear / clutch / drs` **のみ**。
最終的な車両挙動は物理システムだけが決定する。

---

## 5. Randomness Principle

乱数は**結果側ではなく原因側**に作用させる。

適用してよい: `reaction / decision / confidence / risk / mistake / precision / consistency`
適用してはいけない: `lapTime / gap / position / result`

`LapTime` `Gap` `Position` `Overtake` `Collision` `PitStop` `Retirement` `RaceResult`
はすべて Simulation Tick の積み重ねから**創発**しなければならない。

すべての乱数は明示的な `Rng` インスタンス経由。グローバル乱数・時刻依存乱数は禁止。

---

## 6. Performance Budget

**Reference Hardware（開発機・実測）**

| 項目 | 値 |
|------|-----|
| GPU | NVIDIA GeForce RTX 4060 Ti **8 GB** (Ada, HW-RT, DLSS3) |
| CPU | AMD Ryzen 7 5700X (8C / 16T) |
| RAM | 32 GB |
| Disk free | 292 GB |

> **8 GB VRAM が本プロジェクト最大のハード制約。** Photorealism の設計判断はすべてこの上限に従う。

**Primary Target**

| 項目 | 予算 |
|------|------|
| 解像度 | 1920x1080, DLSS Quality (内部 1280x720) |
| フレームレート | 60 fps ロック（フレームタイム 16.6 ms） |
| GPU frame time | <= 14.0 ms |
| CPU main thread | <= 8.0 ms |
| VRAM 使用量 | <= 7.0 GB |
| 車両台数 | 24 台（グリッド上限） |

**Stretch Target**: 2560x1440, DLSS Balanced, 60 fps

**Simulation Budget（Rendering とは別スレッド）**

| System | 予算 / 1 render frame (24 cars) |
|--------|-------------------------------|
| Vehicle Physics (240 Hz, 4 substeps) | <= 2.0 ms |
| Driver AI (60 Hz) | <= 1.5 ms |
| Race Control / Timing (60 Hz) | <= 0.3 ms |
| Perception / Spatial query | <= 0.5 ms |
| **Simulation 合計** | **<= 4.0 ms** |

**VRAM Budget**

| 用途 | 予算 |
|------|------|
| 車両 24 台（共有マスターマテリアル + 2K livery） | <= 2.2 GB |
| トラック + 環境 | <= 2.5 GB |
| 空・IBL・Reflection | <= 0.6 GB |
| Post / Temporal / GBuffer | <= 1.0 GB |
| 予備 | 0.7 GB |

**Frame Generation は Primary Target では使用しない。**
高速な横移動 + 回転ホイールで artifact が出やすく、Q4（放送品質）と相反するため。任意オプション扱い。

---

## 7. Determinism Contract

- Simulation は**固定タイムステップ**のみ。可変 dt を Simulation Core に入れない
- 全システムの更新順序は固定・明示
- 乱数は `seed` から決定的に派生（`RaceSeed -> DriverSeed[i] -> StreamSeed`）
- Wall-clock / システム時刻 / スレッド完了順に依存しない
- 浮動小数は `f64` を状態と積算に使用。fast-math 最適化を禁止
- 保証範囲: **同一バイナリ・同一マシンでのビット一致再現**（クロスプラットフォーム一致は Non-Goal）
- 検証: `determinism_test` が同一 Seed の 2 回実行で全車両状態のハッシュ一致を確認

---

## 8. Documentation Map

| File | 役割 |
|------|------|
| `PROJECT.md` | 本書。目的・品質目標・予算・不可侵原則 |
| `ARCHITECTURE.md` | 現在の Architecture（実装と一致させること） |
| `PLAN.md` | 全体 Development Roadmap / Phase 定義 |
| `TODO.md` | 現在実行中の具体タスク |
| `DECISIONS.md` | Architecture Decision Record |
| `TESTING.md` | Test Strategy / Scenario / Acceptance Criteria |

**Documentation Rule**: コードと文書が矛盾した場合、どちらかを推測で正としない。
Git History / 実装 / Runtime Behaviour / Tests から裏付けを取る。

---

## 9. Responsibility Contract

| Role | Owner |
|------|-------|
| Architect / Technical Director / Reviewer / Quality Gate | **Opus 5** |
| Implementation Engineer | **Sonnet 5** |
| Final approval on Engine / Language / Goal changes | **Human** |

Sonnet 5 は Architecture / Interface / Data Structure / Technology / Scope を自己判断で変更できない。
問題を発見した場合は `PROPOSED DESIGN CHANGE` または `BLOCKED BY ARCHITECTURE` として報告し、Opus の判断を待つ。

---

## 10. Human Approval Required

以下は Opus 単独で実行してはならない。

- Game Engine の選定 / 変更
- Programming Language の変更
- Major Framework / Physics Architecture の置き換え
- Repository 全体の書き換え
- Project Goal の変更
