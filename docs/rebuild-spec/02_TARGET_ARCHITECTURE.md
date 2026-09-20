# 02 — Target Architecture

## 1. Goal

The rebuild must reduce accidental coupling and make ownership obvious enough that a future audit can answer “which system is allowed to change this value?” immediately.

The clean architecture should not recreate the historical `vNN-*` chain or copy today's wrapper stack.

## 2. Proposed top-level structure

```text
src/
  app/
  simulation/
    clock/
    track/
    vehicle/
    driver/
    traffic/
    racecraft/
    collision/
    pit/
    race_control/
    timing/
    strategy/
  presentation/
    world/
    vehicle_render/
    camera/
    broadcast/
    audio/
    radio/
    ui/
  platform/
    browser/
    mobile/
    diagnostics/
  data/
    vehicles/
    tracks/
    championships/
    settings/
tests/
  unit/
  simulation/
  scenarios/
  browser/
  visual/
```

Names may change, but the dependency direction and authority rules below are normative.

## 3. Dependency direction

Allowed:

`app -> simulation + presentation + platform`

`presentation -> read-only simulation snapshots`

`driver/racecraft -> track + vehicle state + traffic perception`

`vehicle physics -> vehicle parameters + environment inputs`

`timing/race_control -> authoritative simulation events/state`

Forbidden:

- simulation importing camera/UI/render modules;
- UI changing car position/speed;
- radio changing strategy as a side effect of playing a message;
- camera/director deciding an overtake, caution or pit stop;
- two modules both writing normal lateral motion;
- pit presentation changing pit physics/state.

## 4. Authority map

| State/output | Sole authoritative owner | Other systems may do |
|---|---|---|
| car pose/velocity | Vehicle physics/integrator | read; recovery system may use explicit recovery transition |
| steering/throttle/brake/gear | Driver controller | racecraft/trajectory may provide targets |
| tactical attack/defend/pass intent | Racecraft decision | strategy may expose context only |
| target trajectory | Trajectory planner | safety may veto/constraint it |
| target speed envelope | Speed planner | safety/race control may apply upper constraints |
| collision impulse/damage | Collision/incident system | safety predictor may try to avoid before impact |
| pit movement phase | Pit state machine | strategy requests pit; presentation observes |
| race flag/session | Race control | UI/radio observes |
| lap/sector/classification | Timing | presentation observes |
| rendering transforms | Presentation interpolator from physical state | never feeds back into simulation |

## 5. Tick model

A deterministic simulation step should conceptually execute:

1. ingest fixed-step external/session inputs;
2. update environment/race-control constraints;
3. build spatial/traffic perception snapshot;
4. update driver/racecraft decisions at defined cadence;
5. generate trajectories and speed envelopes;
6. resolve arbitration/safety constraints;
7. compute driver controls;
8. step vehicle physics;
9. resolve contacts/incidents;
10. update pit state transitions tied to physical state;
11. update lap/timing/classification;
12. emit immutable events/snapshot;
13. presentation consumes snapshot asynchronously/interpolated.

Update order must be explicit and testable.

## 6. Lateral-control contract

Only the trajectory/controller layer may create normal lateral motion.

Racecraft asks for intent such as “attack left,” “defend inside,” “return to ideal line,” or “merge.” Collision prediction may constrain unsafe regions. Pit may supply a pit-path corridor. The trajectory planner combines those into a continuous target path.

The vehicle then follows that path through steering/vehicle dynamics.

No independent `lane = lerp(...)` owner may run afterward.

## 7. Longitudinal-control contract

The speed planner produces a physical speed envelope from:

- vehicle capability;
- curvature/look-ahead;
- tyre/environment grip;
- aero/downforce;
- traffic trajectory/TTC;
- flags/race-control limits;
- pit limiter where physically reached.

The driver controller converts that envelope into throttle/brake. Safety layers can lower the envelope but must not directly overwrite velocity under normal operation.

Any direct `car.v = cap` style assignment in normal race logic is a code-review failure unless it is part of the physics integrator or an explicitly documented stationary/service/recovery state.

## 8. Pit architecture

Pit has three distinct concerns:

1. `PitDecision` — whether/when to pit;
2. `PitPath/StateMachine` — physical route, queue, service, release, merge;
3. `PitPresentation` — crew animation, box visuals, UI/radio.

They must not be merged into one module.

Pit path becomes a trajectory corridor. Entering pit state must not relocate the vehicle to a separate coordinate system.

## 9. Collision architecture

Separate:

- `PredictiveSafety`: collision prediction and avoid/abort constraints before impact;
- `PhysicalContact`: authoritative OBB/contact/impulse/damage after overlap/contact;
- `IncidentState`: spin, damage, retirement, recovery;
- `BarrierGeometry`: authoritative collision geometry supplied by track/world data.

PredictiveSafety must explicitly recognize safe parallel trajectories so side-by-side racing remains possible.

## 10. Racecraft state machine

Recommended explicit tactical states:

`RESET / FOLLOW / ASSESS / SETUP / COMMIT / ALONGSIDE / COMPLETE / ABORT / DEFEND / SWITCHBACK / SPECIAL`

State transitions should have hysteresis/commitment so cars do not flicker between left/right decisions every frame.

Special priorities such as yellow/SC/VSC, blue flag, major hazard, hydroplaning or pit approach may preempt normal attack/defend behaviour.

## 11. Data-driven configuration

Vehicle, track, pit and championship data belong in versioned data files with validation schemas.

Code should implement equations/policy; data should contain calibration.

No class-specific constants should be scattered throughout unrelated modules.

## 12. Diagnostics

Every authority should expose bounded diagnostics sufficient to answer:

- who requested this target;
- which constraint reduced it;
- what tactical state is active;
- why pit/race-control state changed;
- whether a recovery/repair path executed;
- performance cost.

Diagnostics are read-only and must not alter simulation behaviour.

## 13. Legacy policy

The clean rebuild contains **zero behavioural compatibility wrappers** by default.

If temporary adapters are required during reconstruction, they must:

- live under a clearly named `compat/` boundary;
- contain no simulation logic;
- have a deletion issue/date;
- never become application-facing architecture.

The `vNN-*` naming scheme must not be recreated.