# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Next.js Version Warning

This project uses Next.js 16 which has breaking changes from earlier versions — APIs, conventions, and file structure may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Commands

```bash
npm run dev          # Start dev server at http://localhost:3000
npm run build        # prisma generate + next build
npm run lint         # ESLint

npx prisma migrate dev --name <name>   # Run a new DB migration
npx prisma generate                    # Regenerate Prisma client after schema changes
npx prisma studio                      # Browse DB in browser
```

Run `npm test` for unit tests (Vitest; pure-function modules only).

## Architecture

A 5-step wizard (`/survey`) collects an address, electricity bill, **explicit user confirmation of roof + consumption** (the Review step), and a system tier, then `/api/report/generate` orchestrates all computation and redirects to `/report/[id]`. The route refuses (HTTP 422) when load-bearing data is missing — no silent fallback to a fake 10×8m building or a 3,500 kWh default consumption.

**Data flow:**
1. Address typed → `/api/os/address` (OS Places autocomplete) → user selects
2. Building auto-fetched → `/api/os/building` (OS NGD Features API, UPRN filter → bbox fallback → **null** if neither hits)
3. Bill uploaded → `/api/bill/parse` (**Mistral OCR** for both PDFs and images → manual entry fallback). Returns 503 if `MISTRAL_API_KEY` is missing.
4. Review step shows the detected roof + consumption; user confirms or corrects, producing a `dataConfidence` envelope (`{ roof, consumption, tariff }`) that ships with the generate payload and is persisted on the Report row.
5. Submit → `/api/report/generate`:
   - MCS zone lookup (`data/mcs_postcode_zones.csv`, longest-prefix match)
   - Irradiance lookup (`data/mcs_irradiance.csv`, keyed by zone + pitch + orientation)
   - Roof plane estimation + best south-facing plane selection (`lib/geometry.ts`)
   - Panel grid packing (`lib/panelLayout.ts`)
   - Solar calculations (`lib/solarCalculations.ts`)
   - DB insert via Prisma (`lib/db.ts`)
   - PDF rendered with `@react-pdf/renderer` and uploaded to Supabase Storage (`sunscan-reports` bucket)
   - Returns `reportId` → redirect to `/report/[id]`

**Key lib modules:**
- `src/lib/solarCalculations.ts` — All MCS formulas. `runSolarCalculations()` is the master orchestrator.
- `src/lib/mcs.ts` — CSV-backed zone/irradiance lookup; data cached in module-level vars on first load.
- `src/lib/geometry.ts` — EPSG:27700→WGS84 (proj4), flat-earth local metres, roof plane estimation.
- `src/lib/panelLayout.ts` — Grid packing: 300mm edge setback, 20mm gaps, landscape panels (1.722m × 1.134m).
- `src/lib/osApi.ts` — OS Places and OS NGD wrappers; falls back to mock Norwich data when `OS_API_KEY` is absent.
- `src/lib/billParser.ts` — Mistral OCR (`mistral-ocr-latest`) + Mistral chat extraction. Throws `BillOcrUnavailableError` when `MISTRAL_API_KEY` is missing so the route can return 503 (no mock fallback).
- `src/components/ReviewStep.tsx` — Wizard step that gates generation. Exports `isReviewReady()` and `computeDataConfidence()` for the parent form.
- `src/lib/db.ts` — Prisma singleton with PrismaPg adapter (1 connection per serverless instance).

**3D viewer:**
`SolarRoofViewer.tsx` uses React Three Fiber. The reconstruction pipeline:

1. **Capture** — `reconstructBuilding()` (`src/lib/3d/buildingExtractor.ts`) orbits Google Photorealistic 3D Tiles and produces 5 PNG blobs: front, back, left, right (cardinal drone-eye orbit) and a near-vertical top-down. The 6th view, a Google Maps Static satellite image, is captured client-side via a `crossOrigin="anonymous"` `<img>` → canvas → `toBlob()` in `SolarRoofViewer.tsx`.
2. **Enhance** — All 6 PNGs are sent to **Google Gemini 2.5 Flash Image ("Nano Banana")** via `src/lib/ai/nanoBananaClient.ts` with a "do not invent features" prompt. Per-image fallback to the original on failure. Concurrency 2 with 250ms jitter; Supabase-backed per-image cache (`sunscan-reports/nano-banana/{sha256(rawPng)}.png`).
3. **Mesh** — The front cardinal photo (south-facing) is sent to **Meshy direct API** at `https://api.meshy.ai/openapi/v1/image-to-3d` via `src/lib/ai/meshyClient.ts`. We use `meshy-5` by default. The Solar API roof summary is passed as `texture_prompt` (guides texturing only — geometry is determined entirely by the image). We tried fal-ai/meshy/v5/multi-image-to-3d and v6 first; both endpoints are character-only on fal.ai (their schema includes T-pose, rigging height, animation IDs) and reject building photos with `downstream_service_error`. Meshy's own API has no such restriction and is what produces high-quality building reconstructions from a single oblique photo.
4. **Roof correction** — `src/lib/3d/glbRoofCorrector.ts` parses the Meshy GLB with `@gltf-transform/core`, detects roof faces (world-space `normal.y > 0.3`), strips them, builds an authoritative roof via the existing `buildRoof()` helper (`src/lib/3d/specRoof.ts`) using Google Solar API pitch/azimuth/area, aligns it to the deleted-roof eave AABB, and re-exports. On any failure, returns the raw Meshy GLB unmodified.
5. **Persist + render** — Orchestrated by `/api/report/[id]/reconstruction/generate`. Both the raw and corrected GLBs are uploaded to Supabase (`sunscan-reports/meshy/{cacheKey}.{raw|corrected}.glb`). The corrected URL is also written to the legacy `{id}-reconstruction.glb` path so existing consumers keep working. `Report.reconstructedModelUrl` (corrected) and `reconstructedModelRawUrl` (raw) are updated.
6. **Viewer toggle** — `ReconstructedModelView.tsx` pre-fetches both GLBs and exposes a "Roof-corrected" / "Meshy raw" segmented toggle. Preference persists via `localStorage['sunscan.reconstruction.modelSource']`.

