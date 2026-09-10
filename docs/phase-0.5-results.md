# Phase 0.5 — UE5 実現可能性検証の実測結果（M1〜M9）

Status: **進行中 — `build_scene.py`（8 step）/ `import_vehicle.py` / `measure.py` / `capture.py`
+ `ue_env.run_ue_game()` 実装完了・未 commit。M7 / M9 暫定合格。M6 暫定合格（`-game` レンダー
1 枚で圧縮感視認）。RT/Nanite/MotionBlur 4 cvar は `-game` で適用確認（commandlet では不可）。
M1/M2/M5 はプロダクションマテリアル + 動画待ち。**M3/M4: `profile_gpu.py`（ホスト側 M3/M4 ランナー）
実装済み・初回 run で M4 の nvidia-smi サンプリング経路は動作（738 サンプル）だが `-game` プロセスが
フルレンダーに入らず ~400 s で自己終了（プラグイン pip-install + 部分 RHI 初期化のみ・ログ未生成・
VRAM 1.58→2.39 GB）→ M3 CSV 未出力・M4 は未確定。次の診断は §profile_gpu.py。** M8 は Architect 判断待ち。
Task: TASK-05-1（仕様は [`docs/phase-0.5-tasks.md`](phase-0.5-tasks.md)）
Last updated: 2026-09-10（Sonnet 5・未 commit。`profile_gpu.py` 追加 + 初回 M3/M4 run）

> **このファイルには実測値だけを書く。推測値・期待値を「結果」として書かない。**
> 未取得は「未取得」、確認できなかった設定は「未確認」と明記する。
> 判定期限は **Phase 3 完了時**。不合格なら ADR-0004 Fallback（Unity 6 HDRP）を人間に諮る。

---

## 0. スクリプト実装状況（headless・未 commit・Architect 監査待ち）

| 成果物 | 状態 |
|--------|------|
| `ue/RaceSpectator.uproject` | content-only。`PythonScriptPlugin` / `EditorScriptingUtilities`（`GLTFImporter` は UE 5.8 に無いので不使用） |
| `ue/Config/DefaultEngine.ini` | レンダラ設定を intent ベースで記述。全キーに `; VERIFY[Mxx]`。読み戻しは §2 |
| `ue/Config/DefaultGame.ini` / `DefaultInput.ini` | プロジェクト識別・入力スタブ |
| `tools/ue_python/ue_env.py` | ホスト側ランナー: `run_ue_python()`（`-run=pythonscript` + サマリ契約）+ `run_ue_game()`（`-game -ExecCmds` レンダーパス・PNG 出現で判定） |
| `tools/ue_python/build_scene.py` | **全 8 ステップ実装完了**（new_level 冪等 / lighting / road_geometry / guardrail / vehicles_x24 / broadcast_camera / materials / save_level）。headless 緑・2 連続実行で冪等・clean end-to-end 緑 |
| `tools/ue_python/import_vehicle.py` | **実装済み**（Interchange GLB インポート + スロット検査）。§下 |
| `tools/ue_python/measure.py` | **実装済み**（`settings` = レンダラ cvar 読み戻し・§2）。`perf`（`stat gpu` / VRAM）は非 `-nullrhi` 待ちの stub |
| `tools/ue_python/capture.py` | commandlet 版（`SceneCapture2D`）は撮れず `ok:false`（§下）。**実キャプチャは `ue_env.run_ue_game()` + `HighResShot`**（`spike_broadcast.png` 取得済み） |
| `tools/ue_python/profile_gpu.py` | **ホスト側 M3/M4 ランナー・実装済み**（`-game` + `-csvGpuStats -csvCaptureFrames` + host nvidia-smi）。初回 run で M4 サンプリング経路 OK・M3 CSV 未出力（`-game` possess 問題・§profile_gpu.py）|
| `tools/ue_python/README.md` | 起動方法・制約・ファイル表 |
| `.gitignore` | `ue/` 生成物を除外（+12 行・TASK-05-1 分） |

