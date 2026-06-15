'use client'

import type { JourneyState } from '@/lib/journey/types'
import { RoofViewer2D } from '@/components/solar/RoofViewer2D'
import { StepShell } from '../ui'

const MCS_DIRECTION_LABEL = (mcsDeg: number): string => {
  // MCS convention: 0° = South, 90° = E or W, 180° = North.
  const d = ((mcsDeg % 360) + 360) % 360
  if (d <= 22 || d >= 338) return 'South'
  if (d < 68) return 'South-east / south-west'
  if (d < 113) return 'East / west'
  if (d < 158) return 'North-east / north-west'
  return 'North'
}

const ROOF_TYPE_LABEL: Record<string, string> = {
  pitched: 'Pitched',
  flat: 'Flat',
  ground: 'Ground mount',
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{ background: 'var(--ss-s1)', border: '1.5px solid var(--ss-border)' }}
    >
      <p
        className="ss-mono text-[10px] uppercase"
        style={{ letterSpacing: '0.18em', color: 'var(--ss-t4)' }}
      >
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--ss-t1)' }}>
        {value}
      </p>
    </div>
  )
}

export function RoofStep({ state }: { state: JourneyState }) {
  const roof = state.roof
  const address = state.address

  if (!roof || !address) {
    return (
      <StepShell
        eyebrow="Step 2 · Your roof"
        title="Your roof"
        subtitle="We need to confirm your address before we can model your roof."
      />
    )
  }

  const isLow = roof.confidence === 'low'

  return (
    <StepShell
      eyebrow="Step 2 · Your roof"
      title="Here's your roof"
      subtitle="We've estimated how many panels may fit on your roof. This is an initial guide and will be confirmed by survey."
      footnote={
        isLow
          ? "We couldn't model your roof with high confidence — we'll ask you a couple of quick questions next to fill in the gaps."
          : undefined
      }
    >
      <RoofViewer2D
        lat={address.lat}
        lng={address.lng}
        maxPanelCount={roof.maxPanelCount}
        kwpPotential={roof.kwpPotential}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Max panels" value={`${roof.maxPanelCount}`} />
        <Stat label="System size" value={`${roof.kwpPotential.toFixed(2)} kWp`} />
        <Stat label="Roof pitch" value={`${Math.round(roof.pitchDeg)}°`} />
        <Stat label="Orientation" value={MCS_DIRECTION_LABEL(roof.mcsOrientationDeg)} />
        <Stat label="Roof type" value={ROOF_TYPE_LABEL[roof.roofType] ?? roof.roofType} />
      </div>
    </StepShell>
  )
}
