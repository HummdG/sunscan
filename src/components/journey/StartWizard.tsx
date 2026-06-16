'use client'

import { useMemo, useReducer, useState } from 'react'
import {
  createInitialJourneyState,
  currentStep,
  journeyReducer,
  STEP_META,
  visibleSteps,
} from '@/lib/journey/types'
import type { JourneyIntent, JourneyState, StepId } from '@/lib/journey/types'
import { AddressStep } from './steps/AddressStep'
import { RoofStep } from './steps/RoofStep'
import { RoofFallbackStep } from './steps/RoofFallbackStep'
import { PropertyStep } from './steps/PropertyStep'
import { UsageStep } from './steps/UsageStep'
import { LifestyleStep } from './steps/LifestyleStep'
import { TariffStep } from './steps/TariffStep'
import { ExistingStep } from './steps/ExistingStep'
import { MotivationStep } from './steps/MotivationStep'
import { GhostButton, PrimaryButton } from './ui'
import { ResultsView } from './ResultsView'
import type { LeadJourney } from './ResultsView'
import type { OptionSet } from '@/lib/recommend/optionTypes'

// Build the lead API journey payload from the reducer state. Only called from
// the results screen, which is only reachable once address + roof are present.
function buildLeadJourney(state: JourneyState): LeadJourney {
  return {
    uprn: state.address?.uprn,
    roof: {
      confidence: state.roof?.confidence ?? 'low',
      maxPanelCount: state.roof?.maxPanelCount ?? 0,
      kwpPotential: state.roof?.kwpPotential ?? 0,
    },
    propertyType: state.propertyType ?? 'other',
    ownership: state.ownership ?? 'other',
    usage: {
      source: state.usage.source,
      annualKwh: state.usage.annualKwh,
      monthlyCostGbp: state.usage.monthlyCostGbp,
    },
    tariffType: state.tariffType,
    existing: state.existing,
    lifestyle: state.lifestyle,
    motivation: state.motivation,
    budgetBandId: state.budgetBandId,
    financeInterest: state.financeInterest,
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface BudgetBand {
  id: string
  label: string
  minGbp: number
  maxGbp: number
}

export interface SurveyOptions {
  remote: boolean
  onsite: boolean
  installerChoice: boolean
}

interface StartWizardProps {
  installerSlug: string
  installerName: string
  brand: { primary: string; accent: string }
  budgetBands: BudgetBand[]
  surveyOptions: SurveyOptions
  intent: JourneyIntent
}

// ─── Step gating ──────────────────────────────────────────────────────────────

function canAdvance(state: JourneyState, step: StepId): boolean {
  switch (step) {
    case 'address':
      return state.address?.confirmed === true
    case 'roof':
      return true
    case 'roofFallback': {
      const f = state.roofFallback
      return f.sizeBand !== null && f.direction !== null && f.shading !== null
    }
    case 'property':
      return state.propertyType !== null && state.ownership !== null
    case 'usage': {
      const u = state.usage
      if (u.source === null) return false
      switch (u.source) {
        case 'bill_ocr':
        case 'manual_kwh':
          return u.annualKwh !== null
        case 'monthly_cost':
          return u.monthlyCostGbp !== null
        case 'household':
          return u.householdSize !== null
        default:
          return false
      }
    }
    case 'lifestyle':
      // "Select all that apply" — an empty selection is a valid answer.
      return true
    case 'tariff':
      return state.tariffType !== null
    case 'existing':
      return state.existing !== null
    case 'motivation':
      return (
        state.motivation !== null &&
        state.budgetBandId !== null &&
        state.financeInterest !== null
      )
    default:
      return true
  }
}

// ─── Progress rail ────────────────────────────────────────────────────────────

function ProgressRail({ steps, activeIndex }: { steps: StepId[]; activeIndex: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {steps.map((id, i) => {
        const status = i < activeIndex ? 'done' : i === activeIndex ? 'current' : 'upcoming'
        const meta = STEP_META[id]
        return (
          <li key={id} className="flex items-center gap-2">
            <span
              className="ss-mono text-[10px] uppercase transition-colors"
              style={{
                letterSpacing: '0.18em',
                color:
                  status === 'current'
                    ? 'var(--brand-primary)'
                    : status === 'done'
                      ? 'var(--ss-t2)'
                      : 'var(--ss-t4)',
                fontWeight: status === 'current' ? 600 : 400,
              }}
            >
              {meta.code}
            </span>
            {i < steps.length - 1 ? (
              <span
                aria-hidden
                className="h-px w-4 transition-colors"
                style={{
                  background:
                    status === 'upcoming' ? 'var(--ss-border)' : 'var(--brand-primary)',
                }}
              />
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

// ─── Survey CTA ───────────────────────────────────────────────────────────────

function surveyModeLabel(opts: SurveyOptions): string {
  if (opts.installerChoice || (opts.remote && opts.onsite)) {
    return 'They can arrange a remote or on-site survey, whichever suits you best.'
  }
  if (opts.remote) return "They'll arrange a remote survey at a time that suits you."
  if (opts.onsite) return "They'll arrange an on-site survey at a time that suits you."
  return 'They will be in touch to arrange the next steps.'
}

// ─── Wizard host ──────────────────────────────────────────────────────────────

export function StartWizard({
  installerSlug,
  installerName,
  brand,
  budgetBands,
  surveyOptions,
  intent,
}: StartWizardProps) {
  const [state, dispatch] = useReducer(journeyReducer, createInitialJourneyState(intent))
  const [surveyRequested, setSurveyRequested] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [optionSet, setOptionSet] = useState<OptionSet | null>(null)
  const [error, setError] = useState<string | null>(null)

  const steps = useMemo(() => visibleSteps(state), [state])
  const step = currentStep(state)
  const activeIndex = Math.min(state.stepIndex, steps.length - 1)
  const isFirst = activeIndex === 0
  const isLast = step === 'motivation'
  const advanceable = canAdvance(state, step)

  const submitResults = async () => {
    if (!state.address || !state.roof) {
      setError('We’re missing your address or roof details. Please go back and complete them.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        lat: state.address.lat,
        lng: state.address.lng,
        postcode: state.address.postcode,
        uprn: state.address.uprn,
        roof: {
          pitchDeg: state.roof.pitchDeg,
          mcsOrientationDeg: state.roof.mcsOrientationDeg,
          maxPanelCount: state.roof.maxPanelCount,
          roofType: state.roof.roofType,
          confidence: state.roof.confidence,
        },
        roofFallback: state.roofFallback,
        usage: {
          source: state.usage.source,
          annualKwh: state.usage.annualKwh,
          unitRatePence: state.usage.unitRatePence,
          exportTariffPence: state.usage.exportTariffPence,
          monthlyCostGbp: state.usage.monthlyCostGbp,
          householdSize: state.usage.householdSize,
        },
        tariffType: state.tariffType,
        lifestyle: state.lifestyle,
        budgetBandId: state.budgetBandId,
      }
      const res = await fetch(`/api/${installerSlug}/journey/results`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`Results request failed (${res.status})`)
      }
      const data = (await res.json()) as OptionSet
      setOptionSet(data)
    } catch {
      setError(
        'Sorry — we couldn’t prepare your options just now. Please try again in a moment.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleContinue = () => {
    if (!advanceable) return
    if (isLast) {
      void submitResults()
      return
    }
    dispatch({ type: 'NEXT' })
  }

  const renderStep = () => {
    switch (step) {
      case 'address':
        return <AddressStep state={state} dispatch={dispatch} installerSlug={installerSlug} />
      case 'roof':
        return <RoofStep state={state} />
      case 'roofFallback':
        return <RoofFallbackStep state={state} dispatch={dispatch} />
      case 'property':
        return <PropertyStep state={state} dispatch={dispatch} />
      case 'usage':
        return <UsageStep state={state} dispatch={dispatch} />
      case 'lifestyle':
        return <LifestyleStep state={state} dispatch={dispatch} />
      case 'tariff':
        return <TariffStep state={state} dispatch={dispatch} />
      case 'existing':
        return <ExistingStep state={state} dispatch={dispatch} />
      case 'motivation':
        return <MotivationStep state={state} dispatch={dispatch} budgetBands={budgetBands} />
      default:
        return null
    }
  }

  // Results take over the full width (no wizard chrome / progress rail).
  if (optionSet) {
    return (
      <div style={{ animation: 'ss-fade-up 0.45s ease both' }}>
        <style>{FADE_UP_KEYFRAMES}</style>
        <ResultsView
          optionSet={optionSet}
          installerName={installerName}
          brandPrimary={brand.primary}
          surveyOptions={surveyOptions}
          installerSlug={installerSlug}
          leadJourney={buildLeadJourney(state)}
          prefill={{
            addressRaw: state.address?.raw ?? '',
            postcode: state.address?.postcode ?? '',
          }}
        />
      </div>
    )
  }

  if (submitting) {
    return (
      <div className="space-y-6">
        <style>{FADE_UP_KEYFRAMES}</style>
        <div style={{ animation: 'ss-fade-up 0.45s ease both' }} className="space-y-3">
          <p
            className="ss-mono text-[11px] uppercase"
            style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)' }}
          >
            Almost there
          </p>
          <h2
            className="ss-heading text-2xl sm:text-[1.9rem] font-semibold tracking-tight"
            style={{ color: 'var(--ss-t1)' }}
          >
            Preparing your three options…
          </h2>
          <p className="text-base leading-relaxed" style={{ color: 'var(--ss-t2)' }}>
            We&apos;re matching your property, roof and usage against {installerName}&apos;s
            available systems.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <style>{FADE_UP_KEYFRAMES}</style>

      <ProgressRail steps={steps} activeIndex={activeIndex} />

      {/* Animated step content — re-fires fade-up on each step change. */}
      <div key={step} style={{ animation: 'ss-fade-up 0.4s ease both' }}>
        {renderStep()}
      </div>

      {/* Primary navigation */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <GhostButton onClick={() => dispatch({ type: 'BACK' })} disabled={isFirst}>
          Back
        </GhostButton>
        <PrimaryButton onClick={handleContinue} disabled={!advanceable}>
          {isLast ? 'See my 3 options' : 'Continue'}
        </PrimaryButton>
      </div>

      {error ? (
        <div
          className="rounded-xl p-4 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--ss-t4) 8%, var(--ss-s1))',
            border: '1.5px solid var(--ss-border-h)',
            color: 'var(--ss-t2)',
          }}
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {/* Persistent secondary CTA */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border)' }}
      >
        {surveyRequested ? (
          <div className="space-y-1">
            <p className="text-sm font-medium" style={{ color: 'var(--ss-t1)' }}>
              Survey requested — {installerName} will be in touch.
            </p>
            <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
              {surveyModeLabel(surveyOptions)}
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" style={{ color: 'var(--ss-t2)' }}>
              Prefer expert help?
            </p>
            <button
              type="button"
              onClick={() => setSurveyRequested(true)}
              className="text-sm font-semibold underline-offset-4 transition hover:underline"
              style={{ color: 'var(--brand-primary)' }}
            >
              Book a free survey
            </button>
          </div>
        )}
      </div>

      <p className="sr-only">Installer brand: {brand.primary}</p>
    </div>
  )
}

const FADE_UP_KEYFRAMES = `
@keyframes ss-fade-up {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
`
