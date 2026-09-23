# Racing Spectator — Clean Rebuild

This directory is the clean browser/iPhone implementation built from `docs/rebuild-spec/`. It does not reuse the deleted `runtime/` or `vNN-*` behavioural layers.

## Architecture

Simulation and presentation are intentionally separated so the renderer/UI cannot decide race results.

### Simulation authorities

- `src/simulation/track.js` — circuit geometry, widths, track/world coordinates and pit coordinates
- `src/simulation/environment.js` — deterministic weather/visibility state plus local racing-line/off-line surface wetness and standing-water state
- `src/simulation/vehicle.js` — longitudinal/lateral vehicle physics, tyre-force sharing, load transfer, steering, yaw, gears, damage-performance effects and barrier response
- `src/simulation/racecraft.js` — attack/defend/pass/yield/hazard tactical intent
- `src/simulation/traffic-aero.js` — draft drag reduction and dirty-air downforce loss
- `src/simulation/systems.js` — fuel, tyre compound/wear/temperature, local wet-grip/slip degradation, thermal state and deterministic mechanical reliability
- `src/simulation/strategy.js` — reason-coded pit/service decisions including racing-line weather tyre intent; it does not own tactical lane choice
- `src/simulation/pit.js` — physical pit approach, limiter, fast lane, working lane, queue, service, tyre-change application, release and merge
- `src/simulation/timing.js` — lap and sector timing
- `src/simulation/race-control.js` — GREEN/YELLOW/VSC/SAFETY_CAR/RED/CHEQUERED authority, controlled RED recovery/restart procedure and blue-flag context
- `src/simulation/race.js` — deterministic fixed-step orchestration, environment stepping, classification, contacts, radio events and authoritative state hash

### Presentation/platform

- `src/presentation/world.js` — Three.js world and vehicle rendering; wet-road/sky/fog presentation reads authoritative environment state only
- `src/presentation/camera.js` — AUTO/TV/FOLLOW/ONBOARD/PIT/HELI spectator cameras
- `src/presentation/ui.js` — touch UI, authoritative classification, tyre/weather/reliability telemetry, RED/restart procedure display and radio
- `src/presentation/audio.js` — optional tracked-car engine tone
- `src/presentation/performance.js` — frame/simulation/render and renderer-load diagnostics
- `app.js` — application shell, fixed-step accumulator, lifecycle/WebGL recovery, deterministic weather launch profiles and test hooks

## Run

Open the app through an HTTP(S) server at:

`/iphone-demo/index.html`

Deterministic weather launch profiles are available for manual/iPhone inspection:

- dry/default: `/iphone-demo/index.html`
- established wet track: `/iphone-demo/index.html?weather=wet`
- developing rain: `/iphone-demo/index.html?weather=rain`

For automated/manual deterministic stepping use:

`/iphone-demo/index.html?runtimeTest=1`

The query options can be combined, for example:

`/iphone-demo/index.html?runtimeTest=1&weather=wet`

