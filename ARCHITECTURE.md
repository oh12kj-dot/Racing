# ARCHITECTURE.md — Current Runtime Architecture

Status: **Implemented / active browser runtime**
Last updated: 2026-09-14

This document describes the architecture that is actually running today. The long-term Rust/headless target is documented separately in `ARCHITECTURE_TARGET.md`.

## 1. Active application boundary

The iPhone/browser game starts here:

`iphone-demo/app.js -> iphone-demo/runtime/index.js -> stable runtime services`

`app.js` must not import a new `vNN-*` feature module directly. New production work belongs in `iphone-demo/runtime/`.

## 2. Stable runtime services

- `runtime/world.js` — final circuit/pit geometry hand-off and circuit audit
- `runtime/race.js` — stable race wrapper and ownership boundary
- `runtime/pit-state.js` — **single owner of pit movement, queue, service, safe release and exit states**
- `runtime/barrier-safety.js` — continuous guardrail separation after collision/damage processing
- `runtime/regression.js` — continuous browser invariant checks
- `runtime/visuals.js` — material, grounding, rubber and wet-surface enhancement
- `runtime/surface-detail.js` — higher-frequency road material detail
- `runtime/assets.js` — optional GLB vehicle/trackside upgrade with procedural fallback
- `runtime/reflections.js` — lazily generated weather/time PMREM profiles
- `runtime/glow.js` — desktop/QUALITY selective emissive glow
- `runtime/quality-scene.js` — scene-complexity adaptation
- `runtime/camera-base.js` / `runtime/camera.js` — stable TV/onboard/pit broadcast camera stack
- `runtime/director.js` — broadcast event director
- `runtime/environment.js` — weather, wet-road overlay, rain radar and dynamic sky
- `runtime/safety-car.js` — safety-car presentation
- `runtime/broadcast.js` — battle picture-in-picture view
- `runtime/performance.js` — performance / thermal quality manager
- `runtime/settings.js` / `runtime/circuits.js` — active settings and circuit catalogue
- `runtime/audio.js` — engine/effects/radio mixer
- `runtime/ui-core.js` — stable base menu/timing/map/settings/camera UI
- `runtime/ui-radio.js` — radio-test UI attachment
- `runtime/ui-telemetry.js` — telemetry UI attachment
- `runtime/ui-control.js` — performance and race-control UI attachment
- `runtime/ui.js` — radar/delta/control augmentation and stable audio settings/mixer
- `runtime/profiler.js` / `runtime/diagnostics-store.js` — bounded performance and persistent diagnostics
- `runtime/world-cleanup.js` — disposes superseded hidden compatibility geometry after hand-off
- `runtime/config.js` — stable runtime constants/defaults; no direct runtime dependency on `v42-config.js`
- `runtime/index.js` — only application-facing facade

## 3. Historical compatibility boundary

Race and World **implementation ownership is now fully inside `iphone-demo/runtime/`**. The former numbered layers were migrated in parity-protected slices to responsibility-based stable modules, including the foundational race and world cores.

Examples of the stable chain include:

- Race: `race-base -> race-physical -> race-spin -> race-pit-strategy -> race-side-by-side -> race-launch-safety -> race-contact-avoidance -> race-control -> race-pace-policy -> race-systems -> race-class-performance -> race-driver-dynamics -> race-session-control -> race-finish-control -> race-vehicle-systems -> race-pit-service -> race-pit-crew -> race-pit-presentation -> race-rules-thermal -> race-progress -> race-championship-core -> race-replay-policy -> race-core`
- World: `world-base -> world-simulation -> world-racing-line -> world-vehicle-scale -> world-recovery -> world-pit-animation -> world-depth -> world-effects -> world-trackside -> world-touring-model -> world-vehicle-detail -> world-pit-crew-detail -> world-pit-foundation -> world-vehicle-core -> world-clearance -> world-geometry-correction -> world-environment-core -> world-core`

Small `runtime/vNN-*.js` files may remain as **one-line internal import bridges** so exact migrated blobs can retain their original relative import names. They contain no simulation implementation. Likewise, old external `iphone-demo/vNN-*.js` Race/World paths are compatibility shims only.

Two application-facing historical-looking resource paths remain intentionally permitted for now:

- `runtime/race.js -> ../v41-race.js -> runtime/race-base.js`
- `runtime/world.js -> ../v42-world.js -> runtime/world-base.js`

Those files are one-line entry shims, not implementation owners. Browser regression fails if any other external historical Race/World implementation resource is loaded.

Rule: **runtime owns final externally visible state and all active Race/World implementation**. No new production behaviour may be added to an external `vNN-*` file.

## 4. Pit ownership

The stable state model is:

`TRACK -> PIT_ENTRY -> FAST_LANE -> WORKING_APPROACH -> QUEUE | SERVICE -> RELEASE_WAIT -> WORKING_EXIT -> FAST_LANE_EXIT -> MERGE -> TRACK`

