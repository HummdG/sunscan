# SunScan — Solar Survey & Proposal Generator

A production-ready UK solar survey web app. Enter a UK address → fetch OS building footprint → upload an electricity bill → generate a professional solar proposal PDF with 3D visualisation and financial projections.

## Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- An [OS API](https://osdatahub.os.uk) key (free tier, 25k calls/month)
- An [OpenAI](https://platform.openai.com) API key (GPT-4o for bill OCR)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in env vars
cp .env.example .env.local
# Edit .env.local — see Environment Variables below

# 3. Run database migration
npx prisma migrate dev --name init

# 4. Create Supabase Storage bucket
# In Supabase dashboard → Storage → New bucket
# Name: sunscan-reports  |  Private: yes

# 5. Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase connection string (Settings → Database → Connection string → URI) |
| `DIRECT_URL` | Same as DATABASE_URL (used by Prisma Migrate) |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (Settings → API → service_role) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (Settings → API) |
| `OS_API_KEY` | OS Data Hub API key |
| `OPENAI_API_KEY` | OpenAI API key (GPT-4o vision for bill OCR) |
| `NEXT_PUBLIC_APP_URL` | App base URL (`http://localhost:3000` in dev) |

## Mock Mode

Without an `OS_API_KEY`, the app returns 5 mock Norwich addresses and a rectangular 10m × 8m footprint — enough to run the full flow locally. Bill OCR degrades gracefully to manual entry if `OPENAI_API_KEY` is absent.

## MCS Solar Calculation

```
annualGenerationKwh = systemKwp × irradianceKwhPerM2 × performanceRatio

performanceRatio = (1 − shadingLoss) × (1 − inverterLoss) × (1 − systemLoss)
                ≈ 0.95 × 0.97 × 0.90 ≈ 0.830

systemKwp = panelCount × panelWattPeak / 1000
```

Irradiance values come from `data/mcs_irradiance.csv` keyed by MCS zone, roof pitch, and orientation (0° = South, MCS convention). Zone assignment uses `data/mcs_postcode_zones.csv` with longest-prefix matching.

## Project Structure

```
src/
├── app/
│   ├── page.tsx                  Landing page
│   ├── survey/page.tsx           4-step wizard
│   ├── report/[id]/page.tsx      Report viewer (server component)
│   └── api/
│       ├── os/address/           Address autocomplete (OS Places)
│       ├── os/building/          Building footprint (OS NGD)
│       ├── bill/parse/           Bill OCR (GPT-4o)
│       └── report/generate/      Orchestration + PDF generation
├── components/
│   ├── AddressSearch.tsx         Debounced OS Places autocomplete
│   ├── BillUpload.tsx            Drag-and-drop bill upload + OCR
│   ├── Solar3DViewer.tsx         React Three Fiber house + panels
│   ├── AssumptionsPanel.tsx      Collapsible advanced settings
│   ├── ReportPreview.tsx         Browser report view
│   ├── ReportCharts.tsx          Recharts components
│   └── pdf/ReportDocument.tsx    @react-pdf/renderer PDF document
└── lib/
    ├── mcs.ts                    MCS CSV loading + zone/irradiance lookup
    ├── solarCalculations.ts      All solar formulas (MCS-aligned)
    ├── geometry.ts               BNG→WGS84, local metres, roof planes
    ├── panelLayout.ts            Grid packing algorithm
    ├── osApi.ts                  OS Places + OS NGD wrappers
    ├── billParser.ts             GPT-4o vision bill OCR
    ├── reportGenerator.tsx       renderToBuffer wrapper
    └── db.ts                     Prisma singleton (PrismaPg adapter)
```

## OS API Notes

- **Address search**: OS Places API `/search/places/v1/find`
- **Building footprint**: OS NGD Features API `bld-fts-buildingpart` collection, filtered by UPRN
- Geometry is EPSG:27700 (British National Grid) — converted to WGS84 via `proj4`
- If no footprint found for UPRN, falls back to bounding-box search; if still empty, uses a 10m × 8m rectangular estimate

## Deploying to Vercel

```bash
vercel deploy
```

Set all environment variables in the Vercel project settings. The Supabase connection string should use the **pooler** URL for serverless (port 6543), not the direct URL.

## TODO

- [ ] Convert PDF bills to PNG before sending to GPT-4o (currently returns null for PDFs)
- [ ] Pass tariff directly to `runSolarCalculations` instead of patching after
- [ ] Add admin dashboard at `/admin` to browse reports
- [ ] Panel degradation curve in 25-year savings (currently flat)
- [ ] Multiple roof planes selection in 3D viewer
- [ ] Stripe payment gate for PDF download
