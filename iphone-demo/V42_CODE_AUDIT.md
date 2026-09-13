# Racing v42 code audit

## Scope

This audit covers the active `iphone-demo` runtime path used by `app.js`, with special focus on lifecycle growth, duplicated world geometry, pit-lane geometry/colliders, rendering hot paths, and version-wrapper ownership.

## Runtime ownership after v42

- `app.js` — orchestration only.
- `v42-config.js` — central lifecycle and Suzuka pit-layout constants.
- `v42-world.js` — final pit/home-straight architecture, physical guardrails, pit entry/exit openings, circuit audit.
- `v42-race.js` — bounded event/radio/telemetry/crash-history lifecycle.
- `v41-director.js` — broadcast event selection and time-bounded cut history.
- `v41-camera.js` — camera placement/cut execution.
- `v41-audio.js` — single AudioContext radio/engine implementation.
- `v42-profiler.js` — bounded diagnostics, copy-only export, manual clear.
- `v38-performance.js` — adaptive performance controller.

Historical modules remain because the current feature stack still imports selected lower-version modules. They are not independent parallel runtimes. Flattening all historical inheritance into one monolith is intentionally deferred until v42 is validated on-device, because doing it together with physics/world changes would make regression attribution difficult.

## Fixed in v42

### Unbounded diagnostics

All active diagnostics are memory-only and bounded:

- profiler samples: 90
- exported profiler samples: 60
- race dynamics samples: 600
- race events: 180
- radio messages: 60
- physical crash history: 60
- camera cut history: last 120 seconds only

No diagnostics are written to `localStorage` or `sessionStorage`. Settings/championship state remain the only browser-persistent data.

### Duplicate world geometry

Removed/disabled from the active scene:

- old continuous v38 physical barrier root
- old v41 visual pit complex
- primitive v5 pit-building boxes (`38 x 10 x 18`)
- obsolete pit-side home-straight grandstand

The final v42 world owns visible pit architecture and barrier colliders.

### Pit entry/exit collision conflict

The old main-track guardrail was continuous around the full circuit and crossed the pit merge path. v42 rebuilds guardrail geometry and collider masks together, with explicit openings at pit entry and pit exit. The same mask is used for visible rail, posts, tyre packs, and physical collision candidates.

### Pit architecture

The pit area is rebuilt around a continuous Suzuka-style hierarchy:

1. pit lane and working strip
2. service boxes
3. long ground-floor garage row
4. second-floor hospitality glazing
5. overhanging roof/canopy
6. race-control block
7. vertical timing tower
8. paddock/service buildings behind the pit building
9. main grandstand on the opposite side of the home straight

## Runtime circuit audit

`W.auditCircuit()` returns a serializable report including:

- number of legacy pit boxes removed
- number of legacy pit-side stands removed
- pit-entry barrier-hit count and minimum clearance
- pit-exit barrier-hit count and minimum clearance
- minimum pit-lane-to-building clearance
- diagnostic persistence policy

The report is also exported in `COPY DIAGNOSTICS` and assigned to `window.__RACING_AUDIT__` at startup.

## Performance audit

- v42 barrier collision broad phase uses seven nearby barrier buckets rather than scanning all barrier colliders.
- pit building meshes are static and do not participate in per-frame updates.
- tyre barriers and barrier posts use `InstancedMesh`.
- diagnostics remain sampled rather than frame-by-frame.
- adaptive quality remains in `v38-performance.js` and is unchanged by v42.

## Remaining technical debt

1. The feature history still forms an inheritance chain (`v42 -> v41 -> v39/v38 -> ...`). This is deliberate for regression safety but should eventually be flattened after v42 is stable on physical iPhone hardware.
2. Several legacy scene objects are created by older builders before v42 removes/hides them. A future flattened `world-core.js` can avoid their construction entirely and reduce startup allocations further.
3. Pit/building geometry is a scale-accurate visual approximation based on current Suzuka layout/reference imagery, not a surveyed CAD model.
4. Full runtime verification still requires a physical-device pit-in/pit-out pass and visual clearance check from multiple camera modes.
