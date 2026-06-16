import { createClient } from '@supabase/supabase-js'
import { prisma } from '@/lib/db'
import { generateReportPdf, generateQuoteNumber } from '@/lib/reportGenerator'
import { hydrateReportData } from '@/lib/reportData'
import { DEFAULT_PANEL } from '@/lib/solarCalculations'
import type { SolarAssumptions, SolarResults } from '@/lib/types'

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export interface ReportOption {
  panelCount: number
  systemKwp: number
  panelType: string
  inverterType: string
  batteryType: string | null
  batteryCapacityKwh: number
  results: SolarResults
}

export interface GenerateReportParams {
  installerId: string
  addressRaw: string
  postcode: string
  lat: number
  lng: number
  uprn?: string | null
  annualKwh: number
  importPence: number
  standingPence: number
  exportPence: number
  billSource: 'ocr' | 'manual'
  mcsZone: string
  irradianceKwhPerM2: number
  assumptions: SolarAssumptions
  option: ReportOption
}

/**
 * Create a scoped Report for a lead's recommended option, render the detailed
 * PDF, upload it to Supabase Storage (sunscan-reports/{installerId}/{id}.pdf),
 * and store a 7-day signed URL. Resilient: on PDF/upload failure the Report row
 * still persists (status draft, pdfUrl null).
 */
export async function generateReportForLead(
  p: GenerateReportParams,
): Promise<{ reportId: string; pdfUrl: string | null }> {
  const r = p.option.results
  const wattPeak = p.option.panelCount > 0 ? Math.round((p.option.systemKwp * 1000) / p.option.panelCount) : DEFAULT_PANEL.wattPeak

  const panelSpec = {
    modelName: p.option.panelType,
    wattPeak,
    widthMm: DEFAULT_PANEL.widthMm,
    heightMm: DEFAULT_PANEL.heightMm,
    depthMm: DEFAULT_PANEL.depthMm,
  }
  const inverterSpec = {
    modelName: p.option.inverterType,
    ratedKw: Math.max(1, Math.round(p.option.systemKwp)),
    efficiency: 0.97,
  }
  const batterySpec = p.option.batteryType
    ? { modelName: p.option.batteryType, capacityKwh: p.option.batteryCapacityKwh }
    : null

  const count = await prisma.report.count()
  const report = await prisma.report.create({
    data: {
      installerId: p.installerId,
      quoteNumber: generateQuoteNumber(count + 1),
      addressRaw: p.addressRaw,
      addressUprn: p.uprn ?? null,
      lat: p.lat,
      lng: p.lng,
      postcode: p.postcode,
      postcodeDistrict: p.postcode.replace(/\s+/g, ' ').trim().split(' ')[0] ?? p.postcode,
      footprintGeojson: null,
      footprintSource: 'google_solar',
      annualKwh: p.annualKwh,
      tariffPencePerKwh: p.importPence,
      standingChargePencePerDay: p.standingPence,
      exportTariffPencePerKwh: p.exportPence,
      billSource: p.billSource,
      panelCount: p.option.panelCount,
      systemSizeKw: p.option.systemKwp,
      panelSpecJson: JSON.stringify(panelSpec),
      inverterSpecJson: JSON.stringify(inverterSpec),
      batterySpecJson: batterySpec ? JSON.stringify(batterySpec) : null,
      mcsZone: p.mcsZone,
      irradianceKwhPerM2: p.irradianceKwhPerM2,
      annualGenerationKwh: r.annualGenerationKwh,
      selfConsumptionKwh: r.selfConsumptionKwh,
      exportKwh: r.exportKwh,
      annualSavingsPounds: r.annualSavingsPounds,
      paybackYears: r.paybackYears,
      co2SavedTonnesPerYear: r.co2SavedTonnesPerYear,
      monthlyGenJson: JSON.stringify(r.monthlyGenKwh),
      twentyFiveYearJson: JSON.stringify(r.twentyFiveYearSavings),
      assumptionsJson: JSON.stringify(p.assumptions),
      panelLayoutJson: '[]',
      status: 'draft',
    },
  })

  let pdfUrl: string | null = null
  try {
    const data = hydrateReportData({ ...report, configuration: null })
    const pdf = await generateReportPdf(data)
    const supabase = getSupabaseAdmin()
    if (supabase) {
      const fileName = `${p.installerId}/${report.id}.pdf`
      const { error } = await supabase.storage
        .from('sunscan-reports')
        .upload(fileName, pdf, { contentType: 'application/pdf', upsert: true })
      if (!error) {
        const { data: urlData } = await supabase.storage
          .from('sunscan-reports')
          .createSignedUrl(fileName, 60 * 60 * 24 * 7)
        pdfUrl = urlData?.signedUrl ?? null
      } else {
        console.error('Report PDF upload failed:', error.message)
      }
    }
  } catch (e) {
    console.error('Report PDF generation failed:', e instanceof Error ? e.message : e)
  }

  await prisma.report
    .update({ where: { id: report.id }, data: { pdfUrl, status: pdfUrl ? 'complete' : 'draft' } })
    .catch(() => {})

  return { reportId: report.id, pdfUrl }
}
