# 04 — Driver AI and Racecraft

## 1. Objective

Each AI driver should appear to perceive traffic, choose an intent, commit to a line and operate the vehicle within physical limits. The system must avoid both extremes:

- passive “follow the car ahead forever” traffic;
- reckless “force an overtake regardless of geometry” behaviour.

## 2. Perception

A driver perception snapshot should include at minimum:

- own speed, trajectory, grip and control margin;
- track curvature/width/corridor ahead;
- ideal/reference racing line;
- cars ahead/behind and alongside;
- signed longitudinal gap;
- closing speed;
- lateral separation and predicted lateral motion;
- vehicle dimensions;
- next corner/braking intensity;
- class/performance difference;
- flags/hazards/pit intent;
- driver reaction delay and awareness limits.

Spatial query optimizations are allowed, but they must not change the logical meaning of perception.

## 3. Driver traits

Traits may include:

- racecraft;
- aggression;
- confidence;
- consistency;
- reaction time;
- braking precision;
- cornering precision;
- mistake propensity;
- wet-weather skill.

Traits alter decision thresholds, precision and risk. They must not directly grant impossible speed or set race position.

## 4. Tactical state machine

Recommended states:

- `RESET`: no tactical action;
- `FOLLOW`: stable traffic following;
- `ASSESS`: compare closing rate, space and upcoming geometry;
- `SETUP`: move gradually to prepare a pass;
- `COMMIT`: committed attack with hysteresis;
- `ALONGSIDE`: overlap exists; both cars must reason about shared corner/track space;
- `COMPLETE`: pass clearly established;
- `ABORT`: back out safely when opportunity disappears;
- `DEFEND`: one credible defensive move;
- `SWITCHBACK`: yield initial corner position to attack exit;
- `SPECIAL`: flags, blue flag, hazard, pit approach or other higher-priority state.

A commitment timer/hysteresis is required so targets do not alternate each frame.

## 5. Passing on straights

When a follower is faster and sufficient width exists, the default behaviour should be to evaluate and attempt a pass rather than remain centered behind the leader.

Decision inputs:

- gap and closing speed;
- predicted overlap time;
- left/right available width after vehicle-clearance margins;
- predicted leader trajectory;
- track boundary;
- next braking zone distance;
- performance advantage and draft;
- current tactical commitment.

The driver may remain in the slipstream during setup, then move out when the passing lane becomes useful. A pass is not complete merely because `laneTarget` changed.

## 6. Side-by-side behaviour

This is a critical contract.

If two vehicles are longitudinally overlapping but their predicted trajectories retain adequate lateral clearance, **parallel running is valid and must not automatically trigger speed reduction**.

Collision prediction must distinguish:

- current physical overlap/contact;
- future convergence/crossing;
- safe parallel trajectories.

Only future contact risk justifies a safety intervention.

This prevents the historical failure where a car that had already pulled alongside slowed unnecessarily and gave up a pass.

## 7. Corner attacks

### Inside attack

The attacker must earn overlap before/through braking. If meaningful overlap exists at turn-in, both vehicles leave appropriate racing room. The attacker accepts a compromised radius/exit.

### Outside attack

The outside driver may remain alongside where grip/space permits. The outcome can be outside pass, delayed completion, or switchback.

### Switchback

A driver may deliberately avoid overcommitting on entry, cross back toward a better exit trajectory and exploit the opponent’s compromised exit. This must arise from predicted paths, not a canned animation.

## 8. Defending

Defending should represent a deliberate line choice, not repeated blocking.

Normative rules:

- one principal defensive move on a straight;
- no abrupt reactionary swerve after the attacker has committed;
- no movement that forces an overlapping car outside the physical track;
- braking-zone movement is constrained;
- returning toward the racing line requires adequate room.

Exact sporting-rule variants may be configured per championship, but physical safety remains independent.

## 9. Traffic following

Following distance must be dynamic.

Inputs include:

