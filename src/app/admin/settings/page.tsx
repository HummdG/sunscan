import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getInstallerSession } from '@/lib/auth/session'
import { SettingsForm, type SettingsInitial } from '@/components/admin/SettingsForm'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const session = await getInstallerSession()
  if (!session) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: 'var(--ss-ink)', color: 'var(--ss-t2)' }}
      >
        <p>Your account isn&apos;t linked to an installer.</p>
      </main>
    )
  }

  const [config, branding] = await Promise.all([
    prisma.installerConfig.findUnique({ where: { installerId: session.installerId } }),
    prisma.installerBranding.findUnique({ where: { installerId: session.installerId } }),
  ])

  const sentinel = (config?.sentinelConfigJson as { baseUpliftPercent?: number } | null) ?? {}
  const budgetBands = (config?.budgetBandsJson as SettingsInitial['budgetBands']) ?? []

  const initial: SettingsInitial = {
    notificationEmail: config?.notificationEmail ?? '',
    crmWebhookUrl: config?.crmWebhookUrl ?? '',
    crmWebhookSecret: config?.crmWebhookSecret ?? '',
    sentinelEnabled: config?.sentinelEnabled ?? true,
    sentinelBaseUpliftPercent: sentinel.baseUpliftPercent ?? 0.12,
    marginPercent: config?.marginPercent ?? 0,
    budgetBands,
    branding: {
      primaryColor: branding?.primaryColor ?? '#B04020',
      accentColor: branding?.accentColor ?? '#D97706',
      companyTagline: branding?.companyTagline ?? '',
      contactEmail: branding?.contactEmail ?? '',
      logoUrl: branding?.logoUrl ?? '',
    },
  }

  return (
    <main className="min-h-screen" style={{ background: 'var(--ss-ink)', color: 'var(--ss-t1)' }}>
      <header className="border-b" style={{ borderColor: 'var(--ss-border)' }}>
        <div className="mx-auto max-w-2xl px-6 py-4 flex items-center justify-between">
          <div>
            <span className="ss-mono text-[10px] uppercase block" style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)' }}>
              SunScan · Settings
            </span>
            <span className="ss-heading text-lg font-semibold">{session.installer.name}</span>
          </div>
          <Link
            href="/admin"
            className="ss-mono text-[10px] uppercase"
            style={{ letterSpacing: '0.18em', color: 'var(--ss-t3)' }}
          >
            ← Leads
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-8">
        <SettingsForm initial={initial} />
      </div>
    </main>
  )
}
