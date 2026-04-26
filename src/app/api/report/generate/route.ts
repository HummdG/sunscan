import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getZoneForPostcode, getIrradianceKwhPerM2 } from '@/lib/mcs'
import { runSolarCalculations, DEFAULT_PANEL, DEFAULT_ASSUMPTIONS } from '@/lib/solarCalculations'
import { estimateRoofPlanes, getBestRoofPlane, wgs84ToLocalMetres, polygonCentroid, polygonArea } from '@/lib/geometry'
import { calculatePanelLayout } from '@/lib/panelLayout'
import { generateReportPdf, generateQuoteNumber } from '@/lib/reportGenerator'
import type { InverterSpec, PanelSpec, BatterySpec, ReportData, SolarAssumptions } from '@/lib/types'
import { createClient } from '@supabase/supabase-js'

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
})

const BodySchema = z.object({
  addressRaw: z.string().min(1),
  addressUprn: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  postcode: z.string().min(1),
  footprintGeojson: z.string().nullable(),
  footprintSource: z.enum(['os_ngd', 'estimated']),
  annualKwh: z.number().min(100).max(100000),
  tariffPencePerKwh: z.number().min(1).max(100),
  standingChargePencePerDay: z.number().min(0).max(200),
  exportTariffPencePerKwh: z.number().min(0).max(50),
  billSource: z.enum(['ocr', 'manual', 'default']),
  assumptions: AssumptionsSchema,
  model3dImageBase64: z.string().optional(),
})

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

    // ── 1. MCS zone + irradiance ─────────────────────────────────────────
    const postcodeDistrict = data.postcode.replace(/\s+/g, '').toUpperCase().slice(0, 4)
    const mcsZone = getZoneForPostcode(data.postcode)
    const irradianceKwhPerM2 = getIrradianceKwhPerM2(
      mcsZone,
      assumptions.roofPitchDeg,
      assumptions.roofOrientationDeg,
    )

    // ── 2. Building footprint → roof planes → panel layout ───────────────
    let footprintLocal: [number, number][]
    let centre: [number, number] = [data.lng, data.lat]

    const FALLBACK_FOOTPRINT: [number, number][] = [[-5, -4], [5, -4], [5, 4], [-5, 4], [-5, -4]]

    if (data.footprintGeojson) {
      const geojson = JSON.parse(data.footprintGeojson) as { type: string; coordinates: number[][][] }
      const ring = geojson.coordinates[0] as [number, number][]
      centre = polygonCentroid(ring)
      footprintLocal = wgs84ToLocalMetres(ring, centre)
      // Guard against degenerate polygons (zero/near-zero area) that produce 0 panels
      if (polygonArea(footprintLocal) < 10) {
        console.warn('Degenerate footprint (area < 10 m²) — falling back to 10×8 m rectangle')
        footprintLocal = FALLBACK_FOOTPRINT
      }
    } else {
      footprintLocal = FALLBACK_FOOTPRINT
    }

    const roofPlanes = estimateRoofPlanes(footprintLocal, assumptions.roofPitchDeg)
    const bestPlane = getBestRoofPlane(roofPlanes)
    const { positions: panelPositions, count: panelCount } = calculatePanelLayout(
      bestPlane,
      DEFAULT_PANEL,
    )

    // ── 3. Solar calculations ────────────────────────────────────────────
    const results = runSolarCalculations(
      panelCount,
      DEFAULT_PANEL,
      irradianceKwhPerM2,
      data.annualKwh,
      assumptions,
    )

    // Patch: use actual tariff from bill data (runSolarCalculations uses a placeholder)
    const selfSaving = (results.selfConsumptionKwh * data.tariffPencePerKwh) / 100
    const exportEarning = (results.exportKwh * assumptions.exportTariffPencePerKwh) / 100
    results.annualSavingsPounds = Math.round(selfSaving + exportEarning)
    results.paybackYears =
      results.annualSavingsPounds > 0
        ? Math.round((assumptions.systemCostPounds / results.annualSavingsPounds) * 10) / 10
        : 99

    // ── 4. Build ReportData ──────────────────────────────────────────────
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
      systemSizeKw: (panelCount * DEFAULT_PANEL.wattPeak) / 1000,
      panelSpec: DEFAULT_PANEL,
      inverterSpec: DEFAULT_INVERTER,
      batterySpec: assumptions.hasBattery ? DEFAULT_BATTERY : null,
      mcsZone,
      irradianceKwhPerM2,
      results,
      assumptions,
    }

    // ── 5. Save to DB ────────────────────────────────────────────────────
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
        systemSizeKw: reportData.systemSizeKw,
        panelSpecJson: JSON.stringify(DEFAULT_PANEL),
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
        model3dImageUrl: data.model3dImageBase64 ? `data:image/png;base64,${data.model3dImageBase64.replace(/^data:image\/\w+;base64,/, '')}` : null,
        status: 'draft',
      },
    })

    // ── 6. Generate PDF ──────────────────────────────────────────────────
    const fullReportData: ReportData = {
      ...reportData,
      id: report.id,
      quoteNumber,
      createdAt: report.createdAt.toISOString(),
      model3dImageUrl: report.model3dImageUrl,
      pdfUrl: null,
    }

    let pdfUrl: string | null = null
    try {
      const pdfBuffer = await generateReportPdf(
        fullReportData,
        data.model3dImageBase64,
      )

      // Try uploading to Supabase Storage
      const supabase = getSupabaseAdmin()
      if (supabase) {
        const fileName = `${report.id}.pdf`
        const { error } = await supabase.storage
          .from('sunscan-reports')
          .upload(fileName, pdfBuffer, {
            contentType: 'application/pdf',
            upsert: true,
          })

        if (!error) {
          const { data: urlData } = await supabase.storage
            .from('sunscan-reports')
            .createSignedUrl(fileName, 60 * 60 * 24 * 7) // 7-day expiry
          pdfUrl = urlData?.signedUrl ?? null
        } else {
          console.error('Supabase Storage upload error:', error)
        }
      }

      // Update DB with PDF URL
      if (pdfUrl) {
        await prisma.report.update({
          where: { id: report.id },
          data: { pdfUrl, status: 'complete' },
        })
      }
    } catch (pdfErr) {
      console.error('PDF generation error:', pdfErr)
      // Non-fatal: report still accessible in browser
    }

    return NextResponse.json({
      reportId: report.id,
      pdfUrl,
      quoteNumber,
    })
  } catch (err) {
    console.error('/api/report/generate error:', err)
    return NextResponse.json({ error: 'Report generation failed' }, { status: 500 })
  }
}
