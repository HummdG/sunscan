'use client'

import type { Dispatch } from 'react'
import type {
  FinanceInterest,
  JourneyAction,
  JourneyState,
  Motivation,
} from '@/lib/journey/types'
import type { BudgetBand } from '../StartWizard'
import { ChoiceGrid, StepShell } from '../ui'

const MOTIVATION_OPTIONS: { value: Motivation; label: string }[] = [
  { value: 'reduce_bills', label: 'Reduce my energy bills' },
  { value: 'price_protection', label: 'Protect against rising prices' },
  { value: 'cheap_tariffs', label: 'Make the most of cheap tariffs' },
  { value: 'earn_export', label: 'Earn money exporting electricity' },
  { value: 'independence', label: 'Energy independence' },
  { value: 'carbon', label: 'Cut my carbon footprint' },
  { value: 'home_value', label: 'Add value to my home' },
  { value: 'exploring', label: "Just exploring for now" },
]

const FINANCE_OPTIONS: { value: FinanceInterest; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'learn_more', label: 'Tell me more' },
]

export function MotivationStep({
  state,
  dispatch,
  budgetBands,
}: {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
  budgetBands: BudgetBand[]
}) {
  const budgetOptions = budgetBands.map((b) => ({ value: b.id, label: b.label }))

  return (
    <StepShell
      eyebrow="Step · Goals & budget"
      title="What matters most to you?"
      subtitle="Last few questions — these help us shape your three options."
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            What&apos;s your main goal?
          </h3>
          <ChoiceGrid
            options={MOTIVATION_OPTIONS}
            value={state.motivation}
            onSelect={(value) => dispatch({ type: 'SET_MOTIVATION', value })}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            What budget did you have in mind?
          </h3>
          {budgetOptions.length > 0 ? (
            <ChoiceGrid
              options={budgetOptions}
              value={state.budgetBandId}
              onSelect={(value) => dispatch({ type: 'SET_BUDGET', value })}
            />
          ) : (
            <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
              No budget bands configured.
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            Are you interested in finance options?
          </h3>
          <ChoiceGrid
            columns={2}
            options={FINANCE_OPTIONS}
            value={state.financeInterest}
            onSelect={(value) => dispatch({ type: 'SET_FINANCE', value })}
          />
        </section>
      </div>
    </StepShell>
  )
}