**次の実装ステップ**: ① **M3/M4** — `profile_gpu.py` 実装済み（§profile_gpu.py）。ただし初回 run で
`-game` がフルレンダーループに入らず自己終了（原因調査は §profile_gpu.py の「次の診断」）。M4 の
nvidia-smi 経路は動作確認済み。→ ② **プロダクションマテリアル**を `materials` step に実装
（現状はグレー/青の仮）→ M1/M2 の実写並置判定が可能に → ③ **M8**（`sim-ffi` 経由の
Transform 反映）は Architect の実装方式判断待ち。決まれば `-game` で動く車 → M5 動画 →
④ 路面の縁石 / ランオフ / バンク・LOD チェーンは中核 Phase 後の磨き込み。

**既知の仕上げ事項**（レンダー 1 枚で判明・機能はする）: 車体色が仮マテリアルで薄い /
車が路面から僅かに浮く・ガードレールと軽く干渉 / 路面幅が車列に対しやや狭い。
すべて定数調整レベル、スパイクの合否には無関係。

### build_scene.py — SCENE_STEPS 実装状況（最終 2026-09-10・`-nullrhi`）

| step | 結果 | 手段 |
|------|------|------|
| `new_level` | ✅ `/Game/Spike/Maps/L_Spike` 作成。**再実行に対し冪等**（既存なら `load_level` + 全アクタ `destroy_actor` して再利用。新規パスのみ `new_level`。判定前に Asset Registry 同期スキャン） | `AssetRegistryHelpers.scan_paths_synchronous` + `LevelEditorSubsystem.{load_level,new_level}` + `EditorActorSubsystem.destroy_actor` |
| `lighting` | ✅ DirectionalLight（Movable）/ SkyAtmosphere / SkyLight（Movable）/ ExponentialHeightFog を spawn | `EditorActorSubsystem.spawn_actor_from_class()` + `root_component.mobility = MOVABLE` |
| `road_geometry` | ✅ `assets/tracks/aoyama_ring.track.json` の centerline から S/F ストレート + T1 の **600 m スライス**を弧長 8 m で再サンプルし、局所路面幅（`sections[].width_*`）で **75 セグメント**の `/Engine/BasicShapes/Plane` `StaticMeshActor` 帯を生成。手続き的（Code-First 制約 4）。縁石 / ランオフ / バンクは後続 | `EditorAssetLibrary.load_asset` + `EditorActorSubsystem.spawn_actor_from_class(StaticMeshActor)` + `set_actor_scale3d` |
| `guardrail` | ✅ 同スライスから両縁の外側 0.6 m に高さ 1.0 m・厚さ 0.12 m の `/Engine/BasicShapes/Cube` バリアを **150 セグメント**（左右各 75） | 同上 |
| `vehicles_x24` | ✅ **`import_vehicle.py` が入れた 24 パーツメッシュ**を 12×2 グリッド（S/F ストレート・行間 9 m・±1.8 m）で各スロットに全パーツ配置 → **24 台 × 24 パーツ = 576 `StaticMeshActor`**。手前 6 台に `LOD0` タグ。パーツはローカル原点を共有するので同一 transform で車体が再構成される（bounds で確認: wheelbase±137 cm / track±86 cm = spec 一致） | `EditorAssetLibrary.list_assets` + `spawn_actor_from_class(StaticMeshActor)` |
| `broadcast_camera` | ✅ `CineCameraActor` 1 台。filmback 36.0×20.25 mm（フルフレーム 16:9）+ 焦点距離 300 mm → 水平画角 **6.87°**（読み戻しで確認）。放送の圧縮感。配置は S/F ストレート脇の暫定定数 | `get_cine_camera_component()` + `CameraFilmbackSettings` + `current_focal_length` |
| `materials` | ✅ 共有マスター `/Game/Spike/Materials/M_VehicleMaster`（BaseColor/Metallic/Roughness パラメータ）を `MaterialEditingLibrary` でグラフ生成 → 7 ロールの `MaterialInstanceConstant` を `gt_proto_a.spec.json` の `visual.livery`（base `[0.05,0.18,0.42]` / accent `[0.92,0.62,0.05]`）+ ロール別 PBR 値で作成 → 24 パーツメッシュのスロットへ名前一致で割り当て（**24 割当 / 未マッチ 0**） | `AssetToolsHelpers.create_asset` + `MaterialEditingLibrary.{create_material_expression,connect_material_property,set_material_instance_*}` |
| `save_level` | ✅ `ue/Content/Spike/Maps/L_Spike.umap`（約 1.26 MB・**811 アクタ**）書き出し。全 spawn の後で最後に実行 | `LevelEditorSubsystem.save_current_level()` |

