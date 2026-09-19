# Racing runtime code audit

## Active architecture

`app.js` imports application services only from `runtime/index.js`.

The stable runtime layer owns new work:

- `runtime/world.js` — final pit-merge surface, runtime circuit audit and pit visual hand-off
- `runtime/race.js` — pit merge hand-off and run-generation metadata
- `runtime/audio.js` — engine/effects/radio mixer and per-utterance PTT state machine
- `runtime/ui.js` — sound toggle and five-channel audio mixer settings
- `runtime/ui-core.js` — authoritative v16-era spectator UI implementation used by compatibility entry points
- `runtime/profiler.js` — current + previous diagnostic generations
- `runtime/diagnostics-store.js` — bounded persistent diagnostic rotation
- `runtime/config.js` — stable configuration exports and audio defaults
- `runtime/settings.js` — authoritative application settings/defaults
- `runtime/circuits.js` — authoritative circuit metadata and generated alternate layouts
- `runtime/index.js` — the only application-facing runtime facade

New feature work should update these stable files instead of adding another `vNN-*` application layer.

## Diagnostic retention

Diagnostics must survive an app restart without growing forever.

Policy:

- maximum 3 persisted generations
- maximum age 7 days
- maximum serialized store size about 900k characters
- same generation is overwritten rather than appended
- current generation is persisted periodically and on page hide/visibility loss
- oversized generations automatically downsample dynamics/performance history
- `COPY DIAGNOSTICS` contains the current run plus retained previous generations
- `CLEAR ALL LOGS` removes both in-memory and persisted diagnostics

The persistence store is separate from normal application settings. Settings and championship state continue to use their existing keys.

## Radio ownership

The runtime radio queue is normalized into **utterances**, not conversations. If one race-radio record contains explicit `Engineer:` / `Driver:` turns, it is split into independent transmission records before playback.

Every utterance guarantees this sequence:

1. `TX_BEGIN`
2. `PTT_ON`
3. opening contact/squelch burst
4. `SPEAK_CALL`
5. `VOICE_START`
6. `VOICE_END`
7. `PTT_OFF`
8. release squelch/contact tail
9. `TX_END`
10. inter-transmission silence before the next utterance

Therefore an engineer sentence, driver reply, and engineer follow-up each receive their own opening and closing radio sound. The bounded audio trace records `parentId` and `turnIndex` so failures can be diagnosed after the fact.

The mixer separates and persists:

- master
- engine
- effects (wind/tyre/brake/shift)
- radio voice (`SpeechSynthesisUtterance.volume`)
- radio PTT/squelch

## Suzuka pit geometry

The real Suzuka pit lane runs parallel and close to the home straight, but the full pit-lane pavement does **not** cover the racing surface. The pit entry/exit transition shares only the outer edge of the circuit before/after the physically separated lane.

The runtime therefore distinguishes two concepts:

- **vehicle merge trajectory** — allowed to use the outer portion of the racing surface while entering/exiting
- **pit-lane pavement mesh** — its inner edge is clamped at the racing-course edge and can never be drawn over the main racing surface

The dedicated pit lane still moves to the separated 21.5 m offset behind the pit wall. The entry/exit white lines and blue work-lane cue are derived from the same pit offset function.

`W.auditCircuit()` reports the pit-entry/pit-exit barrier clearance and `mainTrackEdgeOverlapAtMerge`, which is now defined as visible pit-surface overlap and should be zero.

Pit service-time defaults are owned by `runtime/pit-config.js` as `DEFAULT_SERVICE_TIME`. Runtime pit presentation/crew code must consume that shared table rather than maintain a second copy of the same per-class values.

## Historical modules

The repository still contains historical `vNN-*` modules because the mature simulation core uses selected versions as compatibility providers. They are no longer the application-facing organization model.

Do not add a new `vNN-*` file for ordinary feature work. Modify the stable `runtime/` service instead.

When a historical entry point must remain for compatibility, prefer a thin re-export to the authoritative stable module instead of copying the implementation. `v10-settings.js`, `v10-circuits.js`, and `v16-ui.js` intentionally follow this pattern; defaults, circuit definitions, and the v16 UI implementation must not be duplicated back into those files.

Stable runtime modules should import their implementation providers directly instead of routing out through a historical compatibility entry point and back into `runtime/`. Compatibility shims remain available for legacy callers, but should not add an extra hop to the active runtime path.

### Internal compatibility-hop cleanup

The cleanup is deliberately conservative: compatibility files stay in place, while small runtime modules bypass a verified one-line re-export when the provider is known exactly. No formulas, thresholds, timing, update order, state transitions or random behaviour are changed by these redirects.

Current direct runtime paths include:

- `world-environment-core.js -> world-core.js`
- `world-geometry-correction.js -> world-environment-core.js`
- `world-clearance.js -> world-geometry-correction.js`
- `world-depth.js -> world-effects.js`
- `world-pit-animation.js -> world-depth.js`
- `world-recovery.js -> world-pit-animation.js`
- `race-replay-policy.js -> race-core.js`
- `race-progress.js -> race-championship-core.js`
- `race-pit-presentation.js -> race-rules-thermal.js`
- `race-pit-crew.js -> race-pit-presentation.js`
- `race-pit-service.js -> race-pit-crew.js`
- `race-finish-control.js -> race-vehicle-systems.js`
- `race-pace-policy.js -> race-systems.js`
- `race.js -> race-base.js`

Large or behaviour-critical modules are intentionally not rewritten merely to remove one import hop. This includes racing-line generation, vehicle/class performance, spin handling, launch safety, side-by-side control, collision avoidance, pit strategy, race control, session control and the large world/pit builders.

The active dependency boundary is now:

`app.js -> runtime/* -> mature legacy providers`

rather than `app.js -> vNN -> vNN-1 -> ...` directly.

## Remaining technical debt

1. `runtime/world.js` currently builds on the audited v42 world and hides obsolete pit-surface ribbons. A future `world-core.js` flatten can avoid constructing them at startup.
2. `runtime/race.js` still delegates mature simulation logic to v42/v41/v38 providers. Flattening it safely requires regression tests for strategy, SC/VSC, collisions, pit stops, race classification and weather.
3. Director, camera, environment, safety-car and broadcast currently enter through stable runtime exports but are implemented by known-good legacy providers. They should be flattened only after automated behavioural regression tests exist.
4. Browser SpeechSynthesis cannot be routed through Web Audio as a fully processed radio signal. True radio-band voice processing requires buffered/prerecorded/neural TTS audio.
5. Physical-device validation is still required for Safari audio-session behaviour, pit-in/pit-out visual continuity and long thermal runs.
