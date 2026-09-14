# Racing iPhone Runtime Audit Remediation — 2026-09-14

This file records implementation status for the findings in `AUDIT_2026-09-14.md`. The original audit remains unchanged as the historical finding set.

## Overall status

The high-risk runtime ownership problems are now substantially remediated. Pit movement/service and guardrail no-penetration are stable-runtime responsibilities, presentation services have been flattened into `runtime/`, browser regressions cover the reported pit/barrier cases, and optional graphical upgrades no longer block game startup.

## Finding status

1. **Pit ownership fragmentation — COMPLETE.** `runtime/pit-state.js` is the single movement/service/release owner. Different teams may service concurrently; a same-team second car queues. Legacy race code may still choose pit strategy but its old box-motion path is disabled during the compatibility update.

2. **Historical `vNN-*` dependency — MOSTLY COMPLETE.** Director, environment, camera, performance, settings, circuits, safety car and broadcast are stable runtime services. The mature World and Race simulation chains remain compatibility providers and are isolated behind `runtime/world.js` and `runtime/race.js`.

3. **Architecture documentation stale — COMPLETE.** `ARCHITECTURE.md` documents the active browser runtime; `ARCHITECTURE_TARGET.md` separately documents the long-term target.

4. **Browser/visual regression manual — COMPLETE FOR REPORTED FAILURES.** Playwright scenarios cover boot/render, guardrail cooldown re-entry, multi-team pit service, same-team double stack, safe pit release and wet/night PMREM switching. Golden-image artistic review remains a separate optional layer.

5. **Obsolete world geometry — PARTIAL / SAFE MITIGATION COMPLETE.** Runtime clean mode suppresses part of the obsolete construction, and `runtime/world-cleanup.js` now detaches and disposes superseded hidden pit render trees after final runtime geometry takes ownership. Fully preventing every historical world object from being constructed requires flattening the remaining World compatibility chain and is intentionally deferred until parity coverage is broader.

6. **Sky/reflection mismatch — COMPLETE.** Day, cloud, sunset, night and wet PMREM profiles are coupled to runtime weather/time. Profiles are generated lazily so software/mobile WebGL boot is not blocked by five synchronous PMREM conversions.

7. **Procedural asset ceiling — PARTIAL / MAJOR UPGRADE COMPLETE.** Optional CC0 GLBs are enabled for GT/touring/supercar classes plus pit/trackside props, with simulation dimensions independent of visual meshes. Formula/prototype retain procedural class-correct fallbacks rather than being replaced with the wrong silhouette.

8. **Low-resolution track detail — COMPLETE.** Stable surface-detail and rubber/braking layers supply higher-frequency road detail above the legacy base texture.

9. **Single shadow volume — ACCEPTED MOBILE DESIGN.** The shadow volume tracks the actual broadcast subject, materially increasing useful resolution. Heavy cascade expansion remains desktop-only future work if profiling justifies it.

10. **Quality adaptation lacks scene complexity — COMPLETE.** `runtime/quality-scene.js` applies scene/LOD complexity changes alongside cadence/DPR management.

11. **Three.js CDN boot dependency — COMPLETE FOR NORMAL LOCAL/DEPLOYED BUILDS.** `three@0.185.1` is pinned in `package.json`; runtime prefers the local npm package, then jsDelivr, then unpkg. GLTFLoader follows the same local-first policy. Optional remote GLBs are asynchronous and cannot block race startup.

12. **Pit camera variety — COMPLETE.** Pit coverage includes telephoto, pit-wall, overhead and garage three-quarter compositions.

13. **Selective post-processing — COMPLETE AS LIGHTWEIGHT POLICY.** Desktop/QUALITY uses selective emissive glow; iPhone avoids heavy global bloom/SSAO to preserve thermal headroom.

14. **Visual metadata in diagnostics — COMPLETE.** Runtime audit/diagnostics expose scene quality, PMREM state, glow, asset status, cleanup, shadow projection and renderer state.

## Reported guardrail penetration

**Fixed at the stable runtime boundary.** Collision/damage cooldown and physical separation are now independent. A car still overlapping a guardrail after the legacy physics update is separated every frame; persistent slide overlap transitions the spin recovery state rather than allowing the visual car to continue embedded in the barrier.

## Remaining migration work

The only large architectural migration intentionally left is flattening the mature World/Race compatibility chains. This is not required to fix the reported pit or guardrail behaviour. It should be done in smaller parity-protected slices so a cleanup refactor cannot reintroduce track, strategy or collision regressions.
