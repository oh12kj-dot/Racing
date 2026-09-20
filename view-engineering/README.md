# Engineering View

**これはデバッグ用の計測器であり、製品レンダラではない。**（`DECISIONS.md` ADR-0003）

目的は「トラックとテレメトリを目と数値で検証できるようにする」ことだけである。
製品としての映像は Unreal Engine 5 側（ADR-0004）でのみ追求する。

したがって、ここには以下を **追加してはならない**。

- 影・反射・ポストエフェクト・スカイボックス
- マテリアルの作り込み、ライティング
- アニメーション、カメラ演出
- UI の装飾

追加してよいのは **検証とデバッグに直接寄与するもの** だけである。

路面は `MeshBasicMaterial` + 頂点カラーで描いている。これは意図的で、
陰影が乗るとカラーマップの色を値として読めなくなるためである
（**表示された色 = データの値** を保つ）。

---

## 起動方法

WASM は `file://` から読めないため、**静的サーバが要る**。
モジュールはトラックアセットをリポジトリルート基準で取りに行くので、
**サーバはリポジトリルートで起動する**。

```bash
cd /c/AI/App_Dev/Racing

# 1) 依存（three のみ。ビルドツールは使わない）
cd view-engineering && npm install && cd ..

# 2) WASM をビルド
wasm-pack build crates/sim-wasm --target web --out-dir ../../view-engineering/pkg --release

# 3) 静的サーバをリポジトリルートで起動
python -m http.server 8080
```

ブラウザで <http://localhost:8080/view-engineering/> を開く。

`view-engineering/pkg/` と `view-engineering/node_modules/` は生成物であり、
`.gitignore` 済み。コミットしない。ソースから常に再生成できる。

### ビルドツールを使わない理由

`index.html` の import map が `three` と `three/addons/` を
`node_modules` の実ファイルへ直接解決する。webpack / vite / esbuild は
導入しない（TASK-1A-4 の制約）。

---

## 操作

| 入力 | 動作 |
|------|------|
| 左ドラッグ | オービット |
| 右ドラッグ | パン |
| ホイール | ズーム |
| マウスホバー | その点の `s` / `t` / 曲率 / 半径 / バンク / 幅 / 標高 / セクターを表示 |

### 着色モード

| キー | モード |
|------|--------|
| `1` | **曲率**（既定。スパイクや不連続の発見が主目的） |
| `2` | バンク角 |
| `3` | 標高 |

### 表示レイヤの切り替え

| キー | レイヤ |
|------|--------|
| `q` | 路面ポリゴン |
| `w` | センターライン（白） |
| `e` | コース端（左 = 緑 / 右 = 橙） |
| `r` | セクター境界（シアン）と Start/Finish（白い板） |
| `t` | バンク区間のハイライト（マゼンタ、\|banking\| > 0.02 rad） |
| `y` | 距離目盛り（100 m ごと。500 m ごとに長い目盛りとラベル） |
| `g` | `y = 0` のグリッド（標高を目で読む基準面） |

---

## 車両表示（TASK-1B-3）

`crates/sim-wasm` の `WasmWorld`（= `sim-core` の `World` を保持する境界）越しに
Aoyama Ring 上で 1 台を走らせ、姿勢・サスペンション・テレメトリを表示する。

- 車体はプリミティブ（箱 + 円柱 4 個）で組む。**GLB（Blender 生成メッシュ）は
  読み込まない。** ライティング・影・エフェクトも付けない（ADR-0003）
- 右上のパネルに速度 / rpm / gear / 入力 / lap / `s` / `t` / セクター /
  4 輪の荷重・スリップ比・スリップ角・摩擦円使用率を数値で表示する
- 位置・姿勢は **すべて `WasmWorld` から読む**（`body_poses` / `wheel_poses`）。
  ビューア側で座標変換や物理量の再計算をしない
