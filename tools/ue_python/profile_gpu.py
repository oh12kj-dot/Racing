"""tools/ue_python/profile_gpu.py

HOST-SIDE script (Python 3.10, run OUTSIDE Unreal). Does NOT import
``unreal``. Drives the M3/M4 measurements for the Phase 0.5 UE5 spike
(TASK-05-1):

  * M3 — GPU frame time @1080p (target <= 14.0 ms). Captured with UE's
    built-in CSV profiler (``-csvGpuStats -csvCaptureFrames=N``), which
    writes a per-frame CSV under ``ue/Saved/Profiling/CSV``. We parse the
    GPU / frame-time columns out of that CSV.

  * M4 — VRAM (target <= 7.0 GB). Sampled from the HOST with
    ``nvidia-smi --query-gpu=memory.used`` at a fixed interval for the
    whole run; steady-state is the tail of the sample series.

Why a real ``-game`` boot and not ``-run=pythonscript``: docs/phase-0.5-
results.md §2 — a headless commandlet has no full rendering context
(RT / Nanite / motion blur read False; HighResShot crashes). Only
``-game`` brings the renderer up, and the M6 still (``spike_broadcast.png``)
was produced that way. The FIRST ``-game`` boot compiles the whole shader
set and can take many minutes; subsequent boots are fast.

``-game`` also needs a GameMode so a PlayerController + pawn are spawned and
the render loop keeps ticking — otherwise the process loads the map and
self-terminates before CsvProfiler writes a frame (this was the first-run
failure, docs/phase-0.5-results.md §profile_gpu.py). That is now supplied by
``GlobalDefaultGameMode`` in ue/Config/DefaultEngine.ini plus a PlayerStart
placed by build_scene.py, so re-run build_scene.py after pulling those in.

Success is judged structurally (this mirrors ue_env.run_ue_game): a fresh
CSV appears under the profiling dir AND at least a handful of nvidia-smi
samples were taken. Everything measured — plus the raw column medians, so
a wrong column guess can be corrected without re-running — is written to
``build/ue/profile_gpu.summary.json``. Nothing here writes into
docs/phase-0.5-results.md; that is a human/Sonnet edit once the numbers
are in.

Usage:
    python tools/ue_python/profile_gpu.py [--frames 900] [--settle-s 900]
                                          [--sample-s 0.5]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from ue_env import UPROJECT, find_ue_cmd  # host-side, no ``unreal`` import

csv.field_size_limit(10_000_000)  # CsvProfiler headers/rows are huge

REPO_ROOT = Path(__file__).resolve().parents[2]
LEVEL_PACKAGE = "/Game/Spike/Maps/L_Spike"
OUT_SUMMARY = REPO_ROOT / "build" / "ue" / "profile_gpu.summary.json"

# UE writes CsvProfiler captures under <project>/Saved/Profiling/CSV in a
# normal build — but a -game launch of this content-only project writes to
# the per-user engine Saved dir instead (measured 2026-09-10:
# %LOCALAPPDATA%\UnrealEngine\5.8\Saved\Profiling\CSV). Scan both. The
# folder name has also moved between releases, hence the list.
_LOCALAPPDATA = Path(os.environ.get("LOCALAPPDATA", REPO_ROOT))
CSV_SCAN_ROOTS = (
    UPROJECT.parent,
    _LOCALAPPDATA / "UnrealEngine" / "5.8",
    _LOCALAPPDATA / "UnrealEngine" / "Common",
)
CSV_SUBDIRS = (
    "Saved/Profiling/CSV",
    "Saved/CsvProfiler",
    "Saved/Profiling/FpsChart",
)


def _nvidia_smi_sample() -> dict | None:
    """One nvidia-smi reading, or None if the tool/GPU is unavailable."""
    try:
        out = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=memory.used,memory.total,utilization.gpu",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    line = out.stdout.strip().splitlines()[0]
    parts = [p.strip() for p in line.split(",")]
    try:
        return {
            "t": time.time(),
            "mem_used_mib": float(parts[0]),
            "mem_total_mib": float(parts[1]),
            "gpu_util_pct": float(parts[2]),
        }
    except (IndexError, ValueError):
        return None


def _csv_snapshot() -> dict[Path, float]:
    snap: dict[Path, float] = {}
    for root in CSV_SCAN_ROOTS:
        for rel in CSV_SUBDIRS:
            d = root / rel
            if d.exists():
                for p in d.rglob("*.csv"):
                    try:
                        snap[p] = p.stat().st_mtime
                    except OSError:
                        pass
    return snap


def _parse_csv_profile(path: Path) -> dict:
    """Pull frame-time / GPU columns out of a UE CsvProfiler capture.

    The column set depends on the build flags, so instead of hard-coding
    a name we report stats for every column whose header looks like a
    timing (contains 'frametime', 'gpu', 'renderthread', 'gamethread')
    AND for every purely-numeric column (medians only), so the right one
    can be identified from the summary.
    """
    with path.open("r", encoding="utf-8", errors="replace", newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return {"error": "empty csv"}
    header = [h.strip() for h in rows[0]]
    data = rows[1:]

    def col(name: str) -> list[float]:
        i = header.index(name)
        vals: list[float] = []
        for r in data:
            if i < len(r):
                try:
                    vals.append(float(r[i]))
                except ValueError:
                    pass
        return vals

    def stats(vals: list[float]) -> dict:
        vs = sorted(v for v in vals if v == v)  # drop NaN
        if not vs:
            return {"n": 0}
        n = len(vs)
        return {
            "n": n,
            "min": round(vs[0], 4),
            "median": round(statistics.median(vs), 4),
            "mean": round(statistics.fmean(vs), 4),
            "p95": round(vs[min(n - 1, int(n * 0.95))], 4),
            "max": round(vs[-1], 4),
        }

    key_pat = ("frametime", "gpu", "renderthread", "gamethread", "rhithread")
    timing_cols = {
        h: stats(col(h))
        for h in header
        if any(k in h.lower() for k in key_pat)
    }
    numeric_medians: dict[str, float] = {}
    for h in header:
        vals = col(h)
        if len(vals) >= max(4, len(data) // 2):  # mostly-numeric column
            numeric_medians[h] = round(statistics.median(vals), 4)

    # The first ~10 s of a -game boot are shader compile + level stream, not
    # steady state. Report the tail 50% separately for the M3 verdict, and
    # spell out the columns that actually matter so the results doc doesn't
    # have to dig through 300 of them.
    tail = data[len(data) // 2:] or data

    def tail_stats(name: str) -> dict:
        if name not in header:
            return {"n": 0, "absent": True}
        i = header.index(name)
        vals = []
        for r in tail:
            if i < len(r):
                try:
                    vals.append(float(r[i]))
                except ValueError:
                    pass
        return stats(vals)

    m3_cols = {
        name: tail_stats(name)
        for name in ("GPUTime", "FrameTime", "RenderThreadTime",
                     "GameThreadTime", "RHIThreadTime")
    }
    gpu_ms = m3_cols.get("GPUTime", {}).get("median")
    m3 = {
        "steady_frames": len(tail),
        "columns_tail_median_ms": m3_cols,
        "gpu_time_median_ms": gpu_ms,
        "budget_ms": 14.0,
        "verdict": (
            "pass" if isinstance(gpu_ms, (int, float)) and gpu_ms <= 14.0
            else ("FAIL" if isinstance(gpu_ms, (int, float)) else "unknown")
        ),
    }

    return {
        "file": str(path),
        "m3": m3,
        "frames": len(data),
        "columns": header,
        "timing_columns": timing_cols,
        "numeric_column_medians": numeric_medians,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=3000,
                    help="CsvProfiler frames to capture (default 3000; the "
                         "first ~600 are the -game boot, the parser reports "
                         "the tail 50% for the M3 verdict)")
    ap.add_argument("--settle-s", type=float, default=900.0,
                    help="hard wall-clock cap for the whole run (first "
                         "-game boot compiles all shaders)")
    ap.add_argument("--sample-s", type=float, default=0.5,
                    help="nvidia-smi sampling interval")
    ap.add_argument("--post-csv-s", type=float, default=20.0,
                    help="keep sampling this long after the CSV lands, "
                         "then terminate UE")
    args = ap.parse_args()

    started = datetime.now(timezone.utc).isoformat()
    OUT_SUMMARY.parent.mkdir(parents=True, exist_ok=True)
    if OUT_SUMMARY.exists():
        OUT_SUMMARY.unlink()

    if not UPROJECT.exists():
        raise FileNotFoundError(f"uproject not found: {UPROJECT}")
    umap = UPROJECT.parent / "Content" / "Spike" / "Maps" / "L_Spike.umap"
    if not umap.exists():
        raise FileNotFoundError(
            f"{umap} missing — run build_scene.py first (Content is "
            ".gitignored and regenerable)"
        )
    ue_cmd = find_ue_cmd()

    baseline = _nvidia_smi_sample()
    csv_before = _csv_snapshot()

    # A dedicated absolute log per run: the default -game log was not landing
    # under ue/Saved/Logs (docs/phase-0.5-results.md §profile_gpu.py, diag 4),
    # which makes every failure opaque. -abslog forces one we control.
    # Timestamp it: a fixed path meant every run destroyed the previous run's
    # evidence (e.g. the green 3002-frame boot log to diff a truncated one
    # against). Never unlink — keep the history.
    run_stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    run_log = OUT_SUMMARY.parent / f"profile_gpu.{run_stamp}.ue.log"
    # When UE exits without flushing the abslog buffer (a truncated -abslog on a
    # silent exit code 1), its own stdout still carries the exit reason. Capture
    # it instead of discarding to DEVNULL.
    stdout_log = OUT_SUMMARY.parent / f"profile_gpu.{run_stamp}.stdout.log"

    cmd = [
        str(ue_cmd),
        UPROJECT.as_posix(),
        LEVEL_PACKAGE,
        "-game",
        "-ResX=1920", "-ResY=1080", "-windowed",
        "-unattended", "-nosplash", "-nopause",
        "-stdout", "-FullStdOutLogOutput",
        f"-abslog={run_log.as_posix()}",
        "-csvGpuStats",
        f"-csvCaptureFrames={args.frames}",
        "-ExecCmds=t.MaxFPS 0",
    ]

    stdout_fh = open(stdout_log, "w", encoding="utf-8", errors="replace")
    proc = subprocess.Popen(cmd, stdout=stdout_fh, stderr=subprocess.STDOUT)
    samples: list[dict] = []
    if baseline:
        samples.append(baseline)

    deadline = time.time() + args.settle_s
    csv_found: Path | None = None
    csv_found_at: float | None = None
    exited_early = False
    try:
        while time.time() < deadline:
            if proc.poll() is not None:
                exited_early = True
                break
            s = _nvidia_smi_sample()
            if s:
                samples.append(s)
            if csv_found is None:
                for p, m in _csv_snapshot().items():
                    if p not in csv_before or m > csv_before[p] + 1.0:
                        csv_found = p
                        csv_found_at = time.time()
                        break
            if csv_found_at is not None and (
                time.time() - csv_found_at > args.post_csv_s
            ):
                break
            time.sleep(args.sample_s)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=45)
            except subprocess.TimeoutExpired:
                proc.kill()
        # UnrealEditor-Cmd in -game can outlive a terminate() of the launcher
        # (measured 2026-09-10: the process kept running past the deadline and
        # needed a manual kill). Kill OUR process tree by PID; only if that PID
        # is somehow still alive afterwards fall back to an image-name sweep.
        # An unconditional /IM sweep would also kill a concurrent build_scene.py
        # / measure.py run — other agent sessions share this working tree.
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
            )
            time.sleep(1.0)
            if proc.poll() is None:
                subprocess.run(
                    ["taskkill", "/F", "/T", "/IM", "UnrealEditor-Cmd.exe"],
                    capture_output=True,
                )
        try:
            stdout_fh.close()
        except OSError:
            pass

    # If -csvCaptureFrames didn't drop a file, re-scan once more (the
    # writer can lag process exit).
    if csv_found is None:
        time.sleep(2.0)
        for p, m in _csv_snapshot().items():
            if p not in csv_before or m > csv_before.get(p, 0) + 1.0:
                csv_found = p
                break

    # --- VRAM (M4): steady-state = tail 60% of samples ------------------
    mem = [s["mem_used_mib"] for s in samples]
    vram: dict = {"samples": len(mem)}
    if mem:
        tail = mem[int(len(mem) * 0.4):] or mem
        vram.update({
            "baseline_mib": round(baseline["mem_used_mib"], 1) if baseline else None,
            "peak_mib": round(max(mem), 1),
            "steady_median_mib": round(statistics.median(tail), 1),
            "steady_peak_mib": round(max(tail), 1),
            "total_mib": round(samples[0]["mem_total_mib"], 1),
            "peak_gb": round(max(mem) / 1024.0, 3),
            "steady_peak_gb": round(max(tail) / 1024.0, 3),
            "budget_gb": 7.0,
            "verdict": ("pass" if max(tail) / 1024.0 <= 7.0 else "FAIL"),
        })

    # --- GPU frame time (M3) -----------------------------------------------
    gpu: dict
    if csv_found is not None:
        gpu = _parse_csv_profile(csv_found)
    else:
        scanned = ", ".join(
            str(root / sub) for root in CSV_SCAN_ROOTS for sub in CSV_SUBDIRS
        )
        gpu = {
            "error": f"no fresh CsvProfiler .csv appeared under: {scanned} "
                     "— check run_log_tail for 'LogCsvProfiler: ... Writing "
                     "CSV to file' and add that dir to CSV_SCAN_ROOTS",
        }

    logs = sorted(
        (UPROJECT.parent / "Saved" / "Logs").glob("*.log"),
        key=lambda p: p.stat().st_mtime,
    )

    # Tail of the run log helps diagnose a -game that renders nothing.
    def _tail(p: Path, n: int) -> list[str]:
        try:
            return p.read_text(
                encoding="utf-8", errors="replace"
            ).splitlines()[-n:]
        except OSError:
            return []

    log_tail = _tail(run_log, 40)
    # UE's own stdout carries the exit reason when the -abslog buffer is lost on
    # a silent exit (docs/phase-0.5-results.md §profile_gpu.py). Surface its tail
    # too, so a failed run is never evidence-free.
    stdout_tail = _tail(stdout_log, 60)

    # A CsvProfiler file can be created and left empty (or with only a few boot
    # frames) when -game dies during boot; "csv present" is not "csv usable".
    # Require a parsed frame count, or the gate records a non-measurement as a
    # pass.
    ok = (csv_found is not None
          and gpu.get("frames", 0) >= 100
          and len(mem) >= 5)
    payload = {
        "ok": ok,
        "task": "profile_gpu",
        "measurements": ["M3 (GPU frame time)", "M4 (VRAM)"],
        "started_utc": started,
        "finished_utc": datetime.now(timezone.utc).isoformat(),
        "level": LEVEL_PACKAGE,
        "resolution": [1920, 1080],
        "ue_cmd": cmd,
        "process_exit_code": proc.poll(),
        "exited_before_terminate": exited_early,
        "wall_clock_s": round(time.time() - (deadline - args.settle_s), 1),
        "latest_log": str(logs[-1]) if logs else None,
        "run_log": str(run_log) if run_log.exists() else None,
        "run_log_tail": log_tail,
        "stdout_log": str(stdout_log) if stdout_log.exists() else None,
        "stdout_tail": stdout_tail,
        "vram_m4": vram,
        "gpu_frame_time_m3": gpu,
        "nvidia_smi_note": (
            "steady-state = tail 60% of the sample series; the M4 verdict "
            "uses steady_peak_gb. GPU frame time for M3 is the CSV column "
            "that best matches 'GPU total' — check gpu_frame_time_m3."
            "timing_columns and pick it in the results doc."
        ),
    }
    OUT_SUMMARY.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"wrote {OUT_SUMMARY}")
    print(json.dumps(payload, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
