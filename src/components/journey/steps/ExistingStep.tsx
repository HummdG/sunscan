'use client'

import type { Dispatch } from 'react'
import type { ExistingSystem, JourneyAction, JourneyState } from '@/lib/journey/types'
import { ChoiceGrid, StepShell } from '../ui'

const EXISTING_OPTIONS: { value: ExistingSystem; label: string; description?: string }[] = [
  { value: 'none', label: 'No — this would be a new system' },
  { value: 'solar', label: 'Solar panels only' },
  { value: 'battery', label: 'A battery only' },
  { value: 'solar_battery', label: 'Solar panels and a battery' },
  { value: 'unsure', label: 'Not sure' },
]

export function ExistingStep({
  state,
  dispatch,
}: {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
}) {
  return (
    <StepShell
      eyebrow="Step · Existing system"
      title="Do you already have solar or a battery?"
      subtitle="If you've got something already, we'll factor it into your options."
    >
      <ChoiceGrid
        options={EXISTING_OPTIONS}
        value={state.existing}
        onSelect={(value) => dispatch({ type: 'SET_EXISTING', value })}
      />
    </StepShell>
  )
}
