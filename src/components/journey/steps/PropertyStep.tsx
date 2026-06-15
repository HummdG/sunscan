'use client'

import type { Dispatch } from 'react'
import type { JourneyAction, JourneyState, Ownership, PropertyType } from '@/lib/journey/types'
import { ChoiceGrid, StepShell } from '../ui'

const PROPERTY_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: 'detached', label: 'Detached house' },
  { value: 'semi', label: 'Semi-detached house' },
  { value: 'terraced', label: 'Terraced house' },
  { value: 'bungalow', label: 'Bungalow' },
  { value: 'flat', label: 'Flat / apartment' },
  { value: 'other', label: 'Other' },
]

const OWNERSHIP_OPTIONS: { value: Ownership; label: string }[] = [
  { value: 'own', label: 'I own it outright' },
  { value: 'mortgage', label: 'I own it with a mortgage' },
  { value: 'rent', label: 'I rent privately' },
  { value: 'social', label: 'Social / council housing' },
  { value: 'landlord', label: "I'm a landlord" },
  { value: 'other', label: 'Other' },
]

export function PropertyStep({
  state,
  dispatch,
}: {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
}) {
  const showPermissionNote = state.ownership === 'rent' || state.ownership === 'social'

  return (
    <StepShell
      eyebrow="Step · Your property"
      title="Tell us about your property"
      subtitle="This helps us tailor the right system and installation approach."
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            What type of property is it?
          </h3>
          <ChoiceGrid
            options={PROPERTY_OPTIONS}
            value={state.propertyType}
            onSelect={(value) => dispatch({ type: 'SET_PROPERTY_TYPE', value })}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            Do you own your home?
          </h3>
          <ChoiceGrid
            options={OWNERSHIP_OPTIONS}
            value={state.ownership}
            onSelect={(value) => dispatch({ type: 'SET_OWNERSHIP', value })}
          />
          {showPermissionNote ? (
            <p
              className="rounded-xl px-4 py-3 text-sm"
              style={{
                color: 'var(--ss-t2)',
                background: 'color-mix(in srgb, var(--brand-accent) 10%, var(--ss-s1))',
                border: '1px solid var(--ss-border-h)',
              }}
            >
              You can continue — permission from the owner may be required before any installation.
            </p>
          ) : null}
        </section>
      </div>
    </StepShell>
  )
}
