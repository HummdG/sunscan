import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadCatalogue } from '@/lib/pricing/catalogueLoader'
import { computeQuote } from '@/lib/pricing/computeQuote'
import { buildTierPresets, inclusionsForTier } from '@/lib/pricing/tiers'
import type { PricingContext, TierPresetSummary } from '@/lib/pricing/types'

const BodySchema = z.object({
  annualKwh: z.number().min(100).max(100000),
  roofMaxPanels: z.number().int().min(1).max(200),
  roofType: z.enum(['pitched', 'flat', 'ground']),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  const catalogue = await loadCatalogue()
  const ctx: PricingContext = {
    catalogue,
    annualKwh: parsed.data.annualKwh,
    roofMaxPanels: parsed.data.roofMaxPanels,
    roofType: parsed.data.roofType,
  }

  const presets = buildTierPresets(ctx)
  const tiers: TierPresetSummary[] = (['essential', 'standard', 'premium'] as const).map((tier) => {
    const config = presets[tier]
    const quote = computeQuote(config, ctx)
    const pvRow = catalogue.pvBasePrice.find((r) => r.panelCount === config.panelCount)
    return {
      tier,
      config,
      totalPounds: quote.totalPounds,
      panelCount: config.panelCount,
      kwp: pvRow?.kwp ?? 0,
      inclusions: inclusionsForTier(tier),
    }
  })

  return NextResponse.json({ presets: tiers })
}
