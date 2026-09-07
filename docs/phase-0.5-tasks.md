# Phase 0.5 — UE5 Feasibility Spike の実装仕様

Status: **仕様確定 / 実装未着手**
Last updated: 2026-09-07

Phase 0.5 は「どのエンジンを選ぶか」の比較ではない。エンジンは ADR-0004 により
**Unreal Engine 5 に確定済み**である。本フェーズの目的は、深くコミットする前に
**残存する 3 つのリスクを実測で潰す**ことにある。

| リスク | 検証 | 合否 |
|--------|------|------|
| 8 GB VRAM で目標画質に届くか | M1〜M6 | GPU <= 14.0 ms, VRAM <= 7.0 GB @1080p DLSS Quality, 24 台 |
| **Code-First 運用が実務で回るか** | **M7** | 人間のエディタ GUI 作業ゼロで車両 1 台をシーンに立てられる |
| 自作アセットのパイプラインが回るか | **M9** | `spec.json` → Blender → glTF → UE5 が全自動で通る |
| Rust core と繋がるか | M8 | `sim-ffi` 経由で Transform を受け取り描画できる |

不合格の場合は ADR-0004 の Fallback（Unity 6 HDRP へ退避。Simulation Core は無傷）を
人間に諮る。**判定期限は Phase 3 完了時。**

タスクは `TASK-05-1`（UE5 側）と `TASK-05-2`（Blender 側）に分かれ、**並行して進められる**。

---

## 検証済みの環境（推測しないこと）

| 項目 | 実測値 |
|------|--------|
| Unreal Engine | **5.8** — `C:\Program Files\Epic Games\UE_5.8` |
| UE ヘッドレス実行体 | `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe` |
| Blender | **5.2.1 LTS**（Microsoft Store / MSIX 版） |
| Blender 起動 | `%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe` **のみ**（実体は ACL で実行拒否） |
| Blender stdout | **転送されない（0 バイト）**。`print()` は呼び出し元に届かない |
| GPU / CPU / RAM | RTX 4060 Ti **8 GB** / Ryzen 7 5700X / 32 GB |

---

# TASK-05-2 — Blender 車両生成パイプライン

**先にこちらを実施してよい**（UE5 のインストール規模に依存せず着手できるため）。

## Goal

**実車の工学的数値を記述した `spec.json` から、Blender Python がパラメトリックに
車両メッシュを生成し、glTF (GLB) として出力する**パイプラインを確立する。

ADR-0006 の中核である「見た目と物理を同一の実寸法仕様から導出する」構造を、
最小構成で実証する。

## 責務の分担（間違えないこと）

| 対象 | 生成場所 |
|------|---------|
| **車両ボディ・ウイング・ホイール・ディスク・キャリパー** | **Blender Python（本タスク）** |
| グランドスタンド・ピットビル・標識・タイヤウォール | Blender Python（後続） |
| トラック路面・縁石・ランオフ・バリア | **UE5 C++（`sim-track` のスプラインから手続き的生成）**。Blender ではない |
| 植生・遠景 | UE5 の PCG / Foliage |
| マテリアル | UE5 Python（`MaterialEditingLibrary`） |

## Allowed Files

```
tools/blender/README.md
tools/blender/blender_env.py          Blender の起動・成否判定の共通処理
tools/blender/build_vehicle.py        Blender 内で実行される生成スクリプト
tools/blender/generate.py             ホスト側の CLI（blender_env を使って呼ぶ）
tools/blender/vehicle_spec_schema.md  spec.json のスキーマ説明
assets/vehicles/gt_proto_a.spec.json  車両仕様 1 台分
assets/vehicles/README.md
tools/blender/tests/test_pipeline.py  パイプラインの自動検証
```

Rust の crate には一切触れないこと。

## Blender 実行規約（厳守。実測に基づく制約）

```
%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe ^
    --background --factory-startup --python <script.py> -- <args...>
```

1. **実行体を直接指定してはならない。**
   `C:\Program Files\WindowsApps\...\Blender\blender.exe` は存在するが
   ACL により **Access Denied** になる。必ずアプリ実行エイリアス経由