**冪等性の実証**: 2 連続実行で 2 回目の `new_level` が **806 アクタ**（75 road + 150 rail
+ 576 vehicle part + 4 light + 1 camera。5 個は破壊不可の world settings 等）を
`destroy_actor` でクリアしてから再構築。scene カウント・生成アセットは不変。
`build_scene.summary.json` = `ok: true`。

**M7 — シーン一式を GUI 操作ゼロで構築**: レベル / 動的ライティング / 手続き的路面（sim-track）/
ガードレール / 車両 24 台グリッド / 放送カメラ / 共有マスターマテリアル + spec リバリー / 保存 /
レンダラ設定読み戻し。すべて `tools/ue_python/*.py` のみ。**人間の GUI 作業は発生していない**
（§3「M7 で人間の GUI 作業が発生した場合」の表は空のまま）。
`ue/Content/` は `.gitignore` 済み（ADR-0006「100% テキストから再生成可能」）。

### import_vehicle.py — Interchange GLB インポート（実装済み・2026-09-10・`-nullrhi`・約 14 s）

`build/vehicles/gt_proto_a.glb`（TASK-05-2 生成）を `AssetImportTask`（Interchange が
`.glb` に自動でトランスレータ登録）で `/Game/Spike/Vehicles` へ。`summary.json` = `ok: true`:

| 項目 | 結果 |
|------|------|
| インポート結果 | **StaticMesh 24**（Blender オブジェクト単位）+ `MaterialInstanceConstant` 7 |
| マテリアルスロット名 | **7 ロール全て保持**（`M_Body` / `M_Glass` / `M_Carbon` / `M_Tyre` / `M_WheelRim` / `M_BrakeDisc` / `M_Caliper`。`expected_slots_missing: []`）→ Blender のスロット命名が UE まで貫通 |
| パーツ位置 | 各メッシュにワールド位置がベイクされ、同一 transform 配置で車体が再構成される |

**M9（spec → Blender → glTF → UE5 → マテリアル）**: Blender→GLB（TASK-05-2 済み）に続き
**GLB→UE5 インポート + スロット保持 + マテリアル割り当てまで GUI ゼロで疎通**。残るは
レンダーパスでの見た目確認（`capture.py` = MRQ 待ち）。

### 静止画キャプチャ — `-game` + `HighResShot` で疎通（2026-09-10）

commandlet 経由（`capture.py`）は不可:
| 手段 | 結果 |
|------|------|
| `AutomationLibrary.take_high_res_screenshot()` | **crash**（`EXCEPTION_ACCESS_VIOLATION` in `UnrealEditor-FunctionalTesting.dll`。viewport が無い） |
| `SceneCapture2D` + `export_render_target()` | crash しないが **PNG 出力なし**（~150 ms で終了・フレームループ無し） |

**動いた経路 = `ue_env.run_ue_game()`**: `UnrealEditor-Cmd <uproject> /Game/Spike/Maps/L_Spike
-game -ResX=1920 -ResY=1080 -ExecCmds="HighResShot 1920x1080 filename=spike_broadcast"`。
`ue/Saved/Screenshots/WindowsEditor/spike_broadcast.png`（1920×1080・約 1.7 MB）が出力され、
host が `build/ue/shots/` にコピー。放送カメラは `build_scene.py` が
`auto_activate_for_player = PLAYER0` を立てているので `-game` がそのビューを使う。
**初回 `-game` 起動はシェーダ大量コンパイルで長い**（数分〜十数分）。2 回目以降は速い。