`runtime/pit-state.js` owns movement toward each team's box, Fast Lane/Working Lane transitions, same-team double-stack queueing, concurrent service across different teams, exact stop position, service countdown, safe release and merge hand-off.

Strategy layers may still decide **whether** a car should pit. During the compatibility-shaped race update, the older box-motion path is disabled so it cannot compete with the runtime state machine.

## 5. Barrier/collision ownership

Stable physical collision modules own impact severity, base damage, incidents and crash state.

`runtime/race.js` owns the current barrier-material post-processing that was previously in `v41-race-final.js` (including tyre-barrier damage relief).

`runtime/barrier-safety.js` owns the final no-penetration invariant. It runs after simulation update and separates any normal on-track car still intersecting a guardrail collider even while impact damage is on cooldown. Persistent spin/barrier overlap forces recovery so a lateral spin offset cannot repeatedly drive the visual mesh through the rail.

Invariant: after runtime race update, a normal non-pit car should not remain in `W.barrierContact(car)`.

## 6. World construction and cleanup

The final browser world is runtime-owned end to end. Historical version labels remain only as bridge names needed by unchanged relative imports inside parity-migrated modules.

With `settings.runtimeCleanWorld=true`:

- `runtime/world-vehicle-scale.js` skips construction of the superseded V38 physical guardrails, posts, tyre barriers and collider set entirely;
- `runtime/world-simulation.js` keeps the mature pit path/kinematic API but does not construct the superseded V41 pit visual complex;
- `runtime/world-base.js` supplies the authoritative physical barrier set and mature home-complex base;
- `runtime/world.js` owns the final dual-lane pit geometry, garage-aligned pit positions/entrances and merge geometry;
- `runtime/world-cleanup.js` disposes any remaining inactive render trees after hand-off.

This avoids the former V38-barrier build -> dispose -> V42-barrier rebuild cost on every clean-runtime boot while preserving the verified mature geometry behaviour.

## 7. Rendering ownership

Three.js remains the active renderer for the browser/iPhone spectator build.

The visual stack is:

1. runtime-owned mature world/material construction
2. stable runtime pit/world geometry
3. disposal of inactive hidden geometry
4. surface micro-detail, racing rubber and braking traces
5. optional CC0 GLB vehicle/trackside upgrades with procedural fallback
6. weather/time PMREM reflection profiles generated lazily after boot
7. broadcast-subject-centred directional shadows and contact shadows
8. adaptive scene complexity
9. desktop/QUALITY-only selective glow
10. stable broadcast camera/director

Mobile policy: spend GPU budget on asset/material fidelity, grounding, useful shadows and surface detail before expensive full-screen effects.

## 8. Runtime regression policy

`runtime/regression.js` continuously checks non-finite state, invalid pit state and residual guardrail overlap.

Playwright browser regression covers:

- application boot and non-empty rendered frame
- local npm Three.js boot and optional-asset independence
- pit-surface merge geometry
- superseded V38 barriers are skipped while the authoritative runtime barrier set is active
- visual guardrail penetration and spin recovery
- multi-team parallel pit service
- same-team double stack queueing
- safe release against Fast Lane traffic
- wet/night PMREM switching
- stable telemetry/control/radar/delta UI
- runtime audio mixer controls
- absence of historical `v16/v17/v19/v24/v26/v34-ui.js` resource loads
- absence of external historical Race/World implementation loads; only the two documented one-line entry shims are permitted

Remote GLB availability is **not** a boot invariant. A network or asset failure must degrade to procedural visuals while simulation remains usable.

GitHub Actions uses Node 24 and cancels stale runs for the same branch so only the newest browser runtime state is authoritative.

## 9. Performance and diagnostics

The runtime records CPU/GPU/frame interval, DPR, draw calls, triangle counts, long-frame rate, quality level, pit state and race events. Rendering diagnostics also record reflection state, selective glow, render-asset state, shadow projection and scene-quality state.

Quality adaptation reduces background cadence and scene complexity before materially reducing render scale.

## 10. Runtime dependencies

`three` is pinned to `0.185.1` in `package.json`. The browser loader prefers the local npm package and falls back to jsDelivr then unpkg. GLTFLoader follows the same local-first policy.

External GLBs are presentation-only. They load asynchronously after race initialization and have bounded timeouts; missing assets leave the procedural fallback visible.

## 11. Migration rule

Do not create another application-facing `vNN-*` layer.

The historical Race/World **implementation migration is complete**. Remaining `vNN` files in the active dependency graph are one-line bridge/shim files only. They may be removed opportunistically when their importing stable modules are next edited, but no behavioural change is required to do so.

For future subsystem work:

1. add regression coverage for current behaviour;
2. change the responsibility-based stable `runtime/<subsystem>.js` owner;
3. keep compatibility shims behaviour-free;
4. never add new implementation to a historical external `vNN-*` path.

Future architecture work should split large stable modules by responsibility when useful, not recreate a version-number chain.
