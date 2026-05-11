import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getZoneForPostcode, getIrradianceKwhPerM2 } from '@/lib/mcs'
import {
  runSolarCalculations,
  runSolarCalculationsFromGoogleData,
  DEFAULT_PANEL,
  DEFAULT_ASSUMPTIONS,
  calcAnnualGeneration,
  calcSystemSizeKw,
} from '@/lib/solarCalculations'
import { estimateRoofPlanes, getBestRoofPlane, wgs84ToLocalMetres, polygonCentroid, polygonArea } from '@/lib/geometry'
import { calculatePanelLayout } from '@/lib/panelLayout'
import { generateReportPdf, generateQuoteNumber } from '@/lib/reportGenerator'
import { selectOptimalPanelConfig } from '@/lib/googleSolarApi'
import { loadCatalogue, CATALOGUE_VERSION } from '@/lib/pricing/catalogueLoader'
import { computeQuote } from '@/lib/pricing/computeQuote'
import type {
  InverterSpec,
  PanelSpec,
  BatterySpec,
  ReportData,
  SolarAssumptions,
  GoogleSolarBuildingInsights,
  DataConfidence,
} from '@/lib/types'
import type { PricingContext, RoofType, SystemConfig, QuoteBreakdown } from '@/lib/pricing/types'
import { createClient } from '@supabase/supabase-js'
import type { Prisma } from '@prisma/client'

// ─── Supabase Storage client (server-side only) ──────────────────────────────

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

// ─── Request validation ───────────────────────────────────────────────────────

const AssumptionsSchema = z.object({
  roofPitchDeg: z.number().min(0).max(90).default(DEFAULT_ASSUMPTIONS.roofPitchDeg),
  roofOrientationDeg: z.number().min(0).max(180).default(DEFAULT_ASSUMPTIONS.roofOrientationDeg),
  shadingLoss: z.number().min(0).max(1).default(DEFAULT_ASSUMPTIONS.shadingLoss),
  inverterLoss: z.number().min(0).max(1).default(DEFAULT_ASSUMPTIONS.inverterLoss),
  systemLoss: z.number().min(0).max(1).default(DEFAULT_ASSUMPTIONS.systemLoss),
  systemCostPounds: z.number().min(0).default(DEFAULT_ASSUMPTIONS.systemCostPounds),
  hasBattery: z.boolean().default(false),
  batteryKwh: z.number().min(0).default(DEFAULT_ASSUMPTIONS.batteryKwh),
  exportTariffPencePerKwh: z.number().min(0).default(DEFAULT_ASSUMPTIONS.exportTariffPencePerKwh),
  energyInflationRate: z.number().min(0).max(0.2).optional(),
  panelDegradationPerYear: z.number().min(0).max(0.05).optional(),
})

const DataConfidenceSchema = z.object({
  roof: z.enum(['os-confirmed', 'user-confirmed']),
  consumption: z.enum(['ocr-confirmed', 'manual-confirmed']),
  tariff: z.enum(['ocr', 'manual']),
})

const BodySchema = z.object({
  addressRaw: z.string().min(1),
  addressUprn: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  postcode: z.string().min(1),
  footprintGeojson: z.string().nullable(),
  footprintSource: z.enum(['os_ngd', 'estimated', 'google_solar']),
  annualKwh: z.number().min(100).max(100000),
  tariffPencePerKwh: z.number().min(1).max(100),
  standingChargePencePerDay: z.number().min(0).max(200),
  exportTariffPencePerKwh: z.number().min(0).max(50),
  billSource: z.enum(['ocr', 'manual']),
  assumptions: AssumptionsSchema,
  solarApiJson: z.string().optional(),
  model3dImageBase64: z.string().optional(),
  selectedTier: z.enum(['essential', 'standard', 'premium']).optional(),
  selectedConfig: z.unknown().optional(),
  dataConfidence: DataConfidenceSchema,
})

type GenerateReason =
  | 'no-footprint'
  | 'no-roof-data'
  | 'low-ocr-confidence'
  | 'no-tariff'

function reject(reason: GenerateReason, message: string) {
  return NextResponse.json({ error: message, reason }, { status: 422 })
}

// ─── Default specs ────────────────────────────────────────────────────────────

const DEFAULT_INVERTER: InverterSpec = {
  modelName: 'SolarEdge SE5000H Inverter',
  ratedKw: 5,
  efficiency: 0.97,
}

