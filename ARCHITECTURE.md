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
- `runtime/barrier-safety.js` — continuous guardrail separation after collision/damage processing
- `runtime/regression.js` — continuous browser invariant checks
- `runtime/visuals.js` — material, grounding, rubber and wet-surface enhancement
- `runtime/surface-detail.js` — higher-frequency road material detail
- `runtime/assets.js` — class-correct GLB vehicle and trackside visual asset layer
- `runtime/reflections.js` — prefiltered day/cloud/sunset/night/wet PMREM environments
- `runtime/glow.js` — desktop-only selective emissive glow
- `runtime/quality-scene.js` — scene-complexity adaptation
- `runtime/camera.js` — active broadcast camera / pit coverage / shadow focus
- `runtime/director.js` — active broadcast event director
- `runtime/environment.js` — weather, wet-road overlay, rain radar and dynamic sky
- `runtime/safety-car.js` — active safety-car presentation
- `runtime/broadcast.js` — battle picture-in-picture view
- `runtime/performance.js` — performance / thermal quality manager
- `runtime/settings.js` / `runtime/circuits.js` — active settings and circuit catalogue
- `runtime/audio.js` — engine/effects/radio mixer
- `runtime/ui.js` — runtime UI and audio controls
- `runtime/profiler.js` — bounded performance/diagnostic capture
- `runtime/diagnostics-store.js` — persistent rotating diagnostics
- `runtime/config.js` — stable runtime constants/defaults
- `runtime/index.js` — only application-facing facade

## 3. Compatibility-provider boundary

Most presentation/runtime services no longer depend directly on historical `vNN-*` files. The remaining compatibility-provider dependency is concentrated in the mature world/race simulation path and the underlying TV-camera core.

Important remaining compatibility providers:

- v42/v41/v38 race simulation chain
- v42/v41 world construction chain
- v41 camera core (wrapped by `runtime/camera.js`)

These providers contain mature simulation behaviour accumulated across many regression fixes. They must be flattened only with browser/scenario coverage proving parity.

Rule: **runtime owns final externally visible state**. A compatibility provider may propose/update legacy behaviour, but stable runtime controllers normalize final pit, barrier, rendering and diagnostics state.

## 4. Pit ownership

Pit movement is no longer shared between several layers.

The stable state model is:

`TRACK -> PIT_ENTRY -> FAST_LANE -> WORKING_APPROACH -> QUEUE | SERVICE -> RELEASE_WAIT -> WORKING_EXIT -> FAST_LANE_EXIT -> MERGE -> TRACK`

`runtime/pit-state.js` owns movement toward the team's own box, working-lane transition, same-team double-stack queue, service start, exact box position, safe release, pit exit and merge hand-off.

Legacy strategy code may still decide **whether** a car should pit. When `W.runtimePitStateMachineOwner` is present, legacy traffic/team-box admission gates are bypassed so they cannot conflict with the stable runtime controller.

## 5. Barrier/collision ownership

Legacy physical collision code still owns impact severity, damage, incidents and crash state.

`runtime/barrier-safety.js` owns the final no-penetration invariant. It runs after the simulation update every rendered simulation frame and repeatedly separates any non-pit car still intersecting a guardrail collider. Damage cooldowns therefore cannot leave a moving car visually embedded in a barrier. Persistent spin/barrier overlap forces `SLIDE -> RECOVER` so the legacy spin offset cannot repeatedly push a car through the rail.

Invariant: after runtime race update, a normal on-track car should not remain in `W.barrierContact(car)`.

## 6. Rendering ownership

Three.js remains the active renderer for the browser/iPhone spectator build.

The active visual stack is:

1. mature world/material construction
2. clean-runtime geometry path (obsolete pit ribbons/doors/boxes are not constructed)
3. stable runtime pit/world geometry
4. high-frequency surface detail + racing rubber / braking traces
5. optional CC0 GLB vehicle and trackside upgrades, with procedural fallback
6. PMREM environment reflections driven by weather/time
7. broadcast-subject-centred shadows and contact shadows
8. adaptive scene complexity
9. desktop-only selective emissive glow
10. broadcast camera/director

Mobile policy: improve realism with assets, materials, useful shadows and surface detail before enabling expensive full-screen post effects.

## 7. Runtime regression policy

`runtime/regression.js` continuously checks the active game for non-finite state, invalid pit states and residual guardrail overlap.

Playwright browser regression additionally covers:

- successful startup and a non-empty rendered frame
- successful required GLB asset loading
- pit-surface merge overlap
- guardrail re-entry during legacy impact cooldown
- multi-team parallel service and same-team double stack
- safe pit release against fast-lane traffic
- wet/night PMREM profile switching

## 8. Performance and diagnostics

The browser runtime records CPU/GPU/frame interval, DPR, draw calls, triangle counts, long-frame rate, quality level, pit state and race events. Rendering diagnostics additionally record active PMREM profile, selective glow, render-asset load counts, shadow projection and scene-quality state.

Quality adaptation must prefer reducing update cadence and scene complexity before reducing render resolution.

## 9. External runtime dependencies

Three.js and GLTFLoader use pinned version `0.185.1` with two-source browser fallbacks. GLB assets use immutable CORS-enabled CC0 CDN URLs and retain procedural fallbacks if an asset cannot load.

A network failure therefore degrades optional render assets to procedural geometry rather than corrupting simulation state. Browser CI separately requires configured production GLBs to load successfully under normal network conditions.

## 10. Migration rule

Do not create another application-facing `vNN-*` layer.

When a remaining historical subsystem requires meaningful new work:

1. add regression coverage for its current behaviour;
2. move ownership into a stable `runtime/<subsystem>.js` service;
3. keep the old provider only while it supplies mature behaviour not yet reproduced;
4. remove that provider dependency once behaviour parity is proven.

The remaining high-risk flattening targets are the world/race simulation core and then the underlying camera core. They are deliberately isolated rather than duplicated wholesale.
