import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { generateReportPdf } from '@/lib/reportGenerator'
import type { ReportData, PanelSpec, InverterSpec, BatterySpec, SolarAssumptions } from '@/lib/types'

export async function GET(
  _: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const report = await prisma.report.findUnique({ where: { id } })
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const panelSpec: PanelSpec = JSON.parse(report.panelSpecJson)
  const inverterSpec: InverterSpec = JSON.parse(report.inverterSpecJson)
  const batterySpec: BatterySpec | null = report.batterySpecJson
    ? JSON.parse(report.batterySpecJson)
    : null
  const assumptions: SolarAssumptions = JSON.parse(report.assumptionsJson)
  const monthlyGenKwh: number[] = JSON.parse(report.monthlyGenJson)
  const twentyFiveYearSavings = JSON.parse(report.twentyFiveYearJson)

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
    pdfUrl: null,
  }

  try {
    const pdfBuffer = await generateReportPdf(
      data,
      report.model3dImageUrl ?? undefined,
    )

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="SunScan-${report.quoteNumber}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error(`PDF generation error for report ${id}:`, err)
    return NextResponse.json({ error: 'PDF generation failed' }, { status: 500 })
  }
}
