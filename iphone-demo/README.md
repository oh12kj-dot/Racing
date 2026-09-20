# iPhone Demo — Clean Rebuild

This directory is a clean implementation based on `docs/rebuild-spec/`.

## Architecture

- `src/simulation/track.js` — renderer-independent circuit geometry, widths, pit coordinates
- `src/simulation/vehicle.js` — continuous longitudinal/lateral vehicle state and physical limits
- `src/simulation/racecraft.js` — follow/pass/side-by-side/predictive safety intent
- `src/simulation/pit.js` — physical pit approach, lane, box, service, release and merge state
- `src/simulation/race.js` — deterministic fixed-step race authority, timing, contacts, radio events
- `src/presentation/world.js` — Three.js world and vehicle rendering only
- `src/presentation/camera.js` — broadcast/follow/onboard/pit/helicopter spectator cameras
- `src/presentation/ui.js` — touch UI, timing tower, telemetry and radio
- `src/presentation/audio.js` — optional tracked-car engine tone
- `app.js` — fixed-step application shell and lifecycle handling

No `vNN-*` compatibility layer exists.

## Run

Serve the repository root so the root `node_modules/three` package is visible, then open:

`/iphone-demo/index.html`

For automated/manual deterministic stepping:

`/iphone-demo/index.html?runtimeTest=1`

The page exposes:

- `window.__RACING__`
- `window.__RACING_TEST_TICK__(seconds)`

## Current clean-build scope

The first clean vertical slice implements:

- 24 cars across Formula, Hyper, LMH, Prototype, GT, Supercar and Touring classes
- class-differentiated acceleration/braking/aero/grip envelopes
- continuous corner-speed lookahead
- deterministic fixed simulation step
- straight-line passing, safe parallel running and predictive convergence avoidance
- continuous pit approach → entry → fast lane → working lane → service/queue → release → exit → merge
- physical car-car contact response without normal-driving coordinate teleport
- race timing/classification and chequered finish
- event-deduplicated pit/race radio
- spectator TV/follow/onboard/pit/helicopter cameras
- iPhone-sized touch UI and lifecycle handling

This is intentionally a clean foundation rather than a copy of the deleted runtime. Further fidelity work should extend the single authorities above rather than add corrective wrapper layers.
