# Racing runtime code audit

## Active architecture

`app.js` now imports application services only from `runtime/index.js`.

The stable runtime layer owns new work:

- `runtime/world.js` — final pit merge geometry and runtime circuit audit
- `runtime/race.js` — pit merge hand-off and run generation metadata
- `runtime/audio.js` — engine/effects/radio mixer and per-utterance PTT state machine
- `runtime/ui.js` — sound toggle and five-channel audio mixer settings
- `runtime/profiler.js` — current + previous diagnostic generations
- `runtime/diagnostics-store.js` — bounded persistent diagnostic rotation
- `runtime/config.js` — stable configuration exports and audio defaults
- `runtime/index.js` — the only application-facing runtime facade

New features should update these stable files instead of creating a new `vNN-*` layer.

## Diagnostic retention

Diagnostics must survive an app restart without growing forever.

Policy:

- maximum 3 persisted generations
- maximum age 7 days
- maximum serialized store size about 900k characters
- same generation is overwritten rather than appended
- current generation is persisted every 30 seconds and on page hide
- oversized generations automatically downsample dynamics/performance history
- `CLEAR ALL LOGS` removes both in-memory and persisted diagnostics

Settings and championship state remain separate from diagnostic storage.

## Radio ownership

Every accepted radio message is one transmission. The runtime audio state machine guarantees:

1. `PTT_ON`
2. opening contact/squelch burst
3. `SPEAK_CALL`
4. `VOICE_START`
5. `VOICE_END`
6. `PTT_OFF`
7. release squelch/contact tail
8. inter-transmission silence before the next message

Engineer, driver and engineer-reply messages all follow the same independent sequence. The audio trace retains the bounded event history needed to diagnose Safari/iOS failures.

The mixer separates:

- master
- engine
- effects
- radio voice (`SpeechSynthesisUtterance.volume`)
- radio PTT/squelch

## Suzuka pit geometry

The real pit lane does not cover the middle of the racing surface. The pit-in road leaves the right edge and the proper pit lane then runs separately along the main straight, behind the pit wall. Pit-out rejoins along the right side.

The runtime replaces the old full-width merge ribbon with a narrow merge strip. Only the outer approximately one-lane-width portion of the racing surface is shared at the entry/exit transition; the full pit lane moves to the existing separated 21.5 m offset.

The runtime pit pose and visible pit asphalt use the same offset function. Pit exit retains the car near the outer edge before the normal racing-line controller merges it back in.

## Historical modules

The repository still contains historical `vNN-*` modules because the lower-level simulation stack uses some of them as compatibility providers. They are no longer the application-facing organization model.

Do not add a new `vNN-*` file for normal feature work. Modify the stable `runtime/` service instead. A future core-flattening pass can replace the remaining legacy provider chain after the runtime has been validated on physical iPhone hardware.

## Remaining technical debt

- `runtime/world.js` currently builds on the audited v42 world and hides the obsolete pit-surface ribbons. A future world-core flatten can avoid constructing those ribbons at startup.
- `runtime/race.js` still delegates the mature simulation core to v42/v41/v38 providers. Flattening this safely requires regression tests for strategy, SC/VSC, collisions, pit stops and race classification.
- Speech synthesis is provided by the browser and cannot be routed through Web Audio as a true processed radio signal without replacing it with buffered/neural TTS audio.
- Physical-device validation is still required for Safari audio-session behaviour, pit-in/pit-out visual continuity and long thermal runs.
