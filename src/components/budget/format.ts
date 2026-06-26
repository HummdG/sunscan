// Shared display formatters for budget / savings UI (results + report screens).

export const gbp = (n: number): string => `£${Math.round(n).toLocaleString()}`

export const kwh = (n: number): string => `${Math.round(n).toLocaleString()} kWh`

export const pct = (frac: number): string => `${Math.round(frac * 100)}%`

export const years = (n: number): string => `${n.toFixed(1)} yrs`

/** Lifetime (25-year) savings hero value from a modelled results object. */
export const lifetimeSavings = (twentyFiveYearSavings: { cumulative: number }[]): number =>
  twentyFiveYearSavings.length ? twentyFiveYearSavings[twentyFiveYearSavings.length - 1].cumulative : 0
