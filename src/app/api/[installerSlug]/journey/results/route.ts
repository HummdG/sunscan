import { NextResponse } from 'next/server'
import { z } from 'zod'
import { fetchBuildingInsights } from '@/lib/googleSolarApi'
import { loadCatalogue } from '@/lib/pricing/catalogueLoader'
import { getZoneForPostcode, getIrradianceKwhPerM2 } from '@/lib/mcs'
import { getTariffForPostcode } from '@/lib/tariff'
import { DEFAULT_ANNUAL_KWH, TDCV_ELECTRICITY_KWH } from '@/lib/consumption'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'
import { buildOptionSet } from '@/lib/recommend/buildOptionSet'
import type { OptionSetInput } from '@/lib/recommend/optionTypes'

const Body = z.object({
  lat: z.number(),
  lng: z.number(),
  postcode: z.string(),
  uprn: z.string().optional(),
  roof: z.object({
    pitchDeg: z.number(),
    mcsOrientationDeg: z.number(),
    maxPanelCount: z.number(),
    roofType: z.enum(['pitched', 'flat', 'ground']),
    confidence: z.enum(['high', 'medium', 'low']),
  }),
  roofFallback: z
    .object({
      sizeBand: z.string().nullable(),
      direction: z.string().nullable(),
      shading: z.string().nullable(),
    })
    .optional(),
  usage: z.object({
    source: z.string().nullable(),
    annualKwh: z.number().nullable(),
    unitRatePence: z.number().nullable(),
    exportTariffPence: z.number().nullable(),
    monthlyCostGbp: z.number().nullable(),
    householdSize: z.number().nullable(),
  }),
  budgetBandId: z.string().nullable(),
})
type BodyT = z.infer<typeof Body>

// Fallback roof-question mappings (only used when mapping confidence is low).
const SIZE_BAND_PANELS: Record<string, number> = { small: 8, medium: 14, large: 22 }
const DIRECTION_MCS: Record<string, number> = {
  south: 0, south_east: 45, south_west: 45, east: 90, west: 90, east_west: 90, north: 180,
}
const SHADING_LOSS: Record<string, number> = {
  none: 0.03, trees: 0.1, buildings: 0.12, heavy: 0.25,
}

function resolveAnnualKwh(usage: BodyT['usage'], importPence: number): number {
  if (usage.annualKwh && usage.annualKwh > 0) return usage.annualKwh
  if (usage.source === 'monthly_cost' && usage.monthlyCostGbp && usage.monthlyCostGbp > 0) {
    const poundsPerKwh = (usage.unitRatePence ?? importPence) / 100
    if (poundsPerKwh > 0) return Math.round((usage.monthlyCostGbp * 12) / poundsPerKwh)
  }
  if (usage.source === 'household' && usage.householdSize && usage.householdSize > 0) {
    if (usage.householdSize <= 2) return TDCV_ELECTRICITY_KWH.low
    if (usage.householdSize === 3) return TDCV_ELECTRICITY_KWH.medium
    return TDCV_ELECTRICITY_KWH.high
  }
  return DEFAULT_ANNUAL_KWH
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ installerSlug: string }> },
) {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) return NextResponse.json({ error: 'unknown-installer' }, { status: 404 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 })
  }
  const b = parsed.data
  const cfg = installer.config

  // Tariff: bill-derived where available, else regional fallback.
  const regional = getTariffForPostcode(b.postcode)
  const importPence = b.usage.unitRatePence ?? regional.importPencePerKwh
  const exportPence = b.usage.exportTariffPence ?? regional.segExportPencePerKwh

  // Geometry: trust the modelled roof, override from fallback answers when low-confidence.
  let pitchDeg = b.roof.pitchDeg
  let mcsOrientationDeg = b.roof.mcsOrientationDeg
  let maxPanelCount = b.roof.maxPanelCount
  let shadingLoss = cfg?.shadingLoss ?? 0.05
  if (b.roof.confidence === 'low' && b.roofFallback) {
    const { sizeBand, direction, shading } = b.roofFallback
    if (sizeBand && SIZE_BAND_PANELS[sizeBand]) maxPanelCount = SIZE_BAND_PANELS[sizeBand]
    if (direction && direction in DIRECTION_MCS) mcsOrientationDeg = DIRECTION_MCS[direction]
    if (shading && shading in SHADING_LOSS) shadingLoss = SHADING_LOSS[shading]
  }

  const [insights, catalogue] = await Promise.all([
    fetchBuildingInsights(b.lat, b.lng),
    loadCatalogue(installer.id),
  ])

  const annualKwh = resolveAnnualKwh(b.usage, importPence)
  const mcsZone = getZoneForPostcode(b.postcode)
  const irradianceKwhPerM2 = getIrradianceKwhPerM2(mcsZone, pitchDeg, mcsOrientationDeg)

  // Budget band → upper bound (default generous when unknown).
  const bands = (cfg?.budgetBandsJson as Array<{ id: string; maxGbp: number }> | undefined) ?? []
  const budgetMaxGbp = bands.find((x) => x.id === b.budgetBandId)?.maxGbp ?? 30000

  const input: OptionSetInput = {
    catalogue,
    roofMaxPanels: Math.max(1, maxPanelCount),
    roofType: b.roof.roofType,
    pitchDeg,
    mcsOrientationDeg,
    solarInsights: insights,
    annualKwh,
    importTariffPence: importPence,
    exportTariffPence: exportPence,
    mcsZone,
    irradianceKwhPerM2,
    shadingLoss,
    inverterLoss: cfg?.inverterLoss ?? 0.03,
    systemLoss: cfg?.systemLoss ?? 0.1,
    energyInflationRate: cfg?.energyInflationRate ?? 0.03,
    panelDegradationPerYear: cfg?.panelDegradationPerYear ?? 0.005,
    minPanels: cfg?.minPanels ?? 6,
    maxPanels: cfg?.maxPanels ?? 50,
    marginPercent: cfg?.marginPercent ?? 0,
    budgetMaxGbp,
  }

  const set = buildOptionSet(input)
  return NextResponse.json(set)
}
