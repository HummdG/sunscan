import type { GoogleSolarBuildingInsights, SolarResults } from '@/lib/types'
import type { PricingCatalogue, RoofType, SystemConfig, Tier } from '@/lib/pricing/types'

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
  inclusions: string[]
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
