"""tools/ue_python/import_vehicle.py

UE-SIDE script. Runs INSIDE UnrealEditor-Cmd via ``-run=pythonscript``.
Invoked by tools/ue_python/ue_env.py — never run this with a normal
Python interpreter (it imports ``unreal``).

Responsibility (docs/phase-0.5-tasks.md, TASK-05-1, M9):
  Import the Blender-generated vehicle GLB
  (build/vehicles/gt_proto_a.glb, produced by TASK-05-2) into the spike
  project under /Game/Spike/Vehicles via Interchange — the standard glTF
  path in UE 5.8 (the old GLTFImporter plugin was removed). Report the
  assets that came back and the material-slot names on any static mesh,
  so build_scene.py's vehicles_x24 step and the M9 verdict can see
  whether the spec -> Blender -> glTF -> UE chain closes with zero GUI
  work.

  This script does NOT build materials or spawn actors — that is
  build_scene.py (vehicles_x24 / materials).

Summary contract (see ue_env.REQUIRED_SUMMARY_KEYS): JSON is written to
the UE_SPIKE_SUMMARY path on every exit path. ``UE_SPIKE_ARGS`` may carry
a single token overriding the GLB path (default: the repo's
build/vehicles/gt_proto_a.glb).
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime, timezone

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
DEFAULT_GLB = os.path.join(REPO_ROOT, "build", "vehicles", "gt_proto_a.glb")
DEST_PATH = "/Game/Spike/Vehicles"

# The seven slot names Blender assigns (docs/phase-0.5-tasks.md); UE-side
# materials are keyed off these.
EXPECTED_SLOTS = (
    "M_Body", "M_Glass", "M_Carbon", "M_Tyre",
    "M_WheelRim", "M_BrakeDisc", "M_Caliper",
)


def _summary_path() -> str:
    env = os.environ.get("UE_SPIKE_SUMMARY")
    if env:
        return env
    return os.path.join(os.getcwd(), "import_vehicle.summary.json")


def _glb_path() -> str:
    raw = os.environ.get("UE_SPIKE_ARGS")
    if raw:
        try:
            args = json.loads(raw)
            if args:
                return os.path.abspath(str(args[0]))
        except (ValueError, TypeError):
            pass
    return DEFAULT_GLB


def _write_summary(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def _import_glb(unreal, glb_path: str) -> list[str]:
    """Import ``glb_path`` into DEST_PATH via an AssetImportTask.

    Interchange auto-registers a translator for .gltf/.glb in UE 5.8, so
    no explicit factory is needed. Returns the imported object paths.
    """
    task = unreal.AssetImportTask()
    task.set_editor_property("filename", glb_path.replace("\\", "/"))
    task.set_editor_property("destination_path", DEST_PATH)
    task.set_editor_property("automated", True)
    task.set_editor_property("save", True)
    task.set_editor_property("replace_existing", True)
    task.set_editor_property("replace_existing_settings", True)

    tools = unreal.AssetToolsHelpers.get_asset_tools()
    tools.import_asset_tasks([task])

    paths = list(task.get_editor_property("imported_object_paths") or [])
    if not paths:
        # Fall back to scanning the destination folder.
        registry = unreal.AssetRegistryHelpers.get_asset_registry()
        registry.scan_paths_synchronous([DEST_PATH], force_rescan=True)
        paths = list(unreal.EditorAssetLibrary.list_assets(DEST_PATH, recursive=True))
    return paths


def _inspect(unreal, asset_paths: list[str]) -> list[dict]:
    out: list[dict] = []
    for p in asset_paths:
        obj = unreal.EditorAssetLibrary.load_asset(p)
        entry: dict = {"path": p, "class": type(obj).__name__ if obj else None}
        if isinstance(obj, unreal.StaticMesh):
            try:
                mats = obj.get_editor_property("static_materials")
                entry["material_slots"] = [
                    str(m.get_editor_property("material_slot_name")) for m in mats
                ]
            except Exception as exc:  # noqa: BLE001
                entry["material_slots_error"] = f"{type(exc).__name__}: {exc}"
        out.append(entry)
    return out


def main() -> int:
    summary_path = _summary_path()
    glb_path = _glb_path()
    started = datetime.now(timezone.utc).isoformat()
    details: dict = {"glb": glb_path, "dest": DEST_PATH}
    ok = False
    ue_version = "unknown"
    warnings: list[str] = []
    errors: list[str] = []

    try:
        import unreal  # only importable inside UnrealEditor-Cmd

        ue_version = unreal.SystemLibrary.get_engine_version()
        details["ue_version"] = ue_version

        if not os.path.isfile(glb_path):
            raise FileNotFoundError(
                f"GLB not found: {glb_path} — run tools/blender/generate.py first"
            )

        imported = _import_glb(unreal, glb_path)
        details["imported_object_paths"] = imported
        details["assets"] = _inspect(unreal, imported)

        meshes = [a for a in details["assets"] if a.get("class") == "StaticMesh"]
        details["static_mesh_count"] = len(meshes)

        all_slots: set[str] = set()
        for m in meshes:
            all_slots.update(m.get("material_slots", []))
        details["material_slots_seen"] = sorted(all_slots)
        missing = [s for s in EXPECTED_SLOTS if s not in all_slots]
        details["expected_slots_missing"] = missing

        ok = bool(imported) and len(meshes) >= 1
        if not imported:
            errors.append("Interchange import produced no assets")
        if imported and not meshes:
            errors.append("import produced assets but no StaticMesh")
        if missing:
            warnings.append(
                f"material slots not found on any mesh: {missing} "
                f"(Interchange may rename slots; materials step keys off these)"
            )
    except Exception as exc:  # noqa: BLE001
        details["fatal"] = f"{type(exc).__name__}: {exc}"
        details["fatal_traceback"] = traceback.format_exc()
        errors.append(details["fatal"])
        ok = False

    payload = {
        "ok": ok,
        "task": "import_vehicle",
        "ue_version": ue_version,
        "script": os.path.abspath(__file__),
        "started_utc": started,
        "finished_utc": datetime.now(timezone.utc).isoformat(),
        "details": details,
        "warnings": warnings,
        "errors": errors,
    }
    _write_summary(summary_path, payload)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
