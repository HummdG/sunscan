import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getInstallerSession } from '@/lib/auth/session'
import { SignOutButton } from '@/components/admin/SignOutButton'

export const dynamic = 'force-dynamic'

type Band = 'hot' | 'warm' | 'nurture'
const BAND_COLOR: Record<Band, string> = {
  hot: '#B04020',
  warm: '#D97706',
  nurture: '#8A6440',
}

interface OptionLite {
  label: string
  kind: string
  panelCount: number
  priceGbp: number
  isRecommended?: boolean
  results?: { paybackYears?: number }
}

function ScoreBadge({ band }: { band: string }) {
  const color = BAND_COLOR[band as Band] ?? 'var(--ss-t3)'
  return (
    <span
      className="ss-mono inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase font-semibold text-white"
      style={{ letterSpacing: '0.12em', background: color }}
    >
      {band}
    </span>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="ss-mono text-[9px] uppercase block" style={{ letterSpacing: '0.16em', color: 'var(--ss-t4)' }}>
        {label}
      </span>
      <span className="text-sm" style={{ color: 'var(--ss-t1)' }}>
        {value || '—'}
      </span>
    </div>
  )
}

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ score?: string }>
}) {
  const session = await getInstallerSession()
  if (!session) {
    return (
      <main
        className="min-h-screen flex flex-col items-center justify-center gap-4 px-6 text-center"
        style={{ background: 'var(--ss-ink)', color: 'var(--ss-t1)' }}
      >
        <p style={{ color: 'var(--ss-t2)' }}>
          Your account isn&apos;t linked to an installer. Ask your administrator for access.
        </p>
        <SignOutButton />
      </main>
    )
  }

  const { score } = await searchParams
  const installerId = session.installerId
  const all = await prisma.lead.findMany({
    where: { installerId },
    orderBy: { createdAt: 'desc' },
    include: { webhookDeliveries: { orderBy: { createdAt: 'desc' } } },
  })

  const counts = { all: all.length, hot: 0, warm: 0, nurture: 0 } as Record<string, number>
  for (const l of all) counts[l.leadScore] = (counts[l.leadScore] ?? 0) + 1
  const filtered = score && score !== 'all' ? all.filter((l) => l.leadScore === score) : all

  const tabs: Array<{ key: string; label: string }> = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'hot', label: `Hot (${counts.hot ?? 0})` },
    { key: 'warm', label: `Warm (${counts.warm ?? 0})` },
    { key: 'nurture', label: `Nurture (${counts.nurture ?? 0})` },
  ]
  const active = score ?? 'all'

  return (
    <main className="min-h-screen" style={{ background: 'var(--ss-ink)', color: 'var(--ss-t1)' }}>
      <header className="border-b" style={{ borderColor: 'var(--ss-border)' }}>
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <div>
            <span className="ss-mono text-[10px] uppercase block" style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)' }}>
              SunScan · Leads
            </span>
            <span className="ss-heading text-lg font-semibold">{session.installer.name}</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs" style={{ color: 'var(--ss-t3)' }}>
              {session.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <nav className="flex gap-2 mb-6">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={t.key === 'all' ? '/admin' : `/admin?score=${t.key}`}
              className="ss-mono text-[11px] uppercase rounded-full px-3 py-1.5 transition"
              style={{
                letterSpacing: '0.12em',
                background: active === t.key ? 'var(--ss-blue)' : 'var(--ss-s1)',
                color: active === t.key ? '#fff' : 'var(--ss-t2)',
                border: '1px solid var(--ss-border)',
              }}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {filtered.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
            No leads yet{active !== 'all' ? ` in “${active}”` : ''}.
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((lead) => {
              const options = (lead.optionsJson as unknown as OptionLite[]) ?? []
              const lastHook = lead.webhookDeliveries[0]
              return (
                <li key={lead.id}>
                  <details
                    className="rounded-xl overflow-hidden"
                    style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border)' }}
                  >
                    <summary
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer list-none"
                      style={{ color: 'var(--ss-t1)' }}
                    >
                      <ScoreBadge band={lead.leadScore} />
                      <span className="font-medium">
                        {lead.firstName} {lead.lastName}
                      </span>
                      <span className="text-sm" style={{ color: 'var(--ss-t3)' }}>
                        {lead.postcode}
                      </span>
                      <span className="ml-auto ss-mono text-[10px] uppercase" style={{ letterSpacing: '0.14em', color: 'var(--ss-t4)' }}>
                        {lead.surveyRequested ? `Survey${lead.surveyType ? ` · ${lead.surveyType}` : ''}` : 'Report'}
                        {' · '}
                        {lead.createdAt.toISOString().slice(0, 10)}
                      </span>
                    </summary>

                    <div className="px-4 pb-4 pt-1 grid gap-4 sm:grid-cols-2" style={{ borderTop: '1px solid var(--ss-border)' }}>
                      <div className="grid grid-cols-2 gap-3 pt-3">
                        <Field label="Email" value={lead.email} />
                        <Field label="Phone" value={lead.phone ?? ''} />
                        <Field label="Address" value={lead.addressRaw} />
                        <Field label="Property" value={`${lead.propertyType} · ${lead.ownership}`} />
                        <Field label="Roof" value={`${lead.roofConfidence}, ≤${lead.maxPanelCount} panels`} />
                        <Field label="Usage" value={`${lead.usageSource} · ${Math.round(lead.annualKwh)} kWh`} />
                        <Field label="Tariff" value={lead.tariffType} />
                        <Field label="Budget band" value={lead.budgetBandId} />
                        <Field label="Motivation" value={lead.motivation ?? ''} />
                        <Field label="Preferred contact" value={`${lead.preferredContact ?? '—'}${lead.bestTime ? ` · ${lead.bestTime}` : ''}`} />
                      </div>

                      <div className="pt-3 space-y-3">
                        <div>
                          <span className="ss-mono text-[9px] uppercase block mb-1" style={{ letterSpacing: '0.16em', color: 'var(--ss-t4)' }}>
                            Options shown
                          </span>
                          <ul className="space-y-1 text-sm">
                            {options.map((o) => (
                              <li key={o.kind} style={{ color: 'var(--ss-t1)' }}>
                                {o.isRecommended ? '★ ' : '· '}
                                {o.label}: {o.panelCount} panels, £{o.priceGbp?.toLocaleString()},{' '}
                                {o.results?.paybackYears != null ? `${o.results.paybackYears.toFixed(1)} yr payback` : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <Field label="Score reasons" value={lead.leadScoreReasons.join(', ')} />
                        <Field
                          label="Delivery"
                          value={[
                            lead.emailSentAt ? 'email sent' : 'email pending',
                            lastHook ? `webhook ${lastHook.status} (${lead.webhookDeliveries.length} attempt${lead.webhookDeliveries.length === 1 ? '' : 's'})` : 'no webhook',
                          ].join(' · ')}
                        />
                        {lead.comments ? <Field label="Comments" value={lead.comments} /> : null}
                      </div>
                    </div>
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </main>
  )
}
