# assets/vehicles/ — 車両仕様

各 `*.spec.json` は 1 台の車両を実寸法で記述した数値仕様であり、
**見た目（`tools/blender/build_vehicle.py`）と物理（Phase 1B の `sim-vehicle`）
共通の正**である。スキーマは `tools/blender/vehicle_spec_schema.md`
（原本は `docs/phase-0.5-tasks.md` TASK-05-2）を参照。

| ファイル | 内容 |
|---------|------|
| `gt_proto_a.spec.json` | オリジナルの GT3 クラス車両「GT Proto A」。実在の GT3 カテゴリの公開されている寸法帯を参照して数値を決定したオリジナル車両（実在チーム/ドライバー/スポンサー/リバリーは含まない） |

生成物（`.glb`）はここには置かない。`build/vehicles/` に出力され、
`.gitignore` によりコミットされない。`spec.json` から常に再生成できる。

```
python tools/blender/generate.py --spec assets/vehicles/gt_proto_a.spec.json
```
