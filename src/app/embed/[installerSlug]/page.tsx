import type { CSSProperties } from 'react'
import { notFound } from 'next/navigation'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'
import { InstallerWizard } from '@/components/journey/InstallerWizard'
import type { JourneyIntent } from '@/lib/journey/types'

interface Props {
  params: Promise<{ installerSlug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Chromeless wizard for embedding in an installer's own site via <iframe>.
 * Lives outside the /[installerSlug] layout, so no SunScan header/footer — it
 * sets the brand CSS vars + warm canvas itself.
 */
export default async function EmbedPage({ params, searchParams }: Props) {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) notFound()

  const sp = await searchParams
  const intent: JourneyIntent = sp.intent === 'survey' ? 'survey' : 'estimate'

  const shell = {
    '--brand-primary': installer.branding?.primaryColor ?? '#B04020',
    '--brand-accent': installer.branding?.accentColor ?? '#D97706',
    background: 'var(--ss-ink)',
    color: 'var(--ss-t1)',
    minHeight: '100vh',
  } as CSSProperties

  return (
    <div style={shell}>
      <main className="mx-auto max-w-2xl px-6 py-8">
        <InstallerWizard installer={installer} installerSlug={installerSlug} intent={intent} />
      </main>
    </div>
  )
}
