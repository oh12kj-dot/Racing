# 07 — Race Rules, Strategy and Radio

## 1. Session scope

The clean rebuild begins directly with the race flow. **Qualifying is excluded.** Grid construction may be configured/generated from race setup data, but no active qualifying session or qualifying result object should exist unless scope is explicitly changed later.

## 2. Race state

Minimum race/session states should represent:

- pre-start/grid;
- start sequence;
- race/green;
- caution states as supported (yellow/VSC/SC);
- red/paused state if supported;
- finish/chequered;
- post-race/classification.

State transitions are owned by race control.

## 3. Start

The start system must provide:

- deterministic grid positions;
- start signal/timing;
- driver reaction delay;
- launch/traction behaviour through vehicle dynamics;
- opening-lap safety context without long-term artificial pace locking.

Cars must not overlap, teleport, or receive a scripted order after the start.

## 4. Timing and classification

Authoritative timing derives from physical track progress.

Required outputs:

- lap count;
- sector times;
- current lap time;
- personal best;
- fastest lap;
- total elapsed/race time;
- overall position;
- class position where applicable;
- gap to leader;
- interval to adjacent competitor;
- pit-stop count/status;
- retirement/finish state.

Classification must remain correct through wrap-around, pit lane, stopped cars and retirement.

## 5. Race control

Race control consumes incident/track facts and owns flags/procedures. It must not be embedded inside collision or UI code.

Potential inputs:

- blocked track;
- severe incident;
- stopped vehicle location;
- weather/visibility;
- race phase;
- configured championship rules.

Potential outputs:

- local/global yellow;
- VSC;
- safety car;
- red flag;
- restart;
- penalties where rule logic exists.

## 6. Caution behaviour

Caution should constrain target speed/spacing through driver control, not directly re-place the field.

No pack reset/rubber band may be used to manufacture exact gaps unless a specific real sporting procedure requires field bunching, in which case cars must physically catch the queue.

## 7. Blue flags / lapped traffic

Blue-flag logic is a race-control/racecraft context, not a teleport/yield command.

A slower/lapped car should become predictable and avoid unnecessary defense. It should not abruptly brake or leave the physical track. The faster car remains responsible for completing a safe pass.

## 8. Strategy

Strategy may consider:

- fuel remaining and projected fuel to finish;
- tyre wear/performance;
- weather/wetness forecast/state;
- damage;
- traffic/gaps;
- pit-loss estimate;
- caution opportunities;
- class/rule constraints;
- laps/time remaining.

Strategy outputs requests such as `PIT_THIS_LAP`, tyre/fuel/service plan or pace-management intent. It must not directly change lane, pose, speed or race position.

## 9. Strategy/racecraft boundary

Strategy may expose intent/context such as:

- save fuel;
- protect tyres;
- push;
- cool system;
- pit request.

Racecraft remains the only tactical owner of normal attack/defend/pass lane intent.

This boundary prevents a second hidden lane controller from fighting the racecraft system.

## 10. Thermal / reliability systems

If enabled, temperatures and reliability evolve from load/environment/time. They may cause:

- reduced pace through control/performance limits;
- cooling behaviour;
- pit request;
- damage/retirement.

They must not arbitrarily overwrite race order.

## 11. Championship

Championship/season state is downstream of race classification.

It may store:

- rounds;
- points;
- standings;
- team/driver records;
- race results.

It must never pre-compute the current race result.

## 12. Radio architecture

Radio is event-based presentation of real simulation/strategy state.

Sources may include:

- race control;
- pit strategy;
- driver status;
- battle/traffic context;
- damage/incident;
- weather;
- pit service/exit.

Radio must not drive authoritative physics.

## 13. Radio deduplication

Every radio event should have a semantic key/context, e.g.:

`PIT_CALL:<car>:<plannedLap>`

A repeated update with the same semantic key does not replay the call. A new message is allowed when context changes materially.

This specifically prevents repeated `BOX THIS LAP` spam.

## 14. Radio variety

Variety may change wording/audio clip, not meaning.

Do not randomly issue contradictory instructions for entertainment.

## 15. Penalties

If penalties are supported, separate:

- detection/decision;
- penalty state;
- physical serving path.

Drive-through and stop/go penalties must use the real pit path and state machine.

## 16. Finish

At the finish:

- classification freezes according to sporting rules;
- cars may continue into cooldown/presentation state;
- no new race-order randomization occurs;
- timing data remains internally consistent;
- UI/director transitions to results without changing simulation history.

## 17. Required acceptance

- race starts directly without qualifying data/session;
- lap/sector/classification remains correct across pit and wrap-around;
- retired cars handled consistently;
- race control is sole session/flag authority;
- strategy cannot write tactical lane position;
- pit requests hand off to pit state without early lateral suction;
- caution does not teleport/bunch field;
- blue flag does not create abrupt stop/yield;
- duplicate radio is suppressed;
- same seed/config produces same race-control/strategy decisions when all inputs are identical.