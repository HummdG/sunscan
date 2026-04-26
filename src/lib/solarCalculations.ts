import type { PanelSpec, SolarAssumptions, SolarResults } from './types'

// ─── Default constants ────────────────────────────────────────────────────────

export const DEFAULT_PANEL: PanelSpec = {
  widthMm: 1134,
  heightMm: 1722,
  depthMm: 30,
  wattPeak: 430,
  modelName: 'Generic 430W Monocrystalline',
}

export const DEFAULT_ASSUMPTIONS: SolarAssumptions = {
  roofPitchDeg: 35,
  roofOrientationDeg: 0, // 0 = South (MCS convention)
  shadingLoss: 0.05,
  inverterLoss: 0.03,
  systemLoss: 0.10,
  systemCostPounds: 8500,
  hasBattery: false,
  batteryKwh: 5.2,
  exportTariffPencePerKwh: 15, // SEG rate
}

// UK grid carbon intensity (2024 figure, DESNZ)
const UK_GRID_CARBON_KG_PER_KWH = 0.233

// Seasonal monthly weighting for annual generation distribution
// Weights sum to 1.0, based on typical UK solar irradiance profile
const MONTHLY_WEIGHTS = [
  0.030, // Jan
  0.050, // Feb
  0.080, // Mar
  0.100, // Apr
  0.125, // May
  0.130, // Jun
  0.120, // Jul
  0.110, // Aug
  0.090, // Sep
  0.065, // Oct
  0.050, // Nov
  0.030, // Dec — TODO: use per-zone monthly MCS profiles
]

// ─── Core formulas ────────────────────────────────────────────────────────────

export function calcSystemSizeKw(panelCount: number, panel: PanelSpec): number {
  return (panelCount * panel.wattPeak) / 1000
}

/**
 * MCS annual generation estimate.
 * annualGenKwh = systemKwp × irradianceKwhPerM2 × performanceRatio
 * performanceRatio = (1 - shadingLoss) × (1 - inverterLoss) × (1 - systemLoss)
 *
 * TODO: Replace with full MCS worksheet calculation for survey-grade accuracy.
 */
export function calcAnnualGeneration(
  systemSizeKw: number,
  irradianceKwhPerM2: number,
  assumptions: Pick<SolarAssumptions, 'shadingLoss' | 'inverterLoss' | 'systemLoss'>,
): number {
  const pr =
    (1 - assumptions.shadingLoss) *
    (1 - assumptions.inverterLoss) *
    (1 - assumptions.systemLoss)
  return systemSizeKw * irradianceKwhPerM2 * pr
}

/**
 * Simple self-consumption model based on consumption/generation ratio.
 * TODO: Replace with diurnal time-series model for accurate battery sizing.
 */
export function calcSelfConsumption(
  annualGenKwh: number,
  annualDemandKwh: number,
  hasBattery: boolean,
  batteryKwh: number = 0,
): { selfConsumptionKwh: number; exportKwh: number; selfConsumptionRate: number } {
  // Base self-consumption rate without battery (~30% for typical UK household)
  let rate = Math.min(0.3, annualDemandKwh / (annualGenKwh * 3.33))
  if (hasBattery && batteryKwh > 0) {
    // Battery increases self-consumption; rough estimate: +5% per kWh of storage
    rate = Math.min(0.85, rate + (batteryKwh * 0.05))
  }
  const selfConsumptionKwh = annualGenKwh * rate
  const exportKwh = annualGenKwh - selfConsumptionKwh
  return { selfConsumptionKwh, exportKwh, selfConsumptionRate: rate }
}

export function calcAnnualSavings(
  selfConsumptionKwh: number,
  exportKwh: number,
  tariffPencePerKwh: number,
  exportTariffPencePerKwh: number,
): number {
  const importSaving = (selfConsumptionKwh * tariffPencePerKwh) / 100
  const exportEarning = (exportKwh * exportTariffPencePerKwh) / 100
  return importSaving + exportEarning
}

export function calcPayback(systemCostPounds: number, annualSavingsPounds: number): number {
  if (annualSavingsPounds <= 0) return 99
  return systemCostPounds / annualSavingsPounds
}

export function calcCo2Saved(annualGenKwh: number): number {
  return (annualGenKwh * UK_GRID_CARBON_KG_PER_KWH) / 1000 // tonnes
}

export function calcMonthlyGenProfile(annualGenKwh: number): number[] {
  return MONTHLY_WEIGHTS.map((w) => Math.round(annualGenKwh * w))
}

export function calc25YearSavings(
  annualSavingsPounds: number,
  systemCostPounds: number,
  inflationRate = 0.04, // 4% annual energy price inflation
): { year: number; saving: number; cumulative: number }[] {
  const result = []
  let cumulative = -systemCostPounds
  for (let year = 1; year <= 25; year++) {
    const saving = annualSavingsPounds * Math.pow(1 + inflationRate, year - 1)
    cumulative += saving
    result.push({ year, saving: Math.round(saving), cumulative: Math.round(cumulative) })
  }
  return result
}

/**
 * Master function: given all inputs, return all SolarResults.
 */
export function runSolarCalculations(
  panelCount: number,
  panel: PanelSpec,
  irradianceKwhPerM2: number,
  annualDemandKwh: number,
  assumptions: SolarAssumptions,
): SolarResults {
  const systemSizeKw = calcSystemSizeKw(panelCount, panel)
  const annualGenerationKwh = calcAnnualGeneration(systemSizeKw, irradianceKwhPerM2, assumptions)
  const { selfConsumptionKwh, exportKwh, selfConsumptionRate } = calcSelfConsumption(
    annualGenerationKwh,
    annualDemandKwh,
    assumptions.hasBattery,
    assumptions.batteryKwh,
  )
  const annualSavingsPounds = calcAnnualSavings(
    selfConsumptionKwh,
    exportKwh,
    // TODO: pull tariff from bill data passed into this function
    24.5, // placeholder — caller should pass actual tariff
    assumptions.exportTariffPencePerKwh,
  )
  const paybackYears = calcPayback(assumptions.systemCostPounds, annualSavingsPounds)
  const co2SavedTonnesPerYear = calcCo2Saved(annualGenerationKwh)
  const monthlyGenKwh = calcMonthlyGenProfile(annualGenerationKwh)
  const twentyFiveYearSavings = calc25YearSavings(annualSavingsPounds, assumptions.systemCostPounds)

  return {
    annualGenerationKwh: Math.round(annualGenerationKwh),
    selfConsumptionKwh: Math.round(selfConsumptionKwh),
    exportKwh: Math.round(exportKwh),
    selfConsumptionRate,
    annualSavingsPounds: Math.round(annualSavingsPounds),
    paybackYears: Math.round(paybackYears * 10) / 10,
    co2SavedTonnesPerYear: Math.round(co2SavedTonnesPerYear * 100) / 100,
    monthlyGenKwh,
    twentyFiveYearSavings,
  }
}
