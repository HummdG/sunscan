'use client'

import { useId, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { OptionResult, OptionSet } from '@/lib/recommend/optionTypes'
import { TextField } from './ui'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ResultsSurveyOptions {
  remote: boolean
  onsite: boolean
  installerChoice: boolean
}

/** Minimal journey payload the lead API needs (built by StartWizard). */
export interface LeadJourney {
  uprn?: string
  roof: { confidence: 'high' | 'medium' | 'low'; maxPanelCount: number; kwpPotential: number }
  propertyType: string
  ownership: string
  usage: { source: string | null; annualKwh: number | null; monthlyCostGbp: number | null }
  tariffType: string | null
  existing: string | null
  lifestyle: string[]
  motivation: string | null
  budgetBandId: string | null
  financeInterest: string | null
}

interface ResultsViewProps {
  optionSet: OptionSet
  installerName: string
  brandPrimary: string
  surveyOptions?: ResultsSurveyOptions
  installerSlug: string
  leadJourney: LeadJourney
  prefill: { addressRaw: string; postcode: string }
}

// ─── Copy ─────────────────────────────────────────────────────────────────────

const INTRO_COPY =
  'Based on your property, roof layout, energy usage and budget, your home may be ' +
  'suitable for solar and battery storage. We’ve created three indicative options ' +
  'to help you compare cost, performance and long-term value.'

const DISCLAIMER_COPY =
  'This is an indicative estimate only. A final recommendation depends on a roof survey, ' +
  'electrical checks, shading assessment, confirmed usage and tariff details.'

const FOOTER_COPY = 'All figures are indicative and labelled per option.'

// ─── Cell formatters (shared by cards + table) ──────────────────────────────────

function batteryLabel(o: OptionResult): string {
  return o.batteryType ? `${o.batteryType} · ${o.batteryCapacityKwh} kWh` : 'No battery'
}

interface MetricRow {
  label: string
  value: (o: OptionResult) => string
}

const METRIC_ROWS: MetricRow[] = [
  { label: 'Number of panels', value: (o) => o.panelCount.toLocaleString() },
  { label: 'Panel type', value: (o) => o.panelType },
  { label: 'Inverter', value: (o) => o.inverterType },
  { label: 'Battery', value: batteryLabel },
  {
    label: 'Est. annual generation',
    value: (o) => `${Math.round(o.results.annualGenerationKwh).toLocaleString()} kWh`,
  },
  {
    label: 'Est. annual saving',
    value: (o) => `£${Math.round(o.results.annualSavingsPounds).toLocaleString()}`,
  },
  {
    label: 'Est. export',
    value: (o) => `${Math.round(o.results.exportKwh).toLocaleString()} kWh`,
  },
  { label: 'Est. payback', value: (o) => `${o.results.paybackYears.toFixed(1)} yrs` },
]

// ─── Small primitives ───────────────────────────────────────────────────────────

function Mono({
  children,
  style,
}: {
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <span
      className="ss-mono text-[10px] uppercase"
      style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)', ...style }}
    >
      {children}
    </span>
  )
}

function RecommendedBadge({ brandPrimary }: { brandPrimary: string }) {
  return (
    <span
      className="ss-mono inline-flex items-center rounded-full px-2.5 py-1 text-[10px] uppercase font-semibold text-white"
      style={{ letterSpacing: '0.18em', background: brandPrimary }}
    >
      Recommended
    </span>
  )
}

function SentinelBlock({ option, brandPrimary }: { option: OptionResult; brandPrimary: string }) {
  const s = option.sentinel
  if (!s.enabled || s.upliftPercent <= 0) {
    return (
      <div
        className="rounded-lg px-3 py-2"
        style={{
          background: 'color-mix(in srgb, var(--ss-t4) 8%, transparent)',
          border: '1px dashed var(--ss-border-h)',
        }}
      >
        <span className="text-xs" style={{ color: 'var(--ss-t3)' }}>
          Sentinel optimisation available
        </span>
      </div>
    )
  }
  const pct = Math.round(s.upliftPercent * 100)
  const gbp = (n: number) => `£${Math.round(n).toLocaleString()}`
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: `color-mix(in srgb, ${brandPrimary} 6%, var(--ss-s1))`,
        border: `1px solid color-mix(in srgb, ${brandPrimary} 28%, var(--ss-border))`,
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="ss-mono text-[10px] uppercase"
          style={{ letterSpacing: '0.18em', color: brandPrimary }}
        >
          + Sentinel
        </span>
        <span className="text-xs font-semibold" style={{ color: brandPrimary }}>
          +{pct}% uplift
        </span>
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <span style={{ color: 'var(--ss-t3)' }}>Saving / yr</span>
        <span className="text-right" style={{ color: 'var(--ss-t1)' }}>
          {gbp(s.withoutSentinel.annualSavingGbp)} &rarr;{' '}
          <b>{gbp(s.withSentinel.annualSavingGbp)}</b>
        </span>
        <span style={{ color: 'var(--ss-t3)' }}>Payback</span>
        <span className="text-right" style={{ color: 'var(--ss-t1)' }}>
          {s.withoutSentinel.paybackYears.toFixed(1)} &rarr;{' '}
          <b>{s.withSentinel.paybackYears.toFixed(1)} yrs</b>
        </span>
      </div>
      <p className="mt-1.5 text-[10px]" style={{ color: 'var(--ss-t4)' }}>
        Indicative &middot; monitoring &amp; protection included
      </p>
    </div>
  )
}

