import fs from 'fs'
import path from 'path'
import Papa from 'papaparse'

/**
 * Regional electricity tariff lookup for the installer lead-gen flow.
 *
 * When an installer just types an address (no bill), we still need import unit
 * rate, standing charge, and SEG export rate to size and price a system. We
 * maintain a static table keyed by postcode prefix → one of the 14 GB
 * electricity distribution regions.
 *
 * Source: representative Ofgem energy-price-cap regional figures for import
 * unit rate and standing charge; SEG export is supplier-set so a representative
 * ~15p/kWh is used. Maintained manually in `data/regional_tariffs.csv` — review
 * quarterly. The installer can always override the auto-derived rates.
 *
 * Mirrors the longest-prefix CSV lookup pattern in `src/lib/mcs.ts`.
 */

export interface RegionalTariff {
  importPencePerKwh: number
  standingChargePencePerDay: number
  segExportPencePerKwh: number
  regionName: string
  source: 'table' | 'default'
}

interface TariffRow {
  prefix: string
  region_name: string
  import_p_per_kwh: string
  standing_p_per_day: string
  seg_p_per_kwh: string
}

/** National-average fallback when a postcode prefix isn't in the table. */
export const DEFAULT_TARIFF: RegionalTariff = {
  importPencePerKwh: 24.5,
  standingChargePencePerDay: 53,
  segExportPencePerKwh: 15,
  regionName: 'National average',
  source: 'default',
}

let _tariffMap: Map<string, RegionalTariff> | null = null

function loadTariffMap(): Map<string, RegionalTariff> {
  if (_tariffMap) return _tariffMap
  const filePath = path.join(process.cwd(), 'data', 'regional_tariffs.csv')
  const csv = fs.readFileSync(filePath, 'utf8')
  const result = Papa.parse<TariffRow>(csv, { header: true, skipEmptyLines: true })
  _tariffMap = new Map(
    result.data
      .filter((r) => r.prefix)
      .map((r) => [
        r.prefix.trim().toUpperCase(),
        {
          importPencePerKwh: parseFloat(r.import_p_per_kwh),
          standingChargePencePerDay: parseFloat(r.standing_p_per_day),
          segExportPencePerKwh: parseFloat(r.seg_p_per_kwh),
          regionName: r.region_name.trim(),
          source: 'table' as const,
        },
      ]),
  )
  return _tariffMap
}

/**
 * Returns the regional tariff for a UK postcode.
 * Uses longest-match on the outward code: "EH1" → "EH" before "E".
 * Falls back to DEFAULT_TARIFF if no prefix matches.
 */
export function getTariffForPostcode(postcode: string): RegionalTariff {
  const map = loadTariffMap()
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase()
  // outward code is everything before the last 3 chars (inward = e.g. "1AA")
  const outward = cleaned.length > 3 ? cleaned.slice(0, cleaned.length - 3) : cleaned
  for (let len = outward.length; len >= 1; len--) {
    const candidate = outward.slice(0, len)
    const hit = map.get(candidate)
    if (hit) return hit
  }
  return DEFAULT_TARIFF
}