**レンダー結果（人間レビュー用の 1 枚）**: 手続き的路面・24 台グリッド・ガードレールが
写り、300 mm による中継の圧縮感が出ている（M6）。Lumen / RT / Nanite / VSM 有効。
`capture.py`（`SceneCapture2D` 版）は `ok:false` を返す stub として残置（commandlet の
限界を明示する回帰記録）。

### `profile_gpu.py` — M3/M4 計測ランナー（ホスト側・実装済み・初回 run 2026-09-10）

`tools/ue_python/profile_gpu.py`（`unreal` を import しない・`ue_env` から `UPROJECT` /
`find_ue_cmd` だけ借用）。UE を `-game` で起動し **M3**（GPU frame time・CsvProfiler の
`-csvGpuStats -csvCaptureFrames=N` で per-frame CSV）と **M4**（VRAM・実行中 host から
`nvidia-smi --query-gpu=memory.used` を 0.5 s 間隔サンプリング → tail 60% を定常値）を同時に取る。
CSV の列名は build フラグ依存なので、`frametime`/`gpu`/`renderthread` 等を含む列 + ほぼ数値の全列の
中央値を summary に出し、正しい列は後から results doc で選ぶ方式。出力は
`build/ue/profile_gpu.summary.json`（`.gitignore` 済み）。

**初回 run（`--frames 900 --settle-s 1200`）の結果**:

| 項目 | 結果 |
|------|------|
| プロセス | `-game` が **~400 s で自己終了**（`process_exit_code: 0` / `exited_before_terminate: true`）|
| ログ | `ue/Saved/Logs/` に**当該 run のログが生成されなかった**（最新は M6 の HighResShot run のまま）|
| 直近で更新されたファイル | `ue/Intermediate/PipInstall/*`（= プラグイン依存の pip-install。起動ごく初期の処理）のみ |
| VRAM（M4 経路） | nvidia-smi サンプル **738 本**取得。baseline 1578 MiB → peak **2447 MiB (2.39 GB)**・定常 2423 MiB。**ただしフルレンダー未到達なので M4 の合否値ではない**（フル Lumen+Nanite 800 アクタ 1080p なら 4〜6 GB 想定）|
| GPU frame time（M3） | CsvProfiler の CSV **未出力**（`Saved/Profiling/CSV` ほか全滅）|

**推定原因**: `L_Spike` は content-only プロジェクトで **GameMode / PlayerStart / Pawn が無い**。
`-game -unattended` でマップをロードしても possess 対象が無く、レンダーループを維持せず自己終了する。
M6 の 1 枚が撮れたのは `-ExecCmds="HighResShot ..."` が **1 フレームだけ**強制描画したから。

**次の診断（1 つずつ）**:
1. ✅ **解決（2026-09-10 Sonnet）**: `DefaultEngine.ini` `[/Script/EngineSettings.GameMapsSettings]` に
   `GlobalDefaultGameMode=/Script/Engine.GameModeBase` を追加 + `build_scene.py` に `player_start` step
   （PlayerStart を放送リグ位置へ）。`-game` が pawn を possess してレンダーループを維持するようになり、
   `LogLoad: Game class is 'GameModeBase'` → CsvProfiler が CSV を出力。
