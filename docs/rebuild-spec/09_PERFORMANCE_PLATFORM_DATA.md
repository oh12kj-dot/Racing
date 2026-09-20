# 09 — Performance, Platform and Data Contracts

## 1. Performance principle

Performance optimization must preserve simulation correctness and visual hierarchy. Do not improve frame rate by weakening racecraft, reducing physics correctness or changing deterministic results.

## 2. Reference desktop budget

Reference hardware:

- Ryzen 7 5700X
- RTX 4060 Ti 8 GB
- 32 GB system RAM

Target desktop presentation: approximately 1080p60 on the reference machine, with adaptive rendering as needed.

Historic project budgets are retained as useful targets:

- GPU frame time around <= 14 ms;
- CPU main thread around <= 8 ms;
- simulation total around <= 4 ms/render frame for a 24-car field;
- VRAM target <= 7 GB on the 8 GB reference GPU.

These budgets should be re-measured after the clean architecture exists rather than copied blindly.

## 3. Mobile/browser target

The spectator build must boot and remain interactive in current iPhone Safari/WebKit-class browsers.

Mobile requirements:

- touch input works;
- no dependency on hover-only UI;
- no accidental page scroll/zoom blocking critical controls;
- bounded memory growth;
- thermal/performance quality adaptation;
- optional high-cost visuals disabled/degraded gracefully;
- simulation remains logically identical for equivalent fixed-step inputs.

## 4. Simulation timing

Use a fixed simulation time step for deterministic core systems.

Rendering may interpolate and operate at a different cadence. Background/thermal throttling must not change the mathematical meaning of one simulation tick.

If browser scheduling forces catch-up limits, policy must be explicit and diagnostics must expose dropped/capped simulation time.

## 5. Frame-rate invariance

Any smoothing/controller algorithm expressed as “blend X per frame” must be converted to time-based behaviour.

At minimum validate equivalent behaviour at representative frame/tick schedules such as 20/30/60/120 Hz rendering around the fixed simulation cadence.

## 6. Determinism

For deterministic simulation scope:

- one explicit race seed;
- derived per-driver/subsystem streams;
- no `Math.random()`/wall-clock randomness in authoritative logic;
- fixed update order;
- no dependence on asynchronous asset load completion;
- presentation cannot feed back into authoritative state.

The browser prototype may require a staged migration toward full deterministic RNG, but the clean rebuild should make it foundational rather than patching it later.

## 7. Data model

Recommended persistent/static data categories:

### VehicleSpec

- class/category ID;
- dimensions/mass;
- longitudinal performance/power parameters;
- brakes;
- tyre parameters;
- aero parameters;
- steering/wheelbase;
- fuel/consumption/refuelling rules;
- tyre wear/thermal parameters;
- drafting/dirty-air sensitivity.

### DriverSpec

- ID/team;
- racecraft/aggression;
- reaction time;
- precision/consistency;
- wet skill;
- mistake/risk parameters.

### TrackSpec

- geometry/spline samples or source representation;
- width/corridor;
- surface/grip;
- barriers;
- sectors;
- pit geometry;
- camera markers if used;
- presentation asset references.

### RaceConfig

- track;
- entrants/classes;
- laps/time;
- weather/environment;
- grid;
- rules/flags/penalties;
- deterministic seed.

### RuntimeState

Runtime state is not mixed back into static specification data.

## 8. Units

Use canonical SI units in simulation:

- metre;
- second;
- m/s;
- kg;
- radian;
- N / derived SI quantities where needed.

Convert to km/h, litres, degrees, etc. only at data-import or presentation boundaries.

Field names should include units where ambiguity is likely (`speedMps`, `fuelKg`, `distanceM`).

## 9. Validation schemas

Every external data file should be schema validated during development/test.

Reject or loudly report:

- missing required properties;
- negative/invalid dimensions;
- non-finite numbers;
- impossible pit geometry;
- duplicate IDs;
- out-of-range performance values;
- missing referenced assets.

Optional presentation assets may warn/fallback instead of failing the simulation.

## 10. Diagnostics and telemetry

Keep bounded diagnostics for:

- frame interval/FPS;
- CPU/GPU timing where measurable;
- draw calls/triangles;
- memory/quality tier where available;
- simulation tick count/time debt;
- active racecraft/pit state;
- safety interventions;
- recovery/invariant repairs;
- collision events;
- radio/race-control events.

Diagnostics must have bounded queues/ring buffers to avoid memory leaks.

## 11. Performance optimization order

Prefer:

1. remove duplicated work/obsolete geometry;
2. spatial indexing and bounded neighbour queries;
3. cache immutable/sample data;
4. reduce decorative update cadence;
5. LOD/culling/instancing;
6. quality-tier visual reductions;
7. render-scale changes.

Do not optimize by making AI blind to necessary nearby traffic or by lowering physics below validated stability requirements.

## 12. Asset loading

Simulation boot should not wait indefinitely on presentation-only network assets.

Use:

- local-first packaged assets;
- bounded async timeouts;
- procedural/simple fallback;
- explicit load diagnostics.

A failed optional GLB/texture/audio resource must not corrupt race state.

## 13. Rebuild portability

Keep the authoritative simulation sufficiently independent that renderer/platform changes do not require rewriting race behaviour. Whether the final implementation uses Rust/WASM plus browser presentation or another approved combination, the contracts in these documents remain the source of truth.