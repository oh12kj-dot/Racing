# tools/blender/ — 車両生成パイプライン

`assets/vehicles/*.spec.json` から Blender Python でパラメトリックに車両メッシュを
生成し、glTF (GLB) として出力する。仕様の全文は `docs/phase-0.5-tasks.md` の
`TASK-05-2`、責務分担・ADR は `DECISIONS.md` の「ADR-0006」「ADR-0006 追記」を参照。

## ファイル構成

| ファイル | 実行環境 | 役割 |
|---------|---------|------|
| `blender_env.py` | ホスト側 Python 3.10 | Blender 起動・成否判定・GLB 読み直しの共通処理 |
| `build_vehicle.py` | **Blender 内**（`bpy`） | spec.json からメッシュを生成し GLB を書き出す本体 |
| `generate.py` | ホスト側 Python 3.10 | CLI。`blender_env` 経由で `build_vehicle.py` を呼ぶ |
| `vehicle_spec_schema.md` | — | `spec.json` のスキーマ説明 |
| `tests/test_pipeline.py` | ホスト側 Python 3.10 | パイプラインの自動検証（Blender をサブプロセスで実行） |

## 使い方

```
python tools/blender/generate.py --spec assets/vehicles/gt_proto_a.spec.json
```

デフォルトでは `build/vehicles/<spec のファイル名>.glb` と
`build/vehicles/<spec のファイル名>.summary.json` に出力する
（`--out` / `--summary` で明示指定も可）。`build/` は `.gitignore` 済み
— **生成物はコミットしない**。`spec.json` と生成スクリプトが唯一の正であり、
成果物はいつでも再生成できる。

テスト実行:

```
python tools/blender/tests/test_pipeline.py
```

## Blender の起動方法（厳守。実測に基づく制約）

```
%LOCALAPPDATA%\Microsoft\WindowsApps\blender-launcher.exe ^
    --background --factory-startup --python <script.py> -- <args...>
```

導入されているのは **Microsoft Store (MSIX) 版 Blender 5.2.1 LTS** である。

1. **実行体を直接指定してはならない。**
   `C:\Program Files\WindowsApps\...\Blender\blender.exe` はファイルとして存在するが、
   WindowsApps の ACL により **Access Denied** で実行が拒否される。
   必ずアプリ実行エイリアス（`blender-launcher.exe`）経由で起動すること。
   `blender_env.find_blender_launcher()` がこのパスのみを探す。
2. **`--factory-startup` を必ず付ける。** ユーザー設定（アドオン等）に依存しない
   再現可能な実行のため。
3. **`--` 以降の引数は `sys.argv` から自分で読む。** Blender 自身の引数と
   スクリプト引数を `--` で分離する必要がある（argparse は使わず、
   `build_vehicle.py` 内で手動パースしている）。

## stdout / stderr が使えない制約（最重要）

**ランチャー経由で起動した場合、子プロセスの stdout / stderr は
呼び出し元へ転送されない（実測: 0 バイト）。** `print()` は一切届かない。
デバッグ目的であっても標準出力に依存してはならない。

## サマリファイルの契約

`build_vehicle.py` は **成功・失敗にかかわらず** `--summary <path>` で
指定された場所へ次の形の JSON を書き出す。

```json
{
  "ok": true,
  "spec": "assets/vehicles/gt_proto_a.spec.json",
  "output": "build/vehicles/gt_proto_a.glb",
  "blender_version": "5.2.1 LTS",
  "mesh": { "objects": 24, "vertices": 36176, "triangles": 71178 },
  "dimensions_m": { "length": 4.72, "width": 2.05, "height": 1.17, "wheelbase": 2.75 },
  "warnings": [],
  "errors": []
}
```

失敗時は `"ok": false` とし `errors` に理由を入れる。例外は
`build_vehicle.py` 内で必ず捕捉し、**サマリを書いてから**非ゼロ終了する
（`sys.exit()` の終了コードはランチャー経由でも正しく親プロセスに伝わることを
実測で確認済み）。

**呼び出し側は終了コードとサマリファイルの両方で成否を判定すること。
終了コード 0 でもサマリが無い/ `ok: false` なら失敗として扱う。**
`blender_env.BlenderRunResult.ok` がこの判定をカプセル化している。

## 座標系（変更禁止）

`+X` が前方、`+Y` が上、`+Z` が右。原点はホイールベース中心・左右中心・接地面
（`y = 0`）。glTF エクスポート時に Blender のネイティブ Z-up 座標系からの
軸変換が入るため、**実際にどう変換されるかを仮定せず、マーカーオブジェクトを
エクスポートして読み直すことで実測した**（`build_vehicle.py` の
`real_to_blender()` の docstring に手順と結果を記載）。生成後は必ず GLB を
読み直して寸法・向きを検証すること（`tests/test_pipeline.py` がこれを行う）。

## 既知の制限（Out of Scope）

マテリアルの質感 / LOD チェーン / リバリーのテクスチャ / 内装の作り込み /
トラックメッシュ（UE5 C++ 側の責務）は本パイプラインの対象外。