- speed;
- closing rate;
- braking capability;
- reaction time;
- aerodynamic following effect;
- next corner;
- pass intent;
- current lateral separation.

When directly in line and not committed to a pass, a follower should maintain a credible buffer and brake progressively if the leader is slower.

When a valid pass trajectory creates lateral escape, following logic must loosen appropriately; otherwise collision avoidance can suppress overtakes forever.

## 10. Multiclass passing

A faster class approaching a slower class should detect the closing opportunity earlier than equal-class tactical fighting.

Multiclass behaviour should:

- recognize sustained performance advantage;
- choose the less disruptive available side;
- communicate intent through stable trajectory choice;
- avoid late zig-zagging;
- allow the slower car to remain predictable rather than forcing it to jump aside;
- retain collision prediction throughout the pass.

The current implementation’s concepts of pass range, minimum closing speed and a latched pass target are useful design ideas, but their numeric thresholds require clean recalibration.

## 11. Collision avoidance integration

Racecraft proposes a desired path. Predictive safety may:

- veto a converging path;
- reduce target speed envelope;
- request an abort;
- choose an emergency avoidance corridor.

Predictive safety must not own routine overtaking or decide racecraft state under normal circumstances.

## 12. Lane/trajectory generation

Racecraft produces semantic intent, not instantaneous coordinates.

Example:

`ATTACK_LEFT + desired clearance + commit horizon`

Trajectory planning converts that into a smooth path with bounded:

- lateral acceleration;
- lateral jerk;
- steering angle;
- steering rate;
- vehicle/track clearance.

A vehicle must not be “pulled” toward a lane target independent of forward speed/vehicle capability.

## 13. Racing line

The ideal line is a reference, not a magnetic rail.

Drivers may depart from it for:

- attack;
- defense;
- avoiding incidents;
- blue-flag management;
- cooling/wet lines;
- pit approach/merge;
- recovering from mistakes.

After the special condition ends, the driver returns gradually according to trajectory feasibility.

## 14. Start/launch phase

The opening seconds of a race require additional caution because many vehicles are compressed.

Launch logic may temporarily tighten unsafe lateral moves and headway, but it must not create a long fixed-speed convoy or disable obvious open-space passes after the field spreads.

## 15. Blue flags and special priorities

Special states may preempt normal attacks/defense when logically necessary:

- blue flag/lapping protocol;
- yellow/SC/VSC/red state;
- major hazard;
- severe vehicle damage;
- hydroplaning/extreme wet state;
- pit approach.

Priority should be explicit and testable.

## 16. Mistakes

Mistakes arise from causes such as late braking, imperfect line, over-throttle, reduced grip or reaction delay. They must not be injected as arbitrary position jumps.

Consequences may include:

- lockup;
- missed apex;
- wide exit;
- snap/oversteer/spin;
- lost momentum;
- contact.

## 17. Prohibited racecraft shortcuts

- “car ahead => fixed target speed”;
- “car nearby => brake regardless of trajectory”;
- forced overtake flag that ignores physical space;
- alternating left/right lane target every frame;
- coordinate separation used as normal avoidance;
- scripted pass completion;
- artificial speed boost to guarantee a pass;
- defensive teleport or immediate lane-center snap;
- independent strategy module writing tactical lane targets while racecraft also writes them.

## 18. Required scenario validation

The clean build must include deterministic scenarios for:

1. faster car catches slower car on wide straight and passes;
2. two cars run parallel at speed without unnecessary braking;
3. converging side-by-side trajectories trigger safety intervention;
4. inside braking-zone attack;
5. outside attack;
6. switchback;
7. legal defense and blocked illegal second move;
8. faster class overtakes slower class;
9. slower class remains predictable;
10. pass abort before an unsafe corner;
11. follower does not rear-end a suddenly slower car;
12. racecraft returns smoothly to normal line after completion;
13. no high-frequency steering/lane-target oscillation;
14. no persistent follow-behind behaviour when a physically valid pass exists.