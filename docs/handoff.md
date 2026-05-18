# SunScan 3D reconstruction — handoff

**Date:** 2026-05-13
**Branch:** main
**Last commit:** `254b067`

## TL;DR

A 17-commit pass landed a Claude-driven "spec → procedural mesh → photo-textured atlas" reconstruction pipeline replacing the broken Hunyuan3D-2 image-to-3D path. The architecture is structurally complete and committed, but **does not currently produce a usable 3D model** for one critical reason: **the offscreen tile capture fails with a coordinate-frame mismatch**, which collapses the entire pipeline before it can run.

The user is dissatisfied with the quality ceiling of the spec/procedural approach even when it does run, and the recommended next direction is to **pivot to a DSM-driven deterministic reconstruction** that uses the Solar API's heightmap GeoTIFF as the actual measured roof geometry rather than asking an LLM to invent one.

## What was built (commits `87dec5e..254b067`)

A 15-task plan plus 4 post-merge fixes was executed end-to-end with TDD on the pure-function modules. 35 Vitest tests pass, build is clean, no `@fal-ai/client` references remain.

| Module | Purpose | Status |
|---|---|---|
| `src/lib/3d/buildingSpec.ts` | Zod schema, `FALLBACK_SPEC`, JSON-Schema export for Anthropic tool_use | Tested (7 tests) |
| `src/lib/3d/specWalls.ts` | Extrude OS footprint to walls | Tested (5 tests) |
| `src/lib/3d/specRoof.ts` | Gable / hip / mansard / flat / mixed roof builder | Tested (6 tests). Mixed routes to hip for 3+ planes. Normals forced upward. |
| `src/lib/3d/specFeatures.ts` | Parametric chimney / dormer / conservatory / garage primitives | Tested (8 tests). Rotation bug fixed across all 3 wall-aligned builders. |
| `src/lib/3d/specRenderer.ts` | Glues walls + roof + features, centers result, applies materials | Tested (5 tests) |
| `src/lib/3d/specTextureProjector.ts` | Wraps `textureRebaker.ts` with geometry-merge + coverage heuristic | Manual verify only |
| `src/lib/3d/stockTextures.ts` | Tileable PBR texture loader with 1×1 white fallback | Manual verify only |
| `src/lib/3d/buildingExtractor.ts` | Tile capture orchestrator. Modified to expose cameras + cropped geometry. Photos now stored as `DataTexture` (CPU-resident) | **Broken: see Critical Issue** |
| `src/lib/3d/multiViewCapture.ts` | Multi-view orbit; reads back pixels to CPU on each capture | Working |
| `src/lib/ai/buildingSpecAgent.ts` | Claude Sonnet 4.6 with forced `tool_use` + Zod retry-once | Tested (4 tests) |
| `src/app/api/report/[id]/reconstruction/spec/route.ts` | POST endpoint, SHA-256 input-hash cache in Supabase | Manual verify only |
| `src/components/SolarRoofViewer.tsx` | Reconstruction `useEffect` with Level 0-5 fallback. Hides tile backdrop when `reconstructedSource` is set. | **Pipeline fails — see below** |

## Critical Issue — pipeline does not run

When the user tested live, the browser console reported:

```
[recon] reconstruction pipeline failed
Error: No tile geometry inside the building footprint.
  Tile meshes: 52, tile tris: 103509.
  Tile world bbox: { min: [-1873.7, -2995.9, -333.5], max: [79.5, 81.1, 297.3] }.
  Prism bbox:      { min: [11.0, -5, 26.6],            max: [28.1, 23.1, 42.2] }.
  at reconstructBuilding (src/lib/3d/buildingExtractor.ts:278:13)
```

**Diagnosis.** The TilesRenderer in `src/lib/3d/offscreenTileScene.ts` registers only `GoogleCloudAuthPlugin` and never applies a local-frame transform. The tiles render at their native ECEF-derived coordinates (huge negative X/Y values), while the OS footprint prism is computed in local lat/lng-metres centred at the building (small positive coordinates). The two volumes don't intersect, so `cropMeshToPrism` returns zero triangles and `reconstructBuilding` throws.

