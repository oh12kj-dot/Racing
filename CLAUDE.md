# Realistic Race Spectator Simulator

プレイヤーは運転せず**観戦**する。「実際のモータースポーツ中継に見え、よく見ると各 AI が本当にレースをしている」ことが目標。映像とレース挙動のどちらか一方に偏らせない。

## 最初に読むもの

作業対象で入口を分ける。

- **現在配布している browser / iPhone runtime (`iphone-demo/**`)**: `RUNTIME_STATUS.md` → `ARCHITECTURE.md` → 関連する runtime/test ファイル。
- **Rust simulation / UE5 target (`crates/**`, `ue/**`)**: `HANDOFF.md` → `TODO.md` → `ARCHITECTURE_TARGET.md` → 関連仕様。

`HANDOFF.md` / `TODO.md` は Rust/UE workstream の資料であり、browser runtime の現在地を表す資料ではない。browser runtime へ古い Phase 記述を持ち込まない。

## Browser runtime の原則

- application boundary は `iphone-demo/app.js -> iphone-demo/runtime/index.js`。
- 新規 production behavior を外部 `vNN-*` に追加しない。責務名を持つ `runtime/*.js` が所有する。
- pit movement/service/release は `runtime/pit-state.js` が単一所有する。strategy は「pit するか」だけを決める。
- render asset の失敗で simulation boot を失敗させない。procedural fallback は常に維持する。
- iPhone/WebKit と Desktop Chromium の両方を回帰ゲートにする。
- 画質改善は mobile thermal budget を壊さない。重い全画面 post-process より asset/material/grounding/camera を優先する。
- 2026-09-14 audit remediation では **AUTO quality / thermal FPS policy はユーザー指示により変更対象外**。

Browser test:

```bash
npm install
npx playwright install chromium webkit
npm run test:browser
```

## Rust / UE target の原則

1. AI は Transform / Position / Velocity を直接書き換えない。出せるのは `steering / throttle / brake / gear / clutch / drs` のみ。
2. Lap Time を乱数生成して順位を決めない。結果は Tick の積み重ねから創発させる。
3. 乱数は「結果」ではなく「原因」に作用させる。
4. Simulation Core は Rendering / UI / Camera を知らない。
5. 固定タイムステップのみ。グローバル乱数・時刻依存乱数は禁止。
6. トラック上の位置は Waypoint index ではなく連続量 `s`（弧長 [m]）。ラップ処理は `wrap_s` / `signed_delta_s` / `detect_lap_crossing` に一本化する。
7. 順位は `(laps_completed, s)` の辞書順のみで決める。ワールド距離で並べない。
8. `VehicleState` を `Vehicle::step()` 以外から書き換えない。

Rust gate:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --release
cargo build -p sim-wasm --target wasm32-unknown-unknown --release
```

## 座標系（Rust/UE target、変更禁止）

右手系 / `+Y` が上 / SI 単位 / 角度はラジアン。車両ローカルは `+X` 前方・`+Y` 上・`+Z` 右。`TrackCoord { s, t }` の `+t` は**左**。曲率は左カーブが正。

## 役割と変更管理

- Architect / Reviewer と Implementation Engineer の責務を分け、重大な Engine・言語・主要フレームワーク・物理アーキテクチャ変更は人間承認を取る。
- 原因分析 → 最小の正しい修正 → テスト → 回帰確認の順を守る。
- テスト削除や閾値の無根拠緩和で PASS にしない。
- browser runtime と Rust/UE target の仕様・進捗を混同しない。

## 環境で踏みやすい罠

- Blender は Store 版。`blender-launcher.exe` 経由でのみ起動でき、stdout が届かない場合は JSON サマリファイルで結果を返す。
- Bash の heredoc が長文で失敗することがある場合はファイル書き込み手段を切り替える。
- PowerShell 5.1 では `if` 式・`&&`・`||` を前提にしない。
