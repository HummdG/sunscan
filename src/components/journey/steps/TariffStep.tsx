'use client'

import type { Dispatch } from 'react'
import type { JourneyAction, JourneyState, TariffType } from '@/lib/journey/types'
import { ChoiceGrid, StepShell } from '../ui'

const TARIFF_OPTIONS: { value: TariffType; label: string; description?: string }[] = [
  { value: 'standard', label: 'Standard fixed or variable', description: 'A single unit rate all day' },
  { value: 'economy7', label: 'Economy 7 / off-peak', description: 'Cheaper electricity at night' },
  { value: 'smart_tou', label: 'Smart time-of-use', description: 'Rates change through the day' },
  { value: 'import_export', label: 'Import & export tariff', description: 'Paid for what you export' },
  { value: 'already_exports', label: 'I already export', description: 'I have solar exporting today' },
  { value: 'unknown', label: 'Not sure' },
]

export function TariffStep({
  state,
  dispatch,
}: {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
}) {
  return (
    <StepShell
      eyebrow="Step · Your tariff"
      title="What's your electricity tariff?"
      subtitle="This shapes how much you could save with solar and a battery. Pick the closest match."
    >
      <ChoiceGrid
        options={TARIFF_OPTIONS}
        value={state.tariffType}
        onSelect={(value) => dispatch({ type: 'SET_TARIFF', value })}
      />
    </StepShell>
  )
}
