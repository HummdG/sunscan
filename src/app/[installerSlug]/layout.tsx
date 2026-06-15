import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'

interface Props {
  children: ReactNode
  params: Promise<{ installerSlug: string }>
}

export default async function InstallerLayout({ children, params }: Props) {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) notFound()

  const primary = installer.branding?.primaryColor ?? '#B04020'
  const accent = installer.branding?.accentColor ?? '#D97706'

  const shell = {
    '--brand-primary': primary,
    '--brand-accent': accent,
    background: 'var(--ss-ink)',
    color: 'var(--ss-t1)',
  } as CSSProperties

  return (
    <div className="min-h-screen flex flex-col" style={shell}>
      <header className="border-b" style={{ borderColor: 'var(--ss-border)' }}>
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href={`/${installerSlug}`} className="flex items-center gap-2.5 no-underline">
            {installer.branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={installer.branding.logoUrl} alt={installer.name} className="h-8 w-auto" />
            ) : (
              <span
                className="ss-heading text-lg font-semibold tracking-tight"
                style={{ color: primary }}
              >
                {installer.name}
              </span>
            )}
          </Link>
          <span
            className="ss-mono text-[10px] uppercase"
            style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)' }}
          >
            Powered by SunScan
          </span>
        </div>
      </header>

      <div className="flex-1 flex flex-col">{children}</div>

      <footer className="border-t mt-auto" style={{ borderColor: 'var(--ss-border)' }}>
        <div
          className="mx-auto max-w-5xl px-6 py-6 text-xs space-y-1"
          style={{ color: 'var(--ss-t3)' }}
        >
          <p>
            Estimates are indicative only and confirmed by survey.
            {installer.branding?.contactEmail ? ` · ${installer.branding.contactEmail}` : ''}
          </p>
          {installer.branding?.privacyUrl ? (
            <a href={installer.branding.privacyUrl} className="underline">
              Privacy policy
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  )
}
