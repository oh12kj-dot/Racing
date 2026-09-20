# 10 — Test and Acceptance Specification

## 1. Definition of Done

A feature/phase is not complete because code compiles or a car moves.

Complete requires:

1. specified behaviour is observable;
2. automated acceptance/regression passes;
3. no CRITICAL/HIGH known realism defect in the affected subsystem;
4. no second authority was introduced for the same state;
5. frame-rate/determinism expectations remain valid;
6. desktop and relevant iPhone/WebKit smoke tests pass;
7. diagnostics show no hidden recovery/repair masking the scenario.

## 2. Static architecture gates

Fail build/review if normal production code contains an unapproved pattern such as:

- presentation module writing authoritative car position/speed;
- multiple normal lateral-motion writers;
- strategy writing attack/defend lane target;
- new `vNN-*` behavioural layer;
- race result/lap time randomized directly;
- pit state transition causing coordinate teleport;
- direct normal-driving speed clamp outside physics/control authority;
- unexplained hard-coded fixed pace target;
- qualifying implementation reintroduced without explicit scope change.

Static checks are safeguards, not substitutes for behavioural tests.

## 3. Vehicle/physics acceptance

### PHY-01 — finite long run

24-car representative field for at least 60 simulated minutes:

- zero NaN/inf physical state;
- zero unbounded velocity/yaw values;
- no simulation halt.

### PHY-02 — class ordering

Representative straight/low/medium/high-speed corner scenarios demonstrate coherent class differences. Formula advantage must be especially strong at high aero speed and not unrealistically identical at low speed.

### PHY-03 — physical braking

From representative race speeds, stopping/deceleration is progressive and consistent with class braking capability. No one-frame large velocity discontinuity except explicit reset/recovery test.

### PHY-04 — friction usage

Combined lateral/longitudinal demand does not exceed the configured force envelope beyond a small numerical tolerance.

## 4. Fixed-speed regression

### REG-SPEED-101

The former approximately 101 km/h lock must never return.

For a deterministic live green-race sample:

- tracked car speed range across samples > 15 km/h;
- ratio of tracked samples in 99–103 km/h band < 65%;
- at least one normal uncapped green-running car exists;
- field peak > 115 km/h on the test circuit;
- field speed spread > 18 km/h at some green sample;
- field speed standard deviation > 4 km/h at some green sample.

These numeric thresholds preserve the existing regression test. They are minimum anti-lock checks, not realism calibration targets.

## 5. Racecraft scenarios

### RC-01 — wide-straight pass

Given sufficient closing speed and lateral room, a faster follower prepares, moves out and can complete a pass. It must not remain indefinitely behind solely because collision avoidance sees a leader.

### RC-02 — parallel side-by-side

Two cars with safe parallel predicted paths:

- no collision-avoidance speed cap solely from longitudinal overlap;
- no forced surrender/brake;
- lateral clearance remains above physical threshold.

### RC-03 — convergence veto

Two vehicles whose future lateral paths converge below safe clearance receive an appropriate path/speed safety intervention before impact where reaction time allows.

### RC-04 — inside attack

Attacker establishes overlap under braking, both leave credible room, no coordinate jump, result emerges from corner/exit performance.

### RC-05 — outside attack

Outside car may remain alongside if physical space/grip exists; avoidance does not automatically push it behind.

### RC-06 — switchback

Committed but disadvantaged entry can transition to a physically plausible exit cross-over without scripted position exchange.

### RC-07 — defense

One deliberate defensive move is possible; repeated reactionary blocking is rejected.

### RC-08 — multiclass pass

Faster class with sustained closing advantage passes slower class when space permits; slower class remains predictable; no artificial speed boost.

### RC-09 — no high-frequency steering oscillation

Steering rate remains within vehicle limit and high-frequency target flipping is absent under stable conditions.

## 6. Collision/incident scenarios

### COL-01

100 representative car-car contacts produce finite states and no numerical explosion.

### COL-02

Barrier contact does not leave a normal car persistently embedded in visible/physical guardrail.

### COL-03

Spin/incident state is not immediately overwritten by ideal-line controller.

### COL-04

Stopped/spinning vehicle ahead produces braking/evasion when time/space permits. Secondary collisions may occur when physically unavoidable; goal is credible response, not zero contact.

### COL-05

Any exceptional recovery increments an explicit diagnostic and does not unfairly advance race progress.