2. **`--factory-startup` を必ず付ける。** ユーザー設定に依存しない再現可能な実行のため
3. **stdout / stderr は呼び出し元へ届かない。** `print()` に依存してはならない
4. **スクリプトは必ず JSON サマリファイルを書き出す**（下記の契約）
5. 呼び出し側は **終了コードとサマリファイルの両方**で成否を判定する。
   **終了コード 0 でもサマリが無ければ失敗として扱う**

### サマリファイルの契約

生成スクリプトは、成功・失敗にかかわらず `--summary <path>` で指定された場所へ
次の JSON を書き出すこと。

```json
{
  "ok": true,
  "spec": "assets/vehicles/gt_proto_a.spec.json",
  "output": "build/vehicles/gt_proto_a.glb",
  "blender_version": "5.2.1 LTS",
  "mesh": { "objects": 14, "vertices": 12345, "triangles": 9876 },
  "dimensions_m": { "length": 4.72, "width": 2.05, "height": 1.18, "wheelbase": 2.75 },
  "warnings": [],
  "errors": []
}
```

失敗時は `"ok": false` とし、`errors` に理由を入れる。
例外は捕捉し、**必ずサマリを書いてから**非ゼロ終了すること
（例外で落ちてサマリが無い状態にしない）。

## `spec.json` のスキーマ（Opus が決定。変更禁止）

この 1 ファイルが **見た目（Blender）と物理（Phase 1B の `sim-vehicle`）の共通の正**である。
本タスクで使うのは `dimensions` と `visual` のみだが、
**物理側のフィールドも最初から定義しておく**（後から形式を変えないため）。

単位はすべて SI（m, kg, s, N, rad）。角度はラジアン。

```jsonc
{
  "schema_version": 1,
  "name": "GT Proto A",
  "class": "gt3",                    // 分類の自由文字列

  // --- 寸法。見た目と物理の両方がこれを使う ---
  "dimensions": {
    "length": 4.72, "width": 2.05, "height": 1.18,
    "wheelbase": 2.75,
    "track_front": 1.68, "track_rear": 1.64,
    "front_overhang": 0.98, "rear_overhang": 0.99,
    "ride_height_front": 0.075, "ride_height_rear": 0.085
  },

  // --- 質量特性 ---
  "mass": {
    "total_kg": 1245.0,
    "distribution_front": 0.45,      // 前軸荷重比 0..1
    "cg_height": 0.42,
    "unsprung_kg_per_wheel": 42.0
  },

  // --- タイヤ / ホイール ---
  "tyre": {
    "front": { "radius": 0.345, "width": 0.30, "rim_diameter_in": 18 },
    "rear":  { "radius": 0.355, "width": 0.31, "rim_diameter_in": 18 }
  },

  // --- 以下は Phase 1B（sim-vehicle）で使う。本タスクでは値の保持のみ ---
  "engine": {
    "idle_rpm": 1200, "max_rpm": 7500, "limiter_rpm": 7600,
    "torque_curve": [[1000, 380], [3000, 520], [5000, 560], [6500, 530], [7500, 470]]
  },
  "drivetrain": {
    "layout": "rwd",
    "gear_ratios": [3.15, 2.19, 1.63, 1.29, 1.03, 0.84],
    "final_drive": 3.44,
    "reverse_ratio": 3.00,
    "shift_time_s": 0.06,
    "lsd_power_ratio": 0.45, "lsd_coast_ratio": 0.25
  },
  "aero": {
    "frontal_area": 1.95, "cd": 0.62,
    "cl_front": 1.05, "cl_rear": 1.55,
    "cop_front_x": 1.20, "cop_rear_x": -1.35   // 車両ローカル +X が前方
  },
  "brakes": {
    "max_torque_front": 3600.0, "max_torque_rear": 2100.0,
    "bias_front": 0.62,
    "disc_radius_front": 0.190, "disc_radius_rear": 0.180
  },
  "suspension": {
    "spring_rate_front": 145000.0, "spring_rate_rear": 160000.0,
    "damper_bump_front": 6500.0, "damper_rebound_front": 9500.0,
    "damper_bump_rear": 7000.0,  "damper_rebound_rear": 10500.0,
    "arb_front": 32000.0, "arb_rear": 24000.0,
    "travel_up": 0.055, "travel_down": 0.070
  },

  // --- 見た目のみ。物理は参照しない ---
  "visual": {
    "body_profile": {
      "nose_height": 0.62, "roof_height": 1.14, "roof_start_x": 0.45, "roof_end_x": -0.75,
      "cabin_width": 1.42, "sill_height": 0.34,
      "front_splitter_depth": 0.22, "diffuser_height": 0.18
    },
    "rear_wing": {
      "enabled": true, "span": 1.74, "chord": 0.28,
      "height_above_body": 0.34, "offset_x": -2.05, "angle": 0.14
    },
    "wheel": { "spoke_count": 10, "spoke_width": 0.035, "dish_depth": 0.06 },
    "brake_disc": { "drilled": true, "vane_count": 36 },
    "livery": { "base_color": [0.05, 0.18, 0.42], "accent_color": [0.92, 0.62, 0.05] }
  }
}
```

### 数値の出どころ（ADR-0006 の Reference Workflow）

各数値は**実在の車両カテゴリの公開されている実測寸法・仕様を参照して**決めること。
参照してよいのは寸法・比率・空力形状・素材構成であり、
**実在チーム名 / ドライバー名 / スポンサーロゴ / 特定チームの配色 / 実在サーキット名を
成果物に含めてはならない。** 車両名 `GT Proto A` はオリジナルであり、そのまま使う。

## 生成すべきメッシュ（`build_vehicle.py`）

`spec.json` から次のオブジェクトをパラメトリックに生成する。
**ハードコードした座標を並べるのではなく、必ず spec の数値から算出すること。**

| オブジェクト | 要件 |
|------------|------|
| `body` | `dimensions` と `visual.body_profile` から。断面をロフトして生成。左右対称 |
| `front_splitter` / `rear_diffuser` | `body_profile` から |
| `rear_wing` + 翼端板 | `visual.rear_wing`。`enabled: false` なら生成しない |
| `wheel_fl/fr/rl/rr` | `tyre` の半径・幅から。前後で寸法が異なること |
| `tyre_fl/...` | ホイールと同心。サイドウォールの膨らみを持たせる |
| `brake_disc_*` / `brake_caliper_*` | `brakes.disc_radius_*` から。ホイールの内側に収まること |
| `glass` | キャビン部。ボディとは別マテリアルスロット |
| `cockpit_floor` | 簡易でよい（オンボードカメラの基準面） |

**マテリアルスロット**（名前は固定。UE5 側がこの名前で参照する）:
`M_Body` / `M_Glass` / `M_Carbon` / `M_Tyre` / `M_WheelRim` / `M_BrakeDisc` / `M_Caliper`

Blender 側では割り当てのみ行い、質感は UE5 側で作る（ADR-0006）。

**原点と向き**（変更禁止・UE5 側がこれを前提にする）:
- 原点は**前後軸の中心・左右中心・接地面**（`y = 0` が路面）
- **`+X` が前方、`+Y` が上、`+Z` が右**（`sim-math` の座標規約に一致させる）
- glTF エクスポート時に軸変換が入るため、**エクスポート後の GLB を読み直して
  向きと寸法を検証すること**

## Required Tests（`tools/blender/tests/test_pipeline.py`）

ホスト側の Python（3.10）から実行する。Blender をサブプロセスとして呼ぶ。

