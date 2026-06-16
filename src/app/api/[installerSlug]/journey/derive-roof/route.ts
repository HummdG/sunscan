import { NextResponse } from 'next/server'
import { z } from 'zod'
import { fetchBuildingInsights } from '@/lib/googleSolarApi'
import { fetchBuilding } from '@/lib/osApi'
import { deriveGeometry } from '@/lib/recommend/deriveGeometry'
import { deriveSiteContext } from '@/lib/pricing/siteContext'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'
import { rateLimit } from '@/lib/rateLimit'
import type { RoofConfidence } from '@/lib/journey/types'

const BodySchema = z.object({
  lat: z.number(),
  lng: z.number(),
  postcode: z.string(),
  uprn: z.string().optional(),
})

const CONFIDENCE: Record<string, RoofConfidence> = {
  google_solar: 'high',
  os_ngd: 'medium',
  estimated: 'low',
}

/**
 * POST /api/[installerSlug]/journey/derive-roof
 * Models the roof from an address: Google Solar (sunniest segment) → OS NGD →
 * estimated. Returns the journey RoofState payload incl. the raw Google insights
 * for the 2D viewer.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ installerSlug: string }> },
) {
  const limited = rateLimit(req, { key: 'derive-roof', limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) return NextResponse.json({ error: 'unknown-installer' }, { status: 404 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request' }, { status: 400 })
  }
  const { lat, lng, uprn } = parsed.data

  const [insights, osBuilding] = await Promise.all([
    fetchBuildingInsights(lat, lng),
    fetchBuilding(uprn ?? '', lat, lng),
  ])

  const geometry = deriveGeometry(insights, osBuilding)
  const panelLayoutMaxPanels = osBuilding ? Math.max(6, Math.round(osBuilding.areaM2 / 4)) : 0
  const { roofType, roofMaxPanels } = deriveSiteContext(osBuilding, insights, panelLayoutMaxPanels)

  const panelW = insights?.solarPotential.panelCapacityWatts ?? 430
  const kwpPotential = Math.round((roofMaxPanels * panelW) / 10) / 100

  return NextResponse.json({
    roof: {
      source: geometry.geometrySource,
      confidence: CONFIDENCE[geometry.geometrySource] ?? 'low',
      maxPanelCount: roofMaxPanels,
      kwpPotential,
      pitchDeg: geometry.pitchDeg,
      mcsOrientationDeg: geometry.mcsOrientationDeg,
      roofType,
      insights,
    },
  })
}
