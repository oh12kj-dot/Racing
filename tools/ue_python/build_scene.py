"""tools/ue_python/build_scene.py

UE-SIDE script. Runs INSIDE UnrealEditor-Cmd via ``-run=pythonscript``.
Invoked by tools/ue_python/ue_env.py — never run this with a normal
Python interpreter (it imports ``unreal``).

Responsibility (docs/phase-0.5-tasks.md, TASK-05-1):
  Build the whole feasibility-spike scene from code only — level, a
  straight + one corner of road, 24 vehicles (6 near-camera at LOD0), a
  dynamic sun, a guardrail, and one broadcast camera — with ZERO editor
  GUI work (ADR-0004, constraint 2). Anything the Python Editor API
  cannot reach is recorded per step in the summary; that list IS the M7
  verdict.

STATUS: all steps implemented — new_level (idempotent), lighting,
road_geometry (plane-segment strip from the sim-track centreline slice),
guardrail (cube-segment barrier down both edges), vehicles_x24 (24-car
grid built from the Interchange-imported GLB parts), broadcast_camera
(300 mm CineCamera), player_start (pawn spawn at the broadcast rig for
-game render passes), materials (shared master material + livery-param
instances from the vehicle spec), save_level. vehicles_x24 needs
tools/ue_python/import_vehicle.py to have run first.

The summary contract (see ue_env.REQUIRED_SUMMARY_KEYS): this script
writes JSON to the UE_SPIKE_SUMMARY path on EVERY exit path, success or
failure, before returning a non-zero code on failure. Per-step outcomes
go in details.steps[] so a partial success is still legible.
"""
from __future__ import annotations

import json
import math
import os
import sys
import traceback
from datetime import datetime, timezone

LEVEL_PACKAGE = "/Game/Spike/Maps/L_Spike"

# tools/ue_python/build_scene.py -> repo root is two levels up.
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRACK_JSON = os.path.join(REPO_ROOT, "assets", "tracks", "aoyama_ring.track.json")

# The feasibility-spike scene is a straight + one corner (not the whole
# ring). Take this many arc-metres of the Aoyama Ring centreline from the
# start/finish line: the long S/F straight plus the first sweeper (T1).
SPIKE_ROAD_LENGTH_M = 600.0
ROAD_SAMPLE_STEP_M = 8.0
M_TO_CM = 100.0


def _summary_path() -> str:
    env = os.environ.get("UE_SPIKE_SUMMARY")
    if env:
        return env
    for i, tok in enumerate(sys.argv):
        if tok == "--summary" and i + 1 < len(sys.argv):
            return sys.argv[i + 1]
        if tok.startswith("--summary="):
            return tok.split("=", 1)[1]
    return os.path.join(os.getcwd(), "build_scene.summary.json")


def _write_summary(path: str, payload: dict) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)


class StepLog:
    """Records each scene step's outcome for the M7 verdict."""

    def __init__(self) -> None:
        self.steps: list[dict] = []

    def run(self, name: str, fn) -> object:
        entry: dict = {"step": name, "ok": False}
        self.steps.append(entry)
        try:
            result = fn()
            entry["ok"] = True
            if isinstance(result, dict):
                entry.update(result)
            return result
        except Exception as exc:  # noqa: BLE001 — one failing step must not abort the rest
            entry["error"] = f"{type(exc).__name__}: {exc}"
            entry["traceback"] = traceback.format_exc()
            return None

    @property
    def all_ok(self) -> bool:
        return all(s["ok"] for s in self.steps)


# --- scene steps ---------------------------------------------------------


def _step_new_level(unreal) -> dict:
    """Ensure an empty level exists at LEVEL_PACKAGE (idempotent).

    ``LevelEditorSubsystem.new_level`` returns False if the package
    already exists, and headless ``EditorAssetLibrary.delete_asset``
    silently no-ops on a ``.umap``, so a re-run over a previous spike's
    ``L_Spike.umap`` (the file is .gitignored and fully regenerable)
    cannot go through ``new_level`` again. Instead: if it already exists,
    load it and destroy every actor so downstream steps populate a clean
    slate; only call ``new_level`` on a genuinely fresh path.
    """
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)

    # A fresh headless process has not scanned /Game/Spike into the Asset
    # Registry yet, so does_asset_exist() would wrongly say False. Force a
    # synchronous scan of the parent path first.
    pkg_dir = LEVEL_PACKAGE.rsplit("/", 1)[0]
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([pkg_dir], force_rescan=True)

    existed = unreal.EditorAssetLibrary.does_asset_exist(LEVEL_PACKAGE)
    if existed:
        if not les.load_level(LEVEL_PACKAGE):
            raise RuntimeError(f"load_level({LEVEL_PACKAGE}) returned False")
        eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
        removed = 0
        for actor in eas.get_all_level_actors():
            # World settings / default brush refuse destruction — harmless.
            if eas.destroy_actor(actor):
                removed += 1
        return {"level": LEVEL_PACKAGE, "reused_existing": True,
                "actors_cleared": removed}

    created = les.new_level(LEVEL_PACKAGE)
    if not created:
        raise RuntimeError(f"new_level({LEVEL_PACKAGE}) returned False")
    return {"level": LEVEL_PACKAGE, "reused_existing": False}


def _spawn(unreal, actor_class, location=(0.0, 0.0, 0.0), rotation=(0.0, 0.0, 0.0)):
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    loc = unreal.Vector(*location)
    rot = unreal.Rotator(*rotation)
    actor = eas.spawn_actor_from_class(actor_class, loc, rot)
    if actor is None:
        raise RuntimeError(f"spawn_actor_from_class({actor_class}) returned None")
    return actor


def _force_movable(unreal, actor) -> None:
    """Dynamic lighting: the sun must be Movable (broadcast time-of-day)."""
    root = actor.get_editor_property("root_component")
    if root is not None:
        root.set_editor_property("mobility", unreal.ComponentMobility.MOVABLE)


def _step_lighting(unreal) -> dict:
    spawned = []

    sun = _spawn(unreal, unreal.DirectionalLight, rotation=(0.0, -42.0, 150.0))
    _force_movable(unreal, sun)
    spawned.append("DirectionalLight")

    for cls_name in ("SkyAtmosphere", "SkyLight", "ExponentialHeightFog"):
        cls = getattr(unreal, cls_name, None)
        if cls is None:
            raise RuntimeError(f"unreal.{cls_name} not found in this build")
        actor = _spawn(unreal, cls)
        if cls_name == "SkyLight":
            _force_movable(unreal, actor)
        spawned.append(cls_name)

    return {"spawned": spawned}


def _load_spike_centerline() -> list[dict]:
    """Return the straight + first-corner slice of the Aoyama Ring
    centreline, resampled at ROAD_SAMPLE_STEP_M.

    Each element: {"x","z" (metres, sim-math world), "wl","wr" (half
    widths to the left / right edge, metres)}. sim-math y is the up axis
    and is 0 along this stretch, so it is dropped here.
    """
    with open(TRACK_JSON, "r", encoding="utf-8") as fh:
        track = json.load(fh)["track"]
    cl = track["centerline"]
    sections = track["sections"]

    # Cumulative arc length along the raw control points.
    pts = [(p["x"], p["z"]) for p in cl]
    cum = [0.0]
    for i in range(1, len(pts)):
        cum.append(cum[-1] + math.dist(pts[i - 1], pts[i]))

    def _lerp(a, b, f):
        return a + (b - a) * f

    out: list[dict] = []
    s = 0.0
    j = 0
    while s <= SPIKE_ROAD_LENGTH_M and s <= cum[-1]:
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        span = cum[j + 1] - cum[j]
        f = 0.0 if span <= 1e-9 else (s - cum[j]) / span
        x = _lerp(pts[j][0], pts[j + 1][0], f)
        z = _lerp(pts[j][1], pts[j + 1][1], f)
        wl = _lerp(sections[j]["width_left"], sections[j + 1]["width_left"], f)
        wr = _lerp(sections[j]["width_right"], sections[j + 1]["width_right"], f)
        out.append({"x": x, "z": z, "wl": wl, "wr": wr})
        s += ROAD_SAMPLE_STEP_M
    return out


def _sim_to_ue(x_m: float, z_m: float, y_m: float = 0.0):
    """sim-math world (X fwd, Y up, Z right; metres) -> UE (X, Y, Z up; cm).

    The spike road is flat (y = 0), so this is a planar remap plus the
    metre->centimetre scale; front-face winding is handled explicitly in
    the mesh builder, so the left-handed/right-handed flip does not
    matter here.
    """
    import unreal

    return unreal.Vector(x_m * M_TO_CM, z_m * M_TO_CM, y_m * M_TO_CM)


ENGINE_PLANE = "/Engine/BasicShapes/Plane"  # 1 m x 1 m, +Z up, centred


def _step_road_geometry(unreal) -> dict:
    """Procedural road surface built from the sim-track centreline (M7 +
    Code-First constraint 4: the track is generated from sim-track data,
    never hand-modelled).

    Runtime component creation is not exposed on a plain Actor in UE 5.8
    Python, so the road is a strip of flat ``/Engine/BasicShapes/Plane``
    StaticMeshActors — one per centreline segment, each positioned at the
    segment midpoint, yawed to the segment tangent, and scaled to
    (segment length x local road width). No plugin, no editor GUI.
    Kerbs / runoff / banking are later increments.
    """
    samples = _load_spike_centerline()
    if len(samples) < 2:
        raise RuntimeError(f"centreline slice too short: {len(samples)} samples")

    plane = unreal.EditorAssetLibrary.load_asset(ENGINE_PLANE)
    if plane is None:
        raise RuntimeError(f"could not load {ENGINE_PLANE}")

    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    segments = 0
    for i in range(len(samples) - 1):
        a, b = samples[i], samples[i + 1]
        mid_x, mid_z = (a["x"] + b["x"]) * 0.5, (a["z"] + b["z"]) * 0.5
        dx, dz = b["x"] - a["x"], b["z"] - a["z"]
        seg_len = math.hypot(dx, dz)
        if seg_len < 1e-6:
            continue
        width = (a["wl"] + a["wr"] + b["wl"] + b["wr"]) * 0.5
        # sim XZ -> UE XY; yaw measured in the UE ground plane.
        yaw_deg = math.degrees(math.atan2(dz, dx))
        loc = _sim_to_ue(mid_x, mid_z, 0.0)
        actor = eas.spawn_actor_from_class(
            unreal.StaticMeshActor, loc, unreal.Rotator(roll=0.0, pitch=0.0, yaw=yaw_deg)
        )
        if actor is None:
            raise RuntimeError("spawn_actor_from_class(StaticMeshActor) returned None")
        actor.set_actor_label(f"SpikeRoad_{i:03d}")
        smc = actor.static_mesh_component
        smc.set_static_mesh(plane)
        smc.set_mobility(unreal.ComponentMobility.STATIC)
        # Plane is 1 m; overlap segments slightly along X so seams do not gap.
        actor.set_actor_scale3d(unreal.Vector((seg_len + 0.05), width, 1.0))
        segments += 1

    return {
        "actors": f"SpikeRoad_000..{segments - 1:03d}",
        "segments": segments,
        "samples": len(samples),
        "length_m": SPIKE_ROAD_LENGTH_M,
        "sample_step_m": ROAD_SAMPLE_STEP_M,
        "source": os.path.relpath(TRACK_JSON, REPO_ROOT).replace("\\", "/"),
    }


ENGINE_CUBE = "/Engine/BasicShapes/Cube"  # 1 m cube, centred

GUARDRAIL_HEIGHT_M = 1.0
GUARDRAIL_THICKNESS_M = 0.12
GUARDRAIL_EDGE_MARGIN_M = 0.6  # gap from the white line out to the barrier


def _step_guardrail(unreal) -> dict:
    """A barrier down both edges of the spike road, from the same
    centreline slice: thin upright ``/Engine/BasicShapes/Cube`` segments
    offset one margin outside the local road width.
    """
    samples = _load_spike_centerline()
    if len(samples) < 2:
        raise RuntimeError(f"centreline slice too short: {len(samples)} samples")

    cube = unreal.EditorAssetLibrary.load_asset(ENGINE_CUBE)
    if cube is None:
        raise RuntimeError(f"could not load {ENGINE_CUBE}")

    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    made = 0
    for side, sign, key in (("L", +1.0, "wl"), ("R", -1.0, "wr")):
        for i in range(len(samples) - 1):
            a, b = samples[i], samples[i + 1]
            dx, dz = b["x"] - a["x"], b["z"] - a["z"]
            seg_len = math.hypot(dx, dz)
            if seg_len < 1e-6:
                continue
            tx, tz = dx / seg_len, dz / seg_len
            lx, lz = -tz, tx  # left-hand perpendicular in sim XZ
            off = 0.5 * (a[key] + b[key]) + GUARDRAIL_EDGE_MARGIN_M
            mid_x = 0.5 * (a["x"] + b["x"]) + sign * lx * off
            mid_z = 0.5 * (a["z"] + b["z"]) + sign * lz * off
            yaw_deg = math.degrees(math.atan2(dz, dx))
            loc = _sim_to_ue(mid_x, mid_z, GUARDRAIL_HEIGHT_M * 0.5)
            actor = eas.spawn_actor_from_class(
                unreal.StaticMeshActor, loc,
                unreal.Rotator(roll=0.0, pitch=0.0, yaw=yaw_deg),
            )
            if actor is None:
                raise RuntimeError("spawn StaticMeshActor (guardrail) returned None")
            actor.set_actor_label(f"SpikeRail_{side}_{i:03d}")
            smc = actor.static_mesh_component
            smc.set_static_mesh(cube)
            smc.set_mobility(unreal.ComponentMobility.STATIC)
            actor.set_actor_scale3d(unreal.Vector(
                seg_len + 0.05, GUARDRAIL_THICKNESS_M, GUARDRAIL_HEIGHT_M
            ))
            made += 1

    return {
        "segments": made,
        "height_m": GUARDRAIL_HEIGHT_M,
        "edge_margin_m": GUARDRAIL_EDGE_MARGIN_M,
    }


VEHICLES_ASSET_DIR = "/Game/Spike/Vehicles"
GRID_ROWS = 12
GRID_COLS = 2                 # 24 cars
GRID_ROW_SPACING_M = 9.0
GRID_COL_OFFSET_M = 1.8       # +/- from centreline
GRID_START_M = 20.0           # arc distance from the slice start
VEHICLE_YAW_OFFSET_DEG = 0.0  # correct once a screenshot shows mesh-forward


def _slice_pose_at(samples: list[dict], arc_m: float):
    """(x, z, yaw_deg) on the centreline slice at arc distance ``arc_m``."""
    f = arc_m / ROAD_SAMPLE_STEP_M
    k = max(0, min(int(f), len(samples) - 2))
    t = f - k
    a, b = samples[k], samples[k + 1]
    x = a["x"] + (b["x"] - a["x"]) * t
    z = a["z"] + (b["z"] - a["z"]) * t
    yaw = math.degrees(math.atan2(b["z"] - a["z"], b["x"] - a["x"]))
    # left-hand perpendicular unit vector in sim XZ
    dx, dz = b["x"] - a["x"], b["z"] - a["z"]
    n = math.hypot(dx, dz) or 1.0
    return x, z, yaw, (-dz / n, dx / n)


def _step_vehicles_x24(unreal) -> dict:
    """Spawn a 24-car grid on the start/finish straight.

    The vehicle GLB comes in from Interchange as one StaticMesh per
    Blender object (body, 4x wheel/tyre/disc/caliper, wings, ...). Each
    part mesh keeps its position baked in, so spawning every part at the
    same grid transform reassembles the whole car. Six cars closest to
    the broadcast camera are tagged LOD0 for the M3/M4 pass (LOD chain
    authoring itself is a later increment).

    Requires tools/ue_python/import_vehicle.py to have run.
    """
    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([VEHICLES_ASSET_DIR], force_rescan=True)
    parts: list[tuple[str, object]] = []
    for path in unreal.EditorAssetLibrary.list_assets(VEHICLES_ASSET_DIR, recursive=True):
        obj = unreal.EditorAssetLibrary.load_asset(path)
        if isinstance(obj, unreal.StaticMesh):
            parts.append((path, obj))
    if not parts:
        raise RuntimeError(
            f"no StaticMesh under {VEHICLES_ASSET_DIR}; run "
            "tools/ue_python/import_vehicle.py first"
        )

    # Diagnostic: local-space bounds of each part for the first car, so a
    # single run tells us whether the parts share a car-space origin
    # (reassemble) or are each centred on their own origin (need merge).
    part_bounds = []
    for name, mesh in parts:
        b = mesh.get_bounds()
        o, e = b.origin, b.box_extent
        part_bounds.append({
            "part": name.rsplit("/", 1)[-1].split(".")[0],
            "origin_cm": [round(o.x, 1), round(o.y, 1), round(o.z, 1)],
            "extent_cm": [round(e.x, 1), round(e.y, 1), round(e.z, 1)],
        })

    samples = _load_spike_centerline()
    eas = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
    cars = 0
    lod0: list[str] = []
    for row in range(GRID_ROWS):
        arc = GRID_START_M + row * GRID_ROW_SPACING_M
        x, z, yaw, (nlx, nlz) = _slice_pose_at(samples, arc)
        for col in range(GRID_COLS):
            side = col * 2 - 1  # -1, +1
            cx = x + nlx * GRID_COL_OFFSET_M * side
            cz = z + nlz * GRID_COL_OFFSET_M * side
            loc = _sim_to_ue(cx, cz, 0.0)
            rot = unreal.Rotator(roll=0.0, pitch=0.0,
                                 yaw=yaw + VEHICLE_YAW_OFFSET_DEG)
            idx = row * GRID_COLS + col
            is_lod0 = idx < 6
            for name, mesh in parts:
                actor = eas.spawn_actor_from_class(unreal.StaticMeshActor, loc, rot)
                if actor is None:
                    raise RuntimeError("spawn StaticMeshActor (vehicle) returned None")
                part = name.rsplit("/", 1)[-1].split(".")[0]
                actor.set_actor_label(f"SpikeCar_{idx:02d}_{part}")
                actor.static_mesh_component.set_static_mesh(mesh)
                actor.static_mesh_component.set_mobility(
                    unreal.ComponentMobility.MOVABLE
                )
                if is_lod0:
                    actor.tags = [unreal.Name("LOD0")]
            if is_lod0:
                lod0.append(f"SpikeCar_{idx:02d}")
            cars += 1

    return {
        "cars": cars,
        "parts_per_car": len(parts),
        "actors_spawned": cars * len(parts),
        "grid": f"{GRID_ROWS}x{GRID_COLS}",
        "lod0_cars": lod0,
        "part_bounds": part_bounds,
    }


def _step_broadcast_camera(unreal) -> dict:
    """One broadcast camera with a long-lens 'compression' look (M6).

    docs/phase-0.5-tasks.md asks for a 300 mm-equivalent focal length so
    the shot has the flattened, telephoto feel of a real race broadcast.
    We model that literally: a full-frame 16:9 filmback (36.0 x 20.25 mm)
    with a 300 mm focal length -> ~6.9deg horizontal FOV.

    Pose is derived from the road slice: on a rig ~22 m outside the
    racing line and 7.5 m up, 130 m back down the straight from the grid,
    looking back at the pack (the classic long-lens broadcast angle).
    ``auto_activate_for_player`` makes it the view in a ``-game`` render.
    """
    # Derive the pose from the actual road: sit trackside near T1 entry,
    # outside the corner and up on a rig, looking back down the straight
    # at approaching cars (the classic long-lens broadcast angle).
    samples = _load_spike_centerline()
    look_at_arc = 60.0                       # cars are on the grid from ~20 m
    cam_arc = look_at_arc + 130.0            # 130 m back down the straight
    tx, tz, _, (nlx, nlz) = _slice_pose_at(samples, cam_arc)
    # outside = camera-right of travel = -left normal
    cam_x = tx - nlx * 22.0
    cam_z = tz - nlz * 22.0
    cam_loc_ue = _sim_to_ue(cam_x, cam_z, 7.5)

    ax, az, _, _ = _slice_pose_at(samples, look_at_arc)
    aim_ue = _sim_to_ue(ax, az, 0.8)
    cam_rot = unreal.MathLibrary.find_look_at_rotation(cam_loc_ue, aim_ue)

    cam = _spawn(unreal, unreal.CineCameraActor)
    cam.set_actor_location_and_rotation(cam_loc_ue, cam_rot, False, False)

    # In a -game launch (the render pass) there is no pawn, so make this
    # camera auto-possess Player 0's view.
    for enum_name in ("PLAYER0", "PLAYER_0"):
        member = getattr(unreal.AutoReceiveInput, enum_name, None)
        if member is not None:
            cam.set_editor_property("auto_activate_for_player", member)
            break

    comp = cam.get_cine_camera_component()
    if comp is None:
        raise RuntimeError("CineCameraActor.get_cine_camera_component() is None")

    filmback = unreal.CameraFilmbackSettings()
    filmback.set_editor_property("sensor_width", 36.0)
    filmback.set_editor_property("sensor_height", 20.25)
    comp.set_editor_property("filmback", filmback)
    comp.set_editor_property("current_focal_length", 300.0)
    comp.set_editor_property("current_aperture", 8.0)

    # Sharp everywhere for an evaluation frame: turn the cinematic
    # depth-of-field off (f/8 + no DoF override).
    focus = comp.get_editor_property("focus_settings")
    for member in ("DISABLE", "DO_NOT_OVERRIDE", "NONE"):
        m = getattr(unreal.CameraFocusMethod, member, None)
        if m is not None:
            focus.set_editor_property("focus_method", m)
            break
    comp.set_editor_property("focus_settings", focus)

    eff_fov = None
    try:
        eff_fov = float(comp.get_editor_property("field_of_view"))
    except Exception:  # noqa: BLE001 — read-back is best-effort telemetry
        pass

    return {
        "actor": "CineCameraActor",
        "location_cm": [round(cam_loc_ue.x, 1), round(cam_loc_ue.y, 1),
                        round(cam_loc_ue.z, 1)],
        "rotation_pyr_deg": [round(cam_rot.pitch, 2), round(cam_rot.yaw, 2),
                             round(cam_rot.roll, 2)],
        "aim_arc_m": look_at_arc,
        "focal_length_mm": 300.0,
        "sensor_mm": [36.0, 20.25],
        "effective_h_fov_deg": eff_fov,
    }


VEHICLE_SPEC_JSON = os.path.join(
    REPO_ROOT, "assets", "vehicles", "gt_proto_a.spec.json"
)
MATERIALS_DIR = "/Game/Spike/Materials"
MASTER_MATERIAL = f"{MATERIALS_DIR}/M_VehicleMaster"

# role -> (metallic, roughness). Base colour is filled from the spec
# livery (M_Body / M_Caliper) or a fixed value (everything else).
_ROLE_PBR = {
    "M_Body": (0.10, 0.35),
    "M_Carbon": (0.0, 0.40),
    "M_Glass": (0.0, 0.05),
    "M_Tyre": (0.0, 0.90),
    "M_WheelRim": (1.0, 0.25),
    "M_BrakeDisc": (1.0, 0.40),
    "M_Caliper": (0.30, 0.30),
}
_ROLE_FIXED_COLOR = {
    "M_Carbon": (0.02, 0.02, 0.02),
    "M_Glass": (0.02, 0.02, 0.03),
    "M_Tyre": (0.015, 0.015, 0.015),
    "M_WheelRim": (0.50, 0.50, 0.55),
    "M_BrakeDisc": (0.35, 0.35, 0.38),
}


def _build_master_material(unreal):
    """One shared master material with BaseColor / Metallic / Roughness
    parameters, driven by MaterialInstanceConstants per role.
    """
    tools = unreal.AssetToolsHelpers.get_asset_tools()
    if unreal.EditorAssetLibrary.does_asset_exist(MASTER_MATERIAL):
        return unreal.EditorAssetLibrary.load_asset(MASTER_MATERIAL)

    master = tools.create_asset(
        "M_VehicleMaster", MATERIALS_DIR, unreal.Material,
        unreal.MaterialFactoryNew(),
    )
    mel = unreal.MaterialEditingLibrary
    col = mel.create_material_expression(
        master, unreal.MaterialExpressionVectorParameter, -350, -100
    )
    col.set_editor_property("parameter_name", "BaseColor")
    col.set_editor_property("default_value", unreal.LinearColor(0.5, 0.5, 0.5, 1.0))
    met = mel.create_material_expression(
        master, unreal.MaterialExpressionScalarParameter, -350, 100
    )
    met.set_editor_property("parameter_name", "Metallic")
    rough = mel.create_material_expression(
        master, unreal.MaterialExpressionScalarParameter, -350, 250
    )
    rough.set_editor_property("parameter_name", "Roughness")
    rough.set_editor_property("default_value", 0.5)
    mel.connect_material_property(col, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(met, "", unreal.MaterialProperty.MP_METALLIC)
    mel.connect_material_property(rough, "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.recompile_material(master)
    unreal.EditorAssetLibrary.save_asset(MASTER_MATERIAL)
    return master


def _step_materials(unreal) -> dict:
    """Shared master material + per-role MaterialInstanceConstants whose
    livery colours come from assets/vehicles/gt_proto_a.spec.json, then
    assigned onto the imported vehicle part meshes by slot name (M9:
    spec -> Blender -> glTF -> UE -> material, zero GUI).
    """
    with open(VEHICLE_SPEC_JSON, "r", encoding="utf-8") as fh:
        livery = json.load(fh)["visual"]["livery"]
    base = livery["base_color"]
    accent = livery["accent_color"]
    role_color = dict(_ROLE_FIXED_COLOR)
    role_color["M_Body"] = tuple(base)
    role_color["M_Caliper"] = tuple(accent)

    master = _build_master_material(unreal)
    mel = unreal.MaterialEditingLibrary
    tools = unreal.AssetToolsHelpers.get_asset_tools()

    role_mic: dict = {}
    for role, (metallic, roughness) in _ROLE_PBR.items():
        mic_path = f"{MATERIALS_DIR}/MI_{role}"
        if unreal.EditorAssetLibrary.does_asset_exist(mic_path):
            unreal.EditorAssetLibrary.delete_asset(mic_path)
        mic = tools.create_asset(
            f"MI_{role}", MATERIALS_DIR, unreal.MaterialInstanceConstant,
            unreal.MaterialInstanceConstantFactoryNew(),
        )
        mel.set_material_instance_parent(mic, master)
        r, g, b = role_color[role]
        mel.set_material_instance_vector_parameter_value(
            mic, "BaseColor", unreal.LinearColor(r, g, b, 1.0)
        )
        mel.set_material_instance_scalar_parameter_value(mic, "Metallic", metallic)
        mel.set_material_instance_scalar_parameter_value(mic, "Roughness", roughness)
        unreal.EditorAssetLibrary.save_asset(mic_path)
        role_mic[role] = mic

    registry = unreal.AssetRegistryHelpers.get_asset_registry()
    registry.scan_paths_synchronous([VEHICLES_ASSET_DIR], force_rescan=True)
    assigned = 0
    unmatched: list[str] = []
    for path in unreal.EditorAssetLibrary.list_assets(VEHICLES_ASSET_DIR, recursive=True):
        mesh = unreal.EditorAssetLibrary.load_asset(path)
        if not isinstance(mesh, unreal.StaticMesh):
            continue
        for slot in mesh.get_editor_property("static_materials"):
            name = str(slot.get_editor_property("material_slot_name"))
            mic = role_mic.get(name)
            if mic is None:
                unmatched.append(name)
                continue
            slot.set_editor_property("material_interface", mic)
            assigned += 1
        unreal.EditorAssetLibrary.save_asset(path)

    return {
        "master": MASTER_MATERIAL,
        "instances": sorted(role_mic),
        "livery_base_color": base,
        "livery_accent_color": accent,
        "slots_assigned": assigned,
        "slots_unmatched": sorted(set(unmatched)),
    }


def _step_player_start(unreal) -> dict:
    """One PlayerStart at the broadcast rig.

    A ``-game`` launch (the M3/M4 render pass) spawns the GlobalDefaultGameMode's
    pawn at a PlayerStart; with none in the level the pawn goes to world origin,
    which for this Aoyama slice is hundreds of metres off the scene, so the
    render loop runs but frames nothing recognisable. Placing it at the same
    pose as the broadcast camera keeps the fallback view sane even if the
    CineCameraActor's auto-activation ever fails. Pose derivation mirrors
    ``_step_broadcast_camera`` (steps are independent by design).
    """
    samples = _load_spike_centerline()
    look_at_arc = 60.0
    cam_arc = look_at_arc + 130.0
    tx, tz, _, (nlx, nlz) = _slice_pose_at(samples, cam_arc)
    start_x = tx - nlx * 22.0
    start_z = tz - nlz * 22.0
    start_loc = _sim_to_ue(start_x, start_z, 7.5)

    ax, az, _, _ = _slice_pose_at(samples, look_at_arc)
    aim = _sim_to_ue(ax, az, 0.8)
    start_rot = unreal.MathLibrary.find_look_at_rotation(start_loc, aim)

    actor = _spawn(unreal, unreal.PlayerStart)
    actor.set_actor_location_and_rotation(start_loc, start_rot, False, False)
    actor.set_actor_label("SpikePlayerStart")

    return {
        "actor": "PlayerStart",
        "location_cm": [round(start_loc.x, 1), round(start_loc.y, 1),
                        round(start_loc.z, 1)],
        "rotation_pyr_deg": [round(start_rot.pitch, 2), round(start_rot.yaw, 2),
                             round(start_rot.roll, 2)],
    }


def _step_save_level(unreal) -> dict:
    les = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
    saved = les.save_current_level()
    if not saved:
        raise RuntimeError("save_current_level() returned False")
    return {"saved": LEVEL_PACKAGE}


def _step_stub(name: str):
    def _fn() -> dict:
        return {"pending": name}

    return _fn


def main() -> int:
    summary_path = _summary_path()
    started = datetime.now(timezone.utc).isoformat()
    details: dict = {}
    log = StepLog()
    ok = False
    ue_version = "unknown"

    try:
        import unreal  # only importable inside UnrealEditor-Cmd

        ue_version = unreal.SystemLibrary.get_engine_version()
        details["ue_version"] = ue_version
        details["project_dir"] = unreal.Paths.project_dir()

        log.run("new_level", lambda: _step_new_level(unreal))
        log.run("lighting", lambda: _step_lighting(unreal))
        # Not yet implemented — recorded as pending so the M7 gap list is explicit.
        log.run("road_geometry", lambda: _step_road_geometry(unreal))
        log.run("guardrail", lambda: _step_guardrail(unreal))
        log.run("vehicles_x24", lambda: _step_vehicles_x24(unreal))
        log.run("broadcast_camera", lambda: _step_broadcast_camera(unreal))
        log.run("player_start", lambda: _step_player_start(unreal))
        log.run("materials", lambda: _step_materials(unreal))
        # Save last so every actor spawned above is persisted into the .umap.
        log.run("save_level", lambda: _step_save_level(unreal))

        details["steps"] = log.steps
        # "ok" for the pipeline = the implemented steps (new_level/lighting/save)
        # succeeded. Stubs report ok:true with a "pending" marker.
        implemented = [s for s in log.steps if "pending" not in s]
        ok = all(s["ok"] for s in implemented)
    except Exception as exc:  # noqa: BLE001
        details["fatal"] = f"{type(exc).__name__}: {exc}"
        details["fatal_traceback"] = traceback.format_exc()
        details["steps"] = log.steps
        ok = False

    pending = [s["step"] for s in log.steps if s.get("pending") or "pending" in s]
    failed = [s["step"] for s in log.steps if not s["ok"]]

    payload = {
        "ok": ok,
        "task": "build_scene",
        "ue_version": ue_version,
        "script": os.path.abspath(__file__),
        "started_utc": started,
        "finished_utc": datetime.now(timezone.utc).isoformat(),
        "details": details,
        "warnings": [f"pending (M7 gap list): {p}" for p in pending],
        "errors": [f"step failed: {f}" for f in failed],
    }
    _write_summary(summary_path, payload)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
