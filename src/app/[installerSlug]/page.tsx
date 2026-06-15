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

  const primary = installer.branding?.primaryColor ?? '#1d4ed8'
  const tagline = installer.branding?.companyTagline ?? 'Solar & battery storage for your home'

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 sm:py-24 text-center">
      <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: primary }}>
        {installer.name}
      </p>
      <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
        Find out what solar and battery system could work for your home.
      </h1>
      <p className="mt-6 text-lg text-slate-600">
        Enter your address and answer a few simple questions. We&apos;ll model your roof, estimate how
        many panels could fit, and show you three system options based on your budget, energy use and
        potential savings.
      </p>

      <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
        <Link
          href={`/${installerSlug}/start`}
          className="inline-flex justify-center rounded-lg px-8 py-4 text-base font-semibold text-white shadow-sm transition hover:opacity-90"
          style={{ background: primary }}
        >
          Start My Estimate
        </Link>
        <Link
          href={`/${installerSlug}/start?intent=survey`}
          className="inline-flex justify-center rounded-lg border border-slate-300 px-8 py-4 text-base font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Book a Free Survey
        </Link>
      </div>

      <p className="mt-8 text-sm text-slate-400">
        {tagline} · Indicative estimate, confirmed by survey.
      </p>
    </main>
  )
}
