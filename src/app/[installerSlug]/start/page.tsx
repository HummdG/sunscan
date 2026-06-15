import { notFound } from 'next/navigation'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'
import { StartWizard } from '@/components/journey/StartWizard'
import type { BudgetBand, SurveyOptions } from '@/components/journey/StartWizard'
import type { JourneyIntent } from '@/lib/journey/types'

interface Props {
  params: Promise<{ installerSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const DEFAULT_BUDGET_BANDS: BudgetBand[] = [
  { id: 'under_6k', label: 'Under £6,000', minGbp: 0, maxGbp: 6000 },
  { id: '6k_10k', label: '£6,000 to £10,000', minGbp: 6000, maxGbp: 10000 },
  { id: '10k_15k', label: '£10,000 to £15,000', minGbp: 10000, maxGbp: 15000 },
  { id: '15k_plus', label: '£15,000+', minGbp: 15000, maxGbp: 30000 },
  { id: 'unsure', label: "I'm not sure yet", minGbp: 0, maxGbp: 30000 },
]

const DEFAULT_SURVEY_OPTIONS: SurveyOptions = { remote: true, onsite: true, installerChoice: true }

function parseBudgetBands(raw: unknown): BudgetBand[] {
  if (!Array.isArray(raw)) return DEFAULT_BUDGET_BANDS
  const bands = raw.filter(
    (b): b is BudgetBand =>
      typeof b === 'object' &&
      b !== null &&
      typeof (b as Record<string, unknown>).id === 'string' &&
      typeof (b as Record<string, unknown>).label === 'string',
  )
  return bands.length > 0 ? bands : DEFAULT_BUDGET_BANDS
}

function parseSurveyOptions(raw: unknown): SurveyOptions {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_SURVEY_OPTIONS
  const o = raw as Record<string, unknown>
  return {
    remote: typeof o.remote === 'boolean' ? o.remote : DEFAULT_SURVEY_OPTIONS.remote,
    onsite: typeof o.onsite === 'boolean' ? o.onsite : DEFAULT_SURVEY_OPTIONS.onsite,
    installerChoice:
      typeof o.installerChoice === 'boolean'
        ? o.installerChoice
        : DEFAULT_SURVEY_OPTIONS.installerChoice,
  }
}

export default async function StartPage({ params, searchParams }: Props) {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) notFound()

  const sp = await searchParams
  const intent: JourneyIntent = sp.intent === 'survey' ? 'survey' : 'estimate'

  const budgetBands = parseBudgetBands(installer.config?.budgetBandsJson)
  const surveyOptions = parseSurveyOptions(installer.config?.surveyOptionsJson)

  const primary = installer.branding?.primaryColor ?? '#B04020'
  const accent = installer.branding?.accentColor ?? '#D97706'

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <StartWizard
        installerSlug={installerSlug}
        installerName={installer.name}
        brand={{ primary, accent }}
        budgetBands={budgetBands}
        surveyOptions={surveyOptions}
        intent={intent}
      />
    </main>
  )
}