## 7. Pit acceptance

### PIT-01 — early strategy request

A request well before the entry keeps the car on the normal circuit and creates approach intent. It must remain much closer to the track pose than the pit pose until the physical entry blend is reached.

### PIT-02 — early legacy entry protection

If an incorrect subsystem marks `ENTRY` before the pit window, pit state defers it to `PIT_APPROACH` rather than pulling the vehicle sideways.

### PIT-03 — approach smoothness

Pit-side positioning respects lateral acceleration/jerk/steering-rate limits and contains no discontinuous lane jump.

### PIT-04 — braking to limiter

Speed reduces progressively toward the control line. No impossible one-frame clamp from racing speed to pit limit.

### PIT-05 — lane fidelity

Car remains inside the intended pit entry/fast/working/exit corridors with defined tolerance and does not cut through pit objects/walls.

### PIT-06 — service capture

Service begins only when car is within a tight box capture tolerance and sufficiently slow. Gross approach errors are not silently snapped into service.

### PIT-07 — parallel service

Different teams may service simultaneously.

### PIT-08 — same-team double stack

Second same-team car waits in queue without overlap and proceeds after box release.

### PIT-09 — fast-lane passage

A service/queued car does not physically occupy the fast lane so unrelated cars can pass.

### PIT-10 — safe release

Release is held when approaching fast-lane traffic creates insufficient gap/TTC and proceeds when safe.

### PIT-11 — exit limiter

Limiter remains until configured end line; after release acceleration follows vehicle capability.

### PIT-12 — no exit warp

Pit exit through merge is continuous in position, heading, speed and lateral motion.

### PIT-13 — radio dedupe

One pit strategy decision does not produce repeated `BOX THIS LAP` every update/tick.

## 8. Race/session acceptance

### RACE-01 — no qualifying

- initial active session is `RACE`;
- no qualifying result/state exists;
- application status does not enter qualifying;
- source/runtime does not include active qualifying transition logic.

### RACE-02 — lap counting

Multi-car multi-lap test including pit lane and incidents produces no false/missed lap increments.

### RACE-03 — classification

Position ordering matches completed laps + authoritative progress according to rules; retirement and finish handled consistently.

### RACE-04 — timing

Sector sum matches lap time within defined timing precision.

### RACE-05 — caution

Caution speed/spacing is achieved by control/physical motion. Field is not teleported into formation.

## 9. Track/world acceptance

### TRK-01

Track-to-world/world-to-track roundtrip error remains below a defined numerical tolerance.

### TRK-02

No accidental road self-intersection or duplicate overlapping surface.

### TRK-03

Usable width is positive and sufficient for configured field/vehicle widths; overtaking-space tests use actual corridor values.

### TRK-04

No unauthorized scenery/collider lies inside racing/pit corridors.

### TRK-05

Grass/runoff visual edge does not intrude across track through high-amplitude jagged geometry.

### TRK-06

Pit boxes align to garage/team presentation.

## 10. Presentation/browser acceptance

### UI-01

Application boots to a non-empty rendered frame on Chromium desktop and iPhone/WebKit test target.

### UI-02

Core buttons, race start/watch controls and camera switching respond to touch on iPhone-sized viewport.

### UI-03

Camera/UI/settings changes do not change deterministic simulation result for the same input/seed.

### VIS-01

No obvious car-ground floating, persistent barrier penetration or pit-lane visual mismatch in validation shots.

### ASSET-01

Failure/missing optional presentation asset falls back without preventing race boot.

## 11. Performance acceptance

Record, at minimum:

- simulation tick time;
- main-thread/render frame time;
- GPU/frame estimate where available;
- memory/VRAM where available;
- draw calls/triangles;
- long-frame rate;
- quality tier.

A >10% unexplained regression in a stable benchmark is a review finding.

## 12. Determinism acceptance

For deterministic scope, two runs with the same build, config, seed and input sequence must produce matching authoritative-state hashes at designated checkpoints.

Asset loading, camera selection and UI interaction that are presentation-only must not alter these hashes.

## 13. Test philosophy

A test that only checks an internal flag is insufficient when the user-visible physical behaviour can still be wrong. Critical tests should inspect resulting motion/geometry as well as state.

Likewise, do not encode a bug as acceptance merely because it matches current code. Any threshold that represents a current regression test rather than a physical target must be labelled as such.