# Racing Clean Rebuild Specification

Status: DRAFTED FROM CURRENT MASTER + REGRESSION HISTORY
Snapshot: `master@ead10321a70c26623748894067391d6e4d90cf42`
Date: 2026-09-20
Purpose: preserve the product intent, accepted behaviour and rebuild constraints before any destructive cleanup.

## 1. Authority

This directory is intended to become the **normative source for a clean rebuild**. It does not mean that every current implementation detail is correct.

Priority when documents disagree:

1. Human-approved product intent and realism principles in this directory
2. Acceptance criteria in `10_TEST_AND_ACCEPTANCE.md`
3. Physics / AI / pit contracts in subsystem documents
4. Existing tests that are explicitly carried forward
5. Existing source code, used only as implementation evidence

A current behaviour that conflicts with the realism principles must **not** be preserved merely because it exists today.

## 2. Rebuild objective

Build a spectator-first race simulator in which cars appear to be driven by independent drivers operating vehicles under continuous physical constraints. Race outcomes must emerge from simulation. The application must not hide defects with coordinate snaps, fixed-speed locks, teleports, arbitrary slowdowns, rubber-banding, forced overtakes or result scripting.

The rebuilt system must be understandable without reading the discarded implementation.

## 3. Documents

- `01_MASTER_SPEC.md` — product scope, invariants, feature catalogue and non-goals
- `02_TARGET_ARCHITECTURE.md` — clean ownership model and dependency rules
- `03_VEHICLE_PHYSICS_AND_CLASSES.md` — vehicle dynamics and class differentiation
- `04_DRIVER_AI_AND_RACECRAFT.md` — perception, decision, trajectory, overtaking and defending
- `05_COLLISION_INCIDENT_AND_RECOVERY.md` — predictive safety, physical contact, spins and recovery
- `06_PIT_SYSTEM.md` — pit request through entry, service, release and merge
- `07_RACE_RULES_STRATEGY_RADIO.md` — session, flags, race control, strategy, championship and radio
- `08_TRACK_WORLD_PRESENTATION.md` — track, world, assets, visuals, cameras, UI and audio
- `09_PERFORMANCE_PLATFORM_DATA.md` — iPhone/browser constraints, performance, determinism and data model
- `10_TEST_AND_ACCEPTANCE.md` — Definition of Done and regression gates
- `11_CURRENT_IMPLEMENTATION_INVENTORY.md` — snapshot of current implementation that informed these documents
- `12_REBUILD_AND_DELETION_PLAN.md` — safe sequence for backup, deletion and clean reconstruction
- `13_KNOWN_FAILURES_AND_GUARDRAILS.md` — defects already observed and rules that prevent recurrence
- `14_LEGACY_WORKSTREAM_DETAILS.md` — Rust/WASM/UE5/Blender/browser operational work that must be classified before cleanup

## 4. Critical interpretation rule

Terms such as `targetSpeed`, `laneTarget`, `pitState`, `avoid`, `racecraftIntent` describe **intent/state**, not permission to move the car directly.

Normal driving authority must flow through:

`world/track -> perception -> decision -> trajectory -> control inputs -> vehicle physics -> resulting motion`

A subsystem may request a target or constraint. It must not teleport or continuously rewrite physical position merely to satisfy that request.

## 5. Current source disposition

No deletion is authorized by the creation of this directory. The current project remains intact while these documents are reviewed.

Before deletion, `12_REBUILD_AND_DELETION_PLAN.md` requires:

- immutable backup/tag or archive;
- verification that all retained source assets are recoverable;
- a final documentation completeness audit;
- explicit retention/deletion manifest;
- ability to restore the exact pre-rebuild state.

## 6. Rebuild success criterion

A clean implementation is successful only if a developer with this document set, the retained source assets and no access to old behaviour code can reproduce the intended application and pass the acceptance suite.