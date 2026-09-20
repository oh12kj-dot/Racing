"""tools/ue_python/measure.py

UE-SIDE script. Runs INSIDE UnrealEditor-Cmd via ``-run=pythonscript``.
Invoked by tools/ue_python/ue_env.py — never run this with a normal
Python interpreter (it imports ``unreal``).

Responsibility (docs/phase-0.5-tasks.md, TASK-05-1, "レンダラ設定の方針" +
M3/M4):

  1. Read the renderer settings declared in ue/Config/DefaultEngine.ini
     BACK from the running editor and report, per key, the effective
     value and whether it matches the authored intent. Every key tagged
     ``; VERIFY[Mxx]`` in the ini must appear here; anything the Python
     API cannot reach is reported with ``effective: null`` and
     ``verdict: "unconfirmed"`` so docs/phase-0.5-results.md §2 can record
     it as "未確認" rather than guessing.

  2. (mode=perf, non-nullrhi only) placeholder hooks for ``stat gpu`` /
     VRAM (M3/M4). Under ``-nullrhi`` there is no RHI to measure, so this
     script refuses perf mode when the RHI is null and says so in the
     summary instead of emitting a fake number.

The cvar read-back uses ``unreal.SystemLibrary.get_console_variable_*_value``
(KismetSystemLibrary, Blueprint-callable, hence exposed to Python). These
are static and need no world, so mode=settings runs fine headless with
``-nullrhi``.

Summary contract (see ue_env.REQUIRED_SUMMARY_KEYS): JSON is written to
the UE_SPIKE_SUMMARY path on EVERY exit path. ``UE_SPIKE_ARGS`` may carry
a single token ``settings`` (default) or ``perf``.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from datetime import datetime, timezone

# --- What ue/Config/DefaultEngine.ini asks for -------------------------------
#
# (cvar, kind, intent, verify_tag, rhi_dependent). ``kind`` picks the
# getter and how the effective value is compared to ``intent``:
#   "int"   -> get_console_variable_int_value, exact match
#   "bool"  -> get_console_variable_bool_value, truthiness match
#             (ini uses both "True" and "1" for these)
#   "float" -> get_console_variable_float_value, match within 1e-6
#
# ``rhi_dependent`` marks a cvar tied to a real rendering hardware
# interface: the ray-tracing switches, Nanite (read-only, initialised
# from the RHI at startup), and rendering-feature defaults like motion
# blur. Under ``-nullrhi`` a "wrong" read for one of these is unavoidable
# and is downgraded to ``unconfirmed_nullrhi``.
#
# MEASURED 2026-09-10: with a REAL RHI (nullrhi=False) in a
# ``-run=pythonscript`` commandlet these four STILL read False. So this
# is not merely a -nullrhi artefact — a headless commandlet does not
# bring RT/Nanite up (probably a DX11 fallback; DefaultGraphicsRHI has no
# Python getter to confirm). Confirming M1/M2/M5 needs a ``-game`` /
# ``-dx12`` render pass or MovieRenderQueue. See docs/phase-0.5-results.md
# §2.
#
# Keep this list in the same order as the ini so a diff is easy to read.
CVAR_CHECKS: list[tuple[str, str, object, str, bool]] = [
    ("r.DynamicGlobalIlluminationMethod", "int", 1, "M1", False),
    ("r.ReflectionMethod", "int", 1, "M2", False),
    ("r.Lumen.HardwareRayTracing", "bool", True, "M2", True),
    ("r.Lumen.HardwareRayTracing.LightingMode", "int", 2, "M2", False),
    ("r.RayTracing", "bool", True, "M2", True),
    ("r.RayTracing.Shadows", "bool", False, "M2", False),
    ("r.Nanite.ProjectEnabled", "bool", True, "M1", True),
    ("r.Shadow.Virtual.Enable", "int", 1, "M1", False),
    ("r.AntiAliasingMethod", "int", 4, "M5", False),
    ("r.DefaultFeature.AutoExposure", "bool", False, "M1", False),
    ("r.DefaultFeature.AutoExposure.Method", "int", 0, "M1", False),
    ("r.DefaultFeature.MotionBlur", "bool", True, "M5", True),
    ("r.MotionBlurQuality", "int", 4, "M5", False),
    ("r.Streaming.PoolSize", "int", 3000, "M4", False),
    ("r.Streaming.LimitPoolSizeToVRAM", "int", 1, "M4", False),
]

# Non-cvar settings from the ini that have no reliable Python getter in
# UE 5.8. Listed so the summary is exhaustive and §2 can mark them 未確認.
UNCONFIRMED_SETTINGS: list[tuple[str, str, str]] = [
    ("DefaultGraphicsRHI", "DefaultGraphicsRHI_DX12",
     "no Python getter for the active RHI in UE 5.8"),
    ("r.SetRes", "1920x1080w",
     "not a readable persistent cvar; window res is irrelevant under -nullrhi"),
]


def _summary_path() -> str:
    env = os.environ.get("UE_SPIKE_SUMMARY")
    if env:
        return env
    for i, tok in enumerate(sys.argv):
        if tok == "--summary" and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        if tok.startswith("--summary="):
            return tok.split("=", 1)[1]
    return os.path.join(os.getcwd(), "measure.summary.json")


def _mode() -> str:
    raw = os.environ.get("UE_SPIKE_ARGS")
    if raw:
        try:
            args = json.loads(raw)
            if args:
                return str(args[0]).strip().lower()
        except (ValueError, TypeError):
            pass
    return "settings"


def _write_summary(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


def _read_cvar(unreal, name: str, kind: str):
    """Return (effective_value, error_or_None) for one cvar."""
    getter = {
        "int": "get_console_variable_int_value",
        "bool": "get_console_variable_bool_value",
        "float": "get_console_variable_float_value",
    }[kind]
    fn = getattr(unreal.SystemLibrary, getter, None)
    if fn is None:
        return None, f"unreal.SystemLibrary.{getter} not present in this build"
    try:
        return fn(name), None
    except Exception as exc:  # noqa: BLE001 — one unreadable cvar must not abort the rest
        return None, f"{type(exc).__name__}: {exc}"


def _matches(kind: str, effective, intent) -> bool:
    if effective is None:
        return False
    if kind == "bool":
        return bool(effective) == bool(intent)
    if kind == "float":
        return abs(float(effective) - float(intent)) <= 1e-6
    return int(effective) == int(intent)


def _check_settings(unreal, nullrhi: bool) -> dict:
    rows: list[dict] = []
    confirmed = mismatched = unreadable = deferred = 0
    for name, kind, intent, tag, rhi_dependent in CVAR_CHECKS:
        effective, err = _read_cvar(unreal, name, kind)
        row: dict = {
            "key": name,
            "verify": tag,
            "kind": kind,
            "intent": intent,
            "effective": effective,
            "rhi_dependent": rhi_dependent,
        }
        if err is not None:
            row["verdict"] = "unconfirmed"
            row["error"] = err
            unreadable += 1
        elif _matches(kind, effective, intent):
            row["verdict"] = "match"
            confirmed += 1
        elif rhi_dependent and nullrhi:
            row["verdict"] = "unconfirmed_nullrhi"
            row["error"] = ("engine forces this off with -nullrhi; needs a "
                            "non-nullrhi re-measure (M3/M4 pass)")
            deferred += 1
        else:
            row["verdict"] = "mismatch"
            mismatched += 1
        rows.append(row)
    for name, intent, why in UNCONFIRMED_SETTINGS:
        rows.append({
            "key": name,
            "verify": "",
            "kind": "opaque",
            "intent": intent,
            "effective": None,
            "rhi_dependent": False,
            "verdict": "unconfirmed",
            "error": why,
        })
        unreadable += 1
    return {
        "settings": rows,
        "counts": {
            "match": confirmed,
            "mismatch": mismatched,
            "unconfirmed": unreadable,
            "unconfirmed_nullrhi": deferred,
            "total": len(rows),
        },
    }


def _rhi_is_null(unreal) -> bool:
    # -nullrhi leaves the editor with no rendering hardware interface. The
    # cleanest signal available from Python: the app cannot render a
    # viewport. Fall back to reading the -nullrhi token from the command
    # line the editor was launched with.
    try:
        cmdline = unreal.SystemLibrary.get_command_line()
        if "-nullrhi" in (cmdline or "").lower():
            return True
    except Exception:  # noqa: BLE001
        pass
    return False


def _check_perf(unreal) -> dict:
    if _rhi_is_null(unreal):
        raise RuntimeError(
            "perf mode needs a real RHI; the editor was launched with "
            "-nullrhi. Re-run with nullrhi=False (ue_env.run_ue_python)."
        )
    # With a real RHI the four cvars that -nullrhi forces off can finally
    # be read for real, which resolves the unconfirmed_nullrhi rows in
    # docs/phase-0.5-results.md §2.
    out = _check_settings(unreal, nullrhi=False)
    out["resolved_from_nullrhi"] = [
        r["key"] for r in out["settings"]
        if r["rhi_dependent"] and r["verdict"] == "match"
    ]
    out["still_off_with_rhi"] = [
        r["key"] for r in out["settings"]
        if r["rhi_dependent"] and r["verdict"] == "mismatch"
    ]
    # GPU frame time / VRAM (M3/M4) still need a warm rendered viewport +
    # a CSV-profiler or host-side nvidia-smi pass. Record the gap rather
    # than emit a fake number.
    out["gpu_frame_time"] = "not-captured"
    out["vram"] = "not-captured"
    out["note"] = (
        "M3/M4 need `-csvprofile` over a warm rendered viewport (or "
        "host-side nvidia-smi while capture.py renders); this pass only "
        "resolves the RHI-dependent cvars for §2."
    )
    return out


def main() -> int:
    summary_path = _summary_path()
    mode = _mode()
    started = datetime.now(timezone.utc).isoformat()
    details: dict = {"mode": mode}
    ok = False
    ue_version = "unknown"
    warnings: list[str] = []
    errors: list[str] = []

    try:
        import unreal  # only importable inside UnrealEditor-Cmd

        ue_version = unreal.SystemLibrary.get_engine_version()
        details["ue_version"] = ue_version

        if mode == "perf":
            details.update(_check_perf(unreal))
            ok = True
        else:
            nullrhi = _rhi_is_null(unreal)
            details["nullrhi"] = nullrhi
            result = _check_settings(unreal, nullrhi)
            details.update(result)
            c = result["counts"]
            ok = c["mismatch"] == 0
            if c["mismatch"]:
                errors.append(
                    f"{c['mismatch']} renderer setting(s) did not take effect"
                )
            if c.get("unconfirmed_nullrhi"):
                warnings.append(
                    f"{c['unconfirmed_nullrhi']} RHI-dependent setting(s) "
                    f"deferred (forced off by -nullrhi; re-measure with "
                    f"nullrhi=False during the M3/M4 pass)"
                )
            if c["unconfirmed"]:
                warnings.append(
                    f"{c['unconfirmed']} setting(s) unconfirmed (record as "
                    f"未確認 in docs/phase-0.5-results.md §2)"
                )
            for row in result["settings"]:
                if row["verdict"] == "mismatch":
                    errors.append(
                        f"{row['key']}: intent={row['intent']!r} "
                        f"effective={row['effective']!r}"
                    )
    except Exception as exc:  # noqa: BLE001
        details["fatal"] = f"{type(exc).__name__}: {exc}"
        details["fatal_traceback"] = traceback.format_exc()
        errors.append(details["fatal"])
        ok = False

    payload = {
        "ok": ok,
        "task": "measure",
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
