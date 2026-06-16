import { notFound } from 'next/navigation'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'
import { InstallerWizard } from '@/components/journey/InstallerWizard'
import type { JourneyIntent } from '@/lib/journey/types'

interface Props {
  params: Promise<{ installerSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function StartPage({ params, searchParams }: Props) {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) notFound()

  const sp = await searchParams
  const intent: JourneyIntent = sp.intent === 'survey' ? 'survey' : 'estimate'

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <InstallerWizard installer={installer} installerSlug={installerSlug} intent={intent} />
    </main>
  )
}
