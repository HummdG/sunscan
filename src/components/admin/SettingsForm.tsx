'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'

export interface SettingsInitial {
  notificationEmail: string
  crmWebhookUrl: string
  crmWebhookSecret: string
  sentinelEnabled: boolean
  sentinelBaseUpliftPercent: number // fraction
  marginPercent: number // fraction
  budgetBands: Array<{ id: string; label: string; minGbp: number; maxGbp: number }>
  branding: {
    primaryColor: string
    accentColor: string
    companyTagline: string
    contactEmail: string
    logoUrl: string
  }
}

const labelStyle = { letterSpacing: '0.18em', color: 'var(--ss-t4)' }
const inputStyle = {
  background: 'var(--ss-ink)',
  border: '1px solid var(--ss-border-h)',
  color: 'var(--ss-t1)',
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="ss-mono text-[10px] uppercase block mb-1" style={labelStyle}>
        {label}
      </span>
      {children}
    </label>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="rounded-xl p-5 space-y-4"
      style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border)' }}
    >
      <h2 className="ss-mono text-[11px] uppercase" style={{ letterSpacing: '0.2em', color: 'var(--ss-t3)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function SettingsForm({ initial }: { initial: SettingsInitial }) {
  const [notificationEmail, setNotificationEmail] = useState(initial.notificationEmail)
  const [crmWebhookUrl, setCrmWebhookUrl] = useState(initial.crmWebhookUrl)
  const [crmWebhookSecret, setCrmWebhookSecret] = useState(initial.crmWebhookSecret)
  const [sentinelEnabled, setSentinelEnabled] = useState(initial.sentinelEnabled)
  const [sentinelPct, setSentinelPct] = useState(Math.round(initial.sentinelBaseUpliftPercent * 100))
  const [marginPct, setMarginPct] = useState(Math.round(initial.marginPercent * 100))
  const [budgetBandsText, setBudgetBandsText] = useState(JSON.stringify(initial.budgetBands, null, 2))
  const [primaryColor, setPrimaryColor] = useState(initial.branding.primaryColor)
  const [accentColor, setAccentColor] = useState(initial.branding.accentColor)
  const [companyTagline, setCompanyTagline] = useState(initial.branding.companyTagline)
  const [contactEmail, setContactEmail] = useState(initial.branding.contactEmail)
  const [logoUrl, setLogoUrl] = useState(initial.branding.logoUrl)

  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const textInput = 'w-full rounded-lg px-3 py-2 text-sm outline-none'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('saving')
    setError(null)

    let budgetBands: SettingsInitial['budgetBands'] | undefined
    if (budgetBandsText.trim()) {
      try {
        budgetBands = JSON.parse(budgetBandsText)
      } catch {
        setStatus('error')
        setError('Budget bands must be valid JSON.')
        return
      }
    }

    const res = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationEmail,
        crmWebhookUrl: crmWebhookUrl || null,
        crmWebhookSecret: crmWebhookSecret || null,
        sentinelEnabled,
        sentinelBaseUpliftPercent: sentinelPct / 100,
        marginPercent: marginPct / 100,
        budgetBands,
        branding: {
          primaryColor,
          accentColor,
          companyTagline: companyTagline || null,
          contactEmail: contactEmail || null,
          logoUrl: logoUrl || null,
        },
      }),
    })
    if (res.ok) {
      setStatus('saved')
    } else {
      const j = await res.json().catch(() => ({}))
      setStatus('error')
      setError(j?.error === 'bad-request' ? 'Some values were invalid.' : 'Could not save settings.')
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" onChange={() => status === 'saved' && setStatus('idle')}>
      <Section title="Lead delivery">
        <Field label="Notification email">
          <input type="email" required value={notificationEmail} onChange={(e) => setNotificationEmail(e.target.value)} className={textInput} style={inputStyle} />
        </Field>
        <Field label="CRM webhook URL">
          <input type="url" value={crmWebhookUrl} onChange={(e) => setCrmWebhookUrl(e.target.value)} placeholder="https://…" className={textInput} style={inputStyle} />
        </Field>
        <Field label="CRM webhook secret (HMAC)">
          <input type="text" value={crmWebhookSecret} onChange={(e) => setCrmWebhookSecret(e.target.value)} placeholder="whsec_…" className={textInput} style={inputStyle} />
        </Field>
      </Section>

      <Section title="Sentinel optimisation">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={sentinelEnabled} onChange={(e) => setSentinelEnabled(e.target.checked)} />
          <span className="text-sm" style={{ color: 'var(--ss-t1)' }}>Show the Sentinel uplift layer</span>
        </label>
        <Field label="Base uplift %">
          <input type="number" min={0} max={50} value={sentinelPct} onChange={(e) => setSentinelPct(Number(e.target.value))} className={textInput} style={inputStyle} />
        </Field>
      </Section>

      <Section title="Commercials">
        <Field label="Margin % (added to catalogue price)">
          <input type="number" min={0} max={100} value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} className={textInput} style={inputStyle} />
        </Field>
        <Field label="Budget bands (JSON)">
          <textarea value={budgetBandsText} onChange={(e) => setBudgetBandsText(e.target.value)} rows={8} className={`${textInput} font-mono text-xs`} style={inputStyle} />
        </Field>
      </Section>

      <Section title="Branding">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary colour">
            <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-full rounded-lg" style={inputStyle} />
          </Field>
          <Field label="Accent colour">
            <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} className="h-10 w-full rounded-lg" style={inputStyle} />
          </Field>
        </div>
        <Field label="Company tagline">
          <input type="text" value={companyTagline} onChange={(e) => setCompanyTagline(e.target.value)} className={textInput} style={inputStyle} />
        </Field>
        <Field label="Contact email">
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={textInput} style={inputStyle} />
        </Field>
        <Field label="Logo URL">
          <input type="url" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" className={textInput} style={inputStyle} />
        </Field>
      </Section>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === 'saving'}
          className="rounded-lg px-6 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
          style={{ background: 'var(--ss-blue)' }}
        >
          {status === 'saving' ? 'Saving…' : 'Save settings'}
        </button>
        {status === 'saved' ? <span className="text-sm" style={{ color: 'var(--ss-green)' }}>Saved ✓</span> : null}
        {status === 'error' ? <span className="text-sm" role="alert" style={{ color: '#B04020' }}>{error}</span> : null}
      </div>
    </form>
  )
}
