# ARCHITECTURE.md — Current Runtime Architecture

Status: **Implemented / active browser runtime**
Last updated: 2026-09-14

This document describes the architecture that is actually running today. The long-term Rust/headless target is documented separately in `ARCHITECTURE_TARGET.md`.

## 1. Active application boundary

The iPhone/browser game starts here:

`iphone-demo/app.js -> iphone-demo/runtime/index.js -> stable runtime services`

`app.js` must not import a new `vNN-*` feature module directly. New production work belongs in `iphone-demo/runtime/`.

## 2. Stable runtime services

- `runtime/world.js` — final circuit geometry hand-off, pit geometry and circuit audit
- `runtime/race.js` — stable race wrapper and ownership boundary
- `runtime/pit-state.js` — **single owner of pit movement, queue, service and exit states**
- `runtime/barrier-safety.js` — continuous guardrail separation after legacy collision/damage processing
- `runtime/regression.js` — continuous browser invariant checks
- `runtime/visuals.js` — visual quality enhancement layer
- `runtime/camera.js` — active broadcast camera wrapper / shadow focus
- `runtime/audio.js` — engine/effects/radio mixer
- `runtime/ui.js` — runtime UI and audio controls
- `runtime/profiler.js` — bounded performance/diagnostic capture
- `runtime/diagnostics-store.js` — persistent rotating diagnostics
- `runtime/config.js` — stable runtime constants/defaults
- `runtime/index.js` — only application-facing facade

## 3. Compatibility-provider boundary

The mature browser simulation still reuses known-good historical providers (`vNN-*`). They are compatibility providers, not the location for ordinary new feature work.

Current important providers include:

- v42/v41/v38 race simulation chain
- v41 director
- v38 environment
- v27 safety car
- v18 broadcast
- v38 performance manager
- v10 settings/circuits

Rule: **runtime owns final externally visible state**. A compatibility provider may propose/update legacy behaviour, but a stable runtime controller may normalize it after the legacy update.

## 4. Pit ownership

Pit movement is no longer shared between several layers.

The stable state model is:

`TRACK -> PIT_ENTRY -> FAST_LANE -> WORKING_APPROACH -> QUEUE | SERVICE -> FAST_LANE_EXIT -> MERGE -> TRACK`

`runtime/pit-state.js` owns:

- movement toward the team's own box
- working-lane transition
- same-team double-stack queue
- service start and exact box position
- pit exit continuation and merge hand-off
- pit invariants and diagnostics

Legacy providers may still decide **whether** a car should pit, but runtime owns **how** it moves through and is serviced in pit lane.

## 5. Barrier/collision ownership

Legacy physical collision code still owns impact severity, damage, incidents and crash state.

`runtime/barrier-safety.js` owns the final no-penetration invariant. It runs after the simulation update every rendered simulation frame and repeatedly separates any non-pit car still intersecting a guardrail collider. Damage cooldowns therefore cannot leave a moving car visually embedded in a barrier.

Invariant: after runtime race update, a normal on-track car should not remain in `W.barrierContact(car)`.

## 6. Rendering ownership

Three.js remains the active renderer for the browser/iPhone spectator build.

The visual stack is:

1. legacy world/material construction
2. `runtime/world.js` final active geometry
3. `runtime/visuals.js` material/surface/grounding enhancement
4. dynamic environment
5. broadcast camera
6. performance manager quality adaptation

Mobile policy: improve realism with assets, materials, useful shadows and surface detail before enabling expensive full-screen post effects.

## 7. Runtime regression policy

`runtime/regression.js` continuously checks the active game for:

- non-finite car state
- pit service away from own box
- moving car while in service
- two same-team cars serviced simultaneously
- invalid queue state
- residual guardrail penetration

The latest state is available as `window.__RACING_REGRESSION__`.

## 8. Performance and diagnostics

The browser runtime records CPU/GPU/frame interval, DPR, draw calls, triangle counts, long-frame rate, quality level, pit state and race events. Diagnostics are bounded and persisted across a small number of generations.

Quality adaptation must prefer reducing update cadence and scene complexity before reducing render resolution.

## 9. Migration rule

Do not create another application-facing `vNN-*` layer.

When a historical subsystem requires meaningful new work:

1. add regression coverage for its current behaviour;
2. move ownership into a stable `runtime/<subsystem>.js` service;
3. keep the old provider only as a compatibility source;
4. remove the old provider dependency once behaviour is fully reproduced.

The next major flattening targets are world construction, environment, performance and broadcast.
