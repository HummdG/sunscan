import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_PANEL,
  runSolarCalculations,
  runSolarCalculationsFromGoogleData,
} from '@/lib/solarCalculations'
import { computeQuote } from '@/lib/pricing/computeQuote'
import { buildTierPresets, inclusionsForTier } from '@/lib/pricing/tiers'
import type { PricingCatalogue, PricingContext, SystemConfig } from '@/lib/pricing/types'
import type { PanelSpec, SolarAssumptions, SolarResults } from '@/lib/types'
import type { OptionKind, OptionResult, OptionSet, OptionSetInput, PresetTier } from './optionTypes'

// ─── Scoring (ported from the proven sales-branch engine) ────────────────────
// Primary objective: net 25-year value (£). Penalties nudge away from systems
// that pay back too slowly or export a lot of cheap surplus (i.e. oversized).
const PAYBACK_TARGET_YEARS = 12
const PAYBACK_PENALTY_PER_YEAR = 150
const EXPORT_PENALTY_PER_KWH = 0.04
const PV_MAX_PANELS = 50 // computeQuote requires a pvBasePrice row in [1, 50]
const TIERS: PresetTier[] = ['essential', 'standard', 'premium']

function net25YearValue(r: SolarResults): number {
  const s = r.twentyFiveYearSavings
  return s.length ? s[s.length - 1].cumulative : 0
}

function scoreOf(r: SolarResults): number {
  const paybackPenalty = Math.max(0, r.paybackYears - PAYBACK_TARGET_YEARS) * PAYBACK_PENALTY_PER_YEAR
  const exportPenalty = r.exportKwh * EXPORT_PENALTY_PER_KWH
  return net25YearValue(r) - paybackPenalty - exportPenalty
}

function panelSpecFor(catalogue: PricingCatalogue, sku: string): PanelSpec {
  const p =
    catalogue.panels.find((x) => x.sku === sku) ??
    catalogue.panels.find((x) => x.isBase) ??
    catalogue.panels[0]
  if (!p) return DEFAULT_PANEL
  return {
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    depthMm: p.depthMm,
    wattPeak: p.wattPeak,
    modelName: p.modelName,
  }
}

function batteryKwhFor(catalogue: PricingCatalogue, config: SystemConfig): number {
  if (!config.battery) return 0
  const b = catalogue.batteries.find((x) => x.sku === config.battery!.sku)
  if (!b) return 0
  const expansion = (b.expansionCapacityKwh ?? 0) * (config.battery.expansionUnits ?? 0)
  return b.baseCapacityKwh + expansion
}

interface Candidate {
  tier: PresetTier
  config: SystemConfig
  panelCount: number
  systemKwp: number
  priceGbp: number
  hasBattery: boolean
  batteryKwh: number
  results: SolarResults
  score: number
  warnings: string[]
}

function sig(c: Candidate): string {
  return `${c.tier}:${c.panelCount}`
}

function makeCandidate(
  base: SystemConfig,
  tier: PresetTier,
  count: number,
  input: OptionSetInput,
  ctx: PricingContext,
): Candidate {
  const config: SystemConfig = { ...base, panelCount: count }
  const quote = computeQuote(config, ctx)
  const priceGbp = Math.round(quote.totalPounds * (1 + input.marginPercent))

  const hasBattery = !!config.battery
  const batteryKwh = batteryKwhFor(input.catalogue, config)

  const assumptions: SolarAssumptions = {
    ...DEFAULT_ASSUMPTIONS,
    roofPitchDeg: input.pitchDeg,
    roofOrientationDeg: input.mcsOrientationDeg,
    shadingLoss: input.shadingLoss,
    inverterLoss: input.inverterLoss,
    systemLoss: input.systemLoss,
    exportTariffPencePerKwh: input.exportTariffPence,
    energyInflationRate: input.energyInflationRate,
    panelDegradationPerYear: input.panelDegradationPerYear,
    hasBattery,
    batteryKwh,
    systemCostPounds: priceGbp,
  }

  const configs = input.solarInsights?.solarPotential.solarPanelConfigs
  let results: SolarResults
  if (configs && configs.length) {
    const ref = configs.reduce((best, c) =>
      Math.abs(c.panelsCount - count) < Math.abs(best.panelsCount - count) ? c : best,
    )
    const perPanelDc = ref.yearlyEnergyDcKwh / Math.max(1, ref.panelsCount)
    results = runSolarCalculationsFromGoogleData(
      perPanelDc * count,
      count,
      input.solarInsights!.solarPotential.panelCapacityWatts,
      input.annualKwh,
      input.importTariffPence,
      assumptions,
    )
  } else {
    results = runSolarCalculations(
      count,
      panelSpecFor(input.catalogue, config.panelSku),
      input.irradianceKwhPerM2,
      input.annualKwh,
      input.importTariffPence,
      assumptions,
    )
  }

  const pvRow = input.catalogue.pvBasePrice.find((r) => r.panelCount === count)
  const panel = input.catalogue.panels.find((p) => p.sku === config.panelSku)
  const systemKwp = pvRow?.kwp ?? Math.round((count * (panel?.wattPeak ?? 430)) / 10) / 100

  return {
    tier,
    config,
    panelCount: count,
    systemKwp,
    hasBattery,
    batteryKwh,
    priceGbp,
    results,
    score: scoreOf(results),
    warnings: quote.warnings,
  }
}

