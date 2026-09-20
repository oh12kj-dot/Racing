# 11 — Current Implementation Inventory

Purpose: preserve enough knowledge about the pre-rebuild project to avoid accidentally dropping required capability. **This file is descriptive, not normative.** If current code conflicts with the clean specifications, the clean specification wins.

Snapshot: `master@ead10321a70c26623748894067391d6e4d90cf42` (2026-09-19 commit: realistic pit-entry braking/lane transition).

## 1. Repository-level documentation/configuration

Current root contains major project documents/configuration including:

- `PROJECT.md`
- `ARCHITECTURE.md`
- `ARCHITECTURE_TARGET.md`
- `DECISIONS.md`
- `HANDOFF.md`
- `PLAN.md`
- `TODO.md`
- `RUNTIME_STATUS.md`
- `TESTING.md`
- `CLAUDE.md`
- `Cargo.toml` / `Cargo.lock`
- `package.json`
- `playwright.config.mjs`
- `rust-toolchain.toml`

These files contain useful history, but much of it predates the browser runtime’s current complexity. They should be archived with the pre-rebuild source rather than copied wholesale into the clean tree.

## 2. Rust/headless simulation work

Current crates include responsibilities such as:

### `crates/sim-core`

Representative files:

- `ground.rs`
- `lib.rs`
- `racing_line.rs`
- `rng.rs`
- `world.rs`

### `crates/sim-driver`

Representative files:

- `controller.rs`
- `decision.rs`
- `driver.rs`
- `model.rs`
- `perception.rs`
- `planner.rs`

### `crates/sim-line`

- `corridor.rs`
- `speed.rs`
- `trajectory.rs`

### `crates/sim-track`

Track-domain code/data support.

### `crates/sim-vehicle`

Representative files:

- `aero.rs`
- `ground.rs`
- `input.rs`
- `params.rs`
- `powertrain.rs`
- `state.rs`
- `tyre.rs`
- `vehicle.rs`

### `crates/sim-wasm`

WASM-facing bridge/prototype code.

The existence of both Rust simulation work and a mature JavaScript/browser runtime is a key architectural fact. The clean rebuild must choose a clear authoritative core rather than maintaining two diverging behaviour implementations indefinitely.

## 3. Browser/iPhone application

Primary entry flow documented by the current architecture:

`iphone-demo/app.js -> iphone-demo/runtime/index.js -> stable runtime services`

Three.js is the active browser renderer in the current build.

## 4. Current stable runtime — race responsibilities

Current `iphone-demo/runtime/` contains a large responsibility chain. Important behavioural modules include, among others:

- `race-base.js`
- `race-physical.js`
- `race-spin.js`
- `race-pit-strategy.js`
- `race-side-by-side.js`
- `race-launch-safety.js`
- `race-contact-avoidance.js`
- `race-control.js`
- `race-pace-policy.js`
- `race-systems.js`
- `race-class-performance.js`
- `race-driver-dynamics.js`
- `race-session-control.js`
- `race-finish-control.js`
- `race-vehicle-systems.js`
- `race-pit-service.js`
- `race-pit-crew.js`
- `race-pit-presentation.js`
- `race-rules-thermal.js`
- `race-progress.js`
- `race-championship-core.js`
- `race-replay-policy.js`
- `race-core.js`
- `race-grid-lock.js`
- `race-spectator-intelligence.js`
- `trajectory-controller.js`
- `vehicle-performance-spec.js`

There are also compatibility bridge/shim files with `vNN-*` names. Current architecture says the active implementation has mostly migrated into responsibility-based runtime modules and the numbered files should no longer own new behaviour.

## 5. Current vehicle/class calibration

`vehicle-performance-spec.js` centralizes seven calibration families:

- Formula
- Hypercar/LMDh
- LMH
- LMP2/prototype
- GT/LMGT3/GT3
- Supercar
- Touring/TCR

It already separates top envelope, speed-banded acceleration/braking, tyre friction/load sensitivity, aero load, traction, wear, fuel, wheelbase/steering, draft/dirty-air effects and multiclass pass heuristics.

The clean rebuild should retain the centralization concept but revalidate all numeric values.

## 6. Current trajectory/racecraft ownership

Current tests assert that:

- runtime racecraft is the tactical lane-intent authority;
- strategy is telemetry-only with respect to attack/defend lane intent;
- trajectory controller is the normal lateral motion owner;
- legacy core is expected to yield tactical lane intent when the runtime authority is active.

This ownership separation is important and should be preserved more cleanly in the rebuild.

