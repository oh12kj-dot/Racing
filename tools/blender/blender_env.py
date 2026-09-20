"""tools/blender/blender_env.py

Host-side (Python 3.10, run OUTSIDE Blender) helpers for invoking the
Microsoft Store (MSIX) build of Blender 5.2.1 LTS headlessly, and for
judging success from both the process exit code and the JSON summary
file contract.

Why this indirection exists (measured facts, see DECISIONS.md
"ADR-0006 追記" and HANDOFF.md section 4):

1. Blender must be invoked ONLY through the app execution alias
   (``blender-launcher.exe``). The real binary under
   ``C:\\Program Files\\WindowsApps\\...\\Blender\\blender.exe`` exists but
   is ACL-locked and fails with Access Denied.
2. stdout/stderr from that launcher are NOT forwarded to the caller
   (measured: 0 bytes back). ``print()`` inside the Blender-side script
   is invisible to us.
3. Therefore every Blender-side script must write a JSON summary file,
   and success must be judged from BOTH the exit code AND that summary
   file. Exit code 0 with no summary (or ``ok: false``) means failure.

This module is imported by both ``generate.py`` (the host CLI) and
``tests/test_pipeline.py`` (the pipeline test suite). It must not import
``bpy`` — it never runs inside Blender.
"""
from __future__ import annotations

import json
import os
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional


class BlenderNotFoundError(RuntimeError):
    """Raised when the sanctioned Blender entry point cannot be located."""


# --- The summary file contract (docs/phase-0.5-tasks.md, TASK-05-2) -------

REQUIRED_SUMMARY_KEYS = (
    "ok",
    "spec",
    "output",
    "blender_version",
    "mesh",
    "dimensions_m",
    "warnings",
    "errors",
)
REQUIRED_MESH_KEYS = ("objects", "vertices", "triangles")
REQUIRED_DIMENSION_KEYS = ("length", "width", "height", "wheelbase")

# Fixed by the approved spec. UE5 looks up materials by these exact names.
# Do not rename — this is a public interface, not an implementation detail.
MATERIAL_SLOTS = (
    "M_Body",
    "M_Glass",
    "M_Carbon",
    "M_Tyre",
    "M_WheelRim",
    "M_BrakeDisc",
    "M_Caliper",
)

# From docs/phase-0.5-tasks.md Acceptance Criteria #5, derived from the
# 8 GB VRAM budget (PROJECT.md §6) for 24 cars on screen at once.
TRIANGLE_BUDGET_MIN = 60_000
TRIANGLE_BUDGET_MAX = 150_000

# Acceptance tolerances from docs/phase-0.5-tasks.md Required Tests.
DIMENSION_TOLERANCE_FRACTION = 0.02  # "誤差 < 2%"
ORIENTATION_TOLERANCE_M = 0.005  # "誤差 < 5 mm"
WHEEL_POSITION_TOLERANCE_M = 0.005  # "誤差 < 5 mm"


def find_blender_launcher() -> Path:
    """Locate the ONLY sanctioned Blender entry point on this machine.

    Per ADR-0006 追記, the real binary under
    ``C:\\Program Files\\WindowsApps\\...\\Blender\\blender.exe`` is
    ACL-locked and must never be invoked directly. Only the app execution
    alias works.
    """
    local_appdata = os.environ.get("LOCALAPPDATA")
    if not local_appdata:
        raise BlenderNotFoundError("LOCALAPPDATA environment variable is not set")
    launcher = Path(local_appdata) / "Microsoft" / "WindowsApps" / "blender-launcher.exe"
    if not launcher.exists():
        raise BlenderNotFoundError(
            f"blender-launcher.exe not found at {launcher}. "
            "This project only supports the Microsoft Store (MSIX) Blender "
            "5.2.1 LTS install, invoked through its app execution alias "
            "(see DECISIONS.md 'ADR-0006 追記')."
        )
    return launcher


@dataclass
class BlenderRunResult:
    exit_code: int
    summary_path: Path
    summary: Optional[dict[str, Any]]
    stdout: bytes
    stderr: bytes

    @property
    def ok(self) -> bool:
        """True only if exit code is 0 AND a valid ``ok: true`` summary exists.

        Exit code 0 with a missing/unparsable/false summary is a failure.
        This is the core success contract from ADR-0006 追記: stdout/stderr
        cannot be trusted, only the exit code + summary file together.
        """
        return (
            self.exit_code == 0
            and self.summary is not None
            and bool(self.summary.get("ok"))
        )


