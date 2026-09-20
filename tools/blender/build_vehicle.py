"""tools/blender/build_vehicle.py

Runs INSIDE Blender (bpy), invoked headlessly via blender-launcher.exe.
Do not run this with a normal Python interpreter — it will fail on
`import bpy`.

Reads a vehicle spec.json (schema: tools/blender/vehicle_spec_schema.md)
and parametrically generates a vehicle mesh, exports it as GLB, and
writes a JSON summary file (contract: docs/phase-0.5-tasks.md,
TASK-05-2, "サマリファイルの契約").

Coordinate convention (fixed by spec, UE5 depends on it):
    +X forward, +Y up, +Z right. Origin at the wheelbase midpoint,
    laterally centred, at ground level (y = 0).

Every vertex in this file is authored in that convention and only
converted to Blender's native Z-up space at the last possible moment
(see `real_to_blender`), so all the shape math below reads in the
project's own coordinate language, not Blender's.

Blender -> glTF axis mapping used by `real_to_blender` was verified
empirically (not assumed — see HANDOFF.md 再導出すると高くつく知見 policy)
by exporting marker empties at Blender (1,0,0)/(0,1,0)/(0,0,1) and
reading back the resulting glTF node translations:

    Blender (1,0,0) -> glTF (1, 0,  0)   => glTF.X =  Blender.X
    Blender (0,1,0) -> glTF (0, 0, -1)   => glTF.Z = -Blender.Y
    Blender (0,0,1) -> glTF (0, 1,  0)   => glTF.Y =  Blender.Z

Solving for the Blender coordinates that make glTF equal our desired
(x_fwd, y_up, z_right):
    Blender.X =  x_fwd
    Blender.Y = -z_right
    Blender.Z =  y_up

This transform's matrix has determinant +1 (a pure rotation, not a
mirror), so face winding authored in the real-world convention survives
unchanged into Blender/glTF space — no winding correction needed.
"""
import json
import math
import sys
import traceback
from pathlib import Path

import bpy

# ---------------------------------------------------------------------------
# Argument parsing (everything after "--"; Blender consumes the rest itself)
# ---------------------------------------------------------------------------


def parse_args():
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    args = {"spec": None, "out": None, "summary": None}
    i = 0
    while i < len(argv):
        tok = argv[i]
        if tok == "--spec":
            args["spec"] = argv[i + 1]
            i += 2
        elif tok == "--out":
            args["out"] = argv[i + 1]
            i += 2
        elif tok == "--summary":
            args["summary"] = argv[i + 1]
            i += 2
        else:
            i += 1
    return args


# ---------------------------------------------------------------------------
# Coordinate helper (see module docstring for derivation)
# ---------------------------------------------------------------------------


def real_to_blender(x_fwd, y_up, z_right):
    return (x_fwd, -z_right, y_up)


# ---------------------------------------------------------------------------
# Spec loading & validation
# ---------------------------------------------------------------------------

REQUIRED_TOP_KEYS = ("schema_version", "name", "class", "dimensions", "mass", "tyre", "visual")
REQUIRED_DIMENSION_KEYS = (
    "length", "width", "height", "wheelbase",
    "track_front", "track_rear", "front_overhang", "rear_overhang",
    "ride_height_front", "ride_height_rear",
)
REQUIRED_TYRE_SIDE_KEYS = ("radius", "width", "rim_diameter_in")
REQUIRED_BODY_PROFILE_KEYS = (
    "nose_height", "roof_height", "roof_start_x", "roof_end_x",
    "cabin_width", "sill_height", "front_splitter_depth", "diffuser_height",
)


class SpecError(ValueError):
    pass


def _require_positive(d, key, path, errors):
    if key not in d:
        errors.append(f"missing key: {path}.{key}")
        return None
    val = d[key]
    if not isinstance(val, (int, float)) or isinstance(val, bool):
        errors.append(f"{path}.{key} must be a number, got {type(val).__name__}")
        return None
    if val <= 0:
        errors.append(f"{path}.{key} must be > 0, got {val}")
    return val


