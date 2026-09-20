# 01 — Master Product Specification

Snapshot basis: `master@ead10321a70c26623748894067391d6e4d90cf42`

## 1. Product definition

Racing is a **race spectator simulator**. The primary interaction is watching a believable race, switching broadcast/onboard views and understanding the event through timing, radio, race control and visual context.

The fundamental quality test is not whether cars can circulate. It is whether sustained observation produces behaviour that looks like real motorsport rather than scripted game traffic.

## 2. Immutable product principles

### 2.1 Race results must emerge

Lap time, gaps, position, overtakes, collisions, pit-stop outcome, retirement and final classification are results of simulation. They must not be directly randomized or preselected.

Randomness may affect causes such as reaction time, confidence, risk tolerance, consistency, precision and mistakes.

### 2.2 Motion must be continuous

Normal race motion must never depend on:

- teleporting to a waypoint, pit lane, merge point or racing line;
- coordinate correction used as a substitute for steering;
- instantaneous lane changes;
- one-frame velocity clamps that imply impossible acceleration/deceleration;
- hidden position snaps intended to make a test pass;
- rubber-banding toward another car or a desired race result.

Emergency recovery may reposition a disabled car only through an explicit, visible recovery state that is excluded from normal driving metrics.

### 2.3 One owner per authority

There must be one authoritative owner for each of:

- longitudinal vehicle dynamics;
- lateral trajectory/control;
- physical collision response;
- tactical racecraft intent;
- pit movement state;
- race/session state;
- timing/classification.

Other systems may propose requests/constraints but must not independently overwrite the same output.

### 2.4 Realism is continuous, not rule-shaped

Avoid logic such as “if car ahead then set 101 km/h”, “if corner then subtract N km/h”, or “if passing then force lane X”. Use physical capability, geometry, predicted trajectories, time-to-collision, available space and driver intent.

## 3. Core simulation pipeline

Normative conceptual pipeline:

`Track/Environment`
→ `Vehicle state + nearby traffic`
→ `Driver perception`
→ `Driver tactical decision`
→ `Target trajectory + target speed envelope`
→ `Controller inputs`
→ `Vehicle physics`
→ `Physical motion/contact`
→ `Timing/race state`
→ `Presentation`

Presentation must be downstream only.

## 4. Required race behaviours

The clean build must support, at minimum:

- standing race start and launch phase;
- green-flag racing;
- natural acceleration, braking and cornering;
- drafting/slipstream and dirty-air effects where appropriate;
- overtaking on straights and under braking;
- inside, outside and switchback attacks;
- side-by-side running without automatic surrender;
- legal/credible defensive positioning;
- multiclass traffic and faster-class passing;
- predictive collision avoidance that does not suppress legitimate passes;
- mistakes, lockups, spins and incidents that arise from causes;
- caution/race-control behaviour;
- fuel, tyre wear, temperature/thermal behaviour where enabled;
- strategy-driven pit stops;
- realistic pit entry, limiter zone, service, safe release and pit exit;
- retirement/recovery;
- timing, positions, gaps, sectors and fastest laps;
- spectator/broadcast cameras, telemetry/timing UI, audio and radio.

## 5. Explicitly removed / excluded behaviour

### 5.1 Qualifying

The active product starts directly into the race flow. Qualifying is not part of the clean rebuild unless a future human-approved scope change restores it.

### 5.2 Player driving

Direct player vehicle control is not a primary requirement. Onboard/driver camera is a spectator view.

### 5.3 Result scripting

No scripted winner, artificial pack compression or pace equalization designed to create drama.

## 6. Vehicle classes

Required classes currently represented by the project:

- Formula
- Hypercar/LMDh
- LMH
- Prototype/LMP2
- GT/LMGT3/GT3
- Supercar/Gen3-style
- Touring/TCR-style

Class identity must come from a coherent combination of mass, power/acceleration profile, braking, tyre grip/load sensitivity, aero, traction, wheelbase/steering response, fuel and tyre behaviour—not just top-speed constants.

Values from the old runtime are calibration seeds, not immutable truth.

## 7. Racecraft requirements

A driver approaching a slower car must reason about:

- longitudinal gap and closing speed;
- relative class/vehicle capability;
- current and predicted lateral separation;
- usable track width and vehicle dimensions;
- next braking/corner phase;
- collision trajectory and TTC;
- whether an attack has been committed;
- whether side-by-side overlap already exists.

A car must not brake simply because another car is nearby. If trajectories remain physically separate, parallel running should preserve pace subject to cornering/tyre limits.

When a pass is possible, the sequence should resemble:

`Assess -> Prepare/Setup -> Commit -> Alongside -> Complete/Abort/Reset`

with continuous trajectory generation rather than lane teleportation.

## 8. Pit requirements

A pit stop is a physical path, not a mode switch.

Required high-level sequence:

`TRACK`
→ `PIT_APPROACH`
→ `PIT_ENTRY`
→ `FAST_LANE`
→ `WORKING_APPROACH`
→ `QUEUE or SERVICE`
→ `RELEASE_WAIT if necessary`
→ `WORKING_EXIT`
→ `FAST_LANE_EXIT`
→ `MERGE`
→ `TRACK`

Drivers must begin positioning for pit entry sufficiently early, brake progressively to the limiter, follow the physical lane, stop at the team box, release only into a safe gap and merge without warping.

## 9. Track/world requirements

- Track geometry must be continuous and non-self-intersecting unless an intentional bridge/grade-separated crossing exists.
- Width must be sufficient and explicitly represented rather than inferred from visual mesh alone.
- Racing surface, runoff/grass, barriers, pit wall and pit buildings must not intrude onto the driveable line.
- Pit boxes must visually and logically align to garage/team positions.
- Physical collision geometry must correspond to visible barriers closely enough that cars do not hit invisible objects.
- Visual grass/runoff boundaries must be smooth enough not to form sawtooth incursions into the track.

## 10. Presentation requirements

The application should present races using motorsport broadcast language:

- trackside follow/pan shots;
- battle-aware director cuts;
- onboard cameras;
- pit cameras;
- timing tower/classification;
- map/radar/telemetry where helpful;
- contextual radio and race-control messaging;
- engine/effects/radio mixing.

Presentation may observe simulation state but cannot influence it.

## 11. Platform targets

Primary development/reference machine remains approximately:

- Ryzen 7 5700X
- RTX 4060 Ti 8 GB
- 32 GB RAM

The active lightweight spectator build must remain usable in modern desktop browsers and on iPhone-class mobile Safari/WebKit. Performance adaptation should reduce nonessential scene complexity before altering the correctness of simulation.

## 12. Quality definition

The rebuild is not complete because it boots. Completion requires:

- no known CRITICAL/HIGH realism defects;
- no fixed-speed lock regression;
- no normal-driving warp/snap path;
- no multiple controllers fighting the same authority;
- racecraft scenarios pass;
- pit scenarios pass;
- long-run stability passes;
- iPhone/browser tests pass;
- code structure maps cleanly to `02_TARGET_ARCHITECTURE.md`;
- all acceptance criteria in `10_TEST_AND_ACCEPTANCE.md` pass.