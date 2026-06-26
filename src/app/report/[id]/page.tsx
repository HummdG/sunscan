import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { ReportPreview } from '@/components/ReportPreview'
import { SystemConfigurator } from '@/components/SystemConfigurator'
import { ReportBudgetExplorer } from '@/components/budget/ReportBudgetExplorer'
import { SunscanMark } from '@/components/SunscanMark'
import { hydrateReportData } from '@/lib/reportData'
import { loadCatalogue } from '@/lib/pricing/catalogueLoader'
import { computeQuote } from '@/lib/pricing/computeQuote'
import { buildBudgetLadder } from '@/lib/recommend/buildBudgetLadder'
import type { OptionSetInput } from '@/lib/recommend/optionTypes'
import type { BudgetLadder } from '@/lib/recommend/ladderTypes'
import type { RoofType, SystemConfig, Tier } from '@/lib/pricing/types'
import type { GoogleSolarBuildingInsights, SolarAssumptions } from '@/lib/types'
import { createClient } from '@supabase/supabase-js'

// Lead.existingSolar (new|upgrade|retrofit|optimisation) → journey ExistingSystem,
// inverting the lead route's EXISTING_MAP so the ladder's battery affinity is faithful.
const EXISTING_REVERSE: Record<string, string> = {
  new: 'none',
  upgrade: 'solar',
  retrofit: 'battery',
  optimisation: 'solar_battery',
}

async function getSignedPdfUrl(pdfPath: string | null): Promise<string | null> {
  if (!pdfPath) return null
  if (pdfPath.startsWith('http')) return pdfPath

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null

  const supabase = createClient(url, key)
  const fileName = pdfPath.split('/').pop() ?? pdfPath
  const { data } = await supabase.storage
    .from('sunscan-reports')
    .createSignedUrl(fileName, 60 * 60 * 24)
  return data?.signedUrl ?? null
}

function legacyConfigFromReport(panelCount: number, panelSku: string): SystemConfig {
  return {
    tier: 'custom',
    panelSku,
    panelCount,
    mountingSku: 'MOUNT-PITCHED-TILE',
    battery: null,
    scaffoldingExtras: [],
    electricalExtras: [],
    optionalExtras: [],
    trenching: null,
    birdMesh: false,
    optimiserScope: 'none',
  }
}

interface Props {
  params: Promise<{ id: string }>
}

export default async function ReportPage({ params }: Props) {
  const { id } = await params
  const report = await prisma.report.findUnique({
    where: { id },
    include: { configuration: true, lead: true, installer: { include: { branding: true } } },
  })

  if (!report) notFound()

  const data = hydrateReportData(report)
  const pdfUrl = await getSignedPdfUrl(report.pdfUrl)
  data.pdfUrl = pdfUrl

  // Build configurator props
  const catalogue = await loadCatalogue()
  const assumptions = JSON.parse(report.assumptionsJson) as { roofPitchDeg?: number }
  const roofType: RoofType = (assumptions.roofPitchDeg ?? 35) < 10 ? 'flat' : 'pitched'

  let initialConfig: SystemConfig
  let initialTier: Tier = 'custom'
  if (report.configuration) {
    initialConfig = JSON.parse(report.configuration.configJson) as SystemConfig
    initialTier = report.configuration.tier as Tier
  } else {
    // Synthesise a legacy config — base panel only, no battery, default mounting + admin
    initialConfig = legacyConfigFromReport(report.panelCount, 'DMEGC-DM430')
    initialTier = 'custom'
  }

  // Compute the live quote from this config (handles both fresh and legacy reports)
  const initialQuote = computeQuote(initialConfig, {
    catalogue,
    annualKwh: report.annualKwh,
    roofMaxPanels: Math.max(report.panelCount, initialConfig.panelCount),
    roofType,
  })

  // ── Budget ladder for the slider ──
  // Built from the report's persisted physics + financials, with battery-affinity
  // context recovered from the linked Lead (neutral when there is no lead). Uses the
  // same default catalogue and raw (margin-free) pricing as the configurator on this
  // page so the slider's prices match what saving a step recomputes.
  const fullAssumptions = JSON.parse(report.assumptionsJson) as SolarAssumptions
  const lead = report.lead
  const solarInsights = report.solarApiJson
    ? (JSON.parse(report.solarApiJson) as GoogleSolarBuildingInsights)
    : null
  const ladderInput: OptionSetInput = {
    catalogue,
    roofMaxPanels: Math.max(lead?.maxPanelCount ?? 0, report.panelCount, 12),
    roofType,
    pitchDeg: fullAssumptions.roofPitchDeg ?? 35,
    mcsOrientationDeg: fullAssumptions.roofOrientationDeg ?? 0,
    solarInsights,
    annualKwh: report.annualKwh,
    importTariffPence: report.tariffPencePerKwh,
    exportTariffPence: report.exportTariffPencePerKwh,
    tariffType: lead?.tariffType ?? 'unknown',
    lifestyle: lead?.lifestyleTags ?? [],
    motivation: lead?.motivation ?? null,
    existing: lead ? (EXISTING_REVERSE[lead.existingSolar] ?? null) : null,
    sentinelConfig: null,
    mcsZone: report.mcsZone,
    irradianceKwhPerM2: report.irradianceKwhPerM2,
    shadingLoss: fullAssumptions.shadingLoss ?? 0.05,
    inverterLoss: fullAssumptions.inverterLoss ?? 0.03,
    systemLoss: fullAssumptions.systemLoss ?? 0.1,
    energyInflationRate: fullAssumptions.energyInflationRate ?? 0.03,
    panelDegradationPerYear: fullAssumptions.panelDegradationPerYear ?? 0.005,
    minPanels: 6,
    maxPanels: 50,
    marginPercent: 0,
    budgetMaxGbp: initialQuote.totalPounds,
  }
  let ladder: BudgetLadder | null = null
  try {
    ladder = buildBudgetLadder(ladderInput)
  } catch {
    ladder = null
  }
  const brandPrimary = report.installer?.branding?.primaryColor ?? '#1d4ed8'

  return (
    <main className="min-h-screen" style={{ background: 'linear-gradient(180deg, #FAF6EC 0%, #F4ECD6 100%)' }}>
      <header
        className="sticky top-0 z-50 border-b"
        style={{
          background: 'rgba(250,246,236,0.85)',
          backdropFilter: 'blur(20px) saturate(180%)',
          borderColor: 'var(--ss-border)',
        }}
      >
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <SunscanMark size={32} />
            <span
              className="ss-heading font-bold text-lg tracking-wide"
              style={{ color: 'var(--ss-t1)' }}
            >
              SUN<span style={{ color: 'var(--ss-blue)' }}>SCAN</span>
            </span>
          </div>
          <span
            className="ss-mono text-[11px] uppercase"
            style={{ letterSpacing: '0.22em', color: 'var(--ss-t3)' }}
          >
            {report.quoteNumber}
          </span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 pt-6 space-y-6">
        {ladder ? (
          <ReportBudgetExplorer
            reportId={report.id}
            ladder={ladder}
            brandPrimary={brandPrimary}
            initialBudgetGbp={initialQuote.totalPounds}
          />
        ) : null}
        <SystemConfigurator
          reportId={report.id}
          initialConfig={initialConfig}
          initialQuote={initialQuote}
          catalogue={catalogue}
          roofMaxPanels={Math.max(report.panelCount, 12)}
          roofType={roofType}
          initialTier={initialTier}
        />
      </div>

      <ReportPreview data={data} pdfUrl={pdfUrl} />
    </main>
  )
}
