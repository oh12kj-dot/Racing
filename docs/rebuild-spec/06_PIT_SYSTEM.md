# 06 — Pit System

## 1. Core principle

A pit stop is a continuous physical route and state transition, not a teleport from circuit to pit coordinates.

The driver should visibly:

1. decide/request a stop;
2. prepare for entry while still racing;
3. position the car toward the pit side early enough;
4. brake progressively toward the pit speed limit;
5. cross the physical pit-entry boundary;
6. follow the fast lane;
7. transition to the working lane/team box;
8. stop accurately;
9. complete service;
10. wait for a safe release when traffic requires it;
11. return to fast lane;
12. follow pit exit;
13. obey limiter until the correct line/zone ends;
14. merge onto the circuit continuously;
15. return to normal racing authority only when merge is complete.

## 2. Normative state model

Recommended states/phases:

`TRACK`
→ `PIT_APPROACH`
→ `PIT_ENTRY`
→ `FAST_LANE`
→ `WORKING_APPROACH`
→ `QUEUE | SERVICE`
→ `RELEASE_WAIT` when necessary
→ `WORKING_EXIT`
→ `FAST_LANE_EXIT`
→ `MERGE`
→ `TRACK`

Drive-through may skip service/working-lane stages but must still follow the physical pit route and limiter rules.

## 3. Strategy/pit separation

Strategy owns **whether/when** a stop is requested.

Pit state owns **how the car physically executes** the stop.

A strategy request far before pit entry must not set the car directly to `ENTRY` if doing so would cause it to be pulled toward pit geometry. It should create `PIT_APPROACH` intent and remain on the racing surface until the physical entry path is reachable.

## 4. Pit approach

This is a critical historical failure area.

Requirements:

- begin positioning hundreds/tens of metres early enough for the circuit geometry and speed;
- use a smooth trajectory with bounded lateral acceleration/jerk;
- preserve racing responsibility to surrounding cars;
- do not jump across the track at the last moment;
- do not decelerate to limiter speed in a single frame;
- avoid treating pit intent as immunity from collision prediction.

The exact approach distance is circuit- and speed-dependent, not one universal magic number.

## 5. Pit-entry braking

The car should predict the distance to the pit speed-control line and brake using actual braking capability plus safety margin.

The limiter constrains control after the relevant line/zone is reached. It is not permission to directly clamp a vehicle from racing speed to the limit.

Regression must reject impossible one-frame deceleration.

## 6. Pit geometry

Pit geometry data must explicitly define:

- pit entry blend start/end;
- speed-control line/zone;
- fast lane center/corridor;
- working lane center/corridor;
- team box positions;
- queue position/gap;
- pit exit lane;
- limiter end line;
- merge start/end;
- walls/barriers/garage entrances.

Visual and logical box positions must align with the corresponding garage/team area.

## 7. Fast lane

Cars in the fast lane may proceed at or below the pit speed limit subject to traffic.

A stopped/service car in the working lane must not block the entire pit lane. There must be sufficient separate width for fast-lane traffic to pass.

## 8. Working lane and service approach

Cars leave the fast lane toward their box through a continuous working-lane trajectory.

The team box should be approached at low speed. The system may define a small capture tolerance for service, but it must not hide gross position errors.

Any final zero-speed anchoring is permitted only inside the stationary service state after the car physically reaches an acceptable box capture window.

## 9. Multiple teams and double stacking

Different teams must be able to service cars concurrently when their boxes are independent.

For two cars of the same team arriving together:

- the first occupies service;
- the second waits at a safe queue position;
- the queued car must not overlap the service car;
- it advances only after the box becomes available;
- traffic in the fast lane remains possible.

## 10. Service

Service duration and allowed operations are class/rule dependent.

State must support, where configured:

- tyre change;
- fuel/refuelling;
- damage repair;
- penalty/drive-through logic;
- minimum stationary/service time.

Presentation/crew animation reflects the authoritative service state and cannot shorten/extend it accidentally.

## 11. Safe release

Before leaving the working lane, evaluate fast-lane traffic using distance and time-to-collision, especially approaching traffic from behind.

If unsafe, hold `RELEASE_WAIT`.

Release decisions should be deterministic from the traffic state/rules, not random.

## 12. Pit exit

The car accelerates naturally while respecting the limiter/exit zone.

Critical rules:

- no warp from pit lane to racing surface;
- no premature normal racing-line authority before the merge corridor permits it;
- limiter remains active until the defined end line is crossed;
- merge trajectory respects circuit traffic and physical boundary/white-line rules;
- acceleration after limiter release follows vehicle capability.

## 13. Merge

`MERGE` is a distinct phase.

During merge:

- the pit corridor/merge trajectory has priority over ordinary ideal racing line;
- predictive safety sees on-track traffic;
- the merging car chooses a continuous insertion path;
- main-field cars may react if a genuine collision trajectory exists;
- neither side is teleported or hard-braked merely to guarantee a gap.

Normal racecraft authority resumes after merge completion.

## 14. Pit radio

`BOX THIS LAP` and similar calls are event-driven.

Rules:

- issue once per strategy decision/context unless the state materially changes;
- deduplicate repeated identical messages;
- do not repeat every simulation tick;
- cancelled pit request may produce one cancellation/update message;
- service/exit messages are tied to transitions.

## 15. Failure handling

If the car cannot reach service due to a simulation defect, diagnostics should identify the failure. Do not silently teleport it into the box.

Stall recovery may exist only as an explicitly instrumented fallback and should fail a strict realism test when exercised in ordinary conditions.

## 16. Acceptance scenarios

Required scenarios:

1. pit request 250 m+ before entry remains on track and begins a smooth approach;
2. high-speed approach brakes progressively to limiter line;
3. no single-frame impossible speed drop;
4. car follows pit lane center/corridor without cutting across barriers/objects;
5. box location aligns to team garage;
6. car reaches/stops inside a tight service capture window;
7. two different teams service concurrently;
8. same-team double stack queues correctly;
9. service car does not block fast lane;
10. unsafe release holds for approaching traffic;
11. safe release proceeds promptly;
12. limiter remains until correct exit line;
13. merge occurs continuously without warp;
14. exit car and on-track car avoid real collision while preserving normal pace when trajectories are separate;
15. drive-through follows physical lane without service;
16. pit radio does not spam repeated `BOX THIS LAP` messages.