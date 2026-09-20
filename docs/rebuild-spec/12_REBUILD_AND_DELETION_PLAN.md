# 12 — Rebuild and Deletion Plan

## 1. Scope of this document

This is the required sequence for eventually replacing the existing implementation with a clean build.

**Current status: documentation phase only. No source deletion is authorized yet.**

## 2. Safety rule

Never perform destructive cleanup without two independent recovery paths:

1. Git reference to the exact pre-rebuild commit/tag/branch;
2. separate archive/export containing source assets and the repository snapshot.

A clean working tree is not a backup.

## 3. Phase A — Freeze the baseline

Before any deletion:

1. choose the exact pre-rebuild commit;
2. create an immutable tag such as `pre-clean-rebuild-YYYY-MM-DD`;
3. verify tag resolves to expected commit;
4. create a separate archive/export outside the working project directory;
5. record hash/date/location of archive;
6. verify archive can be opened/restored.

The current documentation was drafted against:

`master@ead10321a70c26623748894067391d6e4d90cf42`

If master changes before deletion, re-audit changes and update this specification or explicitly freeze this older baseline.

## 4. Phase B — Complete manifest

Generate a full repository manifest recursively.

Required columns:

- path;
- type;
- byte size;
- content hash/SHA;
- generated?;
- source asset?;
- licensed/external?;
- required feature mapping;
- disposition: `KEEP_SOURCE_ASSET`, `KEEP_DOC`, `ARCHIVE_ONLY`, `DELETE_AFTER_BACKUP`, `UNKNOWN`;
- reason.

`UNKNOWN` count must be zero before deletion.

## 5. Phase C — Documentation completeness audit

For every current feature/module/test, answer:

- What user-visible capability does it provide?
- Is that capability required by the clean product?
- Which rebuild document specifies it?
- Which acceptance test will prove it?
- Is there source data/asset that cannot be regenerated?

Do not preserve implementation simply because no one understands it. First classify it.

## 6. Phase D — Retention set

Recommended minimal retained set inside the clean project:

```text
docs/rebuild-spec/
assets_source/        # only original/non-regenerable assets selected by manifest
LICENSES/             # asset/code license records where required
```

Optionally retain seed data/specification files only after validating that they are not behavioural legacy code.

Do not initially retain old runtime source “for reference” inside the clean tree. It encourages accidental copying. Keep it available through the archival tag/repository history instead.

## 7. Phase E — Delete old implementation from clean branch only

Perform deletion on a dedicated rebuild branch, never by destroying the only copy.

Delete categories after manifest approval:

- old application source;
- old simulation implementation;
- compatibility wrappers/shims;
- generated build output;
- old tests that reference discarded architecture;
- obsolete configuration;
- temporary/debug artifacts;
- vendored dependencies that can be restored from package/lock data, unless licensing/offline requirements say otherwise.

Retain only the approved document/source-asset set.

## 8. Phase F — Bootstrap clean repository structure

Create only the architecture required by `02_TARGET_ARCHITECTURE.md`.

Recommended order:

1. config/schema/data types;
2. deterministic clock/RNG;
3. track geometry/corridor;
4. vehicle physics;
5. single-car driver/controller;
6. timing/progress;
7. perception/spatial query;
8. racecraft/trajectory arbitration;
9. collision/incidents;
10. race control/start/finish;
11. pit system;
12. strategy;
13. presentation bridge;
14. world/render/camera/UI/audio;
15. performance adaptation;
16. extended content.

## 9. Phase G — Vertical milestones

### Milestone 1: one physical car

One car completes repeated laps from steering/throttle/brake without transform snapping.

### Milestone 2: two-car traffic

Following, passing and safe side-by-side scenarios work.

### Milestone 3: field race

24-car start/race/timing stable without pit complexity.

### Milestone 4: incidents/race control

Contacts, hazards, caution and recovery stable.

### Milestone 5: physical pit

Full approach/service/release/merge path passes all pit scenarios.

### Milestone 6: presentation

Broadcast cameras/UI/audio consume simulation snapshots.

### Milestone 7: iPhone/performance

Mobile/browser quality and performance targets validated.

Do not advance by hiding a failing milestone under later presentation logic.

## 10. Clean implementation rule

During reconstruction, engineers/agents should normally read:

- this specification directory;
- retained source asset/data documentation;
- new implementation being built.

They should not use old behavioural code as a copy source.

If a feature appears underspecified, consult the archived implementation only to discover missing **requirements**, then update the specification first. Do not paste old code directly into the clean build.

## 11. Root-cause rule

When a clean-build test fails:

1. observe/reproduce;
2. identify authoritative owner;
3. determine root cause;
4. make the smallest architectural fix;
5. add/strengthen regression;
6. rerun adjacent scenarios;
7. update documentation if behaviour contract changed.

Forbidden response patterns:

- add coordinate correction to hide trajectory defect;
- add arbitrary speed clamp to hide traffic defect;
- add another lane writer to compensate for existing writer;
- bypass physical pit route;
- weaken acceptance threshold merely to make CI green without justification.

## 12. Commit/branch strategy

Recommended:

- preserve `master`/tag with old system until clean rebuild proves parity;
- perform reconstruction on `clean-rebuild` branch;
- merge only milestone-sized, testable changes;
- keep architecture/spec changes reviewable separately from behavioural changes where possible.

## 13. Old/new comparison

After a clean subsystem is complete, compare against archived version for **capability coverage**, not implementation similarity.

Checklist:

- any UI/camera/audio feature missing?
- any race-control/pit edge case missing?
- any data/asset missing?
- any useful regression test not recreated?

If old behaviour conflicts with the clean specification, the new specification wins and the difference is documented.

## 14. Final cutover gate

The old implementation may be considered obsolete only when:

- all required capabilities map to new implementation;
- all CRITICAL/HIGH acceptance tests pass;
- 60-minute stability passes;
- key racecraft and pit scenarios pass;
- desktop + iPhone/WebKit pass;
- performance is within accepted budget;
- source asset/license audit is complete;
- restoration of old version has already been tested;
- human approval confirms cutover.

## 15. What must happen next

Before any future request to “delete everything except the docs,” perform **Phase A–C first** against the then-current repository state. If the repository changed after this documentation snapshot, update the inventory/specification before deletion.