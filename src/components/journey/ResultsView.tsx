'use client'

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { OptionResult, OptionSet } from '@/lib/recommend/optionTypes'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ResultsSurveyOptions {
  remote: boolean
  onsite: boolean
  installerChoice: boolean
}

interface ResultsViewProps {
  optionSet: OptionSet
  installerName: string
  brandPrimary: string
  surveyOptions?: ResultsSurveyOptions
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

function surveyModeLabel(opts?: ResultsSurveyOptions): string {
  if (!opts) return 'They will be in touch to arrange the next steps.'
  if (opts.installerChoice || (opts.remote && opts.onsite)) {
    return 'They can arrange a remote or on-site survey, whichever suits you best.'
  }
  if (opts.remote) return "They'll arrange a remote survey at a time that suits you."
  if (opts.onsite) return "They'll arrange an on-site survey at a time that suits you."
  return 'They will be in touch to arrange the next steps.'
}

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

function SentinelPill() {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{
        background: 'color-mix(in srgb, var(--ss-t4) 8%, transparent)',
        border: '1px dashed var(--ss-border-h)',
      }}
    >
      <span
        aria-hidden
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: 'var(--ss-t4)' }}
      />
      <span className="text-xs" style={{ color: 'var(--ss-t3)' }}>
        Sentinel optimisation — shown next
      </span>
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

      {/* Sentinel placeholder */}
      <SentinelPill />

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

// ─── CTA row ──────────────────────────────────────────────────────────────────────

function CtaRow({
  installerName,
  brandPrimary,
  surveyOptions,
}: {
  installerName: string
  brandPrimary: string
  surveyOptions?: ResultsSurveyOptions
}) {
  const [confirmed, setConfirmed] = useState(false)

  if (confirmed) {
    return (
      <div
        className="space-y-1.5 rounded-xl p-4"
        style={{ background: 'var(--ss-s1)', border: '1.5px solid var(--ss-border)' }}
      >
        <p className="text-sm font-medium" style={{ color: 'var(--ss-t1)' }}>
          Thanks — {installerName} will be in touch.
        </p>
        <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
          To make your estimate more accurate, have a recent electricity bill or annual
          kWh figure handy. {surveyModeLabel(surveyOptions)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => setConfirmed(true)}
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
        onClick={() => setConfirmed(true)}
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
      />

      {/* Footer */}
      <p className="text-sm" style={{ color: 'var(--ss-t4)' }}>
        {FOOTER_COPY}
      </p>
    </div>
  )
}