| Test | Acceptance |
|------|-----------|
| `test_blender_is_reachable` | エイリアスが存在し、`--background` で `bpy` が使え、サマリが書ける |
| `test_generate_produces_glb` | `gt_proto_a.spec.json` から GLB が生成され、サイズ > 0 |
| `test_summary_contract` | サマリ JSON が上記の全キーを持ち、`ok: true` |
| `test_dimensions_match_spec` | GLB を読み直し、バウンディングボックスが `spec.dimensions` と一致（誤差 < 2%） |
| `test_orientation` | 前方が `+X`、上が `+Y`、接地面が `y = 0`（誤差 < 5 mm） |
| `test_material_slots` | 上記 7 つのマテリアルスロットが全て存在 |
| `test_wheels_are_positioned_from_spec` | 4 輪の中心が `wheelbase` / `track_*` / `tyre.radius` から算出した位置と一致（誤差 < 5 mm） |
| `test_failure_writes_summary` | 不正な spec を渡すと `ok: false` のサマリが書かれ、非ゼロ終了する |
| `test_deterministic_output` | 同じ spec から 2 回生成し、頂点数・三角形数・寸法が完全一致 |

GLB の読み直しには標準ライブラリのみを使うこと（GLB はチャンク構造 + JSON なので
`struct` と `json` で読める）。外部ライブラリを追加しない。

## Acceptance Criteria

1. **人間の GUI 操作ゼロ**でコマンドから GLB が生成できる（= M9）
2. 上記テストが全通過
3. 生成物 `build/vehicles/*.glb` は `.gitignore` に入れ、**コミットしない**
   （`spec.json` と生成スクリプトが正であり、成果物は再生成可能であること）
4. `tools/blender/README.md` に起動方法・stdout が使えない制約・サマリ契約を記載
5. 三角形数: LOD0 で **60 000 〜 150 000 tri**（24 台で VRAM 予算に収まる範囲）

## Out of Scope
- マテリアルの質感（UE5 側）
- LOD チェーン（後続）
- リバリーのテクスチャ（後続）
- 内装の作り込み
- トラックメッシュ（UE5 C++ 側）

---

# TASK-05-1 — UE5 プロジェクトの Code-First 構築

## Goal

UE5 プロジェクトを **すべてテキストとスクリプトから**構築し、
ADR-0004 の Code-First 運用制約が実務で成立することを実証する（= M7）。

## Allowed Files

```
ue/RaceSpectator.uproject          (JSON。テキスト)
ue/Config/DefaultEngine.ini
ue/Config/DefaultGame.ini
ue/Config/DefaultInput.ini
tools/ue_python/README.md
tools/ue_python/ue_env.py          UnrealEditor-Cmd の起動・成否判定
tools/ue_python/build_scene.py     レベル生成・アクタ配置・ライティング
tools/ue_python/import_vehicle.py  GLB インポート + マテリアル割り当て
tools/ue_python/capture.py         HighResShot によるスクリーンショット取得
tools/ue_python/measure.py         stat unit / stat gpu / VRAM の記録
docs/phase-0.5-results.md          M1〜M9 の実測結果（本タスクで作成）
.gitignore                         (ue/ の生成物を除外)
```

## Code-First 運用制約（ADR-0004。違反は HIGH）

1. **Blueprint にロジックを書かない。** ロジックは C++ のみ。BP は薄いラッパのみ
2. **エディタ GUI の手作業を「正」としない。** レベル・マテリアル・ライティングは
   `tools/ue_python/*.py` を唯一の正とする
3. **レンダラ設定は `Config/DefaultEngine.ini` にテキストで持つ。**
   GUI の Project Settings で直接いじらない
4. トラックは手続き的生成（`sim-track` のデータから）
5. 視覚検証は `HighResShot` の自動取得 + 人間レビューの 2 段構え
6. **UE 側の C++ は薄く保つ。** ロジックは Rust core 側にあるため、
   UE C++ は「Snapshot を受け取って描画状態に反映する」だけに限定する

## ヘッドレス実行

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" ^
    "<abs path>\ue\RaceSpectator.uproject" ^
    -run=pythonscript -script="<abs path>\tools\ue_python\build_scene.py" ^
    -unattended -nosplash -nullrhi
