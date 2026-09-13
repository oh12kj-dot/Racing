# ARCHITECTURE_TARGET.md — Long-term Simulation Architecture

Status: target design
Last updated: 2026-09-14

This document describes the desired end state, not the currently running browser implementation. See `ARCHITECTURE.md` for the active system.

## Goal

Separate deterministic simulation from presentation so the same race can be rendered by browser Three.js, a future native renderer, or another engine without changing physics/AI results.

## Target layers

### Simulation core

A fixed-timestep deterministic core owns:

- track coordinates and geometry
- racing corridor / trajectories / speed profiles
- vehicle physics, tyres, aero and powertrain
- driver perception, decision, planning and control
- race control, timing, classification and strategy
- weather and track state

The simulation never imports rendering, UI, camera or audio code.

### Presentation

Presentation consumes immutable world snapshots and owns:

- vehicle/track rendering
- animation and LOD
- camera/director
- broadcast graphics
- audio/radio playback
- replay visualization

Presentation cannot directly mutate simulation state.

## Target module direction

`sim-math <- sim-track <- sim-line <- sim-driver <- sim-core`

`sim-vehicle` supplies physical state used by `sim-driver`/`sim-core`.

`sim-race` supplies race-control/state services to `sim-core`.

FFI/WASM layers expose snapshots and control inputs without leaking renderer-specific types.

## Track model

Race logic uses continuous local coordinates:

- `s`: arc length around the circuit
- `t`: lateral offset from track centre

World coordinates are derived from `(s,t)`. Waypoint-index ownership is not used for race logic.

## Racing-line model

Keep three concepts separate:

1. legal/drivable corridor
2. trajectory (`t(s)`)
3. speed profile (`v_max(s)`)

Overtake, defend, wet line, avoidance and pit trajectories are continuous variants/blends rather than jumps between waypoints.

## Vehicle model

Target physics uses fixed timestep and physically coupled tyre/load/aero behaviour. Visual suspension reads physical suspension state instead of synthesizing a separate animation-only state.

## Determinism and testing

The target is considered reached only when:

- identical seed/input produces identical simulation hashes;
- scenario tests cover overtakes, incidents, pit stops, SC/VSC and weather;
- presentation can be disabled without changing race results;
- browser/native renderers consume the same snapshot contract.

## Migration path from current runtime

1. Keep the current browser runtime stable and covered by regression monitors.
2. Move one ownership area at a time from historical JS providers into stable runtime modules.
3. Define snapshot-shaped boundaries that match the future simulation/presentation split.
4. Port deterministic state generation into the headless core after behavioural parity exists.
5. Retire duplicate browser-side simulation ownership only after regression parity is demonstrated.