`index.html` currently resolves Three.js through its import map, so normal browser module/CORS rules apply.

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
- continuous physical speed envelope from upcoming curvature and braking distance using the same tyre/braking capability as the vehicle model
- friction-ellipse sharing between longitudinal and lateral tyre force
- longitudinal load-transfer state, tyre slip ratio/slip angle and slip-driven tyre heat/wear feedback
- steering input → vehicle-physics lateral acceleration, with steering-rate/jerk/friction limits
- yaw/yaw-rate and gear state
- deterministic fixed simulation step and authoritative state hashing
- one authoritative environment state with evolving wetness, rainfall intensity, visibility and ambient temperature
- local longitudinal surface wetness with an established racing line, wetter off-line asphalt and traffic-driven line drying
- standing-water state derived from local surface saturation, acting through tyre grip rather than direct vehicle-speed limits
- high-speed standing-water resistance ordered SLICK < INTERMEDIATE < WET, with no scripted speed cap
- SLICK/INTERMEDIATE/WET tyre compounds with continuous weather-dependent grip and distinct temperature targets
- INTERMEDIATE tyres strongest in representative damp conditions, while SLICK remains preferred dry and WET preferred in deep water
- wetness acting through tyre grip, cornering and braking physics rather than direct speed caps
- weather-aware strategy using representative racing-line condition with three-compound hysteresis to avoid repeated threshold-driven stops
- compound changes applied only during physical pit service; weather strategy never directly changes pose/lane/speed
- iPhone/leaderboard telemetry abbreviating INTERMEDIATE as `INT` while the authoritative compound remains `INTERMEDIATE`
- wet-road material, darker environment and visibility/fog presentation driven by the same simulation environment snapshot
- draft as drag reduction and dirty air as downforce reduction; no direct wake speed boost
- staged racecraft: SETUP → COMMIT → ALONGSIDE → COMPLETE/ABORT
- inside/outside attacks, switchback intent, multiclass passing and safe parallel running
- predictive convergence/contact avoidance without blocking every valid pass
- one-move defense contract and predictable blue-flag behaviour
- driver-error input perturbations rather than randomly assigning a spin result
- physical car-car contact, spin/hazard response, barrier response and explicit exceptional-recovery diagnostics
- causal damage effects on aero efficiency, drive, steering response, drag and top-speed capability
- deterministic reliability model: damage/thermal/load stress → derate → mechanical failure; no random DNF assignment
- physical post-failure coast/deceleration before retirement, with observable failure events and telemetry
- fuel, tyre wear/temperature, brake temperature and engine/thermal state
- reason-coded pit strategy for planned stops, tyres, weather, fuel, engine/mechanical risk and damage
- physical pit sequence: approach → entry → fast lane → working approach → queue/service → release → exit → merge
- progressive braking to pit limiter, box lateral/longitudinal capture, same-team queueing, parallel team service and safe release
- event-key radio deduplication, including protection against repeated `BOX THIS LAP`
- direct race start with no qualifying session/result
- deterministic physical grid positions before the start line
- lap/sector/best-lap timing and chequered finish
- authoritative classification with overall/class position, status, completed/current lap, gap/interval, pit-stop count and timing data
- physical YELLOW, VSC and SAFETY_CAR speed/spacing control without teleporting or resetting the field
- VSC pace control that does not artificially bunch the pack and safety-car catch-up that excludes the incident car from queue formation
- RED escalation for physically blocked track or extreme visibility, with no direct pose/velocity rewrite
- RED cars decelerating through the normal vehicle controller, zero-speed hold without throttle creep, and incident recovery only after the non-incident field is physically stopped
- RED restart sequence through SAFETY_CAR formation before GREEN, with queue formation verified physically rather than by teleport/reset
- spectator UI showing distinct `STOP UNDER RED` and `SC RESTART FORMATION` procedure states
- spectator AUTO/TV/FOLLOW/ONBOARD/PIT/HELI cameras
- iPhone-sized touch UI, vehicle selection, visibility pause/resume and WebGL context recovery
- tracked-car tyre compound/wetness, engine temperature, mechanical stress, power derate and failure telemetry
- performance diagnostics for simulation/main/render time, renderer load, long-frame rate and memory where available

## Acceptance/regression coverage

The browser suite includes dedicated contracts for:

- 24-car finite state over 60 simulated minutes
- anti-101-km/h fixed-speed regression
- class ordering, progressive braking, combined friction usage, load transfer and tyre slip behaviour
- wet slick braking/corner degradation and wet-tyre advantage under wet conditions
- dry SLICK advantage, damp INTERMEDIATE advantage, deep-water WET advantage and ordered ideal tyre-temperature targets
- three-compound weather-choice hysteresis across SLICK/INTERMEDIATE/WET transitions
- racing-line drying under traffic, wetter off-line surface state and local standing-water differences
- high-speed standing-water grip loss without a scripted speed cap, with relative resistance ordered SLICK < INTERMEDIATE < WET
- weather strategy intent from representative racing-line condition without direct pose/lane/speed mutation
- SLICK/INTERMEDIATE/WET compound changes only during physical pit service
- mobile telemetry rendering `INT` while preserving the authoritative `INTERMEDIATE` state
- deterministic global/local environment evolution and deterministic race state under identical weather inputs
- presentation reading simulation weather rather than running a second visual weather model
- steering authority/rate and deterministic replay hash
- straight/multiclass passing, safe side-by-side running, convergence veto, inside/outside attacks, switchback and one-move defense
- blue flags without abrupt stop/teleport
- repeated contacts, incident persistence, hazard response, barrier contact and exceptional recovery
- YELLOW/VSC/SAFETY_CAR authority, non-teleporting caution behaviour, non-bunching VSC and physical SC catch-up
- RED authority without direct vehicle writes, blocked-track and low-visibility escalation, physical stop, controlled-field recovery and SAFETY_CAR restart formation
- zero-speed hold without throttle creep, deterministic RED procedure and dry-race protection against false RED escalation
- spectator UI distinction between RED stop and SC restart formation
- deterministic reliability, damage-performance degradation, pre-failure derate/strategy response and physical failure-to-retirement flow
- pit approach/limiter/corridor/service/parallel service/double stack/release/exit/radio dedupe
- lap counting, sector timing, finish rules and overall/class classification
- track self-intersection, usable width, garage/box alignment and scenery clearance
- track ↔ world roundtrip accuracy and visual asphalt/runoff boundary consistency
- presentation-only camera/UI changes not changing the authoritative state hash
- desktop Chromium and iPhone/WebKit boot/lifecycle/touch regression

## Remaining fidelity work

This is a working clean race spectator application, but it is not intended to claim final real-world fidelity in every subsystem. Further work should deepen the existing single authorities rather than add wrapper controllers. High-value future areas include richer weather forecasting and evolving rain-event scenarios, richer fuel/hybrid/energy deployment and strategy, more detailed component-specific reliability/damage, production vehicle/environment assets, and broader calibrated real-world performance validation.
