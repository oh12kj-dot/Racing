# 03 — Vehicle Physics and Class Differentiation

## 1. Purpose

Vehicle behaviour must be generated from continuous vehicle capability rather than visual animation or fixed per-corner speeds. The fidelity target is believable motorsport behaviour, not a professional engineering tyre simulator.

## 2. Required physical state

At minimum each vehicle model must expose enough state to derive:

- longitudinal speed and acceleration;
- yaw/orientation and yaw rate;
- lateral velocity/slip state;
- steering input/angle;
- throttle and brake input;
- gear/power delivery state;
- tyre/grip state;
- fuel mass;
- aero/downforce influence;
- damage/incident modifiers;
- track position/progress separately from rendered transform.

The rendered mesh follows physical state. It must not be the authoritative vehicle state.

## 3. Longitudinal performance

Acceleration must decrease with speed rather than use one constant acceleration value. At minimum the model needs low-, mid- and high-speed capability or a power/drag-based curve.

Braking must account for available tyre force, speed-dependent aero where relevant and combined lateral load through a friction-circle/ellipse constraint.

A speed limiter is a control target. Reaching a pit limit or safety cap should occur through braking/throttle control unless the car is already in an explicit stationary/service/recovery state.

## 4. Cornering capability

Corner speed must derive from curvature and available lateral acceleration.

Conceptually:

`v_limit ≈ sqrt(a_lateral_available / |curvature|)`

where `a_lateral_available` varies with:

- base tyre friction;
- normal load;
- tyre load sensitivity;
- speed-squared aero load;
- wetness/grip modifiers;
- tyre condition/temperature;
- combined braking/acceleration demand.

The system must look ahead far enough to brake naturally before the corner rather than detect the corner at the apex and clamp speed.

## 5. Friction usage

Combined longitudinal and lateral forces must remain inside an explicit tyre-force envelope. Consequences should emerge naturally:

- heavy trail braking reduces lateral capacity;
- excessive throttle on exit can reduce line-holding capacity;
- lockup can arise under excessive braking;
- low grip increases braking distance and lowers corner speed.

## 6. Aero

For aero-dependent classes, downforce grows approximately with speed squared. This is essential to distinguish high-speed Formula behaviour from low-speed mechanical grip.

Low-speed Formula cornering must not receive the full high-speed aero advantage.

## 7. Driver/controller separation

Vehicle physics receives control inputs. It does not decide racecraft.

Allowed external controls:

- steering;
- throttle;
- brake;
- gear/clutch where modelled;
- DRS/energy deployment where supported.

The AI must not directly set physical speed/pose in normal driving.

## 8. Class differentiation

The current project carries seven useful calibration families. The following snapshot is preserved as a **starting calibration only**, not as final truth.

| Class | Current reference category | Top envelope m/s | Mass kg | Key character |
|---|---|---:|---:|---|
| Formula | FIA Formula 1 2026 style | 98.3 | 768 | very high braking/aero, strongest high-speed cornering |
| Hyper | WEC Hypercar/LMDh style | 97.7 | 1030 | prototype aero, strong braking, lower corner ceiling than Formula |
| LMH | Le Mans Hypercar style | 97.2 | 1030 | close to Hyper, separate calibration family |
| Prototype | LMP2 style | 90.7 | 950 | high-downforce prototype below Hyper pace |
| GT | LMGT3/GT3 style | 84.6 | 1300 | heavier, lower aero/braking, strong mechanical grip |
| Supercar | Gen3-style | 83.33 | 1350 | lower aero, lively traction/tyre behaviour |
| Touring | TCR-style | 70.3 | 1265 | lowest top/aero envelope, mechanical-grip dominated |

Current implementation also differentiates acceleration bands, brake bands, tyre base friction, tyre load sensitivity, aero load at a reference speed, traction, tyre wear, wheelbase, steering response, draft gain and dirty-air loss. The clean rebuild should preserve the **dimensions of differentiation**, then recalibrate values from authoritative technical references and observed race behaviour.

## 9. Multiclass implications

A faster class should normally catch and pass a slower class because of the whole performance envelope. Multiclass passing must not be achieved by directly adding speed when a slower-class car is nearby.

Performance advantage should be estimated from physical capability and current conditions. A pass decision may consider pace delta/top-speed delta, but actual completion must still emerge from motion.

## 10. Fuel, tyre and thermal behaviour

Where active:

- fuel is stored with one canonical unit, preferably kg;
- fuel mass contributes to vehicle mass if the physics fidelity supports it;
- consumption follows distance/load rather than random lap subtraction;
- tyre wear changes grip progressively;
- wet tyres/conditions alter grip coherently;
- thermal state may alter performance gradually, not as binary magic values.

Pit refuelling rules are class/rule dependent and must be data driven.

## 11. Draft and dirty air

Draft/slipstream may increase effective straight-line performance when aligned behind another car. Dirty air may reduce aero-dependent cornering when closely following.

Both effects should depend on geometry, gap and class sensitivity. They must not be global “car behind = +/- X speed” switches.

## 12. Contacts and physical response

Vehicle physics/contact resolution must not allow ordinary contacts to produce impossible energy gain, NaN, infinite velocity or repeated tunnelling through barriers.

After physical contact, tactical AI should receive the resulting state; it must not overwrite the contact result immediately with an idealized lane/pose.

## 13. Required validation

At minimum test:

- static load/weight consistency if wheel-load model exists;
- acceleration curves at representative speeds;
- braking distance from representative speeds;
- corner-speed ordering between classes at low/medium/high-speed corners;
- speed-squared aero relation;
- friction-circle compliance;
- no NaN/inf in one-hour field simulation;
- no persistent 101 km/h or any other unexplained fixed-speed attractor;
- class lap-time ordering on a representative circuit;
- no direct normal-driving transform or velocity assignment outside the physics authority.

## 14. Calibration policy

Every tuned constant must have one of these labels:

- `RULE/TECHNICAL SOURCE` — derived from public regulations/specification;
- `MEASURED` — derived from observed/reference performance;
- `MODEL PARAMETER` — necessary for the chosen simplified model;
- `TEMPORARY CALIBRATION` — explicitly awaiting validation.

No unexplained magic value should become permanent simply because it made one scenario look correct.