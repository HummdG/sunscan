import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { ReportPreview } from '@/components/ReportPreview'
import type { ReportData, PanelSpec, InverterSpec, BatterySpec, SolarAssumptions } from '@/lib/types'
import { createClient } from '@supabase/supabase-js'

async function getSignedPdfUrl(pdfPath: string | null): Promise<string | null> {
  if (!pdfPath) return null
  if (pdfPath.startsWith('http')) return pdfPath // already a signed URL

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null

  const supabase = createClient(url, key)
  const fileName = pdfPath.split('/').pop() ?? pdfPath
  const { data } = await supabase.storage
    .from('sunscan-reports')
    .createSignedUrl(fileName, 60 * 60 * 24) // 24h
  return data?.signedUrl ?? null
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params
  const report = await prisma.report.findUnique({ where: { id } })

  if (!report) notFound()

  const panelSpec: PanelSpec = JSON.parse(report.panelSpecJson)
  const inverterSpec: InverterSpec = JSON.parse(report.inverterSpecJson)
  const batterySpec: BatterySpec | null = report.batterySpecJson
    ? JSON.parse(report.batterySpecJson)
    : null
  const assumptions: SolarAssumptions = JSON.parse(report.assumptionsJson)
  const monthlyGenKwh: number[] = JSON.parse(report.monthlyGenJson)
  const twentyFiveYearSavings = JSON.parse(report.twentyFiveYearJson)

  const pdfUrl = await getSignedPdfUrl(report.pdfUrl)

  const data: ReportData = {
    id: report.id,
    quoteNumber: report.quoteNumber,
    createdAt: report.createdAt.toISOString(),
    addressRaw: report.addressRaw,
    lat: report.lat,
    lng: report.lng,
    postcode: report.postcode,
    footprintGeojson: report.footprintGeojson,
    footprintSource: report.footprintSource as 'os_ngd' | 'estimated',
    annualKwh: report.annualKwh,
    tariffPencePerKwh: report.tariffPencePerKwh,
    standingChargePencePerDay: report.standingChargePencePerDay,
    exportTariffPencePerKwh: report.exportTariffPencePerKwh,
    billSource: report.billSource as 'ocr' | 'manual' | 'default',
    panelCount: report.panelCount,
    systemSizeKw: report.systemSizeKw,
    panelSpec,
    inverterSpec,
    batterySpec,
    mcsZone: report.mcsZone,
    irradianceKwhPerM2: report.irradianceKwhPerM2,
    results: {
      annualGenerationKwh: report.annualGenerationKwh,
      selfConsumptionKwh: report.selfConsumptionKwh,
      exportKwh: report.exportKwh,
      selfConsumptionRate: report.selfConsumptionKwh / (report.annualGenerationKwh || 1),
      annualSavingsPounds: report.annualSavingsPounds,
      paybackYears: report.paybackYears,
      co2SavedTonnesPerYear: report.co2SavedTonnesPerYear,
      monthlyGenKwh,
      twentyFiveYearSavings,
    },
    assumptions,
    model3dImageUrl: report.model3dImageUrl,
    pdfUrl,
  }

  return (
    <main className="min-h-screen bg-white">
      <div className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-lg">☀</span>
            <span className="font-bold text-[#1E3A5F]">SunScan</span>
          </div>
          <span className="text-sm text-muted-foreground">{report.quoteNumber}</span>
        </div>
      </div>
      <ReportPreview data={data} pdfUrl={pdfUrl} />
    </main>
  )
}
