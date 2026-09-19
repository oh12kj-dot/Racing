# Browser render assets

This folder is the stable home for optional visual-only GLB/GLTF assets used by the iPhone/browser spectator build.

Rules:

- Physics dimensions, race logic and collisions must never depend on the render mesh.
- Use generic/non-licensed racing designs.
- Prefer GLB with KTX2/Basis-compressed PBR textures.
- Provide LOD0/LOD1/LOD2 where practical.
- Vehicle pivots must be centred at ground-projected vehicle centre with +Z forward and +Y up before manifest offsets are applied.
- Keep wheel nodes named consistently if animated wheels are supplied.
- Missing or failed assets must fall back to the existing procedural vehicle/trackside renderers.

`manifest.json` maps simulation vehicle types to optional model files. An empty manifest is valid and keeps the current procedural renderer.