def validate_spec(spec):
    errors = []
    if not isinstance(spec, dict):
        return ["spec.json root must be a JSON object"]

    for key in REQUIRED_TOP_KEYS:
        if key not in spec:
            errors.append(f"missing top-level key: {key}")
    if errors:
        return errors  # can't safely descend further

    dims = spec["dimensions"]
    if not isinstance(dims, dict):
        errors.append("dimensions must be an object")
    else:
        for key in REQUIRED_DIMENSION_KEYS:
            _require_positive(dims, key, "dimensions", errors)

    tyre = spec["tyre"]
    if not isinstance(tyre, dict) or "front" not in tyre or "rear" not in tyre:
        errors.append("tyre must be an object with 'front' and 'rear'")
    else:
        for side in ("front", "rear"):
            side_d = tyre.get(side)
            if not isinstance(side_d, dict):
                errors.append(f"tyre.{side} must be an object")
                continue
            for key in REQUIRED_TYRE_SIDE_KEYS:
                _require_positive(side_d, key, f"tyre.{side}", errors)

    visual = spec["visual"]
    if not isinstance(visual, dict) or "body_profile" not in visual:
        errors.append("visual.body_profile is required")
    else:
        bp = visual["body_profile"]
        if not isinstance(bp, dict):
            errors.append("visual.body_profile must be an object")
        else:
            for key in REQUIRED_BODY_PROFILE_KEYS:
                if key not in bp:
                    errors.append(f"missing key: visual.body_profile.{key}")
                elif not isinstance(bp[key], (int, float)) or isinstance(bp[key], bool):
                    errors.append(f"visual.body_profile.{key} must be a number")

    return errors


def load_spec(path):
    with open(path, "r", encoding="utf-8") as f:
        raw = f.read()
    try:
        spec = json.loads(raw)
    except json.JSONDecodeError as e:
        raise SpecError(f"invalid JSON: {e}") from e
    errors = validate_spec(spec)
    if errors:
        raise SpecError("; ".join(errors))
    return spec


# ---------------------------------------------------------------------------
# Generic geometry helpers (all authored in the real-world x_fwd/y_up/z_right
# convention; converted to Blender space only when appended to `verts`)
# ---------------------------------------------------------------------------


def superellipse_profile(n, half_width, y_bottom, y_top, bulge=2.6):
    """Closed rounded cross-section in the (z_right, y_up) plane.

    A superellipse ("squircle") is used instead of a hand-placed polygon
    so the whole profile is a pure function of the two extents that come
    from the spec (half_width, y range) plus a fixed shape exponent that
    is an implementation style choice, not a spec value.
    """
    y_mid = (y_top + y_bottom) / 2.0
    y_half = (y_top - y_bottom) / 2.0
    pts = []
    for i in range(n):
        theta = 2.0 * math.pi * i / n
        c = math.cos(theta)
        s = math.sin(theta)
        ze = math.copysign(abs(c) ** (2.0 / bulge), c) * half_width
        ye = math.copysign(abs(s) ** (2.0 / bulge), s) * y_half
        pts.append((ze, y_mid + ye))
    return pts


def build_loft(x_stations, n_segments, bulge=2.6):
    """Loft a superellipse cross-section along X through a list of stations.

    Each station is a dict with keys x, half_width, y_bottom, y_top.
    Returns (verts_blender, faces) ready for mesh.from_pydata.
    """
    verts = []
    faces = []
    ring_starts = []
    for st in x_stations:
        ring_starts.append(len(verts))
        profile = superellipse_profile(n_segments, st["half_width"], st["y_bottom"], st["y_top"], bulge)
        for z, y in profile:
            verts.append(real_to_blender(st["x"], y, z))
    n_rings = len(x_stations)
    for r in range(n_rings - 1):
        b0 = ring_starts[r]
        b1 = ring_starts[r + 1]
        for k in range(n_segments):
            k2 = (k + 1) % n_segments
            faces.append((b0 + k, b0 + k2, b1 + k2, b1 + k))
    first = ring_starts[0]
    faces.append(tuple(first + i for i in range(n_segments)))
    last = ring_starts[-1]
    faces.append(tuple(last + i for i in range(n_segments - 1, -1, -1)))
    return verts, faces


def interpolate_stations(key_stations, subdiv):
    """Linearly interpolate numeric fields between consecutive key stations."""
    fields = ("x", "half_width", "y_bottom", "y_top")
    stations = []
    for i in range(len(key_stations) - 1):
        a = key_stations[i]
        b = key_stations[i + 1]
        for s in range(subdiv):
            t = s / float(subdiv)
            stations.append({f: a[f] + (b[f] - a[f]) * t for f in fields})
    stations.append(dict(key_stations[-1]))
    return stations


