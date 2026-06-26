import type { GoogleSolarBuildingInsights, SolarResults } from '@/lib/types'
import type { PricingCatalogue, RoofType, SystemConfig, Tier } from '@/lib/pricing/types'
import type { SentinelConfig, SentinelResult } from './sentinel'
import type { BudgetLadder } from './ladderTypes'

export type PresetTier = Exclude<Tier, 'custom'>
export type OptionKind = 'budget_fit' | 'better_value' | 'recommended'

/** One presented system option (one column of the results comparison table). */
export interface OptionResult {
  id: OptionKind
  kind: OptionKind
  label: string // 'Budget-fit' | 'Better value' | 'Recommended'
  isRecommended: boolean
  tier: PresetTier
  config: SystemConfig
  panelCount: number
  panelType: string
  inverterType: string
  batteryType: string | null
  batteryCapacityKwh: number
  systemKwp: number
  priceGbp: number
  results: SolarResults
  sentinel: SentinelResult
  inclusions: string[]
  /** Short benefit framing distinct per tier (e.g. "Lowest upfront cost"). */
  headline: string
  bestSuitedTo: string
  nextStep: string
  score: number
  warnings: string[]
  /** Even the smallest option exceeds the stated budget. */
  aboveBudget: boolean
  /** Sizing was capped by the roof rather than the budget. */
  roofLimited: boolean
}

export interface OptionSetContext {
  mcsZone: string
  irradianceKwhPerM2: number
  annualKwh: number
  roofMaxPanels: number
  budgetMaxGbp: number
}

export interface OptionSet {
  /** Exactly 3 distinct options, ordered by price ascending. */
  options: OptionResult[]
  recommendedId: OptionKind
  context: OptionSetContext
  warnings: string[]
  /**
   * Continuous budget ladder for the slider — a single recommended system that
   * morphs as the budget changes. Optional so existing consumers (lead route,
   * tests) remain valid; populated by `buildOptionSet`.
   */
  ladder?: BudgetLadder
}

/**
 * Everything the pure engine needs — all I/O (catalogue load, MCS / tariff /
 * consumption lookup) happens upstream in the results route.
 */
export interface OptionSetInput {
  catalogue: PricingCatalogue
  roofMaxPanels: number
  roofType: RoofType
  pitchDeg: number
  mcsOrientationDeg: number
  /** Present → use Google's modelled DC generation; absent → MCS irradiance path. */
  solarInsights: GoogleSolarBuildingInsights | null
  annualKwh: number
  importTariffPence: number
  exportTariffPence: number
  /** Homeowner tariff type + lifestyle tags — drive the Sentinel uplift. */
  tariffType: string
  lifestyle: string[]
  /** Homeowner goal + existing system — feed the ladder's battery affinity. */
  motivation: string | null
  existing: string | null
  sentinelConfig: SentinelConfig | null
  mcsZone: string
  irradianceKwhPerM2: number
  shadingLoss: number
  inverterLoss: number
  systemLoss: number
  energyInflationRate: number
  panelDegradationPerYear: number
  minPanels: number
  maxPanels: number
  marginPercent: number
  /** Upper bound of the homeowner's stated budget band. */
  budgetMaxGbp: number
}