const LABELS: Record<OptionKind, string> = {
  budget_fit: 'Budget-fit',
  better_value: 'Better value',
  recommended: 'Recommended',
}
const BEST_SUITED: Record<OptionKind, string> = {
  budget_fit: 'A practical entry point that stays closest to your stated budget.',
  better_value: 'A stronger balance of cost, performance and payback.',
  recommended: 'Maximising long-term savings, performance and return on investment.',
}
const NEXT_STEP: Record<OptionKind, string> = {
  budget_fit: 'Book a free survey to confirm this is right for your home.',
  better_value: 'Book a free survey to lock in the detail.',
  recommended: 'Book a free survey — recommended for the strongest return.',
}
const KINDS_BY_PRICE: OptionKind[] = ['budget_fit', 'better_value', 'recommended']

function toOption(c: Candidate, kind: OptionKind, isRecommended: boolean, input: OptionSetInput): OptionResult {
  const panel = input.catalogue.panels.find((p) => p.sku === c.config.panelSku)
  const inv = input.catalogue.inverters.find((i) => i.isDefault) ?? input.catalogue.inverters[0]
  const battery = c.config.battery
    ? input.catalogue.batteries.find((b) => b.sku === c.config.battery!.sku)
    : null
  return {
    id: kind,
    kind,
    label: LABELS[kind],
    isRecommended,
    tier: c.tier,
    config: c.config,
    panelCount: c.panelCount,
    panelType: panel?.modelName ?? c.config.panelSku,
    inverterType: inv?.modelName ?? 'Standard hybrid inverter',
    batteryType: battery?.modelName ?? null,
    batteryCapacityKwh: c.batteryKwh,
    systemKwp: c.systemKwp,
    priceGbp: c.priceGbp,
    results: c.results,
    inclusions: inclusionsForTier(c.tier),
    bestSuitedTo: BEST_SUITED[kind],
    nextStep: NEXT_STEP[kind],
    score: c.score,
    warnings: c.warnings,
    aboveBudget: kind === 'budget_fit' && c.priceGbp > input.budgetMaxGbp,
    roofLimited: c.panelCount >= input.roofMaxPanels,
  }
}

/**
 * Build the three presented options (Budget-fit / Better value / Recommended)
 * from a fully-resolved input. Always returns exactly 3 distinct options ordered
 * by price ascending; `isRecommended` marks the highest-scoring of the three.
 */
export function buildOptionSet(input: OptionSetInput): OptionSet {
  const ctx: PricingContext = {
    catalogue: input.catalogue,
    roofMaxPanels: input.roofMaxPanels,
    annualKwh: input.annualKwh,
    roofType: input.roofType,
  }
  const presets = buildTierPresets(ctx)

  const minP = Math.max(1, input.minPanels)
  const maxP = Math.max(minP, Math.min(input.roofMaxPanels, input.maxPanels, PV_MAX_PANELS))

  const candidates: Candidate[] = []
  for (const tier of TIERS) {
    const base = presets[tier]
    for (let count = minP; count <= maxP; count++) {
      candidates.push(makeCandidate(base, tier, count, input, ctx))
    }
  }

  // ── Select 3 distinct anchors ──
  const within = candidates.filter((c) => c.priceGbp <= input.budgetMaxGbp)
  // Budget-fit: most panels within budget (tie → cheaper); else the cheapest overall.
  const budgetFit = (within.length ? within : candidates)
    .slice()
    .sort((a, b) =>
      within.length ? b.panelCount - a.panelCount || a.priceGbp - b.priceGbp : a.priceGbp - b.priceGbp,
    )[0]
  // Recommended: best score overall.
  const recommended = candidates.reduce((best, c) => (c.score > best.score ? c : best))

  const chosen: Candidate[] = []
  const seen = new Set<string>()
  const add = (c: Candidate | undefined) => {
    if (c && !seen.has(sig(c))) {
      seen.add(sig(c))
      chosen.push(c)
    }
  }
  add(budgetFit)
  add(recommended)

  // Better-value: best score strictly between the two anchor prices.
  if (chosen.length < 3) {
    const lo = Math.min(...chosen.map((c) => c.priceGbp))
    const hi = Math.max(...chosen.map((c) => c.priceGbp))
    const middle = candidates
      .filter((c) => !seen.has(sig(c)) && c.priceGbp > lo && c.priceGbp < hi)
      .sort((a, b) => b.score - a.score)[0]
    add(middle)
  }
  // Backfill to exactly 3 distinct, spread across the price range.
  if (chosen.length < 3) {
    for (const c of candidates.slice().sort((a, b) => a.priceGbp - b.priceGbp)) {
      if (chosen.length >= 3) break
      add(c)
    }
  }

  // Order by price; label by position; highlight the best-scoring of the three.
  const ordered = chosen.slice(0, 3).sort((a, b) => a.priceGbp - b.priceGbp)
  let recIdx = 0
  ordered.forEach((c, i) => {
    if (c.score > ordered[recIdx].score) recIdx = i
  })

  const options = ordered.map((c, i) => toOption(c, KINDS_BY_PRICE[i], i === recIdx, input))
  const warnings = Array.from(new Set(options.flatMap((o) => o.warnings)))

  return {
    options,
    recommendedId: KINDS_BY_PRICE[recIdx],
    context: {
      mcsZone: input.mcsZone,
      irradianceKwhPerM2: input.irradianceKwhPerM2,
      annualKwh: input.annualKwh,
      roofMaxPanels: input.roofMaxPanels,
      budgetMaxGbp: input.budgetMaxGbp,
    },
    warnings,
  }
}
