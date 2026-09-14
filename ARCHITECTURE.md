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

## 3. Compatibility-provider boundary

Presentation/runtime ownership has been flattened into `runtime/`. UI, camera, audio, environment, pit control, rendering policy, diagnostics and runtime configuration no longer require a historical `vNN-ui`/camera/config layer.

The remaining direct historical dependencies are intentionally concentrated in the mature simulation cores:

- `runtime/world.js -> v42-world.js -> historical world chain`
- `runtime/race.js -> v41-race.js -> historical race chain`

The former `v42-race.js` retention wrapper and `v41-race-final.js` barrier-material wrapper have been absorbed into `runtime/race.js`. The historical UI chain `v16/v17/v19/v24/v26/v34-ui.js` is no longer loaded by the active runtime.

Those remaining world/race chains contain mature geometry/simulation behaviour accumulated across many regression fixes. They must be flattened incrementally with parity tests rather than copied wholesale.

Rule: **runtime owns final externally visible state**. Compatibility providers may supply mature base behaviour, but stable runtime controllers own final pit movement, guardrail no-penetration, rendering, camera, environment, UI, configuration and diagnostics state.

## 4. Pit ownership

The stable state model is:

`TRACK -> PIT_ENTRY -> FAST_LANE -> WORKING_APPROACH -> QUEUE | SERVICE -> RELEASE_WAIT -> WORKING_EXIT -> FAST_LANE_EXIT -> MERGE -> TRACK`

`runtime/pit-state.js` owns movement toward each team's box, Fast Lane/Working Lane transitions, same-team double-stack queueing, concurrent service across different teams, exact stop position, service countdown, safe release and merge hand-off.

Legacy strategy code may still decide **whether** a car should pit. During the compatibility race update, the old box-motion owner is disabled so it cannot compete with the runtime state machine.

## 5. Barrier/collision ownership

Historical physical collision code still owns impact severity, base damage, incidents and crash state.

`runtime/race.js` owns the current barrier-material post-processing that was previously in `v41-race-final.js` (including tyre-barrier damage relief).

`runtime/barrier-safety.js` owns the final no-penetration invariant. It runs after simulation update and separates any normal on-track car still intersecting a guardrail collider even while legacy impact damage is on cooldown. Persistent spin/barrier overlap forces recovery so a lateral spin offset cannot repeatedly drive the visual mesh through the rail.

Invariant: after runtime race update, a normal non-pit car should not remain in `W.barrierContact(car)`.

## 6. World construction and cleanup

The final browser world still receives mature base geometry/physics through the historical world provider, but obsolete construction is being removed at source rather than only hidden later.

With `settings.runtimeCleanWorld=true`:

- `v38-world.js` skips construction of the superseded V38 physical guardrails, posts, tyre barriers and collider set entirely;
- `v41-world.js` keeps the mature pit path/kinematic API but does not construct the superseded V41 pit visual complex;
- `v42-world.js` supplies the authoritative physical barrier set and mature home-complex base;
- `runtime/world.js` owns the final dual-lane pit geometry, garage-aligned pit positions/entrances and merge geometry;
- `runtime/world-cleanup.js` disposes any remaining hidden compatibility render trees after hand-off.

This avoids the former V38-barrier build -> dispose -> V42-barrier rebuild cost on every clean-runtime boot.

## 7. Rendering ownership

Three.js remains the active renderer for the browser/iPhone spectator build.

The visual stack is:

1. mature world/material compatibility construction
2. stable runtime pit/world geometry
3. disposal of inactive hidden compatibility geometry
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
- V38 compatibility barriers are skipped while V42 barriers are authoritative
- visual guardrail penetration and spin recovery
- multi-team parallel pit service
- same-team double stack queueing
- safe release against Fast Lane traffic
- wet/night PMREM switching
- stable telemetry/control/radar/delta UI
- runtime audio mixer controls
- absence of historical `v16/v17/v19/v24/v26/v34-ui.js` resource loads

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

When a remaining historical subsystem requires meaningful work:

1. add regression coverage for current behaviour;
2. move ownership into a stable `runtime/<subsystem>.js` service;
3. keep the old provider only while it supplies mature behaviour not yet reproduced;
4. remove that dependency once parity is proven.

The remaining high-risk flattening targets are now the **world core** and **race simulation core**. They should be decomposed by ownership boundary (track sampling/physics, race strategy, vehicle dynamics, incident logic) rather than copied wholesale into one replacement file.
