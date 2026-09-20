# Racing Spectator — Clean Rebuild

This directory is the clean browser/iPhone implementation built from `docs/rebuild-spec/`. It does not reuse the deleted `runtime/` or `vNN-*` behavioural layers.

## Architecture

Simulation and presentation are intentionally separated so the renderer/UI cannot decide race results.

### Simulation authorities

- `src/simulation/track.js` — circuit geometry, widths, track/world coordinates and pit coordinates
- `src/simulation/vehicle.js` — longitudinal/lateral vehicle physics, steering-rate limits, yaw, gears and barrier response
- `src/simulation/racecraft.js` — attack/defend/pass/yield/hazard tactical intent
- `src/simulation/traffic-aero.js` — draft drag reduction and dirty-air downforce loss
- `src/simulation/systems.js` — fuel, tyre wear/temperature and thermal state
- `src/simulation/strategy.js` — reason-coded pit/service decisions only; it does not own tactical lane choice
- `src/simulation/pit.js` — physical pit approach, limiter, fast lane, working lane, queue, service, release and merge
- `src/simulation/timing.js` — lap and sector timing
- `src/simulation/race-control.js` — race flag/caution authority
- `src/simulation/race.js` — deterministic fixed-step orchestration, classification, contacts, radio events and authoritative state hash

### Presentation/platform

- `src/presentation/world.js` — Three.js world and vehicle rendering only
- `src/presentation/camera.js` — AUTO/TV/FOLLOW/ONBOARD/PIT/HELI spectator cameras
- `src/presentation/ui.js` — touch UI, authoritative classification display, telemetry and radio
- `src/presentation/audio.js` — optional tracked-car engine tone
- `src/presentation/performance.js` — frame/simulation/render and renderer-load diagnostics
- `app.js` — application shell, fixed-step accumulator, lifecycle/WebGL recovery and test hooks

## Run

Open the app through an HTTP(S) server at:

`/iphone-demo/index.html`

`index.html` currently resolves Three.js through its import map, so normal browser module/CORS rules apply.

For automated/manual deterministic stepping use:

`/iphone-demo/index.html?runtimeTest=1`

Useful runtime hooks include:

- `window.__RACING__`
- `window.__RACING_RACE__`
- `window.__RACING_WORLD__`
- `window.__RACING_LIFECYCLE__`
- `window.__RACING_PERFORMANCE__`
- `window.__RACING_REGRESSION_MONITOR__`
- `window.__RACING_TEST_TICK__(seconds)`

## Implemented race scope

The current clean build includes:

- 24 cars across Formula, Hyper, LMH, Prototype, GT, Supercar and Touring classes
- class-specific acceleration, braking, tyre grip, aero, steering response, mass and top-speed envelopes
- continuous physical speed envelope from upcoming curvature and braking distance
- steering input → vehicle-physics lateral acceleration, with steering-rate/jerk/friction limits
- yaw/yaw-rate and gear state
- deterministic fixed simulation step and authoritative state hashing
- draft as drag reduction and dirty air as downforce reduction; no direct wake speed boost
- staged racecraft: SETUP → COMMIT → ALONGSIDE → COMPLETE/ABORT
- inside/outside attacks, switchback intent, multiclass passing and safe parallel running
- predictive convergence/contact avoidance without blocking every valid pass
- one-move defense contract and predictable blue-flag behaviour
- driver-error input perturbations rather than randomly assigning a spin result
- physical car-car contact, spin/hazard response, barrier response and explicit exceptional-recovery diagnostics
- fuel, tyre wear/temperature and engine/thermal state
- reason-coded pit strategy for planned stops, tyres, fuel, engine temperature and damage
- physical pit sequence: approach → entry → fast lane → working approach → queue/service → release → exit → merge
- progressive braking to pit limiter, box lateral/longitudinal capture, same-team queueing, parallel team service and safe release
- event-key radio deduplication, including protection against repeated `BOX THIS LAP`
- direct race start with no qualifying session/result
- deterministic physical grid positions before the start line
- lap/sector/best-lap timing and chequered finish
- authoritative classification with overall/class position, status, completed/current lap, gap/interval, pit-stop count and timing data
- physical yellow/caution speed control without field teleport/bunch reset
- spectator AUTO/TV/FOLLOW/ONBOARD/PIT/HELI cameras
- iPhone-sized touch UI, vehicle selection, visibility pause/resume and WebGL context recovery
- performance diagnostics for simulation/main/render time, renderer load, long-frame rate and memory where available

## Acceptance/regression coverage

The browser suite includes dedicated contracts for:

- 24-car finite state over 60 simulated minutes
- anti-101-km/h fixed-speed regression
- class ordering, progressive braking and combined friction usage
- steering authority/rate and deterministic replay hash
- straight/multiclass passing, safe side-by-side running, convergence veto, inside/outside attacks, switchback and one-move defense
- blue flags without abrupt stop/teleport
- repeated contacts, incident persistence, hazard response, barrier contact and exceptional recovery
- pit approach/limiter/corridor/service/parallel service/double stack/release/exit/radio dedupe
- lap counting, sector timing, finish rules and overall/class classification
- track self-intersection, usable width, garage/box alignment and scenery clearance
- track ↔ world roundtrip accuracy and visual asphalt/runoff boundary consistency
- presentation-only camera/UI changes not changing the authoritative state hash
- desktop Chromium and iPhone/WebKit boot/lifecycle/touch regression

## Remaining fidelity work

This is a working clean race spectator application, but it is not intended to claim final real-world fidelity in every subsystem. Further work should deepen the existing single authorities rather than add wrapper controllers. High-value future areas include richer tyre/slip/load-transfer physics, more complete sporting procedures such as VSC/SC/red-flag rules, weather/wet-track behaviour, deeper strategy/reliability modelling, production vehicle/environment assets and broader calibrated real-world performance validation.
