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

  const primary = installer.branding?.primaryColor ?? '#1d4ed8'
  const accent = installer.branding?.accentColor ?? '#f59e0b'

  const brandVars = {
    '--brand-primary': primary,
    '--brand-accent': accent,
  } as CSSProperties

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900" style={brandVars}>
      <header className="border-b border-slate-200">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Link href={`/${installerSlug}`} className="flex items-center gap-2 no-underline">
            {installer.branding?.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={installer.branding.logoUrl} alt={installer.name} className="h-8 w-auto" />
            ) : (
              <span className="text-lg font-bold" style={{ color: primary }}>
                {installer.name}
              </span>
            )}
          </Link>
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-400">
            Powered by SunScan
          </span>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-slate-200 mt-auto">
        <div className="mx-auto max-w-5xl px-6 py-6 text-xs text-slate-500 space-y-1">
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
