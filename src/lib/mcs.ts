import fs from 'fs'
import path from 'path'
import Papa from 'papaparse'

interface ZoneRow {
  postcode_district: string
  zone: string
}

interface IrradianceRow {
  zone: string
  inclination: number
  orientation: number
  irradiance: number
}

let _zoneMap: Map<string, string> | null = null
let _irradianceRows: IrradianceRow[] | null = null

function loadZoneMap(): Map<string, string> {
  if (_zoneMap) return _zoneMap
  const filePath = path.join(process.cwd(), 'data', 'mcs_postcode_zones.csv')
  const csv = fs.readFileSync(filePath, 'utf8')
  const result = Papa.parse<ZoneRow>(csv, { header: true, skipEmptyLines: true })
  _zoneMap = new Map(result.data.map((r) => [r.postcode_district.trim().toUpperCase(), r.zone.trim()]))
  return _zoneMap
}

function loadIrradiance(): IrradianceRow[] {
  if (_irradianceRows) return _irradianceRows
  const filePath = path.join(process.cwd(), 'data', 'mcs_irradiance.csv')
  const csv = fs.readFileSync(filePath, 'utf8')
  const result = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true })
  _irradianceRows = result.data.map((r) => ({
    zone: r.zone.trim(),
    inclination: parseInt(r.inclination, 10),
    orientation: parseInt(r.orientation, 10),
    irradiance: parseFloat(r.irradiance),
  }))
  return _irradianceRows
}

/**
 * Returns the MCS zone for a UK postcode.
 * Uses longest-match: "BD23" is checked before "BD".
 * Falls back to zone "1" (South East England) if not found.
 */
export function getZoneForPostcode(postcode: string): string {
  const map = loadZoneMap()
  // Normalise: remove spaces, uppercase
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase()
  // Extract district candidates from longest to shortest: e.g. "BD23", "BD2", "BD"
  const candidates: string[] = []
  // outward code is everything before the last 3 chars (inward = e.g. "1AA")
  const outward = cleaned.length > 3 ? cleaned.slice(0, cleaned.length - 3) : cleaned
  for (let len = outward.length; len >= 1; len--) {
    candidates.push(outward.slice(0, len))
  }
  for (const c of candidates) {
    if (map.has(c)) return map.get(c)!
  }
  return '1' // default to SE England
}

/**
 * Returns kWh/m²/year irradiance from the MCS dataset.
 * Clamps inclination to [0,90] and finds the closest orientation row.
 * MCS orientation convention: 0=South, 90=East/West, 180=North.
 */
export function getIrradianceKwhPerM2(
  zone: string,
  inclinationDeg: number,
  orientationDeg: number,
): number {
  const rows = loadIrradiance()
  const inclClamped = Math.max(0, Math.min(90, Math.round(inclinationDeg)))
  // MCS dataset uses 0–175 for orientation (symmetric about south)
  const orientClamped = Math.max(0, Math.min(175, Math.round(orientationDeg / 5) * 5))

  const zoneRows = rows.filter((r) => r.zone === zone && r.inclination === inclClamped)
  if (zoneRows.length === 0) {
    // Fallback: find any row for this zone and inclination (nearest zone)
    const fallback = rows.find((r) => r.inclination === inclClamped)
    return fallback?.irradiance ?? 900
  }

  // Find closest orientation
  let best = zoneRows[0]
  let bestDiff = Math.abs(best.orientation - orientClamped)
  for (const r of zoneRows) {
    const diff = Math.abs(r.orientation - orientClamped)
    if (diff < bestDiff) {
      best = r
      bestDiff = diff
    }
  }
  return best.irradiance
}
