'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Check, Sparkles, AlertTriangle } from 'lucide-react'
import type { TierPresetSummary } from '@/lib/pricing/types'

interface Props {
  presets: TierPresetSummary[]
  selectedTier: 'essential' | 'standard' | 'premium' | null
  onSelect: (tier: 'essential' | 'standard' | 'premium') => void
  roofMaxPanels: number
  loading?: boolean
}

const TIER_ACCENT: Record<'essential' | 'standard' | 'premium', { ring: string; pill: string }> = {
  essential: { ring: 'ring-slate-200', pill: 'bg-slate-100 text-slate-700' },
  standard: { ring: 'ring-amber-300', pill: 'bg-amber-100 text-amber-800' },
  premium: { ring: 'ring-violet-300', pill: 'bg-violet-100 text-violet-800' },
}

const TIER_LABEL: Record<'essential' | 'standard' | 'premium', string> = {
  essential: 'Essential',
  standard: 'Standard',
  premium: 'Premium',
}

const TIER_TAGLINE: Record<'essential' | 'standard' | 'premium', string> = {
  essential: 'Solid PV-only setup. Best entry point.',
  standard: 'PV + battery. Most popular for UK homes.',
  premium: 'High-yield bifacial + 10 kWh battery & backup.',
}

function formatGbp(n: number): string {
  return `£${n.toLocaleString('en-GB')}`
}

export function TierSelectStep({ presets, selectedTier, onSelect, roofMaxPanels, loading }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Choose your system</h1>
        <p className="text-muted-foreground mt-1">
          Three pre-configured packages tailored to your roof and energy use. You can fine-tune
          everything on the next page.
        </p>
      </div>

      {roofMaxPanels < 6 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Your roof only fits about {roofMaxPanels} panels — all packages are sized to your roof.
            Differences come from panel quality, battery, and add-ons rather than system size.
          </span>
        </div>
      )}

      {loading && (
        <div className="grid gap-4 md:grid-cols-3">
          {(['essential', 'standard', 'premium'] as const).map((tier) => (
            <Card key={tier} className="animate-pulse">
              <CardContent className="p-6 space-y-3">
                <div className="h-5 bg-slate-200 rounded w-1/2" />
                <div className="h-4 bg-slate-200 rounded w-3/4" />
                <div className="h-8 bg-slate-200 rounded w-1/3 mt-6" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading && (
        <div className="grid gap-4 md:grid-cols-3">
          {presets.map((preset) => {
            const isSelected = selectedTier === preset.tier
            const accent = TIER_ACCENT[preset.tier]
            const isMostPopular = preset.tier === 'standard'
            return (
              <Card
                key={preset.tier}
                className={`relative transition-all ${
                  isSelected
                    ? `ring-2 ${accent.ring} shadow-lg`
                    : 'hover:shadow-md cursor-pointer'
                }`}
                onClick={() => onSelect(preset.tier)}
              >
                {isMostPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-amber-500 hover:bg-amber-500 text-white border-0 shadow-sm gap-1">
                      <Sparkles className="h-3 w-3" /> Most popular
                    </Badge>
                  </div>
                )}
                <CardContent className="p-6 space-y-4">
                  <div className="space-y-1">
                    <div className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${accent.pill}`}>
                      {TIER_LABEL[preset.tier]}
                    </div>
                    <p className="text-sm text-muted-foreground pt-1">{TIER_TAGLINE[preset.tier]}</p>
                  </div>

                  <div>
                    <div className="text-3xl font-bold tracking-tight">
                      {formatGbp(preset.totalPounds)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {preset.panelCount} panels · {preset.kwp.toFixed(2)} kWp · 0% VAT
                    </div>
                  </div>

                  <ul className="space-y-1.5 text-sm">
                    {preset.inclusions.map((line) => (
                      <li key={line} className="flex items-start gap-2">
                        <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                        <span className="text-foreground/80">{line}</span>
                      </li>
                    ))}
                  </ul>

                  <Button
                    variant={isSelected ? 'default' : 'outline'}
                    className={`w-full ${isSelected ? 'bg-[#B04020] hover:bg-[#8B3219]' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelect(preset.tier)
                    }}
                  >
                    {isSelected ? (
                      <>
                        <Check className="h-4 w-4 mr-1" /> Selected
                      </>
                    ) : (
                      'Choose this system'
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
