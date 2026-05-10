// Hydrate a Prisma Report row (with optional SystemConfiguration) into a ReportData object.
// Single source of truth for the report → ReportData mapping used by the report page,
// /api/report/[id]/pdf, /api/report/[id]/configuration, and the PDF renderer.

import type { Prisma } from '@prisma/client'
import type {
  BatterySpec,
  InverterSpec,
  PanelSpec,
  ReportData,
  SolarAssumptions,
} from './types'
import type { QuoteBreakdown } from './pricing/types'

type ReportWithConfig = Prisma.ReportGetPayload<{ include: { configuration: true } }>

export function hydrateReportData(report: ReportWithConfig): ReportData {
  const panelSpec: PanelSpec = JSON.parse(report.panelSpecJson)
  const inverterSpec: InverterSpec = JSON.parse(report.inverterSpecJson)
  const batterySpec: BatterySpec | null = report.batterySpecJson
    ? JSON.parse(report.batterySpecJson)
    : null
  const assumptions: SolarAssumptions = JSON.parse(report.assumptionsJson)
  const monthlyGenKwh: number[] = JSON.parse(report.monthlyGenJson)
  const twentyFiveYearSavings = JSON.parse(report.twentyFiveYearJson)

  let quote: QuoteBreakdown | null = null
  if (report.configuration) {
    try {
      quote = JSON.parse(report.configuration.lineItemsJson) as QuoteBreakdown
    } catch (err) {
      console.error(`Failed to parse SystemConfiguration.lineItemsJson for ${report.id}`, err)
    }
  }

  return {
    id: report.id,
    quoteNumber: report.quoteNumber,
    createdAt: report.createdAt.toISOString(),
    addressRaw: report.addressRaw,
    lat: report.lat,
    lng: report.lng,
    postcode: report.postcode,
    footprintGeojson: report.footprintGeojson,
    footprintSource: report.footprintSource as 'os_ngd' | 'estimated' | 'google_solar',
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
    pdfUrl: report.pdfUrl,
    quote,
  }
}
