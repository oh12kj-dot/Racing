# Racing iPhone Runtime Audit Remediation — 2026-09-14

This file records implementation status for the findings in `AUDIT_2026-09-14.md`. The original audit remains unchanged as the historical finding set.

## Overall status

The high-risk runtime ownership problems are remediated. Pit movement/service and guardrail no-penetration are stable-runtime responsibilities, presentation services and the full Race/World implementation stack are owned by `runtime/`, browser regressions cover the reported pit/barrier cases, and optional graphical upgrades no longer block game startup.

## Finding status

1. **Pit ownership fragmentation — COMPLETE.** `runtime/pit-state.js` is the single movement/service/release owner. Different teams may service concurrently; a same-team second car queues. Strategy may still request a pit stop, but the older box-motion path is disabled during the stable runtime update.

2. **Historical `vNN-*` dependency — COMPLETE FOR IMPLEMENTATION OWNERSHIP.** Race and World implementation from the former numbered chains, including their foundational cores, now lives in responsibility-named `runtime/` modules. Remaining `runtime/vNN-*` and external `iphone-demo/vNN-*` files on the active path are one-line bridge/shim files only. Browser regression prevents external historical Race/World implementations from re-entering the active path.

3. **Architecture documentation stale — COMPLETE.** `ARCHITECTURE.md` documents the active browser runtime; `ARCHITECTURE_TARGET.md` separately documents the long-term Rust/headless target.

4. **Browser/visual regression manual — COMPLETE FOR REPORTED FAILURES.** Playwright scenarios cover boot/render, guardrail cooldown re-entry, multi-team pit service, same-team double stack, safe pit release, wet/night PMREM switching, stable UI and historical implementation-load regression. Golden-image artistic review remains a separate optional layer.

5. **Obsolete world geometry — COMPLETE FOR KNOWN SUPERSEDED GEOMETRY.** Clean runtime suppresses superseded V38 barrier construction and the superseded V41 pit visual complex at source. `runtime/world-cleanup.js` detaches/disposes any remaining inactive render trees after final runtime geometry takes ownership. The world implementation itself is now runtime-owned, so future construction optimization no longer requires editing a historical provider chain.

6. **Sky/reflection mismatch — COMPLETE.** Day, cloud, sunset, night and wet PMREM profiles are coupled to runtime weather/time. Profiles are generated lazily so software/mobile WebGL boot is not blocked by five synchronous PMREM conversions.

7. **Procedural asset ceiling — PARTIAL / MAJOR UPGRADE COMPLETE.** Optional CC0 GLBs are enabled for GT/touring/supercar classes plus pit/trackside props, with simulation dimensions independent of visual meshes. Formula/prototype/hyper classes retain the procedural fallback until class-correct CC0 assets are verified; using an incorrect silhouette solely to remove the fallback is not acceptable.

8. **Low-resolution track detail — COMPLETE.** Stable surface-detail and rubber/braking layers supply higher-frequency road detail above the base texture.

9. **Single shadow volume — ACCEPTED MOBILE DESIGN.** The shadow volume tracks the actual broadcast subject, materially increasing useful resolution. Heavy cascade expansion remains desktop-only future work if profiling justifies it.

10. **Quality adaptation lacks scene complexity — COMPLETE.** `runtime/quality-scene.js` applies scene/LOD complexity changes alongside cadence/DPR management.

11. **Three.js CDN boot dependency — COMPLETE FOR NORMAL LOCAL/DEPLOYED BUILDS.** `three@0.185.1` is pinned in `package.json`; runtime prefers the local npm package, then jsDelivr, then unpkg. GLTFLoader follows the same local-first policy. Optional remote GLBs are asynchronous and cannot block race startup.

12. **Pit camera variety — COMPLETE.** Pit coverage includes telephoto, pit-wall, overhead and garage three-quarter compositions.

13. **Selective post-processing — COMPLETE AS LIGHTWEIGHT POLICY.** Desktop/QUALITY uses selective emissive glow; iPhone avoids heavy global bloom/SSAO to preserve thermal headroom.

14. **Visual metadata in diagnostics — COMPLETE.** Runtime audit/diagnostics expose scene quality, PMREM state, glow, asset status, cleanup, shadow projection and renderer state.

## Reported guardrail penetration

**Fixed at the stable runtime boundary.** Collision/damage cooldown and physical separation are independent. A car still overlapping a guardrail after the physics update is separated every frame; persistent slide overlap transitions the spin recovery state rather than allowing the visual car to continue embedded in the barrier.

## Remaining work

The historical Race/World implementation migration is complete. Remaining architectural work is optional bridge cleanup and responsibility-driven splitting of large stable modules, protected by the existing regression suite.

The main visual-quality gap that remains from the audit is class-correct render-asset coverage for Formula/prototype/hyper vehicles. The procedural models remain the safe fallback until verified CC0 assets with the right silhouette and web performance profile are available.