def field_at_x(key_stations, x, field):
    """Linearly interpolate a station field at an arbitrary x (clamped to range)."""
    xs = [st["x"] for st in key_stations]
    # key_stations run from tail (most negative x) to nose (most positive x)
    if x <= xs[0]:
        return key_stations[0][field]
    if x >= xs[-1]:
        return key_stations[-1][field]
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            t = (x - xs[i]) / (xs[i + 1] - xs[i])
            a = key_stations[i][field]
            b = key_stations[i + 1][field]
            return a + (b - a) * t
    return key_stations[-1][field]


def build_revolve(rings_local, n_segments, center, caps=True):
    """Surface of revolution around the Z (lateral) axis through `center`.

    rings_local: ordered list of (radius, z_offset) pairs.
    center: (x_fwd, y_up, z_right) of the hub in real-world coordinates.
    caps: add flat n-gon caps at the first/last ring if their radius is
        non-zero. Set to False when the ring list already forms a closed
        loop on its own (e.g. an annular washer that returns to its
        starting radius/offset), otherwise a redundant, overlapping cap
        face would be created on top of the real geometry.
    """
    cx, cy, cz = center
    verts = []
    faces = []
    ring_starts = []
    for r, dz in rings_local:
        ring_starts.append(len(verts))
        for i in range(n_segments):
            theta = 2.0 * math.pi * i / n_segments
            x = cx + r * math.cos(theta)
            y = cy + r * math.sin(theta)
            z = cz + dz
            verts.append(real_to_blender(x, y, z))
    n_rings = len(rings_local)
    for ridx in range(n_rings - 1):
        b0 = ring_starts[ridx]
        b1 = ring_starts[ridx + 1]
        for k in range(n_segments):
            k2 = (k + 1) % n_segments
            faces.append((b0 + k, b0 + k2, b1 + k2, b1 + k))
    if caps:
        if rings_local[0][0] > 1e-6:
            first = ring_starts[0]
            faces.append(tuple(first + i for i in range(n_segments)))
        if rings_local[-1][0] > 1e-6:
            last = ring_starts[-1]
            faces.append(tuple(last + i for i in range(n_segments - 1, -1, -1)))
    return verts, faces


def build_box(center, size_x, size_y, size_z, angle_z=0.0):
    """Axis-aligned box (optionally pitched about the lateral/Z axis).

    center, sizes in the real-world x_fwd/y_up/z_right convention.
    angle_z: rotation about the lateral (Z) axis, i.e. pitch (radians) —
    used for the rear wing's angle of attack.
    """
    cx, cy, cz = center
    hx, hy, hz = size_x / 2.0, size_y / 2.0, size_z / 2.0
    local_corners = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    cos_a = math.cos(angle_z)
    sin_a = math.sin(angle_z)
    verts = []
    for lx, ly, lz in local_corners:
        rx = lx * cos_a - ly * sin_a
        ry = lx * sin_a + ly * cos_a
        verts.append(real_to_blender(cx + rx, cy + ry, cz + lz))
    faces = [
        (0, 1, 2, 3),  # -z
        (4, 7, 6, 5),  # +z
        (0, 4, 5, 1),  # -y
        (3, 2, 6, 7),  # +y
        (0, 3, 7, 4),  # -x
        (1, 5, 6, 2),  # +x
    ]
    return verts, faces


def recalc_outward_normals(mesh):
    import bmesh

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()


_materials_cache = {}


def get_or_create_material(name, base_color=(0.6, 0.6, 0.6, 1.0)):
    if name in _materials_cache:
        return _materials_cache[name]
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = base_color
    _materials_cache[name] = mat
    return mat


def make_object(name, verts, faces, material_name, base_color=(0.6, 0.6, 0.6, 1.0)):
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    recalc_outward_normals(mesh)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mat = get_or_create_material(material_name, base_color)
    obj.data.materials.append(mat)
    return obj


def merge_parts(name, parts, material_name, base_color=(0.6, 0.6, 0.6, 1.0)):
    """Combine several (verts, faces) part-lists into a single object."""
    verts = []
    faces = []
    for pverts, pfaces in parts:
        base = len(verts)
        verts.extend(pverts)
        for f in pfaces:
            faces.append(tuple(idx + base for idx in f))
    return make_object(name, verts, faces, material_name, base_color)


# ---------------------------------------------------------------------------
# Resolution constants (implementation style, not spec values). Tuned so the
# whole-vehicle triangle count lands within the 60,000-150,000 budget from
# docs/phase-0.5-tasks.md Acceptance Criteria #5 / PROJECT.md §6.
# ---------------------------------------------------------------------------

BODY_SEGMENTS = 64
BODY_KEY_SUBDIV = 90
GLASS_SEGMENTS = 28
GLASS_KEY_SUBDIV = 40
TYRE_SEGMENTS = 48
TYRE_RINGS = 16
RIM_SEGMENTS = 40
RIM_BARREL_RINGS = 3
HUB_SEGMENTS = 28
SPOKE_LENGTH_SEGMENTS = 3
DISC_SEGMENTS = 40
DISC_VANE_LENGTH_SEGMENTS = 2


# ---------------------------------------------------------------------------
# Vehicle assembly
# ---------------------------------------------------------------------------


def build_vehicle(spec, warnings):
    dims = spec["dimensions"]
    visual = spec["visual"]
    bp = visual["body_profile"]
    tyre = spec["tyre"]
    livery = visual.get("livery", {})
    base_color = tuple(livery.get("base_color", [0.6, 0.6, 0.6])) + (1.0,)

    wheelbase = dims["wheelbase"]
    width = dims["width"]
    sill = bp["sill_height"]
    roof_h = bp["roof_height"]
    nose_h = bp["nose_height"]

    front_axle_x = wheelbase / 2.0
    rear_axle_x = -wheelbase / 2.0
    nose_x = front_axle_x + dims["front_overhang"]
    tail_x = rear_axle_x - dims["rear_overhang"]

    deck_h = sill + 0.35 * (roof_h - sill)

    # Key stations for the body loft, tail to nose.
    key_stations = [
        {"x": tail_x, "half_width": width * 0.30, "y_bottom": sill * 0.35, "y_top": nose_h * 0.80},
        {"x": rear_axle_x, "half_width": width / 2.0, "y_bottom": dims["ride_height_rear"], "y_top": deck_h},
        {"x": bp["roof_end_x"], "half_width": bp["cabin_width"] / 2.0, "y_bottom": sill, "y_top": roof_h},
        {"x": bp["roof_start_x"], "half_width": bp["cabin_width"] / 2.0, "y_bottom": sill, "y_top": roof_h},
        {"x": front_axle_x, "half_width": width / 2.0, "y_bottom": dims["ride_height_front"], "y_top": deck_h},
        {"x": nose_x, "half_width": width * 0.28, "y_bottom": dims["ride_height_front"] * 0.4, "y_top": nose_h},
    ]
    for i in range(len(key_stations) - 1):
        if key_stations[i]["x"] >= key_stations[i + 1]["x"]:
            raise SpecError(
                "visual.body_profile.roof_start_x/roof_end_x are inconsistent "
                "with dimensions.wheelbase/front_overhang/rear_overhang "
                "(body loft stations are not monotonically increasing in x)"
            )

    objects = []

    body_stations = interpolate_stations(key_stations, BODY_KEY_SUBDIV)
    body_verts, body_faces = build_loft(body_stations, BODY_SEGMENTS)
    objects.append(make_object("body", body_verts, body_faces, "M_Body", base_color))

    # Glass: the cabin greenhouse band only, slightly inset from the body.
    glass_key = [
        {"x": bp["roof_end_x"], "half_width": bp["cabin_width"] * 0.48, "y_bottom": sill * 1.05, "y_top": roof_h * 0.985},
        {"x": bp["roof_start_x"], "half_width": bp["cabin_width"] * 0.48, "y_bottom": sill * 1.05, "y_top": roof_h * 0.985},
    ]
    glass_stations = interpolate_stations(glass_key, GLASS_KEY_SUBDIV)
    glass_verts, glass_faces = build_loft(glass_stations, GLASS_SEGMENTS)
    objects.append(make_object("glass", glass_verts, glass_faces, "M_Glass", (0.05, 0.08, 0.10, 0.35)))

    # Cockpit floor: simple flat panel, onboard-camera reference plane.
    floor_y = sill * 0.30
    floor_half_w = bp["cabin_width"] * 0.45
    fv = [
        real_to_blender(bp["roof_end_x"], floor_y, -floor_half_w),
        real_to_blender(bp["roof_start_x"], floor_y, -floor_half_w),
        real_to_blender(bp["roof_start_x"], floor_y, floor_half_w),
        real_to_blender(bp["roof_end_x"], floor_y, floor_half_w),
    ]
    objects.append(make_object("cockpit_floor", fv, [(0, 1, 2, 3)], "M_Carbon", (0.02, 0.02, 0.02, 1.0)))

    # Front splitter: thin blade occupying the last `front_splitter_depth`
    # of the nose, so it never extends beyond dimensions.length.
    splitter_depth = bp["front_splitter_depth"]
    sv, sf = build_box(
        center=(nose_x - splitter_depth / 2.0, dims["ride_height_front"] * 0.5, 0.0),
        size_x=splitter_depth,
        size_y=0.014,
        size_z=width,
    )
    objects.append(make_object("front_splitter", sv, sf, "M_Carbon", (0.02, 0.02, 0.02, 1.0)))

    # Rear diffuser: raked panel from the rear axle to the tail, rising to
    # visual.body_profile.diffuser_height, with a few ribs (fins).
    diffuser_h = bp["diffuser_height"]
    ramp_len = tail_x - rear_axle_x  # negative-going; abs is the span
    diff_thickness = 0.012
    top = [
        real_to_blender(rear_axle_x, dims["ride_height_rear"], -width / 2.0),
        real_to_blender(tail_x, diffuser_h, -width / 2.0),
        real_to_blender(tail_x, diffuser_h, width / 2.0),
        real_to_blender(rear_axle_x, dims["ride_height_rear"], width / 2.0),
    ]
    bottom = [
        real_to_blender(rear_axle_x, dims["ride_height_rear"] - diff_thickness, -width / 2.0),
        real_to_blender(tail_x, diffuser_h - diff_thickness, -width / 2.0),
        real_to_blender(tail_x, diffuser_h - diff_thickness, width / 2.0),
        real_to_blender(rear_axle_x, dims["ride_height_rear"] - diff_thickness, width / 2.0),
    ]
    dv = top + bottom
    df = [
        (0, 1, 2, 3),
        (4, 7, 6, 5),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0),
    ]
    diffuser_parts = [(dv, df)]
    n_fins = 5
    for i in range(n_fins):
        fz = -width / 2.0 + width * (i + 0.5) / n_fins
        fin_v, fin_f = build_box(
            center=(rear_axle_x + ramp_len * 0.5, (dims["ride_height_rear"] + diffuser_h) * 0.5, fz),
            size_x=abs(ramp_len) * 0.96,
            size_y=diffuser_h * 0.5,
            size_z=width * 0.02,
        )
        diffuser_parts.append((fin_v, fin_f))
    objects.append(merge_parts("rear_diffuser", diffuser_parts, "M_Carbon", (0.02, 0.02, 0.02, 1.0)))

    # Rear wing + end plates.
    rw = visual.get("rear_wing", {})
    if rw.get("enabled", False):
        span = rw["span"]
        chord = rw["chord"]
        thickness = chord * 0.08
        body_h_here = field_at_x(key_stations, rw["offset_x"], "y_top")
        wing_cy = body_h_here + rw["height_above_body"] + thickness / 2.0
        wv, wf = build_box(
            center=(rw["offset_x"], wing_cy, 0.0),
            size_x=chord,
            size_y=thickness,
            size_z=span,
            angle_z=rw["angle"],
        )
        objects.append(make_object("rear_wing", wv, wf, "M_Carbon", (0.02, 0.02, 0.02, 1.0)))

        plate_h = chord * 0.9
        plate_t = 0.012
        for side, z in (("l", -span / 2.0), ("r", span / 2.0)):
            pv, pf = build_box(
                center=(rw["offset_x"], wing_cy, z),
                size_x=chord,
                size_y=plate_h,
                size_z=plate_t,
            )
            objects.append(make_object(f"rear_wing_endplate_{side}", pv, pf, "M_Carbon", (0.02, 0.02, 0.02, 1.0)))
    else:
        warnings.append("rear_wing.enabled is false; wing and end plates were not generated")

    # Wheels, tyres, brake discs, calipers — one set per corner.
    wheel_visual = visual.get("wheel", {})
    spoke_count = int(wheel_visual.get("spoke_count", 8))
    spoke_width = wheel_visual.get("spoke_width", 0.03)
    brakes = spec.get("brakes", {})
    disc_visual = visual.get("brake_disc", {})
    vane_count = int(disc_visual.get("vane_count", 24))

    # +Z is right (fixed convention — see module docstring), so the "right"
    # corners (fr/rr) get positive z and the "left" corners (fl/rl) negative.
    corners = [
        ("fl", front_axle_x, -dims["track_front"] / 2.0, tyre["front"], "front"),
        ("fr", front_axle_x, dims["track_front"] / 2.0, tyre["front"], "front"),
        ("rl", rear_axle_x, -dims["track_rear"] / 2.0, tyre["rear"], "rear"),
        ("rr", rear_axle_x, dims["track_rear"] / 2.0, tyre["rear"], "rear"),
    ]
    for corner, x, z, tyre_side, axle in corners:
        radius = tyre_side["radius"]
        tyre_width = tyre_side["width"]
        rim_radius = tyre_side["rim_diameter_in"] * 0.0254 / 2.0
        center = (x, radius, z)

        # Tyre: revolve with a gentle tread bulge (sidewalls tuck slightly
        # inward at the edges relative to the tread crown).
        rings = []
        for i in range(TYRE_RINGS):
            t = i / (TYRE_RINGS - 1)
            dz = -tyre_width / 2.0 + tyre_width * t
            edge_factor = (2.0 * t - 1.0) ** 2  # 0 at center, 1 at edges
            r = radius * (1.0 - 0.06 * edge_factor)
            rings.append((r, dz))
        tv, tf = build_revolve(rings, TYRE_SEGMENTS, center)
        objects.append(make_object(f"tyre_{corner}", tv, tf, "M_Tyre", (0.02, 0.02, 0.02, 1.0)))

        # Wheel: rim barrel + hub + spokes, all sharing the same revolve axis.
        rim_width = tyre_width * 0.88
        barrel_rings = []
        for i in range(RIM_BARREL_RINGS):
            t = i / (RIM_BARREL_RINGS - 1)
            dz = -rim_width / 2.0 + rim_width * t
            barrel_rings.append((rim_radius, dz))
        rim_v, rim_f = build_revolve(barrel_rings, RIM_SEGMENTS, center)

        hub_radius = rim_radius * 0.28
        hub_rings = [(hub_radius, -rim_width * 0.22), (hub_radius, rim_width * 0.22)]
        hub_v, hub_f = build_revolve(hub_rings, HUB_SEGMENTS, center)

        wheel_parts = [(rim_v, rim_f), (hub_v, hub_f)]
        for i in range(spoke_count):
            theta = 2.0 * math.pi * i / spoke_count
            r_mid = (hub_radius + rim_radius) / 2.0
            sx = x + r_mid * math.cos(theta)
            sy = radius + r_mid * math.sin(theta)
            spoke_len = rim_radius - hub_radius
            spoke_v, spoke_f = build_box(
                center=(sx, sy, z),
                size_x=spoke_len,
                size_y=spoke_width,
                size_z=rim_width * 0.7,
                angle_z=theta,
            )
            # build_box pitches about Z using (size_x, size_y) as the
            # in-plane axes already aligned with the spoke's radial
            # direction via angle_z, so no further rotation is needed.
            wheel_parts.append((spoke_v, spoke_f))
        objects.append(merge_parts(f"wheel_{corner}", wheel_parts, "M_WheelRim", (0.75, 0.75, 0.78, 1.0)))

        # Brake disc: a vented washer (outer/inner cylindrical walls + two
        # annular caps) plus radial cooling vanes (visual.brake_disc.vane_count).
        disc_radius = brakes.get(f"disc_radius_{axle}", rim_radius * 0.72)
        disc_inner = disc_radius * 0.45
        disc_thickness = 0.022
        washer_rings = [
            (disc_radius, -disc_thickness / 2.0),
            (disc_radius, disc_thickness / 2.0),
            (disc_inner, disc_thickness / 2.0),
            (disc_inner, -disc_thickness / 2.0),
            (disc_radius, -disc_thickness / 2.0),
        ]
        disc_v, disc_f = build_revolve(washer_rings, DISC_SEGMENTS, center, caps=False)
        disc_parts = [(disc_v, disc_f)]
        for i in range(vane_count):
            theta = 2.0 * math.pi * i / vane_count
            r_mid = (disc_inner + disc_radius) / 2.0
            vx = x + r_mid * math.cos(theta)
            vy = radius + r_mid * math.sin(theta)
            vane_v, vane_f = build_box(
                center=(vx, vy, z),
                size_x=(disc_radius - disc_inner) * 0.9,
                size_y=disc_thickness * 0.4,
                size_z=disc_thickness * 6.0,
                angle_z=theta,
            )
            disc_parts.append((vane_v, vane_f))
        objects.append(merge_parts(f"brake_disc_{corner}", disc_parts, "M_BrakeDisc", (0.35, 0.30, 0.28, 1.0)))

        # Caliper: simple bracket straddling the disc's upper edge.
        cal_v, cal_f = build_box(
            center=(x, radius + disc_radius * 0.55, z + (0.02 if z >= 0 else -0.02)),
            size_x=disc_radius * 0.55,
            size_y=disc_radius * 0.42,
            size_z=0.06,
        )
        objects.append(make_object(f"brake_caliper_{corner}", cal_v, cal_f, "M_Caliper", (0.75, 0.05, 0.05, 1.0)))

    return objects