The on-screen `Scene` component (also in `SolarRoofViewer.tsx`) renders Photorealistic Tiles correctly. Diffing its setup against `offscreenTileScene.ts` will reveal which plugin / matrix transform is missing offscreen. Likely candidates from `3d-tiles-renderer`:

- `tiles.setLatLonToYUp(lat, lng)` (if exposed) — orients tiles to a local YUp frame at the anchor
- A `TileCompressionPlugin` / `TilesFadePlugin` / similar that the on-screen viewer registers
- A manual `tiles.group.matrix` setup using `WGS84_ELLIPSOID.getEastNorthUpFrame(lat, lng)`

Without this fix, every reconstruction throws and `setReconstructedSource` never updates from the cached `reconstructedModelUrl`. The user sees stale state from a prior session.

## Quality ceiling of the spec/procedural approach (the deeper issue)

Even with tile capture working, the spec → procedural pipeline produces visually disappointing roofs for non-trivial UK domestic properties. Screenshot from `3A DOWNS WALK, PEACEHAVEN, BN10 7SN` (4 Solar segments: N 19°, S 40°, SW 8°, S 17°) showed:

- Walls correct (OS footprint extrusion works)
- Roof rendered as disconnected triangular fragments
- Photo textures partially projecting but onto badly-oriented faces

Root cause is architectural, not a bug:

1. **`buildRoof()` is not a real roof solver.** It doesn't resolve ridge intersections between non-parallel pitched planes on an arbitrary polygon footprint. `gable` and `flat` are exact; `hip`, `mansard`, `mixed` are visual approximations (acknowledged in `docs/superpowers/specs/2026-05-11-3d-reconstruction-design.md`).
2. **LLMs cannot output meshes at vertex precision.** Claude's role is to pick a `roof.type` enum and emit feature locations. The actual geometry comes from the procedural code. We've been asking the LLM to do the wrong job and the procedural code to do work it's not equipped for.

The user's expectation is "CAD-grade" output. From the current inputs (OS footprint + Solar API metadata + 4 photos), procedural reconstruction has a hard ceiling well below CAD-grade.

## Recommended pivot: DSM-driven reconstruction

We have a Solar API GeoTIFF (`dsmUrl`) that is essentially a LiDAR-grade heightmap of the property at ~0.1-0.5m per pixel. **This is the actual measured 3D shape of the roof.** The current code uses it only for the heatmap colour overlay and as a tertiary fallback mesh (`DsmMesh` component); it is the most valuable 3D source we have and we're under-using it.

A re-architected pipeline:

1. Fetch the DSM GeoTIFF (already fetched for the heatmap — reuse).
2. Inside the OS footprint, treat every pixel as a vertex at `(x_local, height, z_local)`.
3. Triangulate adjacent pixels → produces an exact 3D mesh of the actual roof.
4. Extrude walls from the OS footprint down to the eave height (detected as the DSM-minus-ground threshold along the footprint boundary, or simply the lowest DSM sample inside the building mask).
5. Snap mesh vertices to the Solar API `segmentMask` polygon boundaries → clean edges between roof planes.
6. Project the cropped Photorealistic Tile texture onto the resulting mesh → photo textures from the real building.
7. Use Claude only for what AI is actually good at:
   - Material classification ("brick / render / slate")
   - Feature labels for the report (chimney positions, dormer locations)
   - Quality verification ("does the satellite image agree with this mesh?")

This pipeline doesn't need the LLM to invent geometry. The geometry comes from measurements. The LLM becomes an annotator, which is what it's good at.

## What to keep, what to remove if pivoting

**Keep (still useful):**
- `src/lib/3d/buildingSpec.ts` — repurposable for the annotation pass (material / feature labels)
- `src/lib/ai/buildingSpecAgent.ts` — repurposable; the agent contract remains valid for a smaller scope
- `src/lib/3d/textureRebaker.ts` — projects photos onto any mesh; will be reused
- `src/lib/3d/footprintPrism.ts`, `meshCropper.ts`, `multiViewCapture.ts`, `offscreenTileScene.ts` — tile capture infrastructure still valuable for the texture step
- `src/lib/3d/glbExporter.ts` — needed regardless
- Vitest setup, `src/lib/3d/__tests__/*` — the geometry tests stay valid
- `src/app/api/report/[id]/reconstruction/route.ts` — GLB persistence endpoint

