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
`SolarRoofViewer.tsx` uses React Three Fiber. The primary path captures **Google Photorealistic 3D Tiles** offscreen and feeds 3 cardinal photos + the OS footprint + Google Solar API roof segments to a **Claude Sonnet 4.6 vision call** (`/api/report/[id]/reconstruction/spec`) which returns a strict Zod-validated `BuildingSpec`. A deterministic procedural renderer (`specRenderer.ts`) builds walls from the footprint, roof planes from the Solar segments, and features (chimneys, dormers, conservatory, garage) as parametric primitives. The existing `textureRebaker.ts` projects the 4 captured photos onto the procedural mesh. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `ANTHROPIC_API_KEY`, and (optionally) `GOOGLE_SOLAR_API_KEY` to enable the full pipeline.

When the Anthropic call is unavailable, the API route returns a `FALLBACK_SPEC` and the renderer still produces a massing model from footprint + Solar segments alone. When tile capture fails entirely, the viewer falls back to a **Google Solar DSM heightmap mesh** (`DsmMesh`). Three.js convention used throughout: **x = east, z = south**. The older `Solar3DViewer.tsx` remains in-tree only for legacy reports.

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
| `ANTHROPIC_API_KEY` | Server-side only; required for spec generation (see 3D viewer). Missing → fallback massing-only spec |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Public; enables Google Photorealistic 3D Tiles in the viewer |
| `NEXT_PUBLIC_APP_URL` | e.g. `http://localhost:3000` in dev |

**Mock mode:** Omitting `OS_API_KEY` still returns 5 mock Norwich addresses for autocomplete, but `fetchBuilding()` returns `null` — there is no fake 10×8m fallback. The Review step blocks generation in that case.

## Database

Single `Report` table (denormalized). JSON columns: `panelSpecJson`, `inverterSpecJson`, `batterySpecJson`, `assumptionsJson`, `panelLayoutJson`, `monthlyGenJson`, `twentyFiveYearJson`. Status values: `'draft'` | `'complete'`.

Run `npx prisma migrate dev` after any schema change in `prisma/schema.prisma`, then `prisma generate` to update the client.

## Known Limitations / TODOs

- Only the best single roof plane is used — multi-plane selection not yet implemented
- `/admin` dashboard not yet built
- No Stripe payment gate (PDF download is currently free)
