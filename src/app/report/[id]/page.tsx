import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { ReportPreview } from '@/components/ReportPreview'
import { SystemConfigurator } from '@/components/SystemConfigurator'
import { SunscanMark } from '@/components/SunscanMark'
import { hydrateReportData } from '@/lib/reportData'
import { loadCatalogue } from '@/lib/pricing/catalogueLoader'
import { computeQuote } from '@/lib/pricing/computeQuote'
import type { RoofType, SystemConfig, Tier } from '@/lib/pricing/types'
import { createClient } from '@supabase/supabase-js'

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
    include: { configuration: true },
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

      <div className="max-w-4xl mx-auto px-4 pt-6">
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
