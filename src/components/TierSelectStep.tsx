'use client'

import { useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import type { TierPresetSummary } from '@/lib/pricing/types'

type Tier = 'essential' | 'standard' | 'premium'

interface Props {
  presets: TierPresetSummary[]
  selectedTier: Tier | null
  onSelect: (tier: Tier) => void
  roofMaxPanels: number
  loading?: boolean
}

const TIER_META: Record<Tier, { num: string; label: string; tagline: string; accent: string }> = {
  essential: {
    num: '01',
    label: 'Essential',
    tagline: 'Solid PV-only setup. The clean entry point.',
    accent: 'var(--ss-t2)',
  },
  standard: {
    num: '02',
    label: 'Standard',
    tagline: 'PV + battery. The most popular spec for UK homes.',
    accent: 'var(--ss-amber)',
  },
  premium: {
    num: '03',
    label: 'Premium',
    tagline: 'High-yield bifacial with 10 kWh storage & backup.',
    accent: 'var(--ss-violet-l)',
  },
}

const INCLUSIONS_PREVIEW = 4

function formatGbp(n: number): string {
  return `£${n.toLocaleString('en-GB')}`
}

export function TierSelectStep({
  presets,
  selectedTier,
  onSelect,
  roofMaxPanels,
  loading,
}: Props) {
  return (
    <div className="space-y-4">
      {roofMaxPanels < 6 && (
        <div
          className="flex items-start gap-2 p-3 text-sm"
          style={{
            background: 'rgba(217,119,6,0.10)',
            border: '1px solid rgba(217,119,6,0.35)',
            color: 'var(--ss-amber)',
            borderRadius: 4,
          }}
        >
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Your roof only fits about {roofMaxPanels} panels. All packages are sized to your roof.
            Differences come from panel quality, battery and add-ons, not system size.
          </span>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="animate-pulse h-[140px]"
              style={{
                background: 'var(--ss-s2)',
                border: '1px solid var(--ss-border)',
                borderRadius: 4,
              }}
            />
          ))}
        </div>
      )}

      {!loading && (
        <ol className="space-y-3">
          {presets.map((preset) => (
            <li key={preset.tier}>
              <TierRow
                preset={preset}
                isSelected={selectedTier === preset.tier}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function TierRow({
  preset,
  isSelected,
  onSelect,
}: {
  preset: TierPresetSummary
  isSelected: boolean
  onSelect: (tier: Tier) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = TIER_META[preset.tier]
  const isPopular = preset.tier === 'standard'
  const extra = preset.inclusions.length - INCLUSIONS_PREVIEW
  const visibleInclusions = expanded
    ? preset.inclusions
    : preset.inclusions.slice(0, INCLUSIONS_PREVIEW)

  const handleSelect = () => onSelect(preset.tier)
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleSelect()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={handleSelect}
      onKeyDown={handleKey}
      className="relative w-full text-left transition-all focus-visible:outline-none focus-visible:ring-2"
      style={{
        background: isSelected ? 'var(--ss-s2)' : 'var(--ss-ink)',
        border: `1px solid ${isSelected ? meta.accent : 'var(--ss-border-h)'}`,
        borderRadius: 4,
        padding: '18px 20px',
        cursor: 'pointer',
        boxShadow: isSelected
          ? `inset 0 0 0 1px ${meta.accent}, 0 6px 18px rgba(120,70,40,0.08)`
          : undefined,
      }}
    >
      {/* Hairline corner brackets when selected */}
      {isSelected &&
        (['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <span
            key={c}
            className="absolute pointer-events-none"
            style={{
              width: 10,
              height: 10,
              borderTop: c.includes('t') ? `2px solid ${meta.accent}` : 'none',
              borderBottom: c.includes('b') ? `2px solid ${meta.accent}` : 'none',
              borderLeft: c.includes('l') ? `2px solid ${meta.accent}` : 'none',
              borderRight: c.includes('r') ? `2px solid ${meta.accent}` : 'none',
              top: c.includes('t') ? -1 : 'auto',
              bottom: c.includes('b') ? -1 : 'auto',
              left: c.includes('l') ? -1 : 'auto',
              right: c.includes('r') ? -1 : 'auto',
            }}
          />
        ))}

      {/* Top row — stage stamp + price */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div
          className="flex items-center gap-2 ss-mono text-[10px] uppercase flex-wrap"
          style={{ letterSpacing: '0.18em' }}
        >
          <span
            style={{
              background: meta.accent,
              color: 'var(--ss-ink)',
              padding: '3px 7px',
              borderRadius: 2,
              fontWeight: 800,
            }}
          >
            {meta.num}
          </span>
          <span style={{ color: meta.accent, fontWeight: 700 }}>
            {meta.label.toUpperCase()}
          </span>
          {isPopular && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5"
              style={{
                background: 'var(--ss-s1)',
                border: `1px solid ${meta.accent}`,
                borderRadius: 2,
                color: meta.accent,
              }}
            >
              ★ Most popular
            </span>
          )}
          {isSelected && (
            <span
              className="inline-flex items-center gap-1 ml-0.5"
              style={{ color: meta.accent }}
            >
              <Check className="h-3 w-3" /> Selected
            </span>
          )}
        </div>
        <div className="text-right shrink-0">
          <div
            className="ss-heading font-extrabold leading-none"
            style={{ fontSize: 26, color: 'var(--ss-t1)' }}
          >
            {formatGbp(preset.totalPounds)}
          </div>
          <div
            className="ss-mono text-[10px] uppercase mt-1.5"
            style={{ letterSpacing: '0.14em', color: 'var(--ss-t4)' }}
          >
            {preset.panelCount} pnl · {preset.kwp.toFixed(2)} kWp · 0% VAT
          </div>
        </div>
      </div>

      {/* Tagline */}
      <p className="text-[14px] mb-3" style={{ color: 'var(--ss-t3)' }}>
        {meta.tagline}
      </p>

      {/* Inclusions — compact 2-col with terracotta dots */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        {visibleInclusions.map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span
              className="w-1 h-1 rounded-full mt-2 flex-shrink-0"
              style={{ background: meta.accent }}
            />
            <span style={{ color: 'var(--ss-t2)' }}>{line}</span>
          </li>
        ))}
      </ul>

      {extra > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded((v) => !v)
          }}
          aria-expanded={expanded}
          className="ss-mono text-[10px] uppercase mt-3 inline-flex items-center gap-1.5 transition-colors group"
          style={{
            letterSpacing: '0.2em',
            color: expanded ? meta.accent : 'var(--ss-t3)',
            background: 'transparent',
            border: 'none',
            padding: '2px 0',
            cursor: 'pointer',
          }}
        >
          <span
            aria-hidden
            className="inline-flex items-center justify-center"
            style={{
              width: 14,
              height: 14,
              border: `1px solid ${expanded ? meta.accent : 'var(--ss-border-h)'}`,
              borderRadius: 2,
              fontSize: 11,
              fontWeight: 800,
              lineHeight: 1,
              transition: 'transform 220ms ease, border-color 200ms ease, color 200ms ease',
              transform: expanded ? 'rotate(45deg)' : 'rotate(0deg)',
              color: expanded ? meta.accent : 'var(--ss-t3)',
            }}
          >
            +
          </span>
          <span className="group-hover:underline underline-offset-4">
            {expanded ? 'Show fewer' : `${extra} more inclusion${extra === 1 ? '' : 's'}`}
          </span>
        </button>
      )}
    </div>
  )
}
