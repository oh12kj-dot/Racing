"""tools/blender/tests/test_pipeline.py

Host-side (Python 3.10) acceptance tests for the Blender vehicle
generation pipeline (TASK-05-2, docs/phase-0.5-tasks.md).

These tests invoke Blender as a real subprocess through the sanctioned
launcher (blender_env.py) — they are integration tests, not unit tests,
and each Blender invocation takes on the order of a few seconds.

Run with:
    python tools/blender/tests/test_pipeline.py
or:
    python -m unittest tools.blender.tests.test_pipeline -v
"""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TOOLS_BLENDER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOLS_BLENDER_DIR.parents[1]
sys.path.insert(0, str(TOOLS_BLENDER_DIR))

import blender_env as be  # noqa: E402

BUILD_VEHICLE_SCRIPT = TOOLS_BLENDER_DIR / "build_vehicle.py"
GT_PROTO_A_SPEC = REPO_ROOT / "assets" / "vehicles" / "gt_proto_a.spec.json"
TEST_OUT_DIR = REPO_ROOT / "build" / "vehicles" / "_test"


def _run(spec_path: Path, out_path: Path, summary_path: Path, timeout_s: float = 180.0) -> be.BlenderRunResult:
    return be.run_blender_script(
        script_path=BUILD_VEHICLE_SCRIPT,
        script_args=["--spec", str(spec_path), "--out", str(out_path), "--summary", str(summary_path)],
        summary_path=summary_path,
        timeout_s=timeout_s,
    )


class TestBlenderReachable(unittest.TestCase):
    """test_blender_is_reachable — the launcher exists, --background works,
    bpy is usable, and a summary file can be written, independent of
    build_vehicle.py's own correctness."""

    def test_blender_is_reachable(self):
        launcher = be.find_blender_launcher()
        self.assertTrue(launcher.exists())

        TEST_OUT_DIR.mkdir(parents=True, exist_ok=True)
        probe_script = TEST_OUT_DIR / "_reachability_probe.py"
        summary_path = TEST_OUT_DIR / "_reachability_probe.summary.json"
        probe_script.write_text(
            "import bpy, sys, json\n"
            "argv = sys.argv[sys.argv.index('--') + 1:]\n"
            "with open(argv[0], 'w') as f:\n"
            "    json.dump({'ok': True, 'blender_version': bpy.app.version_string}, f)\n",
            encoding="utf-8",
        )
        result = be.run_blender_script(
            script_path=probe_script,
            script_args=[str(summary_path)],
            summary_path=summary_path,
            timeout_s=60.0,
        )
        self.assertEqual(result.exit_code, 0, f"stderr={result.stderr!r}")
        self.assertIsNotNone(result.summary, "no summary file was written")
        self.assertTrue(result.summary.get("ok"))
        self.assertIn("5.2", result.summary.get("blender_version", ""))


