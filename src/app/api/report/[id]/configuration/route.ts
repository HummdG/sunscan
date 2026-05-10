import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { loadCatalogue, CATALOGUE_VERSION } from '@/lib/pricing/catalogueLoader'
import { computeQuote } from '@/lib/pricing/computeQuote'
import { hydrateReportData } from '@/lib/reportData'
import { generateReportPdf } from '@/lib/reportGenerator'
import type { PricingContext, RoofType, SystemConfig } from '@/lib/pricing/types'
import { createClient } from '@supabase/supabase-js'

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
})

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await req.json()
  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 })
  }

  const report = await prisma.report.findUnique({
    where: { id },
    include: { configuration: true },
  })
  if (!report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  const catalogue = await loadCatalogue()
  const assumptions = JSON.parse(report.assumptionsJson) as { roofPitchDeg?: number }
  const roofType: RoofType = (assumptions.roofPitchDeg ?? 35) < 10 ? 'flat' : 'pitched'

  // Use the original report's panelCount as a roof cap proxy; configurator already enforces this client-side.
  const ctx: PricingContext = {
    catalogue,
    annualKwh: report.annualKwh,
    roofMaxPanels: Math.max(report.panelCount, parsed.data.config.panelCount),
    roofType,
  }

  const quote = computeQuote(parsed.data.config as SystemConfig, ctx)

  // Persist the configuration row
  await prisma.systemConfiguration.upsert({
    where: { reportId: id },
    create: {
      reportId: id,
      tier: parsed.data.config.tier,
      configJson: JSON.stringify(parsed.data.config),
      lineItemsJson: JSON.stringify(quote),
      totalPounds: quote.totalPounds,
      vatRatePercent: quote.vatRatePercent,
      catalogueVersion: CATALOGUE_VERSION,
    },
    update: {
      tier: parsed.data.config.tier,
      configJson: JSON.stringify(parsed.data.config),
      lineItemsJson: JSON.stringify(quote),
      totalPounds: quote.totalPounds,
      vatRatePercent: quote.vatRatePercent,
      catalogueVersion: CATALOGUE_VERSION,
    },
  })

  // Recompute payback against the new total cost
  const fullAssumptions = JSON.parse(report.assumptionsJson)
  fullAssumptions.systemCostPounds = quote.totalPounds
  const annualSavings = report.annualSavingsPounds || 1
  const newPayback = annualSavings > 0
    ? Math.round((quote.totalPounds / annualSavings) * 10) / 10
    : 99

  await prisma.report.update({
    where: { id },
    data: {
      assumptionsJson: JSON.stringify(fullAssumptions),
      paybackYears: newPayback,
    },
  })

  // Re-render PDF and overwrite same Supabase Storage filename
  let pdfUrl: string | null = report.pdfUrl
  try {
    const fresh = await prisma.report.findUnique({
      where: { id },
      include: { configuration: true },
    })
    if (fresh) {
      const data = hydrateReportData(fresh)
      const pdfBuffer = await generateReportPdf(data, report.model3dImageUrl ?? undefined)

      const supabase = getSupabaseAdmin()
      if (supabase) {
        const fileName = `${id}.pdf`
        const { error } = await supabase.storage
          .from('sunscan-reports')
          .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })
        if (!error) {
          const { data: urlData } = await supabase.storage
            .from('sunscan-reports')
            .createSignedUrl(fileName, 60 * 60 * 24 * 7)
          pdfUrl = urlData?.signedUrl ?? null
          if (pdfUrl) {
            await prisma.report.update({
              where: { id },
              data: { pdfUrl, status: 'complete' },
            })
          }
        } else {
          console.error('Supabase upload failed', error)
        }
      }
    }
  } catch (err) {
    console.error('PDF regeneration error', err)
  }

  return NextResponse.json({ quote, pdfUrl })
}
