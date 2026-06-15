'use client'

import type { Dispatch } from 'react'
import type {
  JourneyAction,
  JourneyState,
  RoofDirection,
  RoofSizeBand,
  ShadingLevel,
} from '@/lib/journey/types'
import { ChoiceGrid, StepShell } from '../ui'

const SIZE_OPTIONS: { value: RoofSizeBand; label: string; description?: string }[] = [
  { value: 'small', label: 'Small', description: 'Roughly a terraced or small semi roof' },
  { value: 'medium', label: 'Medium', description: 'A typical semi-detached roof' },
  { value: 'large', label: 'Large', description: 'A large detached or wide roof' },
  { value: 'unsure', label: "I'm not sure" },
]

const DIRECTION_OPTIONS: { value: RoofDirection; label: string }[] = [
  { value: 'south', label: 'South' },
  { value: 'south_east', label: 'South-east' },
  { value: 'south_west', label: 'South-west' },
  { value: 'east', label: 'East' },
  { value: 'west', label: 'West' },
  { value: 'east_west', label: 'East & west (both slopes)' },
  { value: 'north', label: 'North' },
  { value: 'unsure', label: "I'm not sure" },
]

const SHADING_OPTIONS: { value: ShadingLevel; label: string; description?: string }[] = [
  { value: 'none', label: 'No shading', description: 'Open roof, sun all day' },
  { value: 'trees', label: 'Some trees nearby' },
  { value: 'buildings', label: 'Nearby buildings' },
  { value: 'heavy', label: 'Heavy shading', description: 'Shaded for much of the day' },
  { value: 'unsure', label: "I'm not sure" },
]

export function RoofFallbackStep({
  state,
  dispatch,
}: {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
}) {
  const { sizeBand, direction, shading } = state.roofFallback

  return (
    <StepShell
      eyebrow="Step · Roof details"
      title="A few quick roof questions"
      subtitle="We couldn't fully model your roof from imagery, so these help us give you a better estimate."
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            How big is your main roof?
          </h3>
          <ChoiceGrid
            options={SIZE_OPTIONS}
            value={sizeBand}
            onSelect={(value) => dispatch({ type: 'PATCH_ROOF_FALLBACK', patch: { sizeBand: value } })}
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            Which way does it mainly face?
          </h3>
          <ChoiceGrid
            options={DIRECTION_OPTIONS}
            value={direction}
            onSelect={(value) =>
              dispatch({ type: 'PATCH_ROOF_FALLBACK', patch: { direction: value } })
            }
          />
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            Is the roof shaded at all?
          </h3>
          <ChoiceGrid
            options={SHADING_OPTIONS}
            value={shading}
            onSelect={(value) => dispatch({ type: 'PATCH_ROOF_FALLBACK', patch: { shading: value } })}
          />
          {shading === 'heavy' ? (
            <p
              className="rounded-xl px-4 py-3 text-sm"
              style={{
                color: 'var(--ss-t2)',
                background: 'color-mix(in srgb, var(--brand-accent) 10%, var(--ss-s1))',
                border: '1px solid var(--ss-border-h)',
              }}
            >
              A survey is strongly recommended for heavily shaded roofs so we can position panels to
              minimise the impact of shade.
            </p>
          ) : null}
        </section>
      </div>
    </StepShell>
  )
}