def compute_summary_stats(objects):
    total_verts = 0
    total_tris = 0
    for obj in objects:
        mesh = obj.data
        total_verts += len(mesh.vertices)
        mesh.calc_loop_triangles()
        total_tris += len(mesh.loop_triangles)
    return total_verts, total_tris


def compute_dimensions_m(objects, spec):
    min_b = [float("inf")] * 3
    max_b = [float("-inf")] * 3
    for obj in objects:
        for v in obj.data.vertices:
            co = v.co
            for i, c in enumerate((co.x, co.y, co.z)):
                min_b[i] = min(min_b[i], c)
                max_b[i] = max(max_b[i], c)
    # Blender space here is (x_fwd, -z_right, y_up); extents are invariant
    # to the sign flip, so we can read them straight off.
    length = max_b[0] - min_b[0]
    width = max_b[1] - min_b[1]
    height = max_b[2] - min_b[2]
    return {
        "length": length,
        "width": width,
        "height": height,
        "wheelbase": spec["dimensions"]["wheelbase"],
    }


def main():
    args = parse_args()
    warnings = []
    errors = []
    summary = {
        "ok": False,
        "spec": args["spec"],
        "output": args["out"],
        "blender_version": bpy.app.version_string,
        "mesh": {"objects": 0, "vertices": 0, "triangles": 0},
        "dimensions_m": {},
        "warnings": warnings,
        "errors": errors,
    }

    try:
        if not args["spec"] or not args["out"] or not args["summary"]:
            raise SpecError("missing required argument(s): --spec, --out, --summary")

        spec = load_spec(args["spec"])
        summary["spec"] = args["spec"]
        summary["output"] = args["out"]

        bpy.ops.wm.read_factory_settings(use_empty=True)

        objects = build_vehicle(spec, warnings)

        for obj in bpy.context.scene.objects:
            obj.select_set(True)
        bpy.context.view_layer.update()

        out_path = Path(args["out"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        bpy.ops.export_scene.gltf(
            filepath=str(out_path),
            export_format="GLB",
            use_selection=False,
        )

        total_verts, total_tris = compute_summary_stats(objects)
        summary["mesh"] = {
            "objects": len(objects),
            "vertices": total_verts,
            "triangles": total_tris,
        }
        summary["dimensions_m"] = compute_dimensions_m(objects, spec)
        summary["ok"] = True

    except SpecError as e:
        errors.append(str(e))
        summary["ok"] = False
    except Exception:
        errors.append(traceback.format_exc())
        summary["ok"] = False

    finally:
        summary_path = Path(args["summary"]) if args["summary"] else None
        if summary_path is not None:
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            with open(summary_path, "w", encoding="utf-8") as f:
                json.dump(summary, f, indent=2)

    sys.exit(0 if summary["ok"] else 1)


if __name__ == "__main__":
    main()