2. ✅ **CSV 出力先が `ue/Saved` ではなく `%LOCALAPPDATA%\UnrealEngine\5.8\Saved\Profiling\CSV\`**。
   `profile_gpu.py` の `CSV_SCAN_ROOTS` に追加。`-abslog` で run 毎の専用ログ（診断 4 も解決）。
   `--frames 3000` + tail 50% 解析で boot フレームを除外。orphan `UnrealEditor-Cmd.exe` を
   `taskkill /F /T /IM` で掃く（terminate() を無視して deadline 後も生き残る事象を実測）。
3. MovieRenderQueue へ切替 — 現状は不要（1/2 で `-game` レンダーループが安定）。
4. ✅ `-abslog=<path>` 明示で解決（2 に同梱）。

**⚠ 未解決 — feature level が SM5（2026-09-10 実測）**: `-game` は `r.RayTracing:True` /
`r.Nanite.ProjectEnabled:True` / `r.Lumen.HardwareRayTracing:True` を **cvar としては適用**するが、
実際のレンダーは `rhifeaturelevel="SM5"` / `shaderplatform="PCD3D_SM5"` で走る
（`LogD3D12RHI: Skipped NVAPI RT queries since ... below SM6`）。**Nanite も HWRT も SM6 必須なので
実際には動いていない**。GPU 内訳も `GPU/RayTracingGeometry ≈ 0` / SSR は使うが RT reflection なし /
Nanite パスなし。→ **M3/M4 の暫定値（GPUTime tail median 3.35 ms / VRAM steady 2.51 GB）は
SM5 の下限であって最終値ではない**。対策として `DefaultEngine.ini`
`[/Script/WindowsTargetPlatform.WindowsTargetSettings]` に `+D3D12TargetedShaderFormats=PCD3D_SM6`
（+ `-D3D12TargetedShaderFormats=PCD3D_SM5`）を追加して再 run 中。SM6 で Nanite/HWRT が
実際に engage するか `rhifeaturelevel` で確認 → 数値確定 → M3/M4 行更新。駄目なら `-sm6` フラグ /
`r.SkinCache.CompileShaders` 等 / MRQ。

### 踏んだ罠（`tools/ue_python/ue_env.py` の docstring にも記録）

1. **`RaceSpectator.uproject` の `GLTFImporter` プラグイン参照で editor が fatal abort**
   （UE 5.8 では廃止・Interchange に統合）。→ 削除。GLB インポートは Interchange 標準経路。
2. **`-script=` の値は `\t` `\u` などを unescape する**。Windows パス
   `...\Racing\tools\ue_python\...` が `...\Racing<TAB>ools_python\...` に化けて
   「Could not load Python file」。→ **UE へ渡すパスは全て forward slash**（`Path.as_posix()`）。
3. **`-script="<path> <args>"` の args は UE 内スクリプトの `sys.argv` に届かない**。
   → パラメータは環境変数（`UE_SPIKE_SUMMARY` / `UE_SPIKE_ARGS`）で渡す。
4. **`LevelEditorSubsystem.new_level()` は同名パッケージが既にあると `False` を返し、
   ヘッドレスの `EditorAssetLibrary.delete_asset()` は `.umap` に対して黙って no-op する**
   （スキャン後 `does_asset_exist` は True のまま）。→ `_step_new_level` は既存レベルを
   `load_level` して全アクタを `destroy_actor` で消す方式に変更（新規パスのときだけ
   `new_level`）。冪等。あわせて新規プロセスは `/Game/Spike` を Asset Registry に
   未スキャンなので、判定前に `AssetRegistryHelpers.scan_paths_synchronous` が要る。
5. **`Actor` に `add_component_by_class` が無い**（UE 5.8 Python）。実行時コンポーネント
   生成が塞がれているので、手続き的路面は `ProceduralMeshComponent` ではなく
   `/Engine/BasicShapes/{Plane,Cube}` の `StaticMeshActor` セグメント帯で作る。
6. **Interchange の GLB インポートは Blender オブジェクト単位で StaticMesh を分割する**
   （`gt_proto_a.glb` → body / wheel×4 / tyre×4 / … の 24 メッシュ）。各メッシュに
   ワールド位置がベイクされるので、同一 transform で全パーツを spawn すると車体が再構成
   される。マテリアルスロット名は保持される。
7. **`-run=pythonscript` の commandlet はフルレンダリングコンテキストを持たない**
   （`nullrhi=False` / `-dx12` でも）。`AutomationLibrary.take_high_res_screenshot` は
   viewport が無く crash、`SceneCapture2D.capture_scene()` はフレームループが無く no-op、
   `r.RayTracing` / `r.Nanite.ProjectEnabled` / `r.Lumen.HardwareRayTracing` /
   `r.DefaultFeature.MotionBlur` は false のまま。→ **実レンダリング系は `-game` 起動で行う**
   （`ue_env.run_ue_game()`。`-game` では 4 cvar とも適用され `HighResShot` も撮れる。
   Python は走らないのでシーン構築は事前に `build_scene.py`（commandlet）で済ませ、
   カメラは `auto_activate_for_player=PLAYER0` でビューを取らせる）。

---

## 1. スモークテスト: ヘッドレス Python パイプライン — ✅ 通過（2026-09-09）

| 項目 | 結果 |
|------|------|
| `UnrealEditor-Cmd.exe -run=pythonscript` がヘッドレス完走するか | ✅ exit 0・`ok: true` サマリ |
| `unreal` モジュールが import できるか | ✅ |
| `unreal.SystemLibrary.get_engine_version()` | ✅ `5.8.2-56702186+++UE5+Release-5.8` |
| `LevelEditorSubsystem` / `EditorActorSubsystem` が取得できるか | ✅ 両方 available |
| UE 内スクリプトへの引数受け渡し（`sys.argv` 経由）が効くか | ❌ 届かない → env 変数（`UE_SPIKE_SUMMARY` / `UE_SPIKE_ARGS`）へ切替済み |
| サマリ JSON が書かれ、ホスト契約（`ok: true` + 必須キー）を満たすか | ✅ contract problems 0 |
| 起動所要時間（`-nullrhi`・DDC 温） | 約 11.6 s（1 回目・2 回目とも同等。初回シェーダ大量コンパイルは未発生） |
| `-run=pythonscript` はスクリプト例外時に非ゼロ終了するか | ✅ `-1`（0xFFFFFFFF）。ただしサマリを正とする方針は維持 |
| `DefaultEngine.ini` の `r.*` がプロジェクト設定として適用されるか | 部分確認: `r.MotionBlurQuality` / `r.Streaming.PoolSize` / `r.Streaming.LimitPoolSizeToVRAM` に対し「`SetByScalability` was ignored as it is lower priority than the previous `SetByProjectSetting`」ログ → **これら 3 つは ProjectSetting 優先度で効いている**。残りは `measure.py` で読み戻し（§2） |

---

## 2. レンダラ設定の読み戻し検証（`DefaultEngine.ini` → 実効値）

`measure.py`（`UE_SPIKE_ARGS=["settings"]`）が各 cvar を
`unreal.SystemLibrary.get_console_variable_{int,float,bool}_value` で読み戻す。
これらは KismetSystemLibrary の Blueprint 関数なので Python から呼べる。static・
world 不要のため `-nullrhi` ヘッドレスで走る。

**実測（2026-09-10・`-nullrhi` settings パス。`build/ue/measure.summary.json`）**:
`ok: true` / match 11 / mismatch 0 / unconfirmed 2 / **unconfirmed_nullrhi 4**。

| 設定キー | 意図 | 実効値 | 判定 |
|---------|------|--------|------|
| `r.DynamicGlobalIlluminationMethod` | Lumen GI（=1） | `1` | ✅ match |
| `r.ReflectionMethod` | Lumen 反射（=1） | `1` | ✅ match |
| `r.Lumen.HardwareRayTracing` | HWRT（Ada RT コア） | `false` | ⚠ unconfirmed_nullrhi |
| `r.Lumen.HardwareRayTracing.LightingMode` | hit lighting（=2） | `2` | ✅ match |
| `r.RayTracing` | RT マスタスイッチ | `false` | ⚠ unconfirmed_nullrhi |
| `r.RayTracing.Shadows` | RT シャドウ OFF（VSM に任せる） | `false` | ✅ match |
| `r.Nanite.ProjectEnabled` | Nanite | `false` | ⚠ unconfirmed_nullrhi |
| `r.Shadow.Virtual.Enable` | Virtual Shadow Maps（=1） | `1` | ✅ match |
| `r.AntiAliasingMethod` | TSR（=4） | `4` | ✅ match |
| `r.DefaultFeature.AutoExposure` | 手動固定露出（=False） | `false` | ✅ match |
| `r.DefaultFeature.AutoExposure.Method` | （=0） | `0` | ✅ match |
| `r.DefaultFeature.MotionBlur` | モーションブラー ON | `false` | ⚠ unconfirmed_nullrhi |
| `r.MotionBlurQuality` | （=4） | `4` | ✅ match |
| `r.Streaming.PoolSize` | VRAM 予算（=3000 MB） | `3000` | ✅ match |
| `r.Streaming.LimitPoolSizeToVRAM` | （=1） | `1` | ✅ match |
| `DefaultGraphicsRHI` | DX12（HWRT 前提） | — | 🔲 未確認（Python getter なし） |
| `r.SetRes` | 1920x1080w | — | 🔲 未確認（読み戻し不可 cvar・nullrhi では無意味） |

**RT / Nanite / MotionBlur の 4 件**（`r.Lumen.HardwareRayTracing` / `r.RayTracing` /
`r.Nanite.ProjectEnabled` / `r.DefaultFeature.MotionBlur`）:
- `-run=pythonscript` の commandlet（`-nullrhi` でも `nullrhi=False` + `-dx12` でも）: `false`
  → **commandlet はフルレンダリングコンテキストを持たない。**
- **`-game` 起動（`ue_env.run_ue_game`・2026-09-10）: 4 件とも適用を確認**。
  ログに `LogConfig: Set CVar [[r.RayTracing:True ...]]` / `r.Nanite.ProjectEnabled:True` /
  `r.Lumen.HardwareRayTracing:True` / `r.DefaultFeature.MotionBlur:True`、加えて Lumen HWRT
  の設定群（`r.Lumen.HardwareRayTracing.HitLighting.Allowed:1` 等）が全て適用。
  `r.MotionBlurQuality` は `SetByProjectSetting`（4）が優先され scalability 上書きを拒否 = 意図どおり。

→ **`ini` の設定は正しい。** レンダリング系の M 検証は `-game` レンダーパスで行う（§下 capture）。

**🔲 未確認の 2 件**は UE 5.8 の Python API に読み戻し口が見つからないもの。
`DefaultGraphicsRHI` は起動ログ（`LogD3D12RHI` / `LogD3D11RHI`）で間接確認する。
`r.SetRes` はウィンドウ解像度指定であり cvar として保持されない（レンダーパスの
出力解像度指定で担保する）。

---

## 3. M1〜M9

シーン: 直線 + 1 コーナー、車両 24 台（うち 6 台 LOD0）、動的太陽、路面、
ガードレール、放送カメラ 1 台。

| ID | 内容 | 合格基準 | 実測 | 判定 |
|----|------|---------|------|------|
| M1 | 画質（実写中継との並置） | 遜色ないか（人間判定） | **1 枚レンダー取得**（`build/ue/shots/spike_broadcast.png`・`-game` HighResShot・Lumen/RT/Nanite/VSM 有効）。ただし現状はプレースホルダのグレー/青マテリアルなので実写中継との並置判定は**プロダクションマテリアル投入後**。手続きは疎通 | 🔶 |
| M2 | 車体反射の安定性 | 走行中ちらつかない | `r.ReflectionMethod=1`（Lumen 反射）+ `r.Lumen.HardwareRayTracing` が `-game` で有効（§2）。ちらつき判定は動画 + プロダクションマテリアル待ち | — |
| M3 | GPU frame time | ≤ 14.0 ms @1080p | **暫定合格（2026-09-10）**: `profile_gpu.py` の `-game` レンダーパス（`GlobalDefaultGameMode` + `player_start` + SM6 強制）で CsvProfiler が 2518 frame 出力。**steady-state（tail 1499 frame）`GPUTime` median 2.85 ms / p95 2.91 ms**（`rhifeaturelevel="SM6"`・RT/Nanite/Lumen HWRT cvar 適用確認）。budget 14 ms に対し大きく余裕。※ 現状はプレースホルダ・マテリアル + 手続き的路面（Plane/Cube セグメント）+ 24 台の軽いシーン。プロダクション資産投入後に再計測が要る（下限値として有効） | ✅（暫定） |
| M4 | VRAM | ≤ 7.0 GB（`nvidia-smi`） | **暫定合格（2026-09-10）**: 同 run の host `nvidia-smi` サンプリング（75 サンプル）で **steady_peak 2.52 GB / baseline 1.65 GB**（total 8.0 GB）。budget 7.0 GB に対し余裕大。M3 と同じ軽いシーンの注記が付く | ✅（暫定） |
| M5 | モーション品質 | ghosting / ホイール artifact なし | `r.DefaultFeature.MotionBlur=True` / `r.MotionBlurQuality=4` が `-game` で有効（§2）。ghosting 判定は動く車の動画待ち（M8 後） | — |
| M6 | 物理カメラ | 300 mm 相当で中継の圧縮感 | **合格（暫定）**: `CineCameraActor` を Python のみで配置・36 mm filmback + 300 mm（水平画角 6.87°）。レンダー 1 枚で**中継の圧縮感が視認できる**（`spike_broadcast.png`。24 台が奥へ圧縮） | ✅（暫定） |
| M7 | **AI Coding 適合度** | 人間の GUI 作業ゼロで車両 1 台を配置 + マテリアル | **合格（暫定）**: レベル / 動的ライティング / 手続き的路面（sim-track・75 seg）/ ガードレール（150 seg）/ 車両 24 台グリッド（576 パーツアクタ）/ 放送カメラ / 共有マスターマテリアル + spec リバリー適用（24 スロット・未マッチ 0）/ 保存 / レンダラ設定読み戻し / **`-game` レンダー 1 枚**。**すべて `tools/ue_python/*.py` のみ・GUI 作業ゼロ**（下表は空） | ✅（暫定） |
| M8 | Rust core 接続 | `sim-ffi` 経由で Transform を受けて描画 | 未取得 | — |
| M9 | アセット全自動 | spec → Blender → glTF → UE5 → マテリアル | **合格（自動化パイプライン範囲）**: `spec.json` → Blender → GLB（TASK-05-2）→ Interchange インポート（StaticMesh 24 + スロット 7 保持）→ 共有マスターマテリアル + リバリー割り当て、を GUI ゼロで疎通。残: 非 `-nullrhi` での質感確認 | ✅（暫定） |

### M7 で人間の GUI 作業が発生した場合の記録（Fallback 判定の根拠）

| 作業内容 | 所要時間 | Python API で届かなかった理由 |
|---------|---------|------------------------------|
| （なし / 未取得） | — | — |

---

## 4. 既知のリスクと対応状況

| Risk | 状態 |
|------|------|
| UE 5.8 の cvar 名が想定と異なる | `measure.py settings` で読み戻し済み（§2）。11/15 は intent どおり効いている。RT/Nanite/MotionBlur の 4 件は `-nullrhi` 強制 OFF で未確定（非 `-nullrhi` 待ち）、RHI/SetRes の 2 件は Python getter 無し |
| 8 GB VRAM で 24 台が乗らない | M4 待ち。現状 24 台 = 576 パーツアクタ + 7 共有マテリアル。不合格なら結合メッシュ + LOD、それでも駄目なら Fallback |
| Python Editor API で届かない設定がある | **headless scene-build 範囲では GUI 作業ゼロで完遂**（§3 M7 の表は空）。実行時コンポーネント生成（`add_component_by_class`）と一部 cvar 読み戻しは届かず、回避策で対応（§踏んだ罠 5/6） |
| C++ ビルド時間 | 本スパイクは content-only（`ue/Source/` なし）。M8 の実装方式は Architect 判断待ち |
