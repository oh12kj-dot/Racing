# tools/ue_python/ — UE5 Code-First スパイクのスクリプト群

Phase 0.5 / TASK-05-1。UE5 プロジェクト（`ue/`）を **すべてテキストとスクリプトから**
構築・計測し、ADR-0004 の Code-First 運用が実務で成立するか（= M7）を実測する。

**仕様の正**: [`docs/phase-0.5-tasks.md`](../../docs/phase-0.5-tasks.md) の TASK-05-1。
**実測結果の記録先**: `docs/phase-0.5-results.md`（M1〜M9。推測値を書かない）。

---

## ファイル

| ファイル | 実行場所 | 役割 |
|---------|---------|------|
| `ue_env.py` | **ホスト側**（外の Python 3.10） | UE 起動の共通処理。`run_ue_python()` = `-run=pythonscript`（終了コード + サマリ JSON で判定）。`run_ue_game()` = `-game -ExecCmds=...`（フルレンダーコンテキスト。`Saved/Screenshots` に PNG が出るかで判定）。`unreal` を import しない |
| `build_scene.py` | **UE 内**（`-run=pythonscript`） | シーン一式をスクリプトのみで構築（M7）: 冪等レベル生成 / 動的ライティング / `sim-track` から手続き的路面 + ガードレール / Interchange 済み車両 24 台グリッド / 300 mm 放送カメラ / 共有マスターマテリアル + spec のリバリー適用 / 保存。**`vehicles_x24` は `import_vehicle.py` 実行済みが前提** |
| `import_vehicle.py` | UE 内 | `build/vehicles/*.glb` を Interchange で `/Game/Spike/Vehicles` へインポートし、生成アセットとマテリアルスロット名を報告（M9）。マテリアルの質感付けは `build_scene.py` の `materials` step |
| `capture.py` | UE 内（`nullrhi=False`） | ブロードキャストカメラから 1920×1080 静止画（M1/M2/M5/M6）。**headless では未撮影** — `AutomationLibrary` はコマンドレットで crash、`SceneCapture2D` はフレームループが無く no-op。**MovieRenderQueue 化 or `-game` 待ち**（詳細は docstring / `docs/phase-0.5-results.md`） |
| `measure.py` | UE 内 | `settings` = `DefaultEngine.ini` の cvar 読み戻し（実装済み・§2）。`perf`（`nullrhi=False`）= RHI 依存 cvar の再読み + M3/M4 は `-csvprofile` / nvidia-smi 待ちの gap 記録 |
| `profile_gpu.py` | **ホスト側**（外の Python 3.10） | **M3/M4 計測**。UE を `-game -csvGpuStats -csvCaptureFrames=N` で起動し per-frame CSV から GPU frame time（M3）、実行中に host から `nvidia-smi` をサンプリングして VRAM（M4）。出力 `build/ue/profile_gpu.summary.json`。**初回 run: M4 経路 OK / M3 は `-game` が possess 対象無しでレンダーループ未維持 → CSV 未出力**（`docs/phase-0.5-results.md` §profile_gpu.py の「次の診断」）。`unreal` を import しない |

各 UE 内スクリプトは **成功・失敗にかかわらずサマリ JSON を書く**。
書き出し先は `--summary <path>`（`-script=` の文字列内で渡す）と
環境変数 `UE_SPIKE_SUMMARY` の両方で指定される。

---

## ヘッドレス実行（`docs/phase-0.5-tasks.md` より）

```
"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe" ^
    "<abs>\ue\RaceSpectator.uproject" ^
    -run=pythonscript -script="<abs>\tools\ue_python\build_scene.py --summary <abs>\build\ue\build_scene.summary.json" ^
    -unattended -nosplash -nopause -nullrhi
```

`ue_env.run_ue_python()` がこのコマンド組み立てと後片付け（古いサマリの削除・
`build/ue/` の作成・環境変数の設定）を行う。ホストからはこう呼ぶ:

```python
import sys; sys.path.insert(0, "tools/ue_python")
import ue_env
r = ue_env.run_ue_python(
    "tools/ue_python/build_scene.py",
    nullrhi=True,          # ← 描画しない処理のときだけ True
    timeout_s=1800,
)
print(r.exit_code, r.ok)
print(r.summary)
```

### レンダーパス（`-game`）

`-run=pythonscript` の commandlet はフルレンダリングコンテキストを持たない
（RT / Nanite / per-object モーションブラーが立ち上がらない・`HighResShot` も
`SceneCapture2D` も撮れない。`docs/phase-0.5-results.md` §踏んだ罠 7）。
スクショ・GPU 計測は `-game` 起動で行う:

```python
g = ue_env.run_ue_game(
    "/Game/Spike/Maps/L_Spike",
    exec_cmds="HighResShot 1920x1080 filename=spike_broadcast",
    settle_s=1800,        # 初回 -game 起動はシェーダ大量コンパイルで長い
)
print(g.ok, [str(p) for p in g.screenshots])   # Saved/Screenshots/ の新規 PNG
```

放送カメラは `build_scene.py` の `broadcast_camera` step で
`auto_activate_for_player = PLAYER0` を立てているので、`-game` はそのビューを使う。

### 制約（厳守）

- **`-nullrhi` は描画を伴わない処理でのみ。** スクリーンショット・GPU 計測・VRAM
  計測では外す（`nullrhi=False`）。
- **`UnrealEditor-Cmd.exe` の stdout は当てにしない。** 長時間ログが混ざる。
  成否は `UeRunResult.ok`（終了コード 0 **かつ** `ok: true` のサマリ）で判定する。
- **`DefaultEngine.ini` の cvar 名は推測。** UE 5.8 で実際に効いているかは
  `measure.py` が読み戻して検証し、確認できないものは `docs/phase-0.5-results.md`
  に「未確認」と明記する（`docs/phase-0.5-tasks.md`「レンダラ設定の方針」）。
- **初回起動はシェーダコンパイル / DDC 構築で長い**（数分〜数十分）。
  `timeout_s` を十分大きく取る。2 回目以降は速い。

### 環境変数

| 変数 | 用途 |
|------|------|
| `UE_CMD` | `UnrealEditor-Cmd.exe` の場所を上書き（既定は UE 5.8 の実測パス） |
| `UE_SPIKE_SUMMARY` | UE 内スクリプトがサマリを書く先（`ue_env` が自動設定） |

---

## 生成物はコミットしない

`ue/Binaries` `ue/Intermediate` `ue/Saved` `ue/DerivedDataCache` は `.gitignore` 済み。
`ue/` は `*.uproject` + `Config/*.ini` + このディレクトリのスクリプトから再構築できる
（`docs/phase-0.5-tasks.md` Acceptance Criteria #5）。