class TestGeneratePipeline(unittest.TestCase):
    """The bulk of the Required Tests table: run the real pipeline once
    against gt_proto_a.spec.json and check every contract against the
    result. Grouped into one TestCase with a shared class-level run so
    Blender is only invoked once for all these checks."""

    @classmethod
    def setUpClass(cls):
        TEST_OUT_DIR.mkdir(parents=True, exist_ok=True)
        cls.out_path = TEST_OUT_DIR / "gt_proto_a.glb"
        cls.summary_path = TEST_OUT_DIR / "gt_proto_a.summary.json"
        cls.result = _run(GT_PROTO_A_SPEC, cls.out_path, cls.summary_path)
        cls.spec = json.loads(GT_PROTO_A_SPEC.read_text(encoding="utf-8"))
        cls.gltf = be.read_glb_json(cls.out_path) if cls.out_path.exists() else None

    def test_generate_produces_glb(self):
        self.assertEqual(self.result.exit_code, 0, f"stderr={self.result.stderr!r}")
        self.assertTrue(self.out_path.exists(), "GLB was not written")
        self.assertGreater(self.out_path.stat().st_size, 0, "GLB is empty")

    def test_summary_contract(self):
        self.assertIsNotNone(self.result.summary, "no summary file was written")
        problems = be.validate_summary_contract(self.result.summary)
        self.assertEqual(problems, [], f"summary contract violated: {problems}")
        self.assertTrue(self.result.summary["ok"])

    def test_dimensions_match_spec(self):
        self.assertIsNotNone(self.gltf)
        amin, amax = be.scene_aabb(self.gltf)
        actual_length = amax[0] - amin[0]
        actual_width = amax[2] - amin[2]
        actual_height = amax[1] - amin[1]

        dims = self.spec["dimensions"]
        for label, actual, expected in (
            ("length", actual_length, dims["length"]),
            ("width", actual_width, dims["width"]),
            ("height", actual_height, dims["height"]),
        ):
            tol = expected * be.DIMENSION_TOLERANCE_FRACTION
            self.assertLessEqual(
                abs(actual - expected), tol,
                f"{label}: GLB bbox={actual:.4f} spec={expected:.4f} tol={tol:.4f}",
            )

    def test_orientation(self):
        self.assertIsNotNone(self.gltf)
        amin, amax = be.scene_aabb(self.gltf)
        # Ground plane at y = 0.
        self.assertLessEqual(abs(amin[1]), be.ORIENTATION_TOLERANCE_M, f"min y={amin[1]}")

        dims = self.spec["dimensions"]
        # Front wheels (+X, forward) must be ahead of rear wheels (-X).
        fl_min, fl_max = be.node_aabb(self.gltf, "wheel_fl")
        rl_min, rl_max = be.node_aabb(self.gltf, "wheel_rl")
        front_x = (fl_min[0] + fl_max[0]) / 2.0
        rear_x = (rl_min[0] + rl_max[0]) / 2.0
        self.assertGreater(front_x, rear_x, "front wheels are not ahead of rear wheels on +X")
        self.assertAlmostEqual(front_x, dims["wheelbase"] / 2.0, delta=be.ORIENTATION_TOLERANCE_M)
        self.assertAlmostEqual(rear_x, -dims["wheelbase"] / 2.0, delta=be.ORIENTATION_TOLERANCE_M)

        # +Z is right: the "fr" (front-right) wheel must have a larger z
        # than the "fl" (front-left) wheel.
        fr_min, fr_max = be.node_aabb(self.gltf, "wheel_fr")
        fr_z = (fr_min[2] + fr_max[2]) / 2.0
        fl_z = (fl_min[2] + fl_max[2]) / 2.0
        self.assertGreater(fr_z, fl_z, "wheel_fr is not to the +Z (right) of wheel_fl")

    def test_material_slots(self):
        self.assertIsNotNone(self.gltf)
        names = set(be.material_names(self.gltf))
        missing = set(be.MATERIAL_SLOTS) - names
        self.assertEqual(missing, set(), f"missing material slots: {missing}")

    def test_wheels_are_positioned_from_spec(self):
        self.assertIsNotNone(self.gltf)
        dims = self.spec["dimensions"]
        tyre = self.spec["tyre"]
        expected = {
            "wheel_fl": (dims["wheelbase"] / 2.0, tyre["front"]["radius"], -dims["track_front"] / 2.0),
            "wheel_fr": (dims["wheelbase"] / 2.0, tyre["front"]["radius"], dims["track_front"] / 2.0),
            "wheel_rl": (-dims["wheelbase"] / 2.0, tyre["rear"]["radius"], -dims["track_rear"] / 2.0),
            "wheel_rr": (-dims["wheelbase"] / 2.0, tyre["rear"]["radius"], dims["track_rear"] / 2.0),
        }
        for name, (ex, ey, ez) in expected.items():
            nmin, nmax = be.node_aabb(self.gltf, name)
            cx = (nmin[0] + nmax[0]) / 2.0
            cy = (nmin[1] + nmax[1]) / 2.0
            cz = (nmin[2] + nmax[2]) / 2.0
            self.assertAlmostEqual(cx, ex, delta=be.WHEEL_POSITION_TOLERANCE_M, msg=f"{name}.x")
            self.assertAlmostEqual(cy, ey, delta=be.WHEEL_POSITION_TOLERANCE_M, msg=f"{name}.y")
            self.assertAlmostEqual(cz, ez, delta=be.WHEEL_POSITION_TOLERANCE_M, msg=f"{name}.z")

    def test_triangle_budget(self):
        """Not in the Required Tests table by name, but Acceptance Criteria
        #5 states LOD0 must be 60,000-150,000 triangles — verify it."""
        self.assertIsNotNone(self.result.summary)
        tris = self.result.summary["mesh"]["triangles"]
        self.assertGreaterEqual(tris, be.TRIANGLE_BUDGET_MIN)
        self.assertLessEqual(tris, be.TRIANGLE_BUDGET_MAX)