End-to-end latency target: tile orbit ~30s + Nano Banana ~10s + Meshy ~90s + roof correction ~3s ≈ **130s**. The wizard's optimistic Level-3 cropped-tile preview stays visible during this window.

When `FAL_KEY` is missing, the generate route returns 502 `{ retryable: true }` and the viewer keeps the optimistic preview. When tile capture fails entirely, the viewer falls back to a **Google Solar DSM heightmap mesh** (`DsmMesh`). Three.js convention used throughout: **x = east, z = south**. The older `Solar3DViewer.tsx` remains in-tree only for legacy reports.

The previous Claude-Sonnet-spec → procedural-renderer pipeline (`src/lib/3d/specRenderer.ts`, `src/lib/3d/specTextureProjector.ts`, `src/lib/3d/textureRebaker.ts`, `src/lib/ai/buildingSpecAgent.ts`, `/api/report/[id]/reconstruction/spec`) is `@deprecated` and will be removed after ~2 weeks of validation. `buildRoof()` in `specRoof.ts` is **kept** — it's load-bearing for `glbRoofCorrector.ts`.

## MCS Solar Calculation

```
annualGenerationKwh = systemKwp × irradianceKwhPerM2 × performanceRatio
performanceRatio    = (1 − shadingLoss) × (1 − inverterLoss) × (1 − systemLoss) ≈ 0.830
systemKwp           = panelCount × panelWattPeak / 1000
```

MCS orientation convention: **0° = South, 90° = East or West, 180° = North** (different from compass bearings).

Self-consumption is computed per month from a UK seasonal generation profile and a winter-heavy consumption profile, with a 25% day-use ratio. Battery throughput is the lesser of monthly surplus, `batteryKwh × daysInMonth × 0.9`, and remaining evening demand.

25-year savings projection applies 0.5%/year linear panel degradation and the `energyInflationRate` from assumptions (default 3%).

## Environment Variables

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Supabase pooler URL (port 6543) for serverless |
| `DIRECT_URL` | Direct connection for Prisma migrations |
| `SUPABASE_SERVICE_KEY` | Server-side only — never expose to client |
| `NEXT_PUBLIC_SUPABASE_URL` | Public, client-accessible |
| `OS_API_KEY` | Server-side only; omit to disable OS NGD lookup |
| `MISTRAL_API_KEY` | Server-side only; bill OCR via Mistral. Omit and `/api/bill/parse` returns 503; users must enter the bill manually |
| `GOOGLE_SOLAR_API_KEY` | Server-side only; used for higher-fidelity roof + panel layout |
| `ANTHROPIC_API_KEY` | Server-side only. No longer required by the active 3D viewer pipeline (the deprecated `…/reconstruction/spec` route uses it) |
| `GEMINI_API_KEY` | Server-side only; Nano Banana image enhancement. Unset → enhancement is skipped and originals flow to Meshy (`enhancementsUsedFallback: 6` in the response) |
| `MESHY_API_KEY` | Server-side only; required for Meshy direct API. Unset → `/api/report/[id]/reconstruction/generate` returns 502 `{ retryable: true }`. Get one at https://www.meshy.ai/api |
| `MESHY_AI_MODEL` | Optional. Default `meshy-5`. Set to `meshy-4` to use the older model |
| `FAL_KEY` | Optional now. Kept around because `@fal-ai/client` is still installed for potential future endpoints; not used by the Meshy pipeline (fal-ai/meshy/* is character-only and rejects buildings via `downstream_service_error`) |
| `SUNSCAN_USE_NANO_BANANA` | Optional. `false` disables Nano Banana cleanup entirely (A/B kill switch) |
| `SUNSCAN_MESHY_POLYCOUNT` | Optional. Default `30000` |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Public; enables Google Photorealistic 3D Tiles and the static satellite capture used as the 6th Meshy input |
| `NEXT_PUBLIC_APP_URL` | e.g. `http://localhost:3000` in dev |

**Mock mode:** Omitting `OS_API_KEY` still returns 5 mock Norwich addresses for autocomplete, but `fetchBuilding()` returns `null` — there is no fake 10×8m fallback. The Review step blocks generation in that case.

## Database

Single `Report` table (denormalized). JSON columns: `panelSpecJson`, `inverterSpecJson`, `batterySpecJson`, `assumptionsJson`, `panelLayoutJson`, `monthlyGenJson`, `twentyFiveYearJson`. Status values: `'draft'` | `'complete'`.

Run `npx prisma migrate dev` after any schema change in `prisma/schema.prisma`, then `prisma generate` to update the client.

## Known Limitations / TODOs

- Only the best single roof plane is used — multi-plane selection not yet implemented
- `/admin` dashboard not yet built
- No Stripe payment gate (PDF download is currently free)
