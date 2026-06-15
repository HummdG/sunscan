import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'

interface Props {
  params: Promise<{ installerSlug: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  return {
    title: installer ? `Solar & battery estimate · ${installer.name}` : 'SunScan',
    description: 'Find out what solar and battery system could work for your home.',
  }
}

export default async function InstallerLanding({ params }: Props) {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) notFound()

  const primary = installer.branding?.primaryColor ?? '#B04020'
  const tagline = installer.branding?.companyTagline ?? 'Solar & battery storage for your home'

  return (
    <main className="relative mx-auto max-w-3xl px-6 py-20 sm:py-28 text-center">
      {/* soft solar glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--brand-accent) 16%, transparent) 0%, transparent 60%)',
        }}
      />
      <p
        className="ss-mono text-[11px] uppercase"
        style={{ letterSpacing: '0.28em', color: primary }}
      >
        {installer.name} · Solar estimate
      </p>
      <h1
        className="ss-heading mt-5 text-4xl sm:text-[3.25rem] leading-[1.05] font-semibold tracking-tight"
        style={{ color: 'var(--ss-t1)' }}
      >
        Find out what solar &amp; battery could do for your home.
      </h1>
      <p className="mt-6 text-lg leading-relaxed" style={{ color: 'var(--ss-t2)' }}>
        Enter your address and answer a few simple questions. We&apos;ll model your roof, estimate how
        many panels could fit, and show you three system options based on your budget, energy use and
        potential savings.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row gap-3 justify-center">
        <Link
          href={`/${installerSlug}/start`}
          className="inline-flex justify-center rounded-xl px-8 py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ background: primary }}
        >
          Start my estimate
        </Link>
        <Link
          href={`/${installerSlug}/start?intent=survey`}
          className="inline-flex justify-center rounded-xl px-8 py-4 text-base font-semibold transition"
          style={{ color: 'var(--ss-t2)', border: '1px solid var(--ss-border-h)' }}
        >
          Book a free survey
        </Link>
      </div>

      <p className="ss-mono mt-8 text-[11px]" style={{ color: 'var(--ss-t4)' }}>
        {tagline} · Indicative estimate, confirmed by survey
      </p>
    </main>
  )
}
