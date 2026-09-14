# RUNTIME_STATUS.md — Active Browser/iPhone Runtime

Last updated: 2026-09-14
Status: **active product-facing browser runtime**

This file is the operational handoff for the currently deployed spectator app under `iphone-demo/`.

## Source-of-truth split

- `RUNTIME_STATUS.md` — current browser/iPhone runtime status and next work.
- `ARCHITECTURE.md` — current browser runtime architecture.
- `ARCHITECTURE_TARGET.md` — long-term Rust/headless + UE5 target architecture.
- `HANDOFF.md` / `TODO.md` — historical/current Rust/UE simulation-program workstream. They are **not** the browser runtime handoff.

When working on `iphone-demo/**`, read this file and `ARCHITECTURE.md` before the Rust/UE handoff documents.

## Current browser runtime

Application path:

`iphone-demo/app.js -> iphone-demo/runtime/index.js -> responsibility-named runtime services`

Current browser runtime includes race AI/presentation, weather, race control, pit state machine, camera director, radio/audio, visual quality management, diagnostics, procedural/GLB vehicle presentation and browser regression tests.

## 2026-09-14 audit remediation

Implemented on the audit-remediation branch:

1. Director events are queued instead of discarding simultaneous lower-priority events.
2. Pit-state movement/service no longer imports Suzuka constants directly; it resolves a circuit/world-owned runtime pit spec.
3. iOS lifecycle handling covers visibility/page suspension and WebGL context interruption/recovery.
4. Dedicated iPhone WebKit regression coverage is added alongside desktop Chromium coverage.
5. Formula/prototype/hyper/LMH procedural fallback silhouettes receive lightweight class-specific aero/detail polish.
6. Rendered-frame visual contracts attach screenshots and verify non-blank contrast/color diversity.
7. Production static packaging vendors approved CC0 GLBs at build time so deployed visual quality does not require runtime access to the asset CDN.
8. Rust workspace CI covers format, clippy, tests and wasm32 build.

Explicitly excluded by user request: **AUTO quality/thermal FPS policy**. Do not change that policy as part of this remediation.

## Browser runtime acceptance gates

Required before merge:

- Desktop Chromium browser regression passes.
- Dedicated iPhone WebKit lifecycle/resize regression passes.
- Pit runtime diagnostics report `runtime-pit-config-v1` and preserve current Suzuka merge/exit behavior.
- Simultaneous Director events remain queued and are consumed without loss.
- Runtime boot remains independent of optional render-asset success.
- Static production package contains local copies of approved GLB assets.
- Rust format/clippy/tests/wasm build pass when Rust paths are affected.

## Next visual-quality work

The next meaningful fidelity step is asset authoring, not more wrapper layers: class-correct, web-optimized Formula/Prototype/Hyper GLBs with LOD and compressed material maps. Until those assets are verified, the procedural fallback remains authoritative and must preserve simulation-owned dimensions.
