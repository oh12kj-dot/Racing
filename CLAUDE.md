# Realistic Race Spectator Simulator

**まず `HANDOFF.md` を読むこと。** 現在地・実装済み API・環境・作業手順・落とし穴が
すべてそこに 1 本でまとまっている。他の文書は必要になったときだけ開けばよい。

```bash
cargo test --release      # 73 passed / 0 failed が健全な状態
```

## このプロジェクトは何か

プレイヤーは運転せず**観戦**する。「実際のモータースポーツ中継に見え、
よく見ると各 AI が本当にレースをしている」ことが目標。
映像とレース挙動の**どちらか一方に偏らせない**。

## 役割

- **Opus 5** = Architect / Technical Director / Reviewer / Quality Gate
- **Sonnet 5** = Implementation Engineer（仕様どおりに実装する。設計変更は不可）
- Engine / 言語 / 主要フレームワーク / 物理アーキテクチャの変更は**人間の承認が必須**

Sonnet へタスクを渡すときは `TODO.md` の `# NEXT SONNET TASK` を全文渡すこと
（IMPORTANT IMPLEMENTATION CONTRACT を含む）。実装後は Opus が監査してから commit する。

## 破ってはいけない原則（違反は CRITICAL）

1. AI は Transform / Position / Velocity を直接書き換えない。
   出せるのは `steering / throttle / brake / gear / clutch / drs` のみ
2. Lap Time を乱数生成して順位を決めない。結果は Tick の積み重ねから創発させる
3. 乱数は「結果」ではなく「原因」に作用させる
4. Simulation Core は Rendering / UI / Camera を知らない
5. 固定タイムステップのみ。グローバル乱数・時刻依存乱数は禁止
6. トラック上の位置は Waypoint index ではなく連続量 `s`（弧長 [m]）。
   ラップ処理は `wrap_s` / `signed_delta_s` に一本化する

## 座標系（変更禁止）

右手系 / `+Y` が上 / SI 単位 / 角度はラジアン。
車両ローカルは `+X` 前方・`+Y` 上・`+Z` 右。
`TrackCoord { s, t }` の `+t` は**左**。曲率は左カーブが正。

## 進行状況

Phase 1A（Track Foundation）。`sim-math` / `sim-track` / トラックアセット /
Blender 車両生成パイプライン / `sim-wasm` + Engineering View が完成。
次は TASK-1A-5（曲率リップル解消と平滑性テスト）。
詳細と次タスクの全文仕様は `HANDOFF.md` と `TODO.md` にある。

## 環境で踏みやすい罠

- Blender は Store 版。`blender-launcher.exe` 経由でのみ起動でき、**stdout が届かない**
  （JSON サマリファイルで結果を返すこと）
- Bash の heredoc が長文で失敗することがある → Write ツールを使う
- PowerShell は 5.1。`if` 式・`&&`・`||` が使えない
