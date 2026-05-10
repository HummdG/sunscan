import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { loadCatalogue } from '@/lib/pricing/catalogueLoader'
import { computeQuote } from '@/lib/pricing/computeQuote'
import type { PricingContext, RoofType, SystemConfig } from '@/lib/pricing/types'

const SystemConfigSchema = z.object({
  tier: z.enum(['essential', 'standard', 'premium', 'custom']),
  panelSku: z.string(),
  panelCount: z.number().int().min(1).max(50),
  mountingSku: z.string(),
  battery: z
    .object({
      sku: z.string(),
      expansionUnits: z.number().int().min(0).max(10),
      multiplePremiumUnits: z.number().int().min(1).max(5).optional(),
      isRetrofit: z.boolean(),
    })
    .nullable(),
  scaffoldingExtras: z.array(z.object({ sku: z.string(), quantity: z.number().int().min(0) })),
  electricalExtras: z.array(z.object({ sku: z.string(), quantity: z.number().int().min(0) })),
  optionalExtras: z.array(z.object({ sku: z.string(), quantity: z.number().int().min(0) })),
  trenching: z.object({ surface: z.enum(['soft', 'hard']), metres: z.number().int().min(0) }).nullable(),
  birdMesh: z.boolean(),
  optimiserScope: z.enum(['none', 'partial', 'full']),
  optimiserPanelCount: z.number().int().min(0).max(50).optional(),
})

const BodySchema = z.object({
  config: SystemConfigSchema,
  reportId: z.string().optional(),
  /** Override roofMaxPanels / annualKwh / roofType (used during survey before report exists). */
  roofMaxPanels: z.number().int().min(1).max(200).optional(),
  annualKwh: z.number().min(100).max(100000).optional(),
  roofType: z.enum(['pitched', 'flat', 'ground']).optional(),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  let roofMaxPanels = parsed.data.roofMaxPanels
  let annualKwh = parsed.data.annualKwh
  let roofType: RoofType | undefined = parsed.data.roofType

  if (parsed.data.reportId) {
    const report = await prisma.report.findUnique({
      where: { id: parsed.data.reportId },
      select: { panelCount: true, annualKwh: true, assumptionsJson: true },
    })
    if (report) {
      roofMaxPanels = roofMaxPanels ?? report.panelCount
      annualKwh = annualKwh ?? report.annualKwh
      if (!roofType) {
        try {
          const assumptions = JSON.parse(report.assumptionsJson) as { roofPitchDeg?: number }
          roofType = (assumptions.roofPitchDeg ?? 35) < 10 ? 'flat' : 'pitched'
        } catch {
          roofType = 'pitched'
        }
      }
    }
  }

  const catalogue = await loadCatalogue()
  const ctx: PricingContext = {
    catalogue,
    roofMaxPanels: roofMaxPanels ?? parsed.data.config.panelCount,
    annualKwh: annualKwh ?? 4000,
    roofType: roofType ?? 'pitched',
  }

  const quote = computeQuote(parsed.data.config as SystemConfig, ctx)
  return NextResponse.json({ quote })
}
