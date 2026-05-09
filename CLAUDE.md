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

No test suite exists yet.

## Architecture

A 3-step wizard (`/survey`) collects an address and electricity bill, then `/api/report/generate` orchestrates all computation and redirects to `/report/[id]`.

**Data flow:**
1. Address typed → `/api/os/address` (OS Places autocomplete) → user selects
2. Building auto-fetched → `/api/os/building` (OS NGD Features API, UPRN filter → bbox fallback → 10×8m estimate)
3. Bill uploaded → `/api/bill/parse` (GPT-4o vision OCR → manual entry fallback)
4. Submit → `/api/report/generate`:
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
- `src/lib/billParser.ts` — GPT-4o vision OCR; returns structured JSON with confidence level.
- `src/lib/db.ts` — Prisma singleton with PrismaPg adapter (1 connection per serverless instance).

**3D viewer:**
`Solar3DViewer.tsx` uses React Three Fiber. The canvas is captured as base64 and embedded in the PDF. Three.js convention used throughout: **x = east, z = south** (z is inverted from typical map north-up).

## MCS Solar Calculation

```
annualGenerationKwh = systemKwp × irradianceKwhPerM2 × performanceRatio
performanceRatio    = (1 − shadingLoss) × (1 − inverterLoss) × (1 − systemLoss) ≈ 0.830
systemKwp           = panelCount × panelWattPeak / 1000
```

MCS orientation convention: **0° = South, 90° = East or West, 180° = North** (different from compass bearings).

Self-consumption model: base ~30%, +5% per kWh battery storage, capped at 85%.

25-year savings projection uses 4% annual energy price inflation.

## Environment Variables

| Variable | Notes |
|----------|-------|
| `DATABASE_URL` | Supabase pooler URL (port 6543) for serverless |
| `DIRECT_URL` | Direct connection for Prisma migrations |
| `SUPABASE_SERVICE_KEY` | Server-side only — never expose to client |
| `NEXT_PUBLIC_SUPABASE_URL` | Public, client-accessible |
| `OS_API_KEY` | Server-side only; omit to use mock mode |
| `OPENAI_API_KEY` | Server-side only; omit to fall back to manual bill entry |
| `NEXT_PUBLIC_APP_URL` | e.g. `http://localhost:3000` in dev |

**Mock mode:** Omitting `OS_API_KEY` returns 5 mock Norwich addresses and a 10m × 8m footprint — sufficient to run the full flow locally.

## Database

Single `Report` table (denormalized). JSON columns: `panelSpecJson`, `inverterSpecJson`, `batterySpecJson`, `assumptionsJson`, `panelLayoutJson`, `monthlyGenJson`, `twentyFiveYearJson`. Status values: `'draft'` | `'complete'`.

Run `npx prisma migrate dev` after any schema change in `prisma/schema.prisma`, then `prisma generate` to update the client.

## Known Limitations / TODOs

- PDF bill uploads return null from GPT-4o (needs PNG conversion before sending)
- Tariff is patched into `SolarResults` after `runSolarCalculations()` instead of being passed in directly
- 25-year savings projection is flat (no panel degradation curve)
- Only the best single roof plane is used — multi-plane selection not yet implemented
- `/admin` dashboard not yet built
- No Stripe payment gate (PDF download is currently free)
