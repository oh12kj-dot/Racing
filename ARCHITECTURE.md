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
- `runtime/ui.js` — runtime UI and audio controls
- `runtime/profiler.js` / `runtime/diagnostics-store.js` — bounded performance and persistent diagnostics
- `runtime/world-cleanup.js` — disposes superseded hidden compatibility geometry after hand-off
- `runtime/config.js` — stable runtime constants/defaults
- `runtime/index.js` — only application-facing facade

## 3. Compatibility-provider boundary

Presentation/runtime ownership has been flattened into `runtime/`. The remaining direct historical dependencies are intentionally concentrated in the mature simulation cores:

- `runtime/world.js -> v42-world.js -> historical world chain`
- `runtime/race.js -> v42-race.js -> historical race chain`

Those chains still contain mature geometry/simulation behaviour accumulated across many regression fixes. They must be flattened incrementally with parity tests rather than copied wholesale.

Rule: **runtime owns final externally visible state**. Compatibility providers may supply mature base behaviour, but stable runtime controllers own final pit movement, guardrail no-penetration, rendering, camera, environment and diagnostics state.

## 4. Pit ownership

The stable state model is:

`TRACK -> PIT_ENTRY -> FAST_LANE -> WORKING_APPROACH -> QUEUE | SERVICE -> RELEASE_WAIT -> WORKING_EXIT -> FAST_LANE_EXIT -> MERGE -> TRACK`

`runtime/pit-state.js` owns movement toward each team's box, Fast Lane/Working Lane transitions, same-team double-stack queueing, concurrent service across different teams, exact stop position, safe release and merge hand-off.

Legacy strategy code may still decide **whether** a car should pit. During the compatibility race update, the old box-motion owner is disabled so it cannot compete with the runtime state machine.

## 5. Barrier/collision ownership

Legacy physical collision code still owns impact severity, damage, incidents and crash state.

`runtime/barrier-safety.js` owns the final no-penetration invariant. It runs after simulation update and separates any normal on-track car still intersecting a guardrail collider even while legacy impact damage is on cooldown. Persistent spin/barrier overlap forces recovery so a lateral spin offset cannot repeatedly drive the visual mesh through the rail.

Invariant: after runtime race update, a normal non-pit car should not remain in `W.barrierContact(car)`.

## 6. Rendering ownership

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

## 7. Runtime regression policy

`runtime/regression.js` continuously checks non-finite state, invalid pit state and residual guardrail overlap.

Playwright browser regression covers:

- application boot and non-empty rendered frame
- pit-surface merge geometry
- guardrail re-entry during legacy impact cooldown
- multi-team parallel pit service
- same-team double stack queueing
- safe release against Fast Lane traffic
- wet/night PMREM switching

Remote GLB availability is **not** a boot invariant. A network or asset failure must degrade to procedural visuals while simulation remains usable.

## 8. Performance and diagnostics

The runtime records CPU/GPU/frame interval, DPR, draw calls, triangle counts, long-frame rate, quality level, pit state and race events. Rendering diagnostics also record reflection state, selective glow, render-asset state, shadow projection and scene-quality state.

Quality adaptation reduces background cadence and scene complexity before materially reducing render scale.

## 9. Runtime dependencies

`three` is pinned to `0.185.1` in `package.json`. The browser loader prefers the local npm package and falls back to jsDelivr then unpkg. GLTFLoader follows the same local-first policy.

External GLBs are presentation-only. They load asynchronously after race initialization and have bounded timeouts; missing assets leave the procedural fallback visible.

## 10. Migration rule

Do not create another application-facing `vNN-*` layer.

When a remaining historical subsystem requires meaningful work:

1. add regression coverage for current behaviour;
2. move ownership into a stable `runtime/<subsystem>.js` service;
3. keep the old provider only while it supplies mature behaviour not yet reproduced;
4. remove that dependency once parity is proven.

The remaining high-risk flattening targets are the world and race simulation cores. World cleanup already removes inactive legacy render trees after hand-off; preventing every obsolete object from being constructed in the first place is the next world-core migration step.
