#!/usr/bin/env python
"""tools/blender/generate.py

Host-side CLI (Python 3.10, run OUTSIDE Blender). Invokes
tools/blender/build_vehicle.py headlessly through the sanctioned Blender
launcher (see blender_env.py) and reports success from the exit code +
summary file contract, not from Blender's stdout (which is not
forwarded — see DECISIONS.md "ADR-0006 追記").

Usage:
    python tools/blender/generate.py --spec assets/vehicles/gt_proto_a.spec.json
    python tools/blender/generate.py --spec <spec.json> --out <out.glb> --summary <summary.json>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_env  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[2]
BUILD_VEHICLE_SCRIPT = Path(__file__).resolve().parent / "build_vehicle.py"


def default_out_path(spec_path: Path) -> Path:
    stem = spec_path.stem
    if stem.endswith(".spec"):
        stem = stem[: -len(".spec")]
    return REPO_ROOT / "build" / "vehicles" / f"{stem}.glb"


def default_summary_path(spec_path: Path) -> Path:
    stem = spec_path.stem
    if stem.endswith(".spec"):
        stem = stem[: -len(".spec")]
    return REPO_ROOT / "build" / "vehicles" / f"{stem}.summary.json"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Generate a vehicle GLB from a spec.json via headless Blender.")
    parser.add_argument("--spec", required=True, help="Path to the vehicle spec.json")
    parser.add_argument("--out", default=None, help="Output GLB path (default: build/vehicles/<name>.glb)")
    parser.add_argument("--summary", default=None, help="Summary JSON path (default: build/vehicles/<name>.summary.json)")
    parser.add_argument("--timeout", type=float, default=300.0, help="Timeout in seconds for the Blender subprocess")
    args = parser.parse_args(argv)

    spec_path = Path(args.spec).resolve()
    if not spec_path.exists():
        print(f"ERROR: spec file not found: {spec_path}", file=sys.stderr)
        return 2

    out_path = Path(args.out).resolve() if args.out else default_out_path(spec_path)
    summary_path = Path(args.summary).resolve() if args.summary else default_summary_path(spec_path)

    try:
        result = blender_env.run_blender_script(
            script_path=BUILD_VEHICLE_SCRIPT,
            script_args=["--spec", str(spec_path), "--out", str(out_path), "--summary", str(summary_path)],
            summary_path=summary_path,
            timeout_s=args.timeout,
        )
    except blender_env.BlenderNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 3

    print(f"exit_code={result.exit_code}")
    if result.summary is not None:
        print(json.dumps(result.summary, indent=2))
    else:
        print(f"ERROR: no summary file was written at {summary_path}", file=sys.stderr)

    if not result.ok:
        return 1

    problems = blender_env.validate_summary_contract(result.summary)
    if problems:
        print("ERROR: summary contract violated:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    print(f"OK: wrote {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