**Becomes dead code on a full pivot:**
- `src/lib/3d/specWalls.ts` — wall extrusion will be done in the DSM pipeline; this version is fine but redundant
- `src/lib/3d/specRoof.ts` — superseded by DSM heightmap meshification
- `src/lib/3d/specRenderer.ts` — orchestration goes away
- `src/lib/3d/specTextureProjector.ts` — replaced by the DSM-mesh + tile-projection version
- `src/lib/3d/stockTextures.ts` — only useful as a fallback; revisit later
- `src/app/api/report/[id]/reconstruction/spec/route.ts` — agent role shrinks; this route may stay for annotations or be repurposed

**Whether to commit the pivot to git as "delete first then rebuild" or "build alongside then switch" is a strategic call.** The cleaner answer is to keep the spec path in tree but unwired until the DSM pipeline reaches parity, then delete in one commit.

## How to verify the current state

```bash
git checkout 254b067
npm install
npm test                          # 35/35 pass
npx tsc --noEmit                  # clean
npm run build                     # passes
npm run dev                       # works, but reconstruction fails at runtime per Critical Issue
```

Console logs to watch for in the browser:
- `[recon] spec generated { source, cached, confidence }` — means spec pipeline reached the LLM step (currently never seen because tile capture throws first)
- `[recon] reconstruction pipeline failed` followed by `No tile geometry inside the building footprint` — current behaviour

## Pre-existing related code to be aware of

These files are tracked but were authored in the prior `revamp-3d-photorealistic-tiles` branch — they're load-bearing for both the current spec pipeline and any future DSM pipeline:

- `src/lib/solar/solarApiMapper.ts` — `buildSolar3DModel` already does some of the geometric conversion. Worth reading.
- `src/lib/solar/panelPlacementService.ts` — overlays panel layouts on the 3D model
- `src/components/solar/ReconstructedModelView.tsx` — generic GLB viewer, source-agnostic. Reusable.
- `DsmMesh` (inside `SolarRoofViewer.tsx`) — already meshifies the DSM heightmap as the Level 4 fallback. **This is most of the DSM-driven approach already implemented**, just running only as a fallback. Promoting it to primary is a substantial part of the pivot.

## Documents in this directory

- `docs/superpowers/specs/2026-05-11-3d-reconstruction-design.md` — the original design (still useful as architectural context)
- `docs/superpowers/plans/2026-05-11-3d-reconstruction.md` — the 15-task plan (executed; reference for the work that was done)
- `docs/superpowers/specs/2026-05-12-3d-reconstruction-smoke-test.md` — manual smoke-test checklist (still valid)
- This file

## Open questions for the next session

1. Commit to the DSM-driven pivot or attempt to fix the spec pipeline's procedural roof solver? The first delivers a much better result for substantially less code; the second preserves more of what was built.
2. Should the AI agent be retained for material classification / feature annotations, or removed entirely for simplicity? Retaining adds ~$0.04 per reconstruction and one external dependency; the report quality gain is real but not load-bearing.
3. Coordinate-frame fix for the offscreen tile scene is needed for either path (the texture-projection step in the DSM pivot still needs working tile captures). Diff against the on-screen `Scene` component's `TilesRenderer` setup is the place to start.
4. Should the cropped Photorealistic Tile mesh be ever shown as the "Level 3 fallback" in the new architecture, or is the DSM-mesh + tile-texture composition the only output?

## Environment variables required

| Variable | Status | Purpose |
|---|---|---|
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | required | Photorealistic 3D Tiles |
| `GOOGLE_SOLAR_API_KEY` | required for DSM-driven path | Solar API: roof segments + DSM + segmentMask + RGB |
| `ANTHROPIC_API_KEY` | optional in DSM-driven path | Material / feature annotation only |
| `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | required | GLB and spec cache storage |
| `OS_API_KEY` | required | OS Places + OS NGD footprint |
| `MISTRAL_API_KEY` | required | Bill OCR (unrelated to 3D) |
| `DATABASE_URL` + `DIRECT_URL` | required | Prisma / Postgres |