const DEFAULT_BATTERY: BatterySpec = {
  modelName: 'SolarEdge Home Battery 9.7 kWh',
  capacityKwh: 9.7,
  roundTripEfficiency: 0.90,
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = BodySchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      )
    }

    const data = parsed.data
    const assumptions: SolarAssumptions = data.assumptions
    const dataConfidence: DataConfidence = data.dataConfidence
    // Use the bill's export tariff as the source of truth for savings — these can drift
    // from the modelling default in assumptions.
    assumptions.exportTariffPencePerKwh = data.exportTariffPencePerKwh

    // ── 0. Block silent fallbacks ─────────────────────────────────────────
    // If the wizard claims OS-confirmed roof data, the footprint must be present.
    if (dataConfidence.roof === 'os-confirmed' && !data.footprintGeojson && !data.solarApiJson) {
      return reject(
        'no-footprint',
        'OS-confirmed roof claimed but no footprint or Solar API data was supplied.',
      )
    }
    // If the user is the source-of-truth, we need explicit pitch + orientation.
    if (dataConfidence.roof === 'user-confirmed') {
      if (assumptions.roofPitchDeg <= 0 || assumptions.roofOrientationDeg < 0) {
        return reject('no-roof-data', 'Roof pitch and orientation must be provided by the user.')
      }
    }
    if (data.tariffPencePerKwh <= 0) {
      return reject('no-tariff', 'A unit electricity tariff is required.')
    }

    // ── 1. MCS zone + irradiance (always computed — used as verification) ──
    const postcodeDistrict = data.postcode.replace(/\s+/g, '').toUpperCase().slice(0, 4)
    const mcsZone = getZoneForPostcode(data.postcode)
    const irradianceKwhPerM2 = getIrradianceKwhPerM2(
      mcsZone,
      assumptions.roofPitchDeg,
      assumptions.roofOrientationDeg,
    )

    // ── 2. Determine panel count + generation source ──────────────────────

    let panelCount = 0
    let systemSizeKw = 0
    let panelSpec: PanelSpec = DEFAULT_PANEL
    let panelPositions: ReturnType<typeof calculatePanelLayout>['positions'] = []
    let solarInsights: GoogleSolarBuildingInsights | null = null
    let solarCoveragePercent: number | null = null
    let imageryQuality: string | null = null
    let mcsGenerationKwh: number | null = null

    if (data.solarApiJson) {
      // ── Google Solar primary path ──────────────────────────────────────
      try {
        solarInsights = JSON.parse(data.solarApiJson) as GoogleSolarBuildingInsights
        const sp = solarInsights.solarPotential
        imageryQuality = solarInsights.imageryQuality ?? null

        const optimalConfig = selectOptimalPanelConfig(
          sp.solarPanelConfigs,
          data.annualKwh,
          assumptions.inverterLoss,
          assumptions.systemLoss,
        )

        if (optimalConfig) {
          panelCount = optimalConfig.panelsCount
          panelSpec = {
            widthMm: Math.round(sp.panelWidthMeters * 1000),
            heightMm: Math.round(sp.panelHeightMeters * 1000),
            depthMm: 30,
            wattPeak: sp.panelCapacityWatts,
            modelName: `Google Solar ${sp.panelCapacityWatts}W Panel`,
          }
          systemSizeKw = (panelCount * sp.panelCapacityWatts) / 1000
        } else {
          // Fallback: use max panels from Solar API
          panelCount = sp.maxArrayPanelsCount
          panelSpec = {
            widthMm: Math.round(sp.panelWidthMeters * 1000),
            heightMm: Math.round(sp.panelHeightMeters * 1000),
            depthMm: 30,
            wattPeak: sp.panelCapacityWatts,
            modelName: `Google Solar ${sp.panelCapacityWatts}W Panel`,
          }
          systemSizeKw = (panelCount * sp.panelCapacityWatts) / 1000
        }

        // MCS comparison figure
        mcsGenerationKwh = Math.round(
          calcAnnualGeneration(systemSizeKw, irradianceKwhPerM2, assumptions),
        )
      } catch (parseErr) {
        console.error('Failed to parse solarApiJson', parseErr)
        // Fall through to legacy path
        solarInsights = null
      }
    }

    if (!solarInsights) {
      // ── Legacy path: OS NGD footprint → estimated roof planes ──────────
      // We deliberately do NOT invent a fallback footprint. If we reach here
      // without footprintGeojson, the wizard's Review step has either failed
      // to validate or the dataConfidence claim doesn't match. Refuse.
      if (!data.footprintGeojson) {
        return reject(
          'no-footprint',
          'No roof geometry available. Confirm the roof on the Review step before generating.',
        )
      }

      const geojson = JSON.parse(data.footprintGeojson) as { type: string; coordinates: number[][][] }
      const ring = geojson.coordinates[0] as [number, number][]
      const centre = polygonCentroid(ring)
      const footprintLocal = wgs84ToLocalMetres(ring, centre)
      if (polygonArea(footprintLocal) < 10) {
        return reject(
          'no-roof-data',
          'The detected building footprint is too small to size a system. Please confirm the roof on the Review step.',
        )
      }

      const roofPlanes = estimateRoofPlanes(footprintLocal, assumptions.roofPitchDeg)
      const bestPlane = getBestRoofPlane(roofPlanes)
      const layout = calculatePanelLayout(bestPlane, DEFAULT_PANEL)
      panelCount = layout.count
      panelPositions = layout.positions
      systemSizeKw = calcSystemSizeKw(panelCount, DEFAULT_PANEL)
      panelSpec = DEFAULT_PANEL
    }

    // ── 2.5. Pricing quote (if user selected a tier) ──────────────────────
    let quote: QuoteBreakdown | null = null
    if (data.selectedConfig) {
      try {
        const catalogue = await loadCatalogue()
        const roofType: RoofType = assumptions.roofPitchDeg < 10 ? 'flat' : 'pitched'
        const ctx: PricingContext = {
          catalogue,
          annualKwh: data.annualKwh,
          roofMaxPanels: solarInsights?.solarPotential.maxArrayPanelsCount ?? Math.max(panelCount, 6),
          roofType,
        }
        // Server trusts the panelCount from the configurator's selection but caps to roofMaxPanels.
        const cfg = data.selectedConfig as SystemConfig
        const safeConfig: SystemConfig = {
          ...cfg,
          panelCount: Math.min(Math.max(1, Math.round(cfg.panelCount)), 50),
        }
        quote = computeQuote(safeConfig, ctx)
        // Override the assumption so payback + 25-year projection use the real cost.
        assumptions.systemCostPounds = quote.totalPounds
        // Also align panelCount with the selected configuration so the layout matches.
        panelCount = safeConfig.panelCount
        systemSizeKw = (panelCount * panelSpec.wattPeak) / 1000
      } catch (err) {
        console.error('Pricing computeQuote failed:', err)
      }
    }

    // ── 3. Solar calculations ─────────────────────────────────────────────
    let results

    if (solarInsights) {
      const sp = solarInsights.solarPotential
      const optimalConfig = selectOptimalPanelConfig(
        sp.solarPanelConfigs,
        data.annualKwh,
        assumptions.inverterLoss,
        assumptions.systemLoss,
      )
      const yearlyDc = optimalConfig?.yearlyEnergyDcKwh ?? (panelCount * sp.panelCapacityWatts / 1000 * irradianceKwhPerM2)

      results = runSolarCalculationsFromGoogleData(
        yearlyDc,
        panelCount,
        sp.panelCapacityWatts,
        data.annualKwh,
        data.tariffPencePerKwh,
        assumptions,
      )

      solarCoveragePercent = Math.round((results.annualGenerationKwh / data.annualKwh) * 1000) / 10
    } else {
      results = runSolarCalculations(
        panelCount,
        panelSpec,
        irradianceKwhPerM2,
        data.annualKwh,
        data.tariffPencePerKwh,
        assumptions,
      )
    }

    // ── 4. Build ReportData ───────────────────────────────────────────────
    const reportData: Omit<ReportData, 'id' | 'quoteNumber' | 'createdAt' | 'pdfUrl' | 'model3dImageUrl'> = {
      addressRaw: data.addressRaw,
      lat: data.lat,
      lng: data.lng,
      postcode: data.postcode,
      footprintGeojson: data.footprintGeojson,
      footprintSource: data.footprintSource,
      annualKwh: data.annualKwh,
      tariffPencePerKwh: data.tariffPencePerKwh,
      standingChargePencePerDay: data.standingChargePencePerDay,
      exportTariffPencePerKwh: data.exportTariffPencePerKwh,
      billSource: data.billSource,
      panelCount,
      systemSizeKw,
      panelSpec,
      inverterSpec: DEFAULT_INVERTER,
      batterySpec: assumptions.hasBattery ? DEFAULT_BATTERY : null,
      mcsZone,
      irradianceKwhPerM2,
      results,
      assumptions,
      solarApiData: solarInsights,
      solarCoveragePercent,
      imageryQuality: imageryQuality as 'HIGH' | 'MEDIUM' | 'LOW' | null,
      mcsGenerationKwh,
      dataConfidence,
    }

    // ── 5. Save to DB ─────────────────────────────────────────────────────
    const existingCount = await prisma.report.count()
    const quoteNumber = generateQuoteNumber(existingCount + 1)

    const report = await prisma.report.create({
      data: {
        quoteNumber,
        addressRaw: data.addressRaw,
        addressUprn: data.addressUprn,
        lat: data.lat,
        lng: data.lng,
        postcode: data.postcode,
        postcodeDistrict,
        footprintGeojson: data.footprintGeojson,
        footprintSource: data.footprintSource,
        annualKwh: data.annualKwh,
        tariffPencePerKwh: data.tariffPencePerKwh,
        standingChargePencePerDay: data.standingChargePencePerDay,
        exportTariffPencePerKwh: data.exportTariffPencePerKwh,
        billSource: data.billSource,
        panelCount,
        systemSizeKw,
        panelSpecJson: JSON.stringify(panelSpec),
        inverterSpecJson: JSON.stringify(DEFAULT_INVERTER),
        batterySpecJson: assumptions.hasBattery ? JSON.stringify(DEFAULT_BATTERY) : null,
        mcsZone,
        irradianceKwhPerM2,
        annualGenerationKwh: results.annualGenerationKwh,
        selfConsumptionKwh: results.selfConsumptionKwh,
        exportKwh: results.exportKwh,
        annualSavingsPounds: results.annualSavingsPounds,
        paybackYears: results.paybackYears,
        co2SavedTonnesPerYear: results.co2SavedTonnesPerYear,
        monthlyGenJson: JSON.stringify(results.monthlyGenKwh),
        twentyFiveYearJson: JSON.stringify(results.twentyFiveYearSavings),
        assumptionsJson: JSON.stringify(assumptions),
        panelLayoutJson: JSON.stringify(panelPositions),
        model3dImageUrl: data.model3dImageBase64
          ? `data:image/png;base64,${data.model3dImageBase64.replace(/^data:image\/\w+;base64,/, '')}`
          : null,
        status: 'draft',
        solarApiJson: data.solarApiJson ?? null,
        solarCoveragePercent,
        imageryQuality,
        mcsGenerationKwh,
        dataConfidence: dataConfidence as unknown as Prisma.InputJsonValue,
      },
    })

    // ── 5b. Save SystemConfiguration (if a tier was chosen) ───────────────
    if (quote && data.selectedConfig) {
      try {
        await prisma.systemConfiguration.create({
          data: {
            reportId: report.id,
            tier: data.selectedTier ?? 'custom',
            configJson: JSON.stringify(data.selectedConfig),
            lineItemsJson: JSON.stringify(quote),
            totalPounds: quote.totalPounds,
            vatRatePercent: quote.vatRatePercent,
            catalogueVersion: CATALOGUE_VERSION,
          },
        })
      } catch (cfgErr) {
        console.error('Failed to persist SystemConfiguration:', cfgErr)
      }
    }

    // ── 6. Generate PDF ───────────────────────────────────────────────────
    const fullReportData: ReportData = {
      ...reportData,
      id: report.id,
      quoteNumber,
      createdAt: report.createdAt.toISOString(),
      model3dImageUrl: report.model3dImageUrl,
      pdfUrl: null,
      quote,
    }

    let pdfUrl: string | null = null
    try {
      const pdfBuffer = await generateReportPdf(fullReportData, data.model3dImageBase64)

      const supabase = getSupabaseAdmin()
      if (supabase) {
        const fileName = `${report.id}.pdf`
        const { error } = await supabase.storage
          .from('sunscan-reports')
          .upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true })

        if (!error) {
          const { data: urlData } = await supabase.storage
            .from('sunscan-reports')
            .createSignedUrl(fileName, 60 * 60 * 24 * 7)
          pdfUrl = urlData?.signedUrl ?? null
        } else {
          console.error('Supabase Storage upload error:', error)
        }
      }

      if (pdfUrl) {
        await prisma.report.update({
          where: { id: report.id },
          data: { pdfUrl, status: 'complete' },
        })
      }
    } catch (pdfErr) {
      console.error('PDF generation error:', pdfErr)
    }

    return NextResponse.json({ reportId: report.id, pdfUrl, quoteNumber })
  } catch (err) {
    console.error('/api/report/generate error:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