class TestFailureHandling(unittest.TestCase):
    """test_failure_writes_summary — an invalid spec must produce
    ok: false in the summary AND a non-zero exit code. Exit code 0 with
    no/invalid summary must never be treated as success."""

    def test_failure_writes_summary(self):
        TEST_OUT_DIR.mkdir(parents=True, exist_ok=True)
        bad_spec_path = TEST_OUT_DIR / "_invalid.spec.json"
        # Missing "dimensions" entirely, and tyre.front.radius is negative —
        # either alone is enough to fail validate_spec() in build_vehicle.py.
        bad_spec_path.write_text(
            json.dumps({
                "schema_version": 1, "name": "Broken", "class": "gt3",
                "mass": {}, "tyre": {"front": {"radius": -1.0, "width": 0.3, "rim_diameter_in": 18},
                                       "rear": {"radius": 0.3, "width": 0.3, "rim_diameter_in": 18}},
                "visual": {"body_profile": {}},
            }),
            encoding="utf-8",
        )
        out_path = TEST_OUT_DIR / "_invalid.glb"
        summary_path = TEST_OUT_DIR / "_invalid.summary.json"
        result = _run(bad_spec_path, out_path, summary_path, timeout_s=60.0)

        self.assertNotEqual(result.exit_code, 0, "invalid spec must not exit 0")
        self.assertIsNotNone(result.summary, "a summary must be written even on failure")
        self.assertFalse(result.summary.get("ok"), "summary.ok must be false for an invalid spec")
        self.assertTrue(result.summary.get("errors"), "summary.errors must be non-empty for an invalid spec")
        self.assertFalse(result.ok)


class TestDeterminism(unittest.TestCase):
    """test_deterministic_output — the same spec generated twice must
    produce identical vertex/triangle counts and dimensions."""

    def test_deterministic_output(self):
        TEST_OUT_DIR.mkdir(parents=True, exist_ok=True)
        out1 = TEST_OUT_DIR / "det_run1.glb"
        sum1 = TEST_OUT_DIR / "det_run1.summary.json"
        out2 = TEST_OUT_DIR / "det_run2.glb"
        sum2 = TEST_OUT_DIR / "det_run2.summary.json"

        r1 = _run(GT_PROTO_A_SPEC, out1, sum1)
        r2 = _run(GT_PROTO_A_SPEC, out2, sum2)

        self.assertTrue(r1.ok, f"run 1 failed: {r1.summary}")
        self.assertTrue(r2.ok, f"run 2 failed: {r2.summary}")
        self.assertEqual(r1.summary["mesh"], r2.summary["mesh"])
        self.assertEqual(r1.summary["dimensions_m"], r2.summary["dimensions_m"])


def _cleanup():
    if TEST_OUT_DIR.exists():
        shutil.rmtree(TEST_OUT_DIR, ignore_errors=True)


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2, exit=False)
    finally:
        _cleanup()