```

**注意**: `-nullrhi` は描画を伴わない処理でのみ使う。
スクリーンショット取得や性能計測では外すこと。

## レンダラ設定の方針（`DefaultEngine.ini`）

**重要**: UE 5.8 の cvar 名を推測で書き込まないこと。
下記は**達成すべき意図**であり、実際の設定キーは
`UnrealEditor-Cmd` で適用後の値を読み出して**必ず検証**すること。
検証できなかった項目は `docs/phase-0.5-results.md` に「未確認」と明記する。

| 目的 | 意図する設定 |
|------|------------|
| 動的 GI | Lumen を有効化 |
| 反射 | Lumen 反射。**ハードウェアレイトレーシングを有効化**（Ada の RT コアを使う） |
| ジオメトリ | Nanite を有効化 |
| シャドウ | Virtual Shadow Maps |
| アンチエイリアス | TSR（DLSS プラグインが入るまでの既定）。導入後は DLSS Quality |
| 露出 | 自動露出は**手動固定**（放送映像の一貫性のため。勝手に明滅させない） |
| モーションブラー | 有効。パーオブジェクト。**回転ホイールのモーションベクタを確認すること** |
| テクスチャストリーミング | プールサイズを VRAM 予算 7.0 GB 以内に収まる値へ |
| 解像度 | 1920x1080 |

**Frame Generation は使わない**（PROJECT.md §6）。

## Required Verification（M1〜M9）

`docs/phase-0.5-results.md` に**実測値**を記録すること。推測値を書かない。

| ID | 内容 | 合格基準 | 測定方法 |
|----|------|---------|---------|
| M1 | 画質 | 実写中継のスクショと並べて遜色ないか | `HighResShot` + 人間判定 |
| M2 | 車体反射の安定性 | 走行中にちらつかない | 動画録画 + 目視 |
| M3 | GPU frame time | **<= 14.0 ms** @1080p | `stat gpu` |
| M4 | **VRAM** | **<= 7.0 GB** | `nvidia-smi` 実測 |
| M5 | モーション品質 | ghosting / smearing / **ホイール artifact** なし | 高速パン録画 |
| M6 | 物理カメラ | 焦点距離 300 mm 相当で中継の圧縮感が出る | CineCamera |
| M7 | **AI Coding 適合度** | **人間の GUI 作業ゼロ**で車両 1 台を配置しマテリアル設定 | 実行ログ |
| M8 | Rust core 接続 | `sim-ffi` 経由で Transform を受けて描画 | 動作確認 |
| M9 | アセット全自動 | spec → Blender → glTF → UE5 → マテリアル | 実行ログ |

シーン: 直線 + 1 コーナー、車両 **24 台**（うち 6 台は近景 LOD0）、動的太陽、
路面、ガードレール、放送カメラ 1 台。

## Acceptance Criteria

1. `ue/` 以下が **すべてテキストファイル**から構築できる（`.uasset` を手作業で作らない）
2. `UnrealEditor-Cmd.exe -run=pythonscript` がヘッドレスで完走する
3. M1〜M9 の実測値が `docs/phase-0.5-results.md` に記録される
4. **M7 で人間の GUI 作業が発生した場合、その内容と所要時間を必ず記録する**
   （これが Fallback 判定の根拠になる）
5. `ue/` の生成物（`Binaries` `Intermediate` `Saved` `DerivedDataCache`）は `.gitignore`

## Known Risks

| Risk | 対策 |
|------|------|
| UE 5.8 の cvar 名が想定と異なる | 推測で書かず、適用後の値を読み出して検証。未確認は明記 |
| 8 GB VRAM で 24 台が乗らない | 共有マスターマテリアル + 2K livery + LOD。M4 が不合格なら Fallback を諮る |
| Python Editor API で届かない設定がある | **届かなかった項目を必ず列挙する。** これが M7 の判定そのもの |
| C++ ビルド時間が開発速度を殺す | UE 側 C++ を薄く保つ。ロジックは Rust core へ |

## Out of Scope
- ゲームプレイ実装
- 製品用アセットの作り込み
- Unity との比較（ADR-0004 で UE5 に確定済み）