// ─── Option card ─────────────────────────────────────────────────────────────────

function OptionCardView({
  option,
  brandPrimary,
}: {
  option: OptionResult
  brandPrimary: string
}) {
  const recommended = option.isRecommended
  return (
    <article
      className="flex flex-col gap-5 rounded-2xl p-5 transition-colors"
      style={{
        background: 'var(--ss-s1)',
        border: `1.5px solid ${recommended ? brandPrimary : 'var(--ss-border)'}`,
        boxShadow: recommended
          ? '0 12px 30px -18px color-mix(in srgb, var(--brand-primary) 60%, transparent)'
          : 'none',
      }}
    >
      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Mono>{option.label}</Mono>
          {recommended ? <RecommendedBadge brandPrimary={brandPrimary} /> : null}
        </div>
        <div className="flex items-end justify-between gap-3">
          <p
            className="ss-heading text-2xl font-semibold tracking-tight"
            style={{ color: 'var(--ss-t1)' }}
          >
            &pound;{option.priceGbp.toLocaleString()}
          </p>
          <p className="text-sm font-medium" style={{ color: 'var(--ss-t2)' }}>
            {option.systemKwp} kWp
          </p>
        </div>
        {option.aboveBudget ? (
          <p className="text-xs font-medium" style={{ color: 'var(--ss-t3)' }}>
            Above your stated budget
          </p>
        ) : null}
      </header>

      {/* Metrics */}
      <dl className="space-y-3">
        {METRIC_ROWS.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt>
              <Mono>{row.label}</Mono>
            </dt>
            <dd
              className="text-sm font-medium text-right"
              style={{ color: 'var(--ss-t1)' }}
            >
              {row.value(option)}
            </dd>
          </div>
        ))}
      </dl>

      {/* Sentinel before/after */}
      <SentinelBlock option={option} brandPrimary={brandPrimary} />

      {/* Best suited + next step */}
      <div className="mt-auto space-y-2 pt-1">
        <p className="text-sm italic leading-snug" style={{ color: 'var(--ss-t3)' }}>
          {option.bestSuitedTo}
        </p>
        <p className="text-sm font-medium leading-snug" style={{ color: 'var(--ss-t2)' }}>
          {option.nextStep}
        </p>
      </div>
    </article>
  )
}

// ─── Comparison table ────────────────────────────────────────────────────────────

