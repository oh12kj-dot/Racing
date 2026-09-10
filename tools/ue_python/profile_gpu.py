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
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from ue_env import UPROJECT, find_ue_cmd  # host-side, no ``unreal`` import

REPO_ROOT = Path(__file__).resolve().parents[2]
LEVEL_PACKAGE = "/Game/Spike/Maps/L_Spike"
OUT_SUMMARY = REPO_ROOT / "build" / "ue" / "profile_gpu.summary.json"

# UE writes CsvProfiler captures here (5.8). Kept as a list because the
# exact folder has moved between releases; we scan all of them.
CSV_DIRS = (
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
    for rel in CSV_DIRS:
        d = UPROJECT.parent / rel
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

    return {
        "file": str(path),
        "frames": len(data),
        "columns": header,
        "timing_columns": timing_cols,
        "numeric_column_medians": numeric_medians,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=int, default=900,
                    help="CsvProfiler frames to capture (default 900)")
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

    cmd = [
        str(ue_cmd),
        UPROJECT.as_posix(),
        LEVEL_PACKAGE,
        "-game",
        "-ResX=1920", "-ResY=1080", "-windowed",
        "-unattended", "-nosplash", "-nopause",
        "-stdout", "-FullStdOutLogOutput",
        "-csvGpuStats",
        f"-csvCaptureFrames={args.frames}",
        "-ExecCmds=t.MaxFPS 0",
    ]

    proc = subprocess.Popen(
        cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
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
        gpu = {
            "error": "no CsvProfiler .csv appeared under "
                     + " / ".join(CSV_DIRS)
                     + " — inspect the newest ue/Saved/Logs/*.log for "
                     "'LogCsvProfiler' lines and adjust the capture flags",
        }

    logs = sorted(
        (UPROJECT.parent / "Saved" / "Logs").glob("*.log"),
        key=lambda p: p.stat().st_mtime,
    )

    ok = csv_found is not None and len(mem) >= 5
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
