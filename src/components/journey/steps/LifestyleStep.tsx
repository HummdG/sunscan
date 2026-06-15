'use client'

import type { Dispatch } from 'react'
import type { JourneyAction, JourneyState, LifestyleTag } from '@/lib/journey/types'
import { MultiChoiceGrid, StepShell } from '../ui'

const LIFESTYLE_OPTIONS: { value: LifestyleTag; label: string }[] = [
  { value: 'home_daytime', label: "Someone's usually home in the day" },
  { value: 'evening_use', label: 'Most energy used in the evening' },
  { value: 'ev_now', label: 'We have an EV' },
  { value: 'ev_planned', label: 'Planning an EV' },
  { value: 'heatpump_now', label: 'We have a heat pump' },
  { value: 'heatpump_planned', label: 'Planning a heat pump' },
  { value: 'high_daytime', label: 'High daytime usage' },
]

export function LifestyleStep({
  state,
  dispatch,
}: {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
}) {
  return (
    <StepShell
      eyebrow="Step · Energy lifestyle"
      title="How do you use energy?"
      subtitle="Select anything that applies. This helps us match the right battery size and tariff strategy. Select all that apply, or none."
    >
      <MultiChoiceGrid
        options={LIFESTYLE_OPTIONS}
        values={state.lifestyle}
        onToggle={(tag) => dispatch({ type: 'TOGGLE_LIFESTYLE', tag })}
      />
    </StepShell>
  )
}