function ComparisonTable({
  options,
  brandPrimary,
}: {
  options: OptionResult[]
  brandPrimary: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr>
            <th className="px-3 py-3 text-left">
              <Mono>Option</Mono>
            </th>
            {options.map((o) => (
              <th
                key={o.id}
                className="px-3 py-3 text-left align-bottom"
                style={{
                  borderBottom: `2px solid ${
                    o.isRecommended ? brandPrimary : 'var(--ss-border)'
                  }`,
                }}
              >
                <span className="flex flex-col gap-1">
                  <Mono style={{ color: o.isRecommended ? brandPrimary : 'var(--ss-t4)' }}>
                    {o.label}
                  </Mono>
                  <span
                    className="ss-heading text-base font-semibold"
                    style={{ color: 'var(--ss-t1)' }}
                  >
                    &pound;{o.priceGbp.toLocaleString()}
                  </span>
                  <span style={{ color: 'var(--ss-t3)' }}>{o.systemKwp} kWp</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRIC_ROWS.map((row) => (
            <tr key={row.label}>
              <th
                scope="row"
                className="px-3 py-2.5 text-left font-normal"
                style={{ borderTop: '1px solid var(--ss-border)' }}
              >
                <Mono>{row.label}</Mono>
              </th>
              {options.map((o) => (
                <td
                  key={o.id}
                  className="px-3 py-2.5"
                  style={{
                    borderTop: '1px solid var(--ss-border)',
                    color: 'var(--ss-t1)',
                    background: o.isRecommended
                      ? 'color-mix(in srgb, var(--brand-primary) 5%, transparent)'
                      : 'transparent',
                  }}
                >
                  {row.value(o)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Lead capture ───────────────────────────────────────────────────────────────

type LeadOutcome = 'report' | 'survey'
type SurveyType = 'remote' | 'onsite' | 'installer_choice'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface ContactForm {
  firstName: string
  lastName: string
  email: string
  phone: string
  addressRaw: string
  postcode: string
  preferredContact: '' | 'email' | 'phone'
  bestTime: string
  comments: string
  consent: boolean
}

function emptyContact(prefill: { addressRaw: string; postcode: string }): ContactForm {
  return {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    addressRaw: prefill.addressRaw,
    postcode: prefill.postcode,
    preferredContact: '',
    bestTime: '',
    comments: '',
    consent: false,
  }
}

function contactIsValid(c: ContactForm): boolean {
  return (
    c.firstName.trim() !== '' &&
    c.lastName.trim() !== '' &&
    EMAIL_RE.test(c.email.trim()) &&
    c.addressRaw.trim() !== '' &&
    c.postcode.trim() !== '' &&
    c.consent
  )
}

/** Survey-type choices, filtered to the installer's enabled survey modes. */
function surveyChoices(opts?: ResultsSurveyOptions): { value: SurveyType; label: string }[] {
  const out: { value: SurveyType; label: string }[] = []
  if (!opts || opts.remote) out.push({ value: 'remote', label: 'Remote survey' })
  if (!opts || opts.onsite) out.push({ value: 'onsite', label: 'On-site survey' })
  if (!opts || opts.installerChoice) {
    out.push({ value: 'installer_choice', label: 'Let the installer choose' })
  }
  return out
}

function SurveyTypeChoice({
  choices,
  value,
  onSelect,
  brandPrimary,
}: {
  choices: { value: SurveyType; label: string }[]
  value: SurveyType | null
  onSelect: (v: SurveyType) => void
  brandPrimary: string
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1.5 text-sm font-medium" style={{ color: 'var(--ss-t2)' }}>
        Survey type
      </legend>
      <div className="grid gap-3 sm:grid-cols-3" role="radiogroup" aria-label="Survey type">
        {choices.map((c) => {
          const selected = value === c.value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(c.value)}
              className="rounded-xl px-4 py-3 text-left text-sm font-medium transition focus:outline-none"
              style={{
                background: selected
                  ? `color-mix(in srgb, ${brandPrimary} 8%, var(--ss-s1))`
                  : 'var(--ss-s1)',
                border: `1.5px solid ${selected ? brandPrimary : 'var(--ss-border)'}`,
                color: 'var(--ss-t1)',
              }}
            >
              {c.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function ConsentCheckbox({
  checked,
  onChange,
  brandPrimary,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  brandPrimary: string
  id: string
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer rounded"
        style={{ accentColor: brandPrimary }}
      />
      <span className="text-sm leading-snug" style={{ color: 'var(--ss-t2)' }}>
        I agree to be contacted about my solar and battery estimate.
      </span>
    </label>
  )
}

function buildLeadBody(
  outcome: LeadOutcome,
  surveyType: SurveyType | null,
  contact: ContactForm,
  leadJourney: LeadJourney,
  optionSet: OptionSet,
) {
  return {
    outcome,
    ...(outcome === 'survey' ? { surveyType } : {}),
    contact: {
      firstName: contact.firstName.trim(),
      lastName: contact.lastName.trim(),
      email: contact.email.trim(),
      phone: contact.phone.trim() || undefined,
      addressRaw: contact.addressRaw.trim(),
      postcode: contact.postcode.trim(),
      preferredContact: contact.preferredContact || undefined,
      bestTime: contact.bestTime.trim() || undefined,
      comments: contact.comments.trim() || undefined,
      consent: contact.consent,
    },
    journey: leadJourney,
    optionSet: { recommendedId: optionSet.recommendedId, options: optionSet.options },
  }
}

function LeadForm({
  outcome,
  installerName,
  brandPrimary,
  surveyOptions,
  installerSlug,
  leadJourney,
  optionSet,
  prefill,
  onCancel,
}: {
  outcome: LeadOutcome
  installerName: string
  brandPrimary: string
  surveyOptions?: ResultsSurveyOptions
  installerSlug: string
  leadJourney: LeadJourney
  optionSet: OptionSet
  prefill: { addressRaw: string; postcode: string }
  onCancel: () => void
}) {
  const baseId = useId()
  const [contact, setContact] = useState<ContactForm>(() => emptyContact(prefill))
  const choices = useMemo(() => surveyChoices(surveyOptions), [surveyOptions])
  const [surveyType, setSurveyType] = useState<SurveyType | null>(
    outcome === 'survey' ? (choices[0]?.value ?? null) : null,
  )
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

  const set = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) =>
    setContact((c) => ({ ...c, [key]: value }))

  const isSurvey = outcome === 'survey'
  const surveyOk = !isSurvey || surveyType !== null || choices.length === 0
  const canSubmit = contactIsValid(contact) && surveyOk && status !== 'submitting'

  const submit = async () => {
    if (!canSubmit) return
    setStatus('submitting')
    try {
      const res = await fetch(`/api/${installerSlug}/lead`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          buildLeadBody(outcome, surveyType, contact, leadJourney, optionSet),
        ),
      })
      if (!res.ok) throw new Error(`Lead request failed (${res.status})`)
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div
        className="space-y-1.5 rounded-xl p-5"
        style={{ background: 'var(--ss-s1)', border: '1.5px solid var(--ss-border)' }}
        role="status"
      >
        <p className="text-base font-semibold" style={{ color: 'var(--ss-t1)' }}>
          Thanks, your {isSurvey ? 'survey' : 'report'} request has been received.
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
          {installerName} will review your details and be in touch. To make your estimate
          more accurate, have a recent electricity bill or annual kWh figure handy.
        </p>
      </div>
    )
  }

  const submitting = status === 'submitting'

  return (
    <form
      className="space-y-5 rounded-2xl p-5 sm:p-6"
      style={{ background: 'var(--ss-s1)', border: '1.5px solid var(--ss-border)' }}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <Mono>{isSurvey ? 'Book a free survey' : 'Get my detailed report'}</Mono>
          <h3
            className="ss-heading text-xl font-semibold tracking-tight"
            style={{ color: 'var(--ss-t1)' }}
          >
            {isSurvey ? 'Request a survey' : 'Request your detailed report'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="ss-mono text-[11px] uppercase transition hover:underline"
          style={{ letterSpacing: '0.16em', color: 'var(--ss-t4)' }}
        >
          Cancel
        </button>
      </div>

      {isSurvey && choices.length > 0 ? (
        <SurveyTypeChoice
          choices={choices}
          value={surveyType}
          onSelect={setSurveyType}
          brandPrimary={brandPrimary}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={`${baseId}-first`}
          label="First name *"
          value={contact.firstName}
          onChange={(v) => set('firstName', v)}
        />
        <TextField
          id={`${baseId}-last`}
          label="Last name *"
          value={contact.lastName}
          onChange={(v) => set('lastName', v)}
        />
        <TextField
          id={`${baseId}-email`}
          label="Email *"
          placeholder="you@example.com"
          value={contact.email}
          onChange={(v) => set('email', v)}
        />
        <TextField
          id={`${baseId}-phone`}
          label="Phone"
          value={contact.phone}
          onChange={(v) => set('phone', v)}
        />
        <TextField
          id={`${baseId}-address`}
          label="Address *"
          value={contact.addressRaw}
          onChange={(v) => set('addressRaw', v)}
        />
        <TextField
          id={`${baseId}-postcode`}
          label="Postcode *"
          value={contact.postcode}
          onChange={(v) => set('postcode', v)}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium" style={{ color: 'var(--ss-t2)' }}>
            Preferred contact method
          </legend>
          <div className="flex gap-3" role="radiogroup" aria-label="Preferred contact method">
            {(['email', 'phone'] as const).map((m) => {
              const selected = contact.preferredContact === m
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => set('preferredContact', selected ? '' : m)}
                  className="flex-1 rounded-xl px-4 py-3 text-sm font-medium capitalize transition focus:outline-none"
                  style={{
                    background: selected
                      ? `color-mix(in srgb, ${brandPrimary} 8%, var(--ss-s1))`
                      : 'var(--ss-ink)',
                    border: `1.5px solid ${selected ? brandPrimary : 'var(--ss-border-h)'}`,
                    color: 'var(--ss-t1)',
                  }}
                >
                  {m}
                </button>
              )
            })}
          </div>
        </fieldset>
        <TextField
          id={`${baseId}-besttime`}
          label="Best time to contact"
          placeholder="e.g. weekday evenings"
          value={contact.bestTime}
          onChange={(v) => set('bestTime', v)}
        />
      </div>

      <TextField
        id={`${baseId}-comments`}
        label="Additional comments"
        value={contact.comments}
        onChange={(v) => set('comments', v)}
      />

      <ConsentCheckbox
        id={`${baseId}-consent`}
        checked={contact.consent}
        onChange={(v) => set('consent', v)}
        brandPrimary={brandPrimary}
      />

      {status === 'error' ? (
        <div
          className="rounded-xl p-4 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--ss-t4) 8%, var(--ss-s1))',
            border: '1.5px solid var(--ss-border-h)',
            color: 'var(--ss-t2)',
          }}
          role="alert"
        >
          Sorry — we couldn&apos;t submit your request just now. Please try again.
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-sm transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          style={{ background: brandPrimary }}
          onMouseEnter={(e) => {
            if (!e.currentTarget.disabled) e.currentTarget.style.opacity = '0.92'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = ''
          }}
        >
          {submitting
            ? 'Submitting…'
            : isSurvey
              ? 'Request my survey'
              : 'Request my report'}
        </button>
        <p className="text-sm" style={{ color: 'var(--ss-t4)' }}>
          * Required fields
        </p>
      </div>
    </form>
  )
}

// ─── CTA row ──────────────────────────────────────────────────────────────────────

function CtaRow({
  installerName,
  brandPrimary,
  surveyOptions,
  installerSlug,
  leadJourney,
  optionSet,
  prefill,
}: {
  installerName: string
  brandPrimary: string
  surveyOptions?: ResultsSurveyOptions
  installerSlug: string
  leadJourney: LeadJourney
  optionSet: OptionSet
  prefill: { addressRaw: string; postcode: string }
}) {
  const [openForm, setOpenForm] = useState<LeadOutcome | null>(null)

  if (openForm) {
    return (
      <LeadForm
        outcome={openForm}
        installerName={installerName}
        brandPrimary={brandPrimary}
        surveyOptions={surveyOptions}
        installerSlug={installerSlug}
        leadJourney={leadJourney}
        optionSet={optionSet}
        prefill={prefill}
        onCancel={() => setOpenForm(null)}
      />
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setOpenForm('report')}
        className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-sm transition focus:outline-none"
        style={{ background: brandPrimary }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = '0.92'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = ''
        }}
      >
        Get my detailed report
      </button>
      <button
        type="button"
        onClick={() => setOpenForm('survey')}
        className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-medium transition focus:outline-none"
        style={{ color: 'var(--ss-t2)', border: '1.5px solid var(--ss-border-h)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--ss-s1)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        Book a free survey
      </button>
    </div>
  )
}

// ─── Main view ──────────────────────────────────────────────────────────────────

export function ResultsView({
  optionSet,
  installerName,
  brandPrimary,
  surveyOptions,
  installerSlug,
  leadJourney,
  prefill,
}: ResultsViewProps) {
  const { options, warnings } = optionSet

  return (
    <div className="space-y-10">
      {/* Intro */}
      <header className="space-y-3">
        <h2
          className="ss-heading text-2xl sm:text-[1.9rem] leading-tight font-semibold tracking-tight"
          style={{ color: 'var(--ss-t1)' }}
        >
          Your three indicative options
        </h2>
        <p className="text-base leading-relaxed" style={{ color: 'var(--ss-t2)' }}>
          {INTRO_COPY}
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
          {DISCLAIMER_COPY}
        </p>
      </header>

      {/* Warnings */}
      {warnings.length > 0 ? (
        <ul
          className="space-y-1.5 rounded-xl p-4"
          style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border)' }}
        >
          {warnings.map((w, i) => (
            <li key={i} className="text-sm" style={{ color: 'var(--ss-t3)' }}>
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Option cards */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {options.map((o) => (
          <OptionCardView key={o.id} option={o} brandPrimary={brandPrimary} />
        ))}
      </div>

      {/* Comparison table */}
      <section className="space-y-3">
        <Mono>At a glance</Mono>
        <ComparisonTable options={options} brandPrimary={brandPrimary} />
      </section>

      {/* CTA */}
      <CtaRow
        installerName={installerName}
        brandPrimary={brandPrimary}
        surveyOptions={surveyOptions}
        installerSlug={installerSlug}
        leadJourney={leadJourney}
        optionSet={optionSet}
        prefill={prefill}
      />

      {/* Footer */}
      <p className="text-sm" style={{ color: 'var(--ss-t4)' }}>
        {FOOTER_COPY}
      </p>
    </div>
  )
}