Current trajectory code also contains compatibility/repair logic for old separation/physical-sync cases. Those fallbacks are evidence of historical coupling; they should not be copied blindly into a clean architecture.

## 7. Current predictive traffic/collision behaviour

`race-contact-avoidance.js` currently includes concepts worth preserving at the design level:

- predicted side-by-side lateral risk;
- distinction between safe parallel motion and future convergence;
- current/target lateral separation;
- TTC/following policy;
- latched multiclass pass target;
- lateral safety veto;
- launch/caution sensitivity;
- predictive speed cap requests.

The clean rebuild should move these concepts into explicit prediction/arbitration interfaces rather than continue a layered overwrite chain.

## 8. Current pit ownership

Current `pit-state.js` describes a detailed state machine and owns queue/service/release/exit concerns.

Observed concepts include:

- deferred early entry;
- pending pit approach;
- team box occupancy;
- same-team queue/double stack;
- service capture tolerance;
- safe release based on fast-lane traffic/TTC;
- drive-through;
- stall/invariant repair fallbacks;
- working lane / fast lane / exit phases.

Current architecture describes the high-level state model as:

`TRACK -> PIT_ENTRY -> FAST_LANE -> WORKING_APPROACH -> QUEUE | SERVICE -> RELEASE_WAIT -> WORKING_EXIT -> FAST_LANE_EXIT -> MERGE -> TRACK`

The clean specification inserts explicit `PIT_APPROACH` as a first-class pre-entry phase because recent failures showed that pit intent must exist before physical entry without pulling the car sideways.

## 9. Current world/render responsibilities

Current runtime includes modules for:

- world geometry/construction;
- racing line;
- vehicle scale/detail;
- recovery;
- pit animation/foundation/detail;
- effects/environment;
- clearance/geometry correction;
- surface detail;
- optional assets;
- reflections;
- glow;
- scene quality adaptation;
- world cleanup.

Current architecture also documents removal/skipping of obsolete geometry in clean-runtime mode. This demonstrates why the clean rebuild should construct only the final authoritative world rather than build-and-dispose historical layers.

## 10. Current presentation/runtime services

Current architecture lists services including:

- `camera-base.js` / `camera.js`
- `director.js`
- `broadcast.js`
- `environment.js`
- `safety-car.js`
- `performance.js`
- `settings.js`
- `circuits.js`
- `audio.js`
- `ui-core.js`
- `ui-radio.js`
- `ui-telemetry.js`
- `ui-control.js`
- `ui.js`
- `profiler.js`
- `diagnostics-store.js`
- `regression.js`
- `barrier-safety.js`

Capabilities should be mapped to clean presentation modules, not copied one-to-one.

## 11. Assets/data seen in repository

Representative retained-value source data/assets include:

- `assets/tracks/aoyama_ring.track.json`
- track asset documentation/README;
- `assets/vehicles/gt_proto_a.spec.json`;
- render/asset manifests;
- Unreal/Blender/engineering tooling under repository tool directories.

Before destructive cleanup, every actual non-generated asset must be enumerated with hash, origin/license and retention decision.

## 12. Current browser tests — high-value regression categories

Existing browser tests include coverage for areas such as:

- speed variety / former 101 km/h lock;
- racecraft authority;
- pit-entry safety;
- trajectory realism;
- corner physics;
- multiclass performance;
- no-qualifying requirement;
- pit state/service/release/geometry;
- contact/hazard behaviour;
- frame-rate behaviour;
- iOS runtime and presentation;
- visual/start-grid/runtime boot.

These tests are a critical source of historical bug knowledge. They should be classified into:

1. carry forward unchanged in meaning;
2. rewrite against the new architecture;
3. retire because they test legacy implementation details.

## 13. Current architectural debt to avoid reproducing

The snapshot contains signs of accumulated compatibility work:

- many fine-grained runtime layers;
- bridge/shim `vNN` files;
- compatibility-shaped update chains;
- explicit invariant repairs and recovery helpers;
- behaviour split between old JS runtime evolution and Rust target work.

These are not criticisms of the fixes that stabilized the application. They are the reason a clean rebuild can now be valuable: the desired behaviour is better understood than when the implementation began.

## 14. Inventory completeness rule before deletion

This high-level inventory is not by itself permission to delete the repository.

Before deletion, generate a machine-readable complete manifest of every file in the pre-rebuild snapshot containing at least:

- path;
- size;
- SHA/hash;
- category (`source`, `test`, `asset-source`, `generated`, `dependency`, `documentation`, `tooling`, `unknown`);
- keep/archive/delete decision;
- reason;
- replacement document/feature mapping when applicable.

Any `unknown` blocks destructive cleanup until classified.