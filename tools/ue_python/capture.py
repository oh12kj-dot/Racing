"""tools/ue_python/capture.py

UE-SIDE script. Runs INSIDE UnrealEditor-Cmd via ``-run=pythonscript``.
Invoked by tools/ue_python/ue_env.py with ``nullrhi=False`` — it renders,
so there must be a real RHI.

Responsibility (docs/phase-0.5-tasks.md, TASK-05-1, M1/M2/M5/M6):
  Open the spike level and render a 1920x1080 still from the broadcast
  CineCamera for human review. The image path + byte size go in the
  summary; the visual verdict (M1 image quality, M6 telephoto
  compression) is a human step on the resulting PNG.

STATUS (2026-09-10): headless still capture does not yet work.
  * AutomationLibrary.take_high_res_screenshot() -> EXCEPTION_ACCESS_
    VIOLATION in UnrealEditor-FunctionalTesting.dll (null viewport in a
    commandlet).
  * SceneCapture2D + TextureRenderTarget2D + export_render_target() runs
    without error but writes nothing: a ``-run=pythonscript`` editor has
    no frame loop, so capture_scene()'s enqueued render commands are
    never pumped (run finishes in ~150 ms).
  The fix is MovieRenderQueue (unreal.MoviePipelineQueueEngineSubsystem)
  or launching with ``-game`` + ExecCmds "HighResShot" — a later
  increment; this file keeps the SceneCapture2D path so the failure is
  reported cleanly (summary ok:false, no crash).

Summary contract (ue_env.REQUIRED_SUMMARY_KEYS): JSON is written to the
UE_SPIKE_SUMMARY path on every exit path. ``UE_SPIKE_ARGS`` may carry one
token: the output PNG basename (default "spike_broadcast").
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime, timezone

LEVEL_PACKAGE = "/Game/Spike/Maps/L_Spike"
SHOT_W, SHOT_H = 1920, 1080
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(REPO_ROOT, "build", "ue", "shots")


def _summary_path() -> str:
    env = os.environ.get("UE_SPIKE_SUMMARY")
    if env:
        return env
    return os.path.join(os.getcwd(), "capture.summary.json")


def _basename() -> str:
    raw = os.environ.get("UE_SPIKE_ARGS")
    if raw:
        try:
            args = json.loads(raw)
            if args:
                return str(args[0])
        except (ValueError, TypeError):
            pass
    return "spike_broadcast"


def _write_summary(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def _find_camera(unreal):
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    for actor in eas.get_all_level_actors():
        if isinstance(actor, unreal.CineCameraActor):
            return actor
    return None


def _render_from_camera(unreal, cam, out_dir: str, name: str) -> dict:
    world = unreal.EditorLevelLibrary.get_editor_world()
    if world is None:
        raise RuntimeError("no editor world")

    rt = unreal.RenderingLibrary.create_render_target2d(
        world, SHOT_W, SHOT_H, unreal.TextureRenderTargetFormat.RTF_RGBA8_SRGB
    )
    if rt is None:
        raise RuntimeError("create_render_target2d returned None")

    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    cap = eas.spawn_actor_from_class(
        unreal.SceneCapture2D,
        cam.get_actor_location(),
        cam.get_actor_rotation(),
    )
    if cap is None:
        raise RuntimeError("spawn SceneCapture2D returned None")
    comp = cap.get_editor_property("capture_component2d")
    comp.set_editor_property("texture_target", rt)
    comp.set_editor_property(
        "capture_source", unreal.SceneCaptureSource.SCS_FINAL_COLOR_LDR
    )
    comp.set_editor_property("capture_every_frame", False)
    comp.set_editor_property("capture_on_movement", False)

    # Match the broadcast lens (CineCamera reports an effective FOV).
    cine = cam.get_cine_camera_component()
    fov = None
    try:
        fov = float(cine.get_editor_property("field_of_view"))
        comp.set_editor_property("fov_angle", fov)
    except Exception:  # noqa: BLE001
        pass

    # Capture twice: the first pass primes streaming / Lumen, the second
    # is the frame we keep.
    comp.capture_scene()
    comp.capture_scene()

    written = unreal.RenderingLibrary.export_render_target(
        world, rt, out_dir, name
    )
    eas.destroy_actor(cap)

    path = os.path.join(out_dir, f"{name}.png")
    return {"export_ok": bool(written), "fov_angle": fov, "path": path}


def main() -> int:
    summary_path = _summary_path()
    name = _basename()
    started = datetime.now(timezone.utc).isoformat()
    os.makedirs(OUT_DIR, exist_ok=True)
    details: dict = {"level": LEVEL_PACKAGE, "resolution": [SHOT_W, SHOT_H],
                     "out_dir": OUT_DIR.replace("\\", "/")}
    ok = False
    ue_version = "unknown"
    warnings: list[str] = []
    errors: list[str] = []

    try:
        import unreal

        ue_version = unreal.SystemLibrary.get_engine_version()
        details["ue_version"] = ue_version

        cmdline = (unreal.SystemLibrary.get_command_line() or "").lower()
        if "-nullrhi" in cmdline:
            raise RuntimeError(
                "capture.py needs a real RHI; launched with -nullrhi. "
                "Run via ue_env.run_ue_python(..., nullrhi=False)."
            )

        les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
        if not les.load_level(LEVEL_PACKAGE):
            raise RuntimeError(f"load_level({LEVEL_PACKAGE}) returned False "
                               "(run build_scene.py first)")

        cam = _find_camera(unreal)
        if cam is None:
            raise RuntimeError("no CineCameraActor in the level")

        result = _render_from_camera(unreal, cam, OUT_DIR, name)
        details.update(result)

        png = result["path"]
        if os.path.isfile(png) and os.path.getsize(png) > 0:
            details["screenshot"] = png.replace("\\", "/")
            details["bytes"] = os.path.getsize(png)
            ok = True
        else:
            errors.append(f"no PNG at {png} after export_render_target")
    except Exception as exc:  # noqa: BLE001
        details["fatal"] = f"{type(exc).__name__}: {exc}"
        details["fatal_traceback"] = traceback.format_exc()
        errors.append(details["fatal"])
        ok = False

    payload = {
        "ok": ok,
        "task": "capture",
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
