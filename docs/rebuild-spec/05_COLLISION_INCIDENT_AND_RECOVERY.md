# 05 — Collision, Incident and Recovery

## 1. Separation of concerns

Collision handling is divided into four responsibilities:

1. **Predictive safety** — tries to prevent future contact when a real collision trajectory exists.
2. **Physical contact** — resolves actual car-car/barrier contact and authoritative response.
3. **Incident state** — spin, damage, degraded control, retirement.
4. **Recovery** — explicit recovery from states the simplified simulation cannot resolve naturally.

These responsibilities must not fight each other.

## 2. Predictive safety model

Prediction should use the future motion of both vehicles, not only current distance.

At minimum consider:

- longitudinal gap and overlap;
- relative longitudinal speed / TTC;
- current lateral separation;
- lateral velocities;
- intended/target trajectories;
- vehicle widths/lengths;
- track boundaries;
- corner load / braking phase;
- uncertainty margin appropriate to speed.

Safe parallel motion is not a collision threat merely because longitudinal overlap exists.

## 3. Safety responses

Escalation should be proportional:

1. preserve current valid trajectory;
2. constrain an unsafe tactical target;
3. request controlled line adjustment;
4. lower speed envelope / brake if needed;
5. emergency evasive manoeuvre only when collision risk is imminent.

Do not jump immediately to heavy braking whenever another vehicle is close.

## 4. Physical car-car contact

Actual overlap/contact should be detected using an appropriate oriented vehicle representation rather than only center-point distance.

Physical response must:

- avoid energy creation;
- separate interpenetrating bodies without launching them unrealistically;
- preserve meaningful relative momentum;
- create damage/incident events based on severity;
- remain finite and stable;
- feed the post-contact state back to driver control.

Normal racecraft must not instantly overwrite the resulting post-contact pose.

## 5. Barrier contact

Visible and physical barrier geometry should be aligned.

Required invariants:

- no invisible barrier protruding into the racing surface;
- no persistent visual car penetration through a guardrail;
- collision cooldown must not disable basic non-penetration;
- spins near a barrier must not repeatedly oscillate through the barrier due to a competing lane controller.

A simplified post-contact separation correction may be used only inside the physical contact/recovery authority and must be identified as such—not as routine driving.

## 6. Spins

Spin initiation should arise from physical/driver causes such as:

- excessive slip/yaw;
- contact impulse;
- grip loss;
- over-braking/over-throttle;
- curb/runoff disturbance.

During an active spin, normal ideal-line trajectory control should yield to the physical incident state. The car should not be magnetically re-centered while still spinning.

## 7. Off-track behaviour

A car leaving the normal corridor should retain momentum and vehicle dynamics appropriate to the surface.

Recovery to the track should be gradual where possible. No instant reset is permitted during a recoverable excursion.

If the car becomes irrecoverably stuck because the simplified simulator lacks sufficient dynamics, enter an explicit recovery state with telemetry/event logging.

## 8. Damage

Damage levels may be simplified but must be causal and progressive.

Possible effects:

- reduced aero efficiency;
- steering bias/control precision reduction;
- reduced top/acceleration performance;
- puncture/tyre degradation where supported;
- forced pit request;
- retirement.

Damage must not be a random race-result modifier independent of incidents.

## 9. Recovery rules

Recovery is exceptional.

Permitted reasons include:

- impossible geometry interpenetration that cannot be solved stably;
- vehicle fully immobilized in an invalid state;
- simulation integrity protection after a severe incident.

Recovery must:

- be observable in diagnostics;
- increment a recovery metric/event;
- never masquerade as normal steering;
- avoid improving race position unfairly;
- restore the car to a safe state or retire it.

## 10. Multi-car incidents

The system must tolerate chain reactions without numerical collapse.

Predictive safety should respond to a stopped/spinning vehicle ahead, but cars may still collide when time/space is insufficient. The goal is credible causality, not collision elimination.

## 11. Safety car / caution interaction

Incidents may trigger race-control decisions according to configured rules. The collision module emits incident facts; it does not directly set session flags unless explicitly delegated by race control.

## 12. Regression requirements

Required tests include:

- safe parallel side-by-side does not trigger braking solely due to proximity;
- future lateral convergence is detected before contact;
- sudden stopped car produces emergency response;
- actual contact remains finite;
- 100 repeated contact scenarios produce no NaN/inf;
- barrier penetration does not persist after contact resolution;
- spin state is not overwritten by normal racing-line controller;
- recovery paths are countable and rare;
- no recovery increases longitudinal progress beyond a safe placement allowance;
- post-contact race can continue or retire cars cleanly.