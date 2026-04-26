'use client'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChevronDown, Info } from 'lucide-react'
import { useState } from 'react'
import type { SolarAssumptions } from '@/lib/types'
import { DEFAULT_ASSUMPTIONS } from '@/lib/solarCalculations'

interface AssumptionsPanelProps {
  value: SolarAssumptions
  onChange: (a: SolarAssumptions) => void
}

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help ml-1 inline" />
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="text-sm">{text}</p>
      </TooltipContent>
    </Tooltip>
  )
}

function NumericField({
  label,
  tip,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string
  tip: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="flex-1 text-sm">
        {label}
        <InfoTip text={tip} />
      </Label>
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-24 text-right h-8 text-sm"
        />
        {suffix && <span className="text-sm text-muted-foreground w-10">{suffix}</span>}
      </div>
    </div>
  )
}

export function AssumptionsPanel({ value, onChange }: AssumptionsPanelProps) {
  const [open, setOpen] = useState(false)

  const set = (key: keyof SolarAssumptions) => (v: number | boolean) =>
    onChange({ ...value, [key]: v })

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border bg-muted/40 px-4 py-3 text-sm font-medium hover:bg-muted/60 transition-colors">
        <span>Advanced Assumptions</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="rounded-b-lg border border-t-0 p-4 space-y-4 bg-background">
          <div className="text-xs text-muted-foreground mb-2">
            These defaults are suitable for most UK homes. Change only if you have specific data.
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Roof</p>
            <NumericField
              label="Roof Pitch"
              tip="Angle of the roof from horizontal. UK pitched roofs are typically 30–45°."
              value={value.roofPitchDeg}
              onChange={set('roofPitchDeg') as (v: number) => void}
              min={0} max={90} step={1} suffix="°"
            />
            <NumericField
              label="Roof Orientation"
              tip="MCS convention: 0 = due South (best), 90 = East or West, 180 = North. South-facing roofs maximise generation."
              value={value.roofOrientationDeg}
              onChange={set('roofOrientationDeg') as (v: number) => void}
              min={0} max={180} step={5} suffix="° from S"
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">System Losses</p>
            <NumericField
              label="Shading Loss"
              tip="Estimated energy lost to shading from trees, chimneys, or neighbouring buildings. 0.05 = 5% loss (default)."
              value={value.shadingLoss * 100}
              onChange={(v) => set('shadingLoss')(v / 100)}
              min={0} max={50} step={1} suffix="%"
            />
            <NumericField
              label="Inverter Loss"
              tip="Energy conversion loss in the inverter. Typical value: 3% (0.97 efficiency)."
              value={value.inverterLoss * 100}
              onChange={(v) => set('inverterLoss')(v / 100)}
              min={0} max={20} step={0.5} suffix="%"
            />
            <NumericField
              label="System Loss"
              tip="Aggregate losses from wiring resistance, temperature effects, and soiling. MCS default: 10%."
              value={value.systemLoss * 100}
              onChange={(v) => set('systemLoss')(v / 100)}
              min={0} max={30} step={1} suffix="%"
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Financial</p>
            <NumericField
              label="System Cost"
              tip="Total installed cost including panels, inverter, mounting, and labour. Used to calculate payback period."
              value={value.systemCostPounds}
              onChange={set('systemCostPounds') as (v: number) => void}
              min={1000} max={50000} step={100} suffix="£"
            />
            <NumericField
              label="Export Tariff (SEG)"
              tip="Rate paid by your energy supplier for electricity you export to the grid. Check your supplier's Smart Export Guarantee rate."
              value={value.exportTariffPencePerKwh}
              onChange={set('exportTariffPencePerKwh') as (v: number) => void}
              min={0} max={30} step={0.5} suffix="p/kWh"
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Battery Storage</p>
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                Include Battery Storage
                <InfoTip text="Adding a battery increases self-consumption by storing surplus daytime generation for evening use." />
              </Label>
              <button
                type="button"
                role="switch"
                aria-checked={value.hasBattery}
                onClick={() => set('hasBattery')(!value.hasBattery)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  value.hasBattery ? 'bg-solar-gold' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                    value.hasBattery ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {value.hasBattery && (
              <NumericField
                label="Battery Capacity"
                tip="Usable capacity of the battery storage system. 5–10 kWh is typical for a UK household."
                value={value.batteryKwh}
                onChange={set('batteryKwh') as (v: number) => void}
                min={1} max={50} step={0.5} suffix="kWh"
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => onChange(DEFAULT_ASSUMPTIONS)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Reset to defaults
          </button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
