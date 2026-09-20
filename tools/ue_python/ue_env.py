"""tools/ue_python/ue_env.py

Host-side (Python 3.10, run OUTSIDE Unreal) helpers for invoking
UnrealEditor-Cmd.exe headlessly for the Phase 0.5 feasibility spike
(TASK-05-1), and for judging success from BOTH the process exit code AND
a JSON summary file — the same contract the Blender tooling uses
(tools/blender/blender_env.py), for the same reason: a long-running
editor process's stdout is noisy and unreliable to parse, so every
UE-side script writes a structured summary and we trust that.

This module never runs inside Unreal. It must not import ``unreal``.

Invocation reference (docs/phase-0.5-tasks.md, "ヘッドレス実行"):

    UnrealEditor-Cmd.exe <uproject> -run=pythonscript
        -script=<script.py> -unattended -nosplash -nullrhi

``-nullrhi`` disables the RHI entirely and MUST be dropped for anything
that renders (screenshots, GPU timing, VRAM). Pass ``nullrhi=False`` for
those runs.

MEASURED FACTS (first real runs, 2026-09-09 — see docs/phase-0.5-results.md):
  * UE 5.8's -script value goes through backslash-escape processing: a
    Windows path with a backslash-t or backslash-u in it (as in
    "tools/ue_python") came out with a TAB and a mangled segment. So every
    path handed to UE is passed with FORWARD SLASHES (Path.as_posix()).
  * Extra tokens after the script path (-script="<path> <args>") are not a
    reliable argv channel. Parameters are passed via environment variables
    instead: UE_SPIKE_SUMMARY (the summary path) and UE_SPIKE_ARGS (a JSON
    list of any extra args). The UE-side scripts read those; they do not
    depend on sys.argv beyond the script name.
  * -run=pythonscript returns -1 / 0xFFFFFFFF when the script fails, but we
    still never rely on the exit code alone — the summary file is
    authoritative, exactly as with Blender.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parents[2]


class UnrealNotFoundError(RuntimeError):
    """Raised when UnrealEditor-Cmd.exe cannot be located."""


# --- Measured environment (docs/phase-0.5-tasks.md, "検証済みの環境") -------

_DEFAULT_UE_CMD = Path(
    r"C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor-Cmd.exe"
)
UPROJECT = REPO_ROOT / "ue" / "RaceSpectator.uproject"


# --- Summary file contract ------------------------------------------------
#
# Every UE-side script writes this, success or failure, to the path given
# by --summary (and mirrored in the UE_SPIKE_SUMMARY env var). Exit code 0
# with a missing / unparsable / ``ok: false`` summary is a FAILURE.

REQUIRED_SUMMARY_KEYS = (
    "ok",
    "task",            # e.g. "build_scene", "import_vehicle", "measure"
    "ue_version",
    "script",
    "warnings",
    "errors",
)


def find_ue_cmd() -> Path:
    """Locate UnrealEditor-Cmd.exe.

    Honours the UE_CMD environment variable first (so a machine with UE
    installed elsewhere can still run the suite), then falls back to the
    measured default install path for this project's machine.
    """
    override = os.environ.get("UE_CMD")
    if override:
        p = Path(override)
        if not p.exists():
            raise UnrealNotFoundError(f"UE_CMD points at a missing file: {p}")
        return p
    if _DEFAULT_UE_CMD.exists():
        return _DEFAULT_UE_CMD
    raise UnrealNotFoundError(
        f"UnrealEditor-Cmd.exe not found at {_DEFAULT_UE_CMD}. Set the UE_CMD "
        "environment variable to its location (this project targets UE 5.8, "
        "see docs/phase-0.5-tasks.md)."
    )


@dataclass
class UeRunResult:
    exit_code: int
    summary_path: Path
    summary: Optional[dict[str, Any]]
    stdout: bytes
    stderr: bytes
    cmd: list[str]

    @property
    def ok(self) -> bool:
        """True only if exit code is 0 AND a valid ``ok: true`` summary exists."""
        return (
            self.exit_code == 0
            and self.summary is not None
            and bool(self.summary.get("ok"))
        )


def run_ue_python(
    script_path: Path,
    script_args: Optional[list[str]] = None,
    summary_path: Optional[Path] = None,
    nullrhi: bool = True,
    extra_ue_args: Optional[list[str]] = None,
    timeout_s: float = 900.0,
) -> UeRunResult:
    """Run a UE-side Python script headlessly via UnrealEditor-Cmd.

    ``summary_path`` defaults to ``<repo>/build/ue/<script stem>.summary.json``.
    It is deleted before the run so a stale file can never be mistaken for
    a fresh result. It is handed to the UE-side script via the
    ``UE_SPIKE_SUMMARY`` environment variable (NOT via the -script string:
    UE 5.8 unescapes backslashes in that value, corrupting Windows paths).
    Any ``script_args`` go through ``UE_SPIKE_ARGS`` as a JSON list, same
    reason. Every path passed to UE itself uses forward slashes.
    """
    script_path = Path(script_path).resolve()
    if not script_path.exists():
        raise FileNotFoundError(f"UE-side script not found: {script_path}")

    script_args = list(script_args or [])
    extra_ue_args = list(extra_ue_args or [])

    if summary_path is None:
        summary_path = REPO_ROOT / "build" / "ue" / f"{script_path.stem}.summary.json"
    summary_path = Path(summary_path).resolve()
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    if summary_path.exists():
        summary_path.unlink()

    if not UPROJECT.exists():
        raise FileNotFoundError(f"uproject not found: {UPROJECT}")

    ue_cmd = find_ue_cmd()

    # Forward slashes only: UE 5.8 unescapes '\t', '\u', ... inside -script.
    script_posix = script_path.as_posix()
    uproject_posix = UPROJECT.as_posix()

    cmd = [
        str(ue_cmd),
        uproject_posix,
        "-run=pythonscript",
        f"-script={script_posix}",
        "-unattended",
        "-nosplash",
        "-nopause",
        "-stdout",
        "-FullStdOutLogOutput",
    ]
    if nullrhi:
        cmd.append("-nullrhi")
    cmd.extend(extra_ue_args)

    env = dict(os.environ)
    env["UE_SPIKE_SUMMARY"] = str(summary_path)
    env["UE_SPIKE_ARGS"] = json.dumps(script_args)

    proc = subprocess.run(cmd, capture_output=True, timeout=timeout_s, env=env)

    summary: Optional[dict[str, Any]] = None
    if summary_path.exists():
        try:
            summary = json.loads(summary_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            summary = None

    return UeRunResult(
        exit_code=proc.returncode,
        summary_path=summary_path,
        summary=summary,
        stdout=proc.stdout,
        stderr=proc.stderr,
        cmd=cmd,
    )


@dataclass
class UeGameResult:
    exit_code: Optional[int]
    screenshots: list[Path] = field(default_factory=list)
    log_path: Optional[Path] = None
    cmd: list[str] = field(default_factory=list)
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return bool(self.screenshots)


def run_ue_game(
    map_package: str,
    exec_cmds: str,
    resolution: tuple[int, int] = (1920, 1080),
    watch_dir: Optional[Path] = None,
    settle_s: float = 240.0,
    poll_s: float = 3.0,
    extra_ue_args: Optional[list[str]] = None,
) -> UeGameResult:
    """Launch UE in ``-game`` mode (a real rendered viewport, unlike the
    ``-run=pythonscript`` commandlet) and run ``exec_cmds`` at startup —
    e.g. ``'HighResShot 1920x1080'``.

    ``-game`` has no Python channel, so success is judged structurally:
    new PNGs appearing under ``watch_dir`` (default
    ``<project>/Saved/Screenshots``). The process is polled for up to
    ``settle_s`` after the first new file, then terminated (a first
    ``-game`` boot compiles the full shader set and can take many
    minutes).
    """
    if not UPROJECT.exists():
        raise FileNotFoundError(f"uproject not found: {UPROJECT}")
    ue_cmd = find_ue_cmd()
    extra_ue_args = list(extra_ue_args or [])
    w, h = resolution

    project_dir = UPROJECT.parent
    if watch_dir is None:
        watch_dir = project_dir / "Saved" / "Screenshots"
    watch_dir = Path(watch_dir)

    def _pngs() -> set[Path]:
        return set(watch_dir.rglob("*.png")) if watch_dir.exists() else set()

    before = _pngs()
    before_mtimes = {p: p.stat().st_mtime for p in before}

    cmd = [
        str(ue_cmd),
        UPROJECT.as_posix(),
        map_package,
        "-game",
        f"-ResX={w}", f"-ResY={h}", "-windowed",
        f'-ExecCmds={exec_cmds}',
        "-unattended", "-nosplash", "-nopause", "-stdout", "-FullStdOutLogOutput",
        *extra_ue_args,
    ]

    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.time() + settle_s
    first_hit: Optional[float] = None
    new: set[Path] = set()
    timed_out = False
    try:
        while time.time() < deadline:
            if proc.poll() is not None:
                break
            cur = _pngs()
            new = {
                p for p in cur
                if p not in before_mtimes
                or p.stat().st_mtime > before_mtimes[p] + 1.0
            }
            if new and first_hit is None:
                first_hit = time.time()
            # once a shot has landed, give the encoder a moment then stop
            if first_hit is not None and time.time() - first_hit > 8.0:
                break
            time.sleep(poll_s)
        else:
            timed_out = True
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                proc.kill()

    logs = sorted(
        (project_dir / "Saved" / "Logs").glob("*.log"),
        key=lambda p: p.stat().st_mtime,
    )
    return UeGameResult(
        exit_code=proc.poll(),
        screenshots=sorted(new),
        log_path=logs[-1] if logs else None,
        cmd=cmd,
        timed_out=timed_out,
    )


def validate_summary_contract(summary: dict[str, Any]) -> list[str]:
    """Check a summary dict against the required-keys contract.

    Returns a list of problem strings; empty means the contract holds.
    """
    problems: list[str] = []
    for key in REQUIRED_SUMMARY_KEYS:
        if key not in summary:
            problems.append(f"missing top-level key: {key}")
    for list_key in ("warnings", "errors"):
        if list_key in summary and not isinstance(summary[list_key], list):
            problems.append(f"summary.{list_key} is not a list")
    return problems
