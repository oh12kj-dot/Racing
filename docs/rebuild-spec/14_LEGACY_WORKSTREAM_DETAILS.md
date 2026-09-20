# 14 — Legacy Workstream Details Worth Preserving

Purpose: capture technically valuable work that exists outside the current product-facing browser runtime so it is not forgotten during a clean rebuild.

This is **historical implementation evidence**, not a command to copy old architecture.

## 1. Two major implementation lines currently coexist

The repository contains:

1. a product-facing browser/iPhone Three.js runtime under `iphone-demo/`;
2. an earlier/parallel Rust headless simulation program with WASM Engineering View plus UE5/Blender tooling.

A clean rebuild must decide which layer becomes authoritative and avoid maintaining two independent race-behaviour implementations.

## 2. Rust simulation foundation already explored

Historical completed/approved areas recorded by the project handoff include:

- `sim-math` — math primitives, splines, deterministic RNG/utilities;
- `sim-track` — track coordinates/frames, surfaces, JSON loading, lap handling;
- `sim-vehicle` — control inputs, ground probing, vehicle parameters and physics;
- `sim-line` — corridor, trajectory, speed profile, performance envelope;
- `sim-driver` — perception, decision, planner and controller;
- `sim-core` — fixed-step world, track ground integration and AI wiring;
- `sim-wasm` — WASM boundary/read-only views/world stepping;
- `view-engineering` — Three.js engineering/debug visualization, not intended as final product renderer.

These domain boundaries are useful design research for the clean architecture even if the code is not reused.

## 3. Track/line research

The historical Rust work reached a nontrivial reference racing-line solution:

- direct banded/KKT-style solver rather than a simple waypoint chase;
- white-line box constraints with an internal margin (historically around 0.30 m);
- objective based on minimizing integrated curvature squared;
- generated out-in-out line that used a large portion of available width in representative corners;
- line curvature substantially lower than the centerline in the recorded test case.

The important requirement to preserve is **continuous optimization/corridor-aware trajectory design**, not the exact old solver or constants.

## 4. Known Rust lateral-control blocker

The historical handoff also records an unresolved hard blocker after the better reference line was introduced:

- a clean baseline driver could spin at a representative corner on the real optimized line;
- an offline `t=0` spawn case could fail to complete a large lane change on the start/finish straight and leave the corridor;
- the project concluded that the lateral inner loop / real-tyre control needed redesign.

This is important evidence: **do not treat the historical Rust driver/controller as a proven final controller and copy it unchanged.**

The clean rebuild must validate controller stability against the actual tyre/vehicle model and race trajectories.

## 5. Historical Rust validation state

The 2026-09-10 handoff recorded a healthy test baseline around:

- 182 release tests passing plus doctest;
- four ignored tests tied to the known lateral-control blocker;
- clean clippy/fmt;
- wasm32 / wasm-pack checks.

These numbers are historical milestones, not current acceptance counts. The valuable part is the culture of headless unit/scenario/determinism validation.

## 6. Aoyama Ring data

The Rust work includes an original `aoyama_ring.track.json`, recorded historically as approximately 4,139 m.

Before deletion:

- classify this as retained source data if still used/valuable;
- preserve its license/origin metadata;
- validate its geometry with the clean track acceptance suite;
- do not assume old tuning/curvature is correct merely because it passed previous milestones.

## 7. Vehicle source/spec data

`assets/vehicles/gt_proto_a.spec.json` historically served as a shared visual/physical vehicle specification.

Preserve useful source dimensions/metadata, but migrate them into the clean schema only after unit/range validation.

## 8. Blender pipeline

The repository contains `tools/blender/` and historical notes that a procedural vehicle mesh generation pipeline reached an approved milestone.

Before cleanup, determine whether this tooling contains:

- unique source geometry generation logic;
- material conventions;
- export settings;
- LOD/compression conventions;
- license metadata.

If it can regenerate required assets and remains useful, keep it as source tooling or archive it with a migration note. Do not delete it merely because it is not runtime code.

## 9. Track tooling

`tools/tracks/` contains track control-point/densification tooling. Preserve or document any algorithm necessary to regenerate retained track data.

## 10. UE5 workstream

Historical planning selected/evaluated UE5 as a photorealistic renderer path and began code-first/headless automation/spike work.

Recorded work included:

- scaffold/automation;
- scene-building Python;
- GPU profiling attempt;
- a known `-game`/possession-type diagnostic issue during the spike.

The clean rebuild should not automatically inherit UE5 as a required product renderer unless that choice is still desired. Rendering-engine selection is separable from the authoritative simulation contract.

## 11. Browser runtime operational features to preserve as capabilities

The product-facing runtime status records several capabilities that must not disappear accidentally:

- event-aware broadcast Director with queued simultaneous events rather than silently dropping all but one;
- circuit/world-owned pit runtime configuration rather than hard-coded single-circuit pit constants;
- iOS lifecycle handling for page visibility/suspension;
- WebGL context interruption/recovery handling;
- dedicated iPhone WebKit regression coverage;
- class-specific procedural fallback silhouettes for Formula/prototype/hyper families;
- rendered-frame visual contracts/screenshot checks for non-blank output;
- optional remote GLB asset persistence/cache after successful fetch while preserving procedural fallback;
- Rust CI for format/clippy/tests/wasm when Rust code is part of the build.

These are **capability requirements**. Their current implementation does not need to be copied.

## 12. Director queue requirement

When multiple broadcast-worthy events occur at once, lower-priority events should be queued/aged/expired according to policy rather than silently lost.

Director event prioritization belongs to presentation and cannot alter simulation ordering.

## 13. iOS lifecycle requirement

The clean browser/mobile build should explicitly handle:

- `visibilitychange` / page suspension;
- resize/orientation changes;
- WebGL context loss and restoration;
- resuming without duplicate simulation loops;
- resuming without race-state corruption.

Tests must verify state transition/recovery rather than only page load.

## 14. Render asset fallback/cache requirement

Optional higher-fidelity assets must not be a boot dependency.

Policy:

- ship or generate a functional baseline appearance;
- load higher-fidelity assets asynchronously;
- cache verified assets where platform policy permits;
- on failure/time-out, retain fallback;
- never block/rerandomize simulation because presentation asset loading differed.

## 15. Quality-policy note

Historical runtime notes mention an explicit user exclusion around one AUTO quality/thermal FPS policy at that time. Because user intent may have evolved, the clean rebuild should not preserve an old quality policy solely from legacy notes. Performance adaptation should follow the current product requirements in this specification and be reviewed when implemented.

## 16. Clean-rebuild decision rule for old workstreams

For every Rust/UE/Blender/browser component, classify it as one of:

- `REQUIREMENT TO PRESERVE` — behaviour/capability belongs in clean spec;
- `SOURCE ASSET/TOOL TO RETAIN` — unique generative/value data;
- `DESIGN RESEARCH` — useful idea, reimplement cleanly;
- `KNOWN BAD/INCOMPLETE` — do not copy;
- `ARCHIVE ONLY` — historical evidence.

No code is retained merely because it previously received an “approved” milestone; clean architecture and current acceptance criteria remain authoritative.