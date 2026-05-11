# Spec-Driven 3D Building Reconstruction

**Date:** 2026-05-11
**Status:** Approved design, ready for implementation planning
**Replaces:** Hunyuan3D-2 image-to-3D ML reconstruction pipeline

## Problem

The current reconstructed model shown in `SolarRoofViewer.tsx` is unreliable. After the offscreen Photorealistic-Tiles capture and OS-footprint crop produce a real, textured mesh of the building (the "local v2 GLB"), the pipeline sends 4 isolated photos to `fal-ai/hunyuan3d/v2/multi-view` and replaces the working mesh with whatever the image-to-3D model returns. In practice that output is frequently a malformed dark blob bearing no resemblance to a house — and it overwrites the perfectly serviceable cropped tile mesh that was already on screen.

The image-to-3D model invents geometry from pixels. We already have authoritative geometric data (OS NGD footprint, Google Solar API roof segments, eave-height estimate, 4 cardinal photos). The replacement architecture uses that data deterministically and uses an LLM only for the things photos uniquely tell us: features (chimneys, dormers, conservatory, garage), wall/roof materials, and roof topology when the Solar API is ambiguous.

## Goals

1. **Recognisable building, every time.** The user sees something that looks like their actual house, not a blob.
2. **Photo-textured, top-fidelity output.** Walls and roof carry actual photographic texture of the actual house. Features (chimneys, dormers, conservatory, garage) are positioned accurately and visible.
3. **Bounded latency.** End-to-end reconstruction under 60 s on Vercel Pro. Optimistic preview within 5 s.
4. **Graceful degradation.** Every failure mode falls back to a still-useful output. No black blobs, no error toasts, no empty viewers.
5. **No new infrastructure beyond one env var.** `ANTHROPIC_API_KEY` is the only addition. `FAL_KEY` is removed.

## Non-goals

- Sub-metre geometric accuracy. This is for visualisation in a solar report, not for engineering.
- Editable parametric output. The agent does not emit code; it emits a JSON spec consumed by a fixed renderer.
- Perfect hip/mansard/mixed roofs. Gable and flat are exact; others are good visual approximations.
- Animated or interactive features (no opening doors, no swinging signs).
- Multi-building lots. One building per reconstruction, identified by the OS footprint polygon.

## Architecture overview

Five-phase pipeline. Phase 1 reuses existing capture code with small modifications. Phases 2-4 are new. Phase 5 reuses the existing persistence route.

```
┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 1 — Capture (modified buildingExtractor.ts)                    │
│  Offscreen Photorealistic Tiles scene → wait for LOD settle →        │
│  capture 4 cardinal photos (S/E/N/W) at drone-eye altitude →         │
│  crop tile mesh to OS footprint (keep for fallback & masking) →      │
│  expose photos + camera matrices to the caller                       │
└────────────────────────────┬─────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 2 — Agent spec generation (NEW)                                │
│  POST /api/report/[id]/reconstruction/spec                           │
│  Body: 3 photos + footprint + roofSegments + eaveHeight + dimensions │
│  Action: single Claude Sonnet 4.6 vision call, forced tool_use of    │
│          emit_building_spec; Zod-validated; cached by input hash     │
│  Response: { spec: BuildingSpec } in ~8-15 s                         │
└────────────────────────────┬─────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 3 — Procedural assembly (NEW)                                  │
│  specRenderer.ts — pure (spec, footprint) → THREE.Group              │
│  Walls extruded from footprint to eaveHeight; roof planes resolved   │
│  from spec.roof.planes anchored to footprint edges; features         │
│  (chimney/dormer/conservatory/garage) attached as parametric         │
│  primitives; materials assigned from spec.materials                  │
└────────────────────────────┬─────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 4 — Texture projection (NEW, reuses textureRebaker.ts)         │
│  Per-face source selection: argmax dot(normal, -viewDir) * coverage  │
│  UV-projection through chosen camera; visibility-masked against the  │
│  cropped tile mesh to reject neighbour pixels; rebaker bakes a       │
│  unified 2048² atlas. Low-coverage faces fall back to tinted stock   │
│  tileable textures.                                                  │
└────────────────────────────┬─────────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PHASE 5 — Export & persist (existing route)                          │
│  GLTFExporter → Blob → POST /api/report/[id]/reconstruction →        │
│  Supabase Storage → signed URL → Report.reconstructedModelUrl        │
└──────────────────────────────────────────────────────────────────────┘
```

### Coordinate convention

Used throughout the spec, renderer, and viewer:

- Origin at footprint centroid (lat, lng of the building).
- `+x = east`, `+z = south`, `+y = up`. Matches the existing `SolarRoofViewer` convention.
- All distances in metres; all azimuths in MCS convention (0° = S, 90° = E, 180° = N, 270° = W) to match `solarCalculations.ts`.

## The BuildingSpec schema

This is the single contract between the LLM and the renderer. Zod-validated on the server. Failed parses retry once, then fall back to a deterministic spec.

```typescript
// src/lib/3d/buildingSpec.ts

export interface BuildingSpec {
  // ── Massing ──
  eaveHeightM: number              // clamped to [2.5, 15]

  // ── Roof topology ──
  roof: {
    type: 'gable' | 'hip' | 'mansard' | 'flat' | 'mixed'
    planes: Array<{
      footprintEdgeIndex: number     // index into footprint ring; this is the
                                     // bottom edge of this roof plane
      pitchDeg: number               // clamped to [0, 60]
      azimuthDeg: number             // MCS convention
      ridgeSharedWithPlaneIndex?: number
    }>
  }

  // ── Features (LLM-extracted from photos) ──
  features: {
    chimneys: Array<{
      x: number; z: number           // local coords; clamped to footprint bbox
      widthM: number                 // clamped to [0.5, 2.5]
      depthM: number                 // clamped to [0.5, 2.5]
      heightAboveRoofM: number       // clamped to [0.3, 3.0]
    }>
    dormers: Array<{
      footprintEdgeIndex: number
      offsetAlongEdgeM: number
      widthM: number                 // clamped to [0.8, edgeLength - 0.4]
      heightM: number                // clamped to [0.8, 2.5]
      projectionM: number            // clamped to [0.3, 2.0]
      roofType: 'gable' | 'hip' | 'flat'
    }>
    conservatory?: {
      footprintEdgeIndex: number
      offsetAlongEdgeM: number
      widthM: number                 // clamped to [2, 6]
      depthM: number                 // clamped to [2, 6]
      heightM: number                // clamped to [2, 4]
    }
    garage?: {
      footprintEdgeIndex: number
      offsetAlongEdgeM: number
      widthM: number                 // clamped to [2.5, 7]
      depthM: number                 // clamped to [3, 8]
      heightM: number                // clamped to [2.2, 4]
      attachment: 'attached' | 'detached'
    }
  }

  // ── Materials ──
  materials: {
    wallColor: `#${string}`          // hex sampled by LLM from photos
    roofColor: `#${string}`
    wallTexture: 'brick' | 'render' | 'stone' | 'timber' | 'pebble-dash' | 'mixed'
    roofTexture: 'tile' | 'slate' | 'thatch' | 'metal' | 'flat-felt'
  }

  // ── Meta ──
  confidence: 'high' | 'medium' | 'low'
  notes?: string                     // free-form, dev-only debug surface
}
```

The schema's central property: **the LLM never emits raw 3D vertex coordinates.** Everything is relative to the OS footprint polygon — by edge index, by offset along an edge, or by `(x, z)` inside the footprint bbox. The renderer holds all 3D geometric responsibility. This is what prevents the kind of failure the Hunyuan path produced.

### `FALLBACK_SPEC`

A deterministic default spec returned by the API route when the LLM call fails or is unavailable. The renderer can produce a usable building from this alone — that's Level 2 of the fallback chain.

```typescript
const FALLBACK_SPEC: BuildingSpec = {
  eaveHeightM: 5.8,                  // overridden with the real estimate at call site
  roof: {
    type: 'gable',
    planes: [/* derived from Solar API segments if present, else single gable along longest footprint axis */],
  },
  features: { chimneys: [], dormers: [] },
  materials: {
    wallColor: '#cccccc',
    roofColor: '#7a5a3a',
    wallTexture: 'render',
    roofTexture: 'tile',
  },
  confidence: 'low',
  notes: 'Fallback spec — LLM unavailable or invalid response.',
}
```

## The AI agent call

Server-side only. One LLM call per reconstruction. `ANTHROPIC_API_KEY` never reaches the client.

### Endpoint

`POST /api/report/[id]/reconstruction/spec`

Multipart body:
- `front`, `right`, `back` — PNG blobs (3 cardinal captures, ~1024² each)
- `footprint` — JSON: `[[lng, lat], ...]` ring
- `roofSegments` — JSON: `[{ pitchDeg, azimuthDeg, areaM2, centerLng, centerLat }, ...]` or `[]`
- `eaveHeightM` — number
- `dimensionsM` — `{ x, y, z }` real-world bbox

Response: `{ spec: BuildingSpec }` (always, even on fallback to FALLBACK_SPEC), or `{ error }` with 502/503 for unrecoverable failures.

`maxDuration = 60`, `runtime = 'nodejs'`.

### Tool-use forcing

```typescript
import Anthropic from '@anthropic-ai/sdk'

const buildingSpecTool: Anthropic.Tool = {
  name: 'emit_building_spec',
  description: 'Emit a structured BuildingSpec for this property.',
  input_schema: zodToJsonSchema(BuildingSpecSchema),
}

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 4096,
  tools: [buildingSpecTool],
  tool_choice: { type: 'tool', name: 'emit_building_spec' },   // forced
  system: BUILDING_SPEC_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: [textContext, ...imageBlocks] }],
})

const toolUse = response.content.find(b => b.type === 'tool_use')
const spec = BuildingSpecSchema.parse(toolUse.input)
```

`tool_choice: { type: 'tool', name: '...' }` forces Claude to call exactly this tool. It cannot reply in prose. Bad inputs still get a spec (possibly low-confidence), which the renderer can absorb.

### Context block sent with the photos

```
You are reconstructing a 3D model of a UK residential property from aerial
photos and known geometric data.

FOOTPRINT (Ordnance Survey, authoritative):
  Edge 0: 8.3m, bearing 92° (E)
  Edge 1: 11.2m, bearing 182° (S)
  Edge 2: 8.4m, bearing 272° (W)
  Edge 3: 11.1m, bearing 2° (N)
  (closes back to edge 0)

GOOGLE SOLAR API ROOF SEGMENTS (primary source for roof planes):
  Segment 0: pitch 19°, azimuth 0° (N), area 157 m²
  Segment 1: pitch 40°, azimuth 0° (S, MCS), area 40 m²
  Segment 2: pitch 8°, azimuth 45° (SW), area 17 m²
  Segment 3: pitch 17°, azimuth 0° (S), area 13 m²

EAVE HEIGHT ESTIMATE: 5.8 m
BUILDING BBOX: 12.3 × 7.1 × 9.2 m

PHOTOS (3 cardinal-view drone-eye captures at ~14 m radius):
  • Photo 1 — camera at SOUTH, looking NORTH (shows south face)
  • Photo 2 — camera at EAST,  looking WEST  (shows east face)
  • Photo 3 — camera at NORTH, looking SOUTH (shows north face)

YOUR JOB:
1. From footprint + Solar segments, decide roof topology and which
   footprint edge each plane sits on.
2. From photos, identify chimneys, dormers, conservatory, garage. Use
   realistic UK domestic scales.
3. From photos, sample dominant wall and roof colour (hex) and classify
   material family.
4. Emit one call to emit_building_spec.

Rules:
- Never invent geometry not supported by footprint or visible features.
- If Solar segments conflict with photos, trust the photos.
- If a feature is ambiguous, omit it. Empty arrays are correct.
- Origin = footprint centroid. +x east, +z south. Metres.
- Confidence: 'high' if all signals agree; 'medium' on conflict;
  'low' on obstructions or imprecise feature locations.
```

### Cost and latency

- Vision input: 3 × ~1024² PNG ≈ 4,500 input tokens
- Context text: ~600 tokens
- Output (tool input): ~400 tokens
- Per-call cost: **~$0.03-0.05** at Sonnet 4.6 list price
- End-to-end latency: **~8-15 s** dominated by inference

### Caching

Cache key:
```
sha256(footprintRing + sortedRoofSegments + eaveHeightM + photoSha256s)
```

Stored in Supabase Storage at `sunscan-reports/specs/{cacheKey}.json` with a 30-day signed URL. The API route checks cache first; cache hit skips the Anthropic call entirely. Same address → same cache key → free + instant on second load.

### Failure handling on the server

| Failure | Response |
|---|---|
| Schema validation fails after one retry | 200 with `FALLBACK_SPEC` (Level 2 client-side) |
| Anthropic API 5xx or timeout | 502; client falls back to cropped tile mesh |
| `ANTHROPIC_API_KEY` missing | 503; client falls back to cropped tile mesh |
| Multipart body malformed | 400 |

The retry-once is purely on schema-validation failures — if Claude returns a JSON object that fails Zod, we make one more call with the validation error in the system prompt. Two strikes → fallback.

## The procedural renderer

Pure functions of `(spec, footprintLocal) → THREE.Group`. No async, no network, no GPU. Trivial to unit test.

### Pipeline

```
1. Validate & clamp the spec
   Every numeric field clamped to its realistic range; clamp violations
   logged as debug warnings for prompt tuning.

2. Build walls — buildWalls(footprintLocal, eaveHeightM)
   One quad per footprint edge. Bottom edge at y=0, top at y=eaveHeightM.
   Each wall face emits faceMeta: { edgeIndex, normal, bbox, kind:'wall' }.

3. Build roof — buildRoof(footprintLocal, spec.roof, eaveHeightM)
   For each plane:
     - Anchor bottom edge to footprintEdgeIndex.
     - Extrude upward at pitchDeg toward the footprint interior in the
       direction opposite to the wall's outward normal.
   Resolve adjacent planes:
     - 'gable':   pair planes; each pair shares one ridge line.
       Triangular gable infill at the gable ends.
     - 'hip':     all 4+ planes meet at apex point(s).
     - 'mansard': two-tier — lower steep planes + upper shallow planes
       sharing the eave-level break line.
     - 'flat':    single horizontal cap at eaveHeightM + 0.3m parapet.
     - 'mixed':   render each plane independently; any holes filled with
       a generic gable at the average pitch.
   Each roof face emits faceMeta: { planeIndex, normal, bbox, kind:'roof' }.

4. Build features — specFeatures.ts
   chimney:      vertical box rising from nearest roof plane
   dormer:       box poking out of named wall + its own little roof
   conservatory: glass-material box attached to named wall edge
   garage:       solid box; shares wall if 'attached', else 0.5m gap

5. Apply materials
   walls:        MeshStandardMaterial tinted spec.materials.wallColor
   roof:         MeshStandardMaterial tinted spec.materials.roofColor
   conservatory: MeshPhysicalMaterial { transmission: 0.7 }
   userData.textureFamily on each material — consumed by Phase 4

6. Centre at origin
   Translate so footprint centroid is at (0,0,0) and y_min = 0.
```

### Why this can't produce a blob

- Walls extruded from the OS footprint polygon — authoritative geometry, not LLM output. Walls are always correctly shaped, even if every other field in the spec is junk.
- Roof planes anchored to footprint edges with clamped pitches. Worst case: roof type slightly wrong, but it still sits on the building.
- Features clamped before geometry is built.
- An empty `features: {}` plus `roof.type: 'gable'` still yields a recognisable house.

### Renderer-level failure modes

| Spec problem | Renderer behaviour |
|---|---|
| `footprintEdgeIndex` out of range | Skip the plane/feature; log warning |
| Two planes claim the same edge | Keep the first, drop the rest |
| Planes don't form a closed shape | Fill missing edges with a generic gable at average pitch |
| Conservatory and garage overlap | Stack along the edge by offset; if true overlap, garage wins |
| Dormer wider than its host wall | Clamp width to wall length − 0.4 m |

### Scope ceiling on roof topology

- `gable` and `flat`: exact.
- `hip`, `mansard`, `mixed`: visual approximations that look right but are not strict CAD-grade.

Acceptable because this is for a solar report's hero image, not for engineering. If results disappoint, the renderer can be sharpened later without changing the spec contract.

## Texture projection

Reuses `src/lib/3d/textureRebaker.ts` — the existing module designed for projecting multi-view captures onto an arbitrary mesh.

### Per-face source selection

For each face F in the procedural mesh:

1. Compute view-quality score per photo:
   ```
   score(photo_i) = max(0, dot(F.normal, -cam_i.viewDirAtF)) * visibility_i
   ```
   where `visibility_i` is the fraction of F's corners that land inside `cam_i`'s NDC frustum.

2. Assign F a **primary** photo (argmax score) and a **secondary** photo (next-best). The rebaker blends between them on edge seams.

3. Generate F's UVs by projecting its vertices through the primary photo's view-projection matrix into image space. UVs clamped to [0,1] — out-of-range pixels fall back to the flat tint.

### Atlas rebake

`textureRebaker.ts` (existing) takes `(geometry, captures[], atlasSize)` and produces `{ geometry, material }` with a baked 2048² atlas. The existing module already handles seam blending, exposure normalisation across photos, and atlas packing. Our work is roughly 20-50 lines of adapter code in `specTextureProjector.ts` to feed the procedural mesh + camera matrices into it.

### Visibility masking against the cropped tile mesh

Prevents neighbour-house pixels bleeding onto our walls. For each photo pixel about to be back-projected:

1. Cast a ray from the camera through the pixel into world space.
2. If the ray's first intersection with the cropped tile mesh is *not* on our procedural face (or fails to intersect entirely), reject the pixel.

The cropped tile mesh is already kept in memory through Phase 4 for exactly this purpose. ~2 MB. Same trick the existing `buildingMasker.ts` uses for the Hunyuan path — but the rebaker integrates it natively instead of pre-masking the photos.

### Low-coverage fallback

If after projection a face has <30% of its area covered by accepted pixels, it falls back to a flat tinted material with an optional stock tileable PBR texture from `/public/textures/`:

```
public/textures/
  brick-tileable.jpg
  render-tileable.jpg
  stone-tileable.jpg
  timber-tileable.jpg
  pebble-dash-tileable.jpg
  tile-tileable.jpg
  slate-tileable.jpg
  thatch-tileable.jpg
  metal-tileable.jpg
```

Each is 512², ~80 KB. Total ~700 KB bundled in `/public`. Tinted at render time by `material.color` from `spec.materials.wallColor` / `roofColor`.

### Output

- One unified material with a 2048² atlas for most faces.
- Optional stock-texture material for low-coverage faces.
- Feature meshes (chimney/conservatory/garage) keep flat colours — small surfaces and unreliable projection.

GLB output size: **1-2 MB** per building. Under the existing 25 MB cap on `/api/report/[id]/reconstruction`.

## Fallback chain

The principle: the user never sees a black blob, an error toast, or an empty viewer. Every failure has a graceful degradation that still shows something recognisable.

```
LEVEL 0 — Photo-textured spec mesh                       (happy path)
LEVEL 1 — Spec mesh with stock tileable textures         (low photo coverage)
LEVEL 2 — Skeleton spec mesh (FALLBACK_SPEC)             (LLM failed)
LEVEL 3 — Raw cropped tile mesh                          (renderer failed)
LEVEL 4 — Google Solar DSM heightmap mesh                (tile capture failed)
LEVEL 5 — Empty 3D tab with explanation banner           (everything failed)
```

The chain is orchestrated client-side in `SolarRoofViewer.tsx`. The optimistic Level 3 preview (cropped tile mesh) is rendered immediately while the spec call is in flight — gets replaced when Level 0/1/2 succeeds, kept as-is on Level 3 fallback.

### Persistence policy

| Level | What gets persisted to `Report.reconstructedModelUrl` |
|---|---|
| 0, 1, 2 | spec-rendered GLB |
| 3 | cropped tile mesh GLB (so subsequent loads skip the LLM call) |
| 4, 5 | nothing — viewer renders DSM / empty state on every load |

`reconstructedModelUrl` is never downgraded. A Level-3 result on a later run does not overwrite an existing Level-0 URL.

### Abort behaviour

Single `AbortController` threads through tile capture, the Anthropic SDK (which supports `signal`), the rebake, and the final upload. Component unmount or address change calls `.abort()` and all in-flight work stops.

### Observability

- Each level transition logs `[recon] level <N> reached: <reason>` to the console.
- Dev-only debug overlay (gated on `NODE_ENV !== 'production'`) shows: which level was reached, agent confidence, list of clamping warnings. Useful for tuning the prompt against real addresses without redeploys.

## Files

### New

| Path | Purpose | Approx LOC |
|---|---|---|
| `src/lib/3d/buildingSpec.ts` | Zod schema, types, JSON-Schema export, `FALLBACK_SPEC` | 150 |
| `src/lib/3d/specRenderer.ts` | `renderSpec(input) → SpecRenderResult` | 400 |
| `src/lib/3d/specFeatures.ts` | Parametric chimney/dormer/conservatory/garage primitives | 250 |
| `src/lib/3d/specTextureProjector.ts` | Adapter to `textureRebaker.ts`; per-face source selection, masking | 180 |
| `src/lib/3d/stockTextures.ts` | Lazy load + tint of `/public/textures/` library | 80 |
| `src/lib/ai/buildingSpecAgent.ts` | Anthropic SDK call, prompt, parse, retry-once | 200 |
| `src/app/api/report/[id]/reconstruction/spec/route.ts` | `POST` endpoint with caching | 120 |
| `public/textures/*.jpg` | 9 tileable 512² PBR textures (~700 KB) | bundled |

### Modified

| Path | Change |
|---|---|
| `src/lib/3d/buildingExtractor.ts` | Return `cameras: CapturedView['camera'][]` alongside the photos. Rename `produceMlInputs` → `produceSpecInputs` for accuracy. Keep cropped tile mesh accessible to the projector. |
| `src/components/SolarRoofViewer.tsx` | Replace ML reconstruction effect with the new fallback chain (~80 lines diff). |
| `CLAUDE.md` | Add `ANTHROPIC_API_KEY`; rewrite 3D-viewer section to describe spec-driven reconstruction. |
| `package.json` | Add `@anthropic-ai/sdk`. Remove `@fal-ai/client`. |

### Deleted

| Path | Reason |
|---|---|
| `src/app/api/report/[id]/reconstruction/ml/route.ts` | Hunyuan endpoint no longer called |
| `src/lib/3d/buildingMasker.ts` | Photo-masking for Hunyuan inputs; projector does its own masking against the cropped tile mesh |
| `src/lib/3d/normaliseMlMesh.ts` | Hunyuan output normaliser no longer called |

## Environment variables

| Variable | Status | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | **new** | Server-only. Required for spec generation. Missing → Level 2 fallback. |
| `FAL_KEY` | **removed** | Hunyuan dependency, no longer used. Delete from `.env.local`, `.env.example`, Vercel project, GitHub Actions secrets. |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | unchanged | Photorealistic Tiles capture |
| `GOOGLE_SOLAR_API_KEY` | unchanged | Roof segments |
| All others | unchanged | |

## Dependencies

```diff
 "dependencies": {
-   "@fal-ai/client": "^...",
+   "@anthropic-ai/sdk": "^0.32.0",
    ...
 }
```

`zod` is already a dependency.

## Database

No schema changes. `Report.reconstructedModelUrl` already exists (added by the uncommitted `20260511153154_add_reconstructed_model_url` migration). Spec JSON is cached in Supabase Storage, not Prisma.

## Migration / deploy

- One Vercel deploy. No DB migration.
- Add `ANTHROPIC_API_KEY` to Vercel env vars in the same deploy.
- Existing reports with Hunyuan-generated `reconstructedModelUrl` continue to render fine (viewer is source-agnostic). They will be regenerated with the spec-driven model only on a fresh reconstruction trigger. No backfill required.
- `FAL_KEY` can be removed from Vercel env in a follow-up cleanup deploy.

## Open questions resolved during brainstorming

| Question | Decision |
|---|---|
| Keep Hunyuan path or remove? | Remove. AI is the right direction, but image-to-3D is the wrong shape of AI here. |
| What kind of AI agent? | LLM that consumes geometry + photos and emits a structured JSON spec. Procedural code renders the mesh. |
| Fidelity target? | Top-tier: massing + features + photo-projected textures. |
| Agent structure? | Single forced-tool Claude call returning a strict Zod-validated spec. |
| LLM provider? | Anthropic Claude Sonnet 4.6 (vision + tool_use). |
| Delete vs dormant for the old ML code? | Delete — dead 3D-pipeline code rots fast and shares little with the new path. |
| Photos sent to Claude? | 3 (S/E/N) — sufficient for feature identification, ~25% cheaper than 4. All 4 still used for texture projection. |

## Risks and acceptance criteria

### Risks

1. **Roof topology resolution complexity.** Hip/mansard/mixed roofs on arbitrary footprints are non-trivial geometry. Mitigation: gable and flat are exact; others are visual approximations clamped to look reasonable. Acceptable for visualisation; revisit if real outputs look wrong.

2. **Photo-projection alignment.** Procedural walls don't exactly match real wall positions (footprint and real building edges can be off by 0.5-1.5 m). Mitigation: 0.05 m UV guardband; edge pixels alpha-blended into flat tint; visibility masking against the cropped tile mesh.

3. **LLM cost drift.** ~$0.04 per reconstruction is fine at current volumes. If a single user re-runs many times, costs grow linearly. Mitigation: input-hash caching catches identical inputs; consider per-report rate-limiting if abuse appears.

4. **Anthropic API availability.** If Sonnet 4.6 is rate-limited or down, every report drops to Level 2. Mitigation: Level 2 still produces a usable model — the system degrades gracefully, doesn't fail.

### Acceptance criteria

A test set of UK domestic addresses is agreed during the implementation planning step (writing-plans). It must include at least: one simple rectangular footprint, one L-shaped footprint, one property with a known conservatory, one property with a known dormer, one property where the Google Solar API returns no segments, and the address from the original bug report (`3A, DOWNS WALK, PEACEHAVEN, BN10 7SN`). For every address in that set, across three independent reconstructions each:

1. Every property reaches at least Level 2 on a fresh load — no Level 4/5 unless the Maps API key is intentionally missing.
2. Properties with Solar API roof segments reach Level 0 or 1 in ≥80% of cases — Level 2 fallback only when Claude returns invalid JSON twice in a row.
3. End-to-end reconstruction completes in under 30 s for warm-cache scenarios and under 60 s for cold-cache scenarios.
4. The reconstructed model is identifiable as the same property when compared side-by-side with the Satellite tab.
5. No black blobs, no malformed meshes, no error toasts visible in any reconstruction in the test set.