- 駆動は固定タイムステップ（`PHYSICS_DT = 1/240`）のアキュムレータ。
  1 フレームで進める tick は 32 で頭打ち（タブ復帰時のフリーズ防止）

### 暫定入力について

現在の操作入力は **プレースホルダのスクリプト**（既定 `throttle 0.35` /
`steer 0` / rpm に応じた簡易ギア選択のみ）であり、**Driver AI ではない**。
ライン追従などの操舵ロジックはここには書かない（Phase 2 の `sim-driver` で実装する）。
そのため車はコーナーで自然にコースアウトする。track limits は Phase 2 で扱う。

### spawn の姿勢の制約

`World::spawn` の姿勢はヨーのみで、縦勾配・バンク区間では 1 step 後の
サスペンション縮み量が最大 38 mm ずれる過渡が出る（減衰する・`recovered_steps` は増えない）。
グリッド用途の S/F ストレートでは無害（5.5e-5 m）。`TrackFrame` 由来の
ピッチ/ロール込みへの拡張は `sim-vehicle` の凍結解除が要るため別タスク（`HANDOFF.md` D-1）。

### `window.__engview`（自動検証用）

読み出し・視点操作・`ControlInput` の指定のみ。位置や速度を直接書く API はない。

| メンバ | 用途 |
|--------|------|
| `world` | `WasmWorld` ハンドル（`body_poses` / `wheel_poses` / `telemetry` / `standings`） |
| `car` | 車両メッシュ（`chassis` / `wheels[4]` / `group`） |
| `stepOnce()` | 1 物理 tick 進めて描画も更新する |
| `setInput({steer, throttle, brake, gear, autoShift})` | 暫定入力の上書き |
| `vehicle.{bodyPose, wheelPoses, telemetry}` | 現在値のスナップショット |
| `followCar(on)` | 車体後方からのチェイスカメラ（OrbitControls と排他） |
| `WasmWorld` / `__trackJson` / `__specText` | ネイティブ参照と突き合わせる別 World を組む用 |

---

## 曲率カラーマップの読み方

負 = 青 / 0 = 灰 / 正 = 赤。**本規約では左カーブが正**。

正規化は `signed sqrt` を使う。トラックの最大曲率はヘアピン（R ≈ 20.6 m,
κ ≈ 0.049）が支配するため、線形正規化にすると高速コーナーがすべて灰色に潰れ、
**発見したいスパイクが見えなくなる**。sqrt は 0 付近の勾配を立てるので、
微小な曲率の跳ねほど見つけやすくなる。凡例には実際の値を数値で表示している。

**探すべきもの**: 色が滑らかに変化せず、1 サンプルだけ跳ねている箇所。
これは制御点密度の急変によるニセの曲率スパイクであり、
Phase 2 の Speed Profile ではニセの減速になる
（`assets/tracks/README.md` と `TODO.md` の TASK-1A-3 記録を参照）。

---

## 構成

```
index.html            import map と CSS。ビルドツールなし
src/main.js           シーン構築・入力・ホバー読み取り・World の駆動
src/track_mesh.js     WasmTrack -> Three.js オブジェクト。カラーマップ
src/vehicle_mesh.js   車両スペック -> プリミティブ。pose の適用
src/overlay.js        数値 HUD（諸元・凡例・ホバー表示・車両テレメトリ）
pkg/                  wasm-pack の生成物（gitignore）
node_modules/         three（gitignore）
```

幾何の唯一の正は `sim-track` / `sim-core` にある。ビューア側で曲率・バンク・
車両姿勢を計算し直してはならない。すべて `crates/sim-wasm` 経由で読み出す。
`sim-wasm` のトラック境界（`WasmTrack`）は **読み出し専用**。
`WasmWorld` は `World` を保持して進めるが、外部から渡せるのは `ControlInput`
相当の数値列だけで、Transform を書く経路は持たない
（Presentation が Simulation を書き換える経路を作らないため）。