def run_blender_script(
    script_path: Path,
    script_args: list[str],
    summary_path: Path,
    timeout_s: float = 300.0,
) -> BlenderRunResult:
    """Run a Blender-side script headlessly via the sanctioned invocation.

    ``script_args`` are passed after the mandatory ``--`` separator, so the
    Blender-side script must read them from ``sys.argv`` itself (Blender
    strips its own args before the ``--`` and hands the rest through
    unmodified — verified empirically).
    """
    launcher = find_blender_launcher()

    # Never trust a stale summary from a previous run.
    if summary_path.exists():
        summary_path.unlink()
    summary_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        str(launcher),
        "--background",
        "--factory-startup",
        "--python",
        str(script_path),
        "--",
        *script_args,
    ]
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout_s)

    summary: Optional[dict[str, Any]] = None
    if summary_path.exists():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            summary = None

    return BlenderRunResult(
        exit_code=proc.returncode,
        summary_path=summary_path,
        summary=summary,
        stdout=proc.stdout,
        stderr=proc.stderr,
    )


def validate_summary_contract(summary: dict[str, Any]) -> list[str]:
    """Check a summary dict against the required-keys contract.

    Returns a list of problem descriptions; empty list means the contract
    is satisfied.
    """
    problems: list[str] = []
    for key in REQUIRED_SUMMARY_KEYS:
        if key not in summary:
            problems.append(f"missing top-level key: {key}")
    mesh = summary.get("mesh")
    if isinstance(mesh, dict):
        for key in REQUIRED_MESH_KEYS:
            if key not in mesh:
                problems.append(f"missing mesh.{key}")
    elif "mesh" in summary:
        problems.append("summary.mesh is not an object")
    dims = summary.get("dimensions_m")
    if isinstance(dims, dict):
        for key in REQUIRED_DIMENSION_KEYS:
            if key not in dims:
                problems.append(f"missing dimensions_m.{key}")
    elif "dimensions_m" in summary:
        problems.append("summary.dimensions_m is not an object")
    return problems


# --- GLB reading (standard library only: struct + json) -------------------
#
# GLB is a small binary container: a 12-byte header, followed by chunks.
# Chunk 0 is always JSON (the glTF document itself); chunk 1, if present,
# is the binary buffer (BIN). We only need the JSON chunk to verify
# bounding boxes, node transforms and material names, so we don't even
# need to touch the BIN chunk's raw bytes for this pipeline's tests
# (accessors carry min/max already, populated by Blender's exporter).

_GLB_MAGIC = b"glTF"
_CHUNK_TYPE_JSON = 0x4E4F534A  # 'JSON' little-endian
_CHUNK_TYPE_BIN = 0x004E4942  # 'BIN\0' little-endian


def read_glb_json(path: Path) -> dict[str, Any]:
    """Parse a GLB file's JSON chunk using only struct + json."""
    data = Path(path).read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != _GLB_MAGIC:
        raise ValueError(f"{path}: not a GLB file (bad magic {magic!r})")
    offset = 12
    while offset < length:
        chunk_len, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk_data = data[offset : offset + chunk_len]
        offset += chunk_len
        if chunk_type == _CHUNK_TYPE_JSON:
            return json.loads(chunk_data.decode("utf-8"))
    raise ValueError(f"{path}: no JSON chunk found")


def node_aabb(gltf: dict[str, Any], node_name: str) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """Return ((min_x,min_y,min_z), (max_x,max_y,max_z)) for a named node's mesh.

    Uses the POSITION accessor's own min/max (glTF requires exporters to
    populate these for POSITION accessors, and Blender's exporter does).
    Assumes the node has no non-identity TRS (true here: this pipeline
    bakes final coordinates directly into vertex data, so every mesh
    object sits at the scene origin with identity transform).
    """
    nodes = gltf.get("nodes", [])
    node = next((n for n in nodes if n.get("name") == node_name), None)
    if node is None:
        raise KeyError(f"no node named {node_name!r} in GLB (have: {[n.get('name') for n in nodes]})")
    mesh_index = node.get("mesh")
    if mesh_index is None:
        raise KeyError(f"node {node_name!r} has no mesh")
    mesh = gltf["meshes"][mesh_index]
    overall_min = [float("inf")] * 3
    overall_max = [float("-inf")] * 3
    for prim in mesh["primitives"]:
        pos_accessor_idx = prim["attributes"]["POSITION"]
        accessor = gltf["accessors"][pos_accessor_idx]
        amin = accessor["min"]
        amax = accessor["max"]
        for i in range(3):
            overall_min[i] = min(overall_min[i], amin[i])
            overall_max[i] = max(overall_max[i], amax[i])
    return tuple(overall_min), tuple(overall_max)


def scene_aabb(gltf: dict[str, Any]) -> tuple[tuple[float, float, float], tuple[float, float, float]]:
    """Return the combined AABB across every mesh node in the GLB."""
    overall_min = [float("inf")] * 3
    overall_max = [float("-inf")] * 3
    for node in gltf.get("nodes", []):
        if node.get("mesh") is None:
            continue
        nmin, nmax = node_aabb(gltf, node["name"])
        for i in range(3):
            overall_min[i] = min(overall_min[i], nmin[i])
            overall_max[i] = max(overall_max[i], nmax[i])
    return tuple(overall_min), tuple(overall_max)


def material_names(gltf: dict[str, Any]) -> list[str]:
    return [m.get("name", "") for m in gltf.get("materials", [])]
