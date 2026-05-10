'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Loader2, Save, RotateCcw, AlertTriangle, Sparkles, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import type {
  PricingCatalogue,
  QuoteBreakdown,
  RoofType,
  SystemConfig,
  Tier,
} from '@/lib/pricing/types'

interface Props {
  reportId: string
  initialConfig: SystemConfig
  initialQuote: QuoteBreakdown
  catalogue: PricingCatalogue
  roofMaxPanels: number
  roofType: RoofType
  initialTier: Tier
}

function formatGbp(n: number): string {
  return `£${n.toLocaleString('en-GB')}`
}

function firstNum(v: number | readonly number[]): number {
  return Array.isArray(v) ? v[0] : (v as number)
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const TIER_LABEL: Record<Tier, string> = {
  essential: 'Essential',
  standard: 'Standard',
  premium: 'Premium',
  custom: 'Custom',
}

export function SystemConfigurator({
  reportId,
  initialConfig,
  initialQuote,
  catalogue,
  roofMaxPanels,
  roofType,
  initialTier,
}: Props) {
  const router = useRouter()
  const [config, setConfig] = useState<SystemConfig>(initialConfig)
  const [quote, setQuote] = useState<QuoteBreakdown>(initialQuote)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dirty = useMemo(() => JSON.stringify(config) !== JSON.stringify(initialConfig), [config, initialConfig])

  // ── Preview (debounced) ──────────────────────────────────────────────
  useEffect(() => {
    if (!dirty) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      setPreviewing(true)
      try {
        const res = await fetch('/api/quote/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ config, reportId }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('Preview failed')
        const data = await res.json()
        setQuote(data.quote)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error('Preview error', err)
        }
      } finally {
        setPreviewing(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [config, dirty, reportId])

  function setTierPreset(tier: 'essential' | 'standard' | 'premium') {
    // Re-derive tier preset on the server to ensure roof/demand context is honoured
    void (async () => {
      try {
        const res = await fetch('/api/quote/tiers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annualKwh: 4000, // a sane default — server is just rebuilding presets
            roofMaxPanels,
            roofType,
          }),
        })
        if (!res.ok) return
        const data = await res.json()
        const target = data.presets.find(
          (p: { tier: string; config: SystemConfig }) => p.tier === tier,
        )
        if (target) {
          setConfig(target.config as SystemConfig)
        }
      } catch (err) {
        console.error('Tier reset failed', err)
      }
    })()
  }

  async function handleSave() {
    setSaving(true)
    try {
      const res = await fetch(`/api/report/${reportId}/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Save failed')
      setQuote(data.quote)
      setSavedAt(new Date())
      toast.success('Saved — quote PDF regenerated')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  // Copy before sorting — Prisma's array prop is read-only at runtime via type.
  const panels = useMemo(
    () => [...catalogue.panels].sort((a, b) => a.sortOrder - b.sortOrder),
    [catalogue.panels],
  )
  const mounting = useMemo(
    () => catalogue.mounting.filter((m) => m.appliesTo === roofType || m.appliesTo === 'pitched'),
    [catalogue.mounting, roofType],
  )
  const batteries = useMemo(
    () => [...catalogue.batteries].sort((a, b) => a.sortOrder - b.sortOrder),
    [catalogue.batteries],
  )
  const scaffold = useMemo(
    () => catalogue.extras.filter((e) => e.category === 'scaffold'),
    [catalogue.extras],
  )
  const electrical = useMemo(
    () => catalogue.extras.filter((e) => e.category === 'general_electrical' && !e.isMandatory),
    [catalogue.extras],
  )
  const evChargers = useMemo(
    () => catalogue.extras.filter((e) => e.category === 'ev'),
    [catalogue.extras],
  )
  const epsOptions = useMemo(
    () => catalogue.extras.filter((e) => e.category === 'eps'),
    [catalogue.extras],
  )

  function toggleQuantity(
    list: 'scaffoldingExtras' | 'electricalExtras' | 'optionalExtras',
    sku: string,
    on: boolean,
  ) {
    setConfig((prev) => {
      const existing = prev[list].filter((x) => x.sku !== sku)
      return { ...prev, [list]: on ? [...existing, { sku, quantity: 1 }] : existing }
    })
  }

  function setSingleExclusive(
    list: 'optionalExtras',
    group: 'eps' | 'ev',
    sku: string | null,
  ) {
    setConfig((prev) => {
      const filtered = prev[list].filter((x) => {
        const extra = catalogue.extras.find((e) => e.sku === x.sku)
        return !(extra?.exclusiveGroup === group)
      })
      return { ...prev, [list]: sku ? [...filtered, { sku, quantity: 1 }] : filtered }
    })
  }

  const selectedEv = config.optionalExtras.find((x) => evChargers.some((e) => e.sku === x.sku))?.sku
  const selectedEps = config.optionalExtras.find((x) => epsOptions.some((e) => e.sku === x.sku))?.sku

  const bespokeTrenchingWarning = quote.warnings.find((w) => w.toLowerCase().includes('bespoke'))

  return (
    <Card className="overflow-visible border-amber-200/60 shadow-sm">
      <CardHeader className="border-b bg-gradient-to-br from-amber-50 to-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Settings2 className="h-5 w-5 text-amber-600" />
              Configure your system
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Swap panels, batteries, or extras. Total updates live. Save when you&apos;re happy to
              regenerate your quote PDF.
            </p>
          </div>
          <Badge variant="outline" className="bg-white shrink-0">
            Started: {TIER_LABEL[initialTier]}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="grid lg:grid-cols-[1fr_320px]">
          {/* ── Left column: form ─────────────────────────────────── */}
          <div className="p-6 space-y-4 border-r">
            {/* Tier preset chips */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-muted-foreground mr-1">
                Quick presets:
              </span>
              {(['essential', 'standard', 'premium'] as const).map((tier) => (
                <Button
                  key={tier}
                  size="sm"
                  variant={config.tier === tier ? 'default' : 'outline'}
                  className={
                    config.tier === tier
                      ? 'bg-[#B04020] hover:bg-[#8B3219]'
                      : ''
                  }
                  onClick={() => setTierPreset(tier)}
                >
                  {TIER_LABEL[tier]}
                </Button>
              ))}
              {config.tier === 'custom' && (
                <Badge variant="outline" className="ml-1 gap-1">
                  <Sparkles className="h-3 w-3" /> Custom
                </Badge>
              )}
            </div>

            <Accordion multiple defaultValue={['panels', 'battery']} className="w-full">
              {/* Panels */}
              <AccordionItem value="panels">
                <AccordionTrigger>Panels</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <RadioGroup
                    value={config.panelSku}
                    onValueChange={(v) =>
                      setConfig((c) => ({ ...c, panelSku: asString(v), tier: 'custom' }))
                    }
                  >
                    {panels.map((p) => (
                      <div key={p.sku} className="flex items-start gap-2 py-1">
                        <RadioGroupItem value={p.sku} id={`panel-${p.sku}`} className="mt-0.5" />
                        <Label htmlFor={`panel-${p.sku}`} className="flex-1 cursor-pointer font-normal">
                          <div className="font-medium">{p.modelName}</div>
                          <div className="text-xs text-muted-foreground">
                            {p.wattPeak}W ·{' '}
                            {p.upliftType === 'base'
                              ? 'Base price'
                              : p.upliftType === 'percent'
                                ? `+${(p.upliftValue * 100).toFixed(1)}% uplift`
                                : `+£${p.upliftValue}/panel`}
                          </div>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Number of panels</Label>
                      <span className="text-sm font-mono font-bold">{config.panelCount}</span>
                    </div>
                    <Slider
                      value={[config.panelCount]}
                      min={1}
                      max={Math.max(roofMaxPanels, 6)}
                      step={1}
                      onValueChange={(v) =>
                        setConfig((c) => ({ ...c, panelCount: firstNum(v), tier: 'custom' }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Roof fits up to {roofMaxPanels} panels
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Mounting */}
              <AccordionItem value="mounting">
                <AccordionTrigger>Mounting</AccordionTrigger>
                <AccordionContent>
                  <RadioGroup
                    value={config.mountingSku}
                    onValueChange={(v) =>
                      setConfig((c) => ({ ...c, mountingSku: asString(v), tier: 'custom' }))
                    }
                  >
                    {mounting.map((m) => (
                      <div key={m.sku} className="flex items-start gap-2 py-1">
                        <RadioGroupItem value={m.sku} id={`mount-${m.sku}`} className="mt-0.5" />
                        <Label htmlFor={`mount-${m.sku}`} className="flex-1 cursor-pointer font-normal">
                          <div className="font-medium">{m.label}</div>
                          <div className="text-xs text-muted-foreground">
                            £{m.pricePerPanel}/panel
                          </div>
                        </Label>
                      </div>
                    ))}
                  </RadioGroup>
                </AccordionContent>
              </AccordionItem>

              {/* Battery */}
              <AccordionItem value="battery">
                <AccordionTrigger>Battery storage</AccordionTrigger>
                <AccordionContent className="space-y-4">
                  <Select
                    value={config.battery?.sku ?? 'NONE'}
                    onValueChange={(rawV) => {
                      const v = asString(rawV)
                      setConfig((c) => ({
                        ...c,
                        tier: 'custom',
                        battery:
                          !v || v === 'NONE'
                            ? null
                            : {
                                sku: v,
                                expansionUnits: 0,
                                isRetrofit: false,
                              },
                      }))
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a battery" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">No battery</SelectItem>
                      {batteries.map((b) => (
                        <SelectItem key={b.sku} value={b.sku}>
                          {b.modelName} — {b.baseCapacityKwh} kWh ({formatGbp(b.priceWithSolar)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {config.battery && (
                    <>
                      {(() => {
                        const battery = batteries.find((b) => b.sku === config.battery!.sku)
                        if (!battery) return null
                        return (
                          <div className="space-y-3 pt-2">
                            {battery.expansionSku && battery.expansionMaxUnits ? (
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Label className="text-sm">
                                    Expansion modules (+{battery.expansionCapacityKwh} kWh each)
                                  </Label>
                                  <span className="text-sm font-mono font-bold">
                                    {config.battery.expansionUnits}
                                  </span>
                                </div>
                                <Slider
                                  value={[config.battery.expansionUnits]}
                                  min={0}
                                  max={battery.expansionMaxUnits}
                                  step={1}
                                  onValueChange={(v) =>
                                    setConfig((c) => ({
                                      ...c,
                                      tier: 'custom',
                                      battery: c.battery
                                        ? { ...c.battery, expansionUnits: firstNum(v) }
                                        : null,
                                    }))
                                  }
                                />
                              </div>
                            ) : null}

                            <div className="flex items-center justify-between">
                              <Label className="text-sm">
                                Retrofit (no solar at the same time)
                              </Label>
                              <Switch
                                checked={config.battery.isRetrofit}
                                onCheckedChange={(checked) =>
                                  setConfig((c) => ({
                                    ...c,
                                    tier: 'custom',
                                    battery: c.battery ? { ...c.battery, isRetrofit: checked } : null,
                                  }))
                                }
                              />
                            </div>
                          </div>
                        )
                      })()}
                    </>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Scaffolding & site */}
              <AccordionItem value="scaffold">
                <AccordionTrigger>Scaffolding &amp; site complexity</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  {scaffold.map((s) => {
                    const checked = config.scaffoldingExtras.some((x) => x.sku === s.sku)
                    return (
                      <div key={s.sku} className="flex items-center gap-2 py-1">
                        <Checkbox
                          id={`scaf-${s.sku}`}
                          checked={checked}
                          onCheckedChange={(v) =>
                            toggleQuantity('scaffoldingExtras', s.sku, !!v)
                          }
                        />
                        <Label htmlFor={`scaf-${s.sku}`} className="flex-1 cursor-pointer font-normal">
                          <span className="font-medium">{s.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({formatGbp(s.baseGbp)})
                          </span>
                        </Label>
                      </div>
                    )
                  })}
                </AccordionContent>
              </AccordionItem>

              {/* Electrical */}
              <AccordionItem value="electrical">
                <AccordionTrigger>Electrical extras</AccordionTrigger>
                <AccordionContent className="space-y-2">
                  {electrical.map((e) => {
                    const checked = config.electricalExtras.some((x) => x.sku === e.sku)
                    return (
                      <div key={e.sku} className="flex items-center gap-2 py-1">
                        <Checkbox
                          id={`elec-${e.sku}`}
                          checked={checked}
                          onCheckedChange={(v) =>
                            toggleQuantity('electricalExtras', e.sku, !!v)
                          }
                        />
                        <Label htmlFor={`elec-${e.sku}`} className="flex-1 cursor-pointer font-normal">
                          <span className="font-medium">{e.label}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({formatGbp(e.baseGbp)})
                          </span>
                        </Label>
                      </div>
                    )
                  })}
                </AccordionContent>
              </AccordionItem>

              {/* Optional extras */}
              <AccordionItem value="optional">
                <AccordionTrigger>Optional extras</AccordionTrigger>
                <AccordionContent className="space-y-5">
                  {/* EV charger */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">EV charger</Label>
                    <Select
                      value={selectedEv ?? 'NONE'}
                      onValueChange={(rawV) => {
                        const v = asString(rawV)
                        setSingleExclusive('optionalExtras', 'ev', !v || v === 'NONE' ? null : v)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select an EV charger" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">None</SelectItem>
                        {evChargers.map((e) => (
                          <SelectItem key={e.sku} value={e.sku}>
                            {e.label} ({formatGbp(e.baseGbp)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Optimisers */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Tigo solar optimisers</Label>
                    <RadioGroup
                      value={config.optimiserScope}
                      onValueChange={(v) =>
                        setConfig((c) => ({
                          ...c,
                          tier: 'custom',
                          optimiserScope: asString(v) as SystemConfig['optimiserScope'],
                        }))
                      }
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="none" id="opt-none" />
                        <Label htmlFor="opt-none" className="font-normal cursor-pointer">
                          None
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="partial" id="opt-partial" />
                        <Label htmlFor="opt-partial" className="font-normal cursor-pointer">
                          Partial system (£60/panel)
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="full" id="opt-full" />
                        <Label htmlFor="opt-full" className="font-normal cursor-pointer">
                          Full system (£50/panel)
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Bird mesh */}
                  <div className="flex items-center justify-between">
                    <Label htmlFor="birdmesh" className="font-normal">
                      EnviroGuard bird-proofing mesh
                      <span className="text-xs text-muted-foreground ml-2">
                        (£600 up to 20 panels, +£30/panel after)
                      </span>
                    </Label>
                    <Switch
                      id="birdmesh"
                      checked={config.birdMesh}
                      onCheckedChange={(v) =>
                        setConfig((c) => ({ ...c, birdMesh: v, tier: 'custom' }))
                      }
                    />
                  </div>

                  {/* EPS */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Emergency Power Supply</Label>
                    <Select
                      value={selectedEps ?? 'NONE'}
                      onValueChange={(rawV) => {
                        const v = asString(rawV)
                        setSingleExclusive('optionalExtras', 'eps', !v || v === 'NONE' ? null : v)
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select EPS option" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NONE">None</SelectItem>
                        {epsOptions.map((e) => (
                          <SelectItem key={e.sku} value={e.sku}>
                            {e.label} ({formatGbp(e.baseGbp)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </AccordionContent>
              </AccordionItem>

              {/* Trenching */}
              <AccordionItem value="trenching">
                <AccordionTrigger>Cable trenching</AccordionTrigger>
                <AccordionContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Trenching required</Label>
                    <Switch
                      checked={!!config.trenching}
                      onCheckedChange={(on) =>
                        setConfig((c) => ({
                          ...c,
                          tier: 'custom',
                          trenching: on ? { surface: 'soft', metres: 10 } : null,
                        }))
                      }
                    />
                  </div>
                  {config.trenching && (
                    <>
                      <RadioGroup
                        value={config.trenching.surface}
                        onValueChange={(v) =>
                          setConfig((c) => ({
                            ...c,
                            tier: 'custom',
                            trenching: c.trenching
                              ? { ...c.trenching, surface: asString(v) as 'soft' | 'hard' }
                              : null,
                          }))
                        }
                        className="flex gap-4"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="soft" id="trench-soft" />
                          <Label htmlFor="trench-soft" className="font-normal cursor-pointer">
                            Soft (grass/gravel)
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="hard" id="trench-hard" />
                          <Label htmlFor="trench-hard" className="font-normal cursor-pointer">
                            Hard (tarmac/patio)
                          </Label>
                        </div>
                      </RadioGroup>
                      <div>
                        <Label className="text-sm">Distance (metres)</Label>
                        <Input
                          type="number"
                          min={0}
                          max={500}
                          value={config.trenching.metres}
                          onChange={(e) =>
                            setConfig((c) => ({
                              ...c,
                              tier: 'custom',
                              trenching: c.trenching
                                ? { ...c.trenching, metres: parseInt(e.target.value) || 0 }
                                : null,
                            }))
                          }
                          className="mt-1"
                        />
                      </div>
                    </>
                  )}
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>

          {/* ── Right column: sticky total ─────────────────────────── */}
          <div className="p-6 bg-slate-50/50">
            <div className="lg:sticky lg:top-20 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Your quote
                </div>
                <div className="text-4xl font-bold tracking-tight">
                  {formatGbp(quote.totalPounds)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {quote.vatRatePercent === 0
                    ? '0% VAT (domestic solar)'
                    : `${quote.vatRatePercent}% VAT included`}
                  {previewing && (
                    <span className="ml-2 inline-flex items-center gap-1 text-amber-600">
                      <Loader2 className="h-3 w-3 animate-spin" /> Updating…
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5 text-sm border-t pt-3">
                {(
                  [
                    ['pv', 'Solar PV'],
                    ['panel_uplift', 'Panel uplift'],
                    ['mounting', 'Mounting'],
                    ['battery', 'Battery'],
                    ['scaffold', 'Scaffolding'],
                    ['electrical', 'Electrical'],
                    ['optional', 'Optional extras'],
                    ['trenching', 'Trenching'],
                    ['admin', 'Admin'],
                  ] as const
                ).map(([key, label]) => {
                  const v = quote.subtotalsByCategory[key] ?? 0
                  if (v === 0) return null
                  return (
                    <div key={key} className="flex justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-mono">{formatGbp(v)}</span>
                    </div>
                  )
                })}
              </div>

              {bespokeTrenchingWarning && (
                <div className="flex items-start gap-2 p-2 rounded bg-amber-50 border border-amber-200 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{bespokeTrenchingWarning}</span>
                </div>
              )}

              <div className="space-y-2 pt-3 border-t">
                <Button
                  className="w-full bg-[#B04020] hover:bg-[#8B3219]"
                  disabled={saving || previewing || !dirty}
                  onClick={handleSave}
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" /> Save &amp; regenerate PDF
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={!dirty}
                  onClick={() => {
                    setConfig(initialConfig)
                    setQuote(initialQuote)
                  }}
                >
                  <RotateCcw className="h-4 w-4 mr-2" /> Reset
                </Button>
              </div>

              {savedAt && (
                <div className="text-xs text-muted-foreground">
                  Last saved: {savedAt.toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
