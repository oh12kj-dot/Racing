# Racing v42 code audit — superseded

This document described the v42 transition state and is retained only as historical context.

The active application architecture has since moved to the stable `iphone-demo/runtime/` layer. The current source of truth is:

- `RUNTIME_CODE_AUDIT.md`
- `runtime/index.js`
- `runtime/config.js`

Important changes since the original v42 audit:

- diagnostics are no longer memory-only; they use bounded generation rotation so previous runs can be diagnosed after an app restart
- `app.js` no longer imports a collection of versioned runtime modules directly
- radio PTT, mixer controls, pit-merge geometry and diagnostics live under the stable runtime layer
- normal feature work should update `runtime/` instead of creating another `vNN-*` wrapper
