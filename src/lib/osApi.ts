import type { OsAddress, OsBuilding, RoofAspect, BuildingPart } from './types'
import { polygonArea, polygonCentroid, polygonPrincipalAxisLength, wgs84ToLocalMetres } from './geometry'

const OS_API_KEY = process.env.OS_API_KEY
const OS_PLACES_BASE = 'https://api.os.uk/search/places/v1'
const OS_NGD_BASE = 'https://api.os.uk/features/ngd/ofa/v1'

if (!OS_API_KEY && process.env.NODE_ENV === 'production') {
  console.error('OS_API_KEY is not set — address and building lookup will fail')
}

// ─── Address search (OS Places API) ─────────────────────────────────────────

export async function searchAddresses(query: string): Promise<OsAddress[]> {
  if (!OS_API_KEY) return mockSearchAddresses(query)

  const url = new URL(`${OS_PLACES_BASE}/find`)
  url.searchParams.set('query', query)
  url.searchParams.set('maxresults', '10')
  url.searchParams.set('output_srs', 'WGS84')
  url.searchParams.set('key', OS_API_KEY)

  const res = await fetch(url.toString(), { next: { revalidate: 60 } })
  if (!res.ok) {
    console.error('OS Places API error', res.status, await res.text())
    return mockSearchAddresses(query)
  }

  const data = await res.json()
  const results = data.results ?? []

  return results.map((r: Record<string, unknown>) => {
    const dpa = r.DPA as Record<string, unknown> | undefined
    const lpi = r.LPI as Record<string, unknown> | undefined
    const entry = dpa ?? lpi ?? r

    return {
      uprn: String(entry.UPRN ?? entry.uprn ?? ''),
      address: String(
        entry.ADDRESS ??
          entry.LPI_LOGICAL_STATUS_CODE_DESCRIPTION ??
          `${query} (${entry.UPRN})`,
      ),
      lat: Number(entry.LAT ?? entry.Y ?? 51.5),
      lng: Number(entry.LNG ?? entry.X ?? -0.1),
      postcode: String(entry.POSTCODE ?? entry.POSTCODE_LOCATOR ?? ''),
    } satisfies OsAddress
  })
}

// ─── Building footprint (OS NGD Features API) ────────────────────────────────

/**
 * Returns the real OS NGD building footprint for an address, or `null` if the
 * key isn't configured / OS has no data. We deliberately do NOT invent a
 * fallback footprint — the wizard's Review step surfaces the missing data to
 * the user so the report is grounded in real geometry.
 */
export async function fetchBuilding(uprn: string, lat?: number, lng?: number): Promise<OsBuilding | null> {
  if (!OS_API_KEY) {
    console.warn('OS_API_KEY not set — building lookup disabled')
    return null
  }

  // Try UPRN filter first — results are all parts of this specific building
  let features = await queryNgdBuilding({ uprn, apiKey: OS_API_KEY })
  let isUprnResult = features.length > 0

  // Fallback to bbox around address coordinates if UPRN returned nothing
  // bbox results can include neighboring buildings, so multi-part is disabled for these
  if (features.length === 0 && lat !== undefined && lng !== undefined) {
    console.warn(`OS NGD: 0 features for UPRN ${uprn} — trying bbox fallback`)
    features = await queryNgdBuilding({ lat, lng, apiKey: OS_API_KEY })
    isUprnResult = false  // bbox may contain multiple unrelated buildings
  }

  if (features.length === 0) {
    console.warn(`OS NGD: no building found for UPRN ${uprn}`)
    return null
  }

  return featuresToBuilding(features, isUprnResult)
}

async function queryNgdBuilding(
  params: { uprn: string; apiKey: string } | { lat: number; lng: number; apiKey: string },
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${OS_NGD_BASE}/collections/bld-fts-buildingpart/items`)
  url.searchParams.set('key', params.apiKey)

  if ('uprn' in params) {
    url.searchParams.set('filter', `uprn=${params.uprn}`)
    url.searchParams.set('filter-lang', 'cql-text')
  } else {
    // ~60m × 60m bounding box around address point
    const { lat, lng } = params
    url.searchParams.set('bbox', `${lng - 0.0004},${lat - 0.0003},${lng + 0.0004},${lat + 0.0003}`)
    url.searchParams.set('limit', '10')
  }

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 3600 } })
    if (!res.ok) {
      console.error('OS NGD API error', res.status, await res.text())
      return []
    }
    const data = await res.json()
    return data.features ?? []
  } catch (err) {
    console.error('OS NGD fetch failed', err)
    return []
  }
}

/**
 * Pick the compass bearing (0=N, 45=NE, … 315=NW) of the roof slope that scores
 * highest for solar — weighted by area × cos(deviation from south).
 */
function bestSolarAzimuth(aspect: RoofAspect): number {
  const candidates: [number, number][] = [
    [0,   aspect.n],
    [45,  aspect.ne],
    [90,  aspect.e],
    [135, aspect.se],
    [180, aspect.s],
    [225, aspect.sw],
    [270, aspect.w],
    [315, aspect.nw],
  ]
  let bestDeg = 180
  let bestScore = -Infinity
  for (const [deg, area] of candidates) {
    if (area <= 0) continue
    const mcsDeviation = Math.abs(deg - 180)
    const score = area * Math.cos((mcsDeviation * Math.PI) / 180)
    if (score > bestScore) { bestScore = score; bestDeg = deg }
  }
  return bestDeg
}

/**
 * Derive roof pitch (degrees) from eave/ridge heights and a local-metre footprint ring.
 * halfSpan = area / (2 × ridge_length); pitch = atan(rise / halfSpan).
 */
function derivePitchDeg(
  eaveH: number,
  ridgeH: number,
  localRing: [number, number][],
  areaM2: number,
): number | undefined {
  const rise = ridgeH - eaveH
  if (rise <= 0) return undefined
  const ridgeLength = polygonPrincipalAxisLength(localRing)
  if (ridgeLength <= 0) return undefined
  const halfSpan = areaM2 / (2 * ridgeLength)
  const pitchDeg = (Math.atan2(rise, halfSpan) * 180) / Math.PI
  return pitchDeg > 0 && pitchDeg < 90 ? pitchDeg : undefined
}

function extractRoofAspect(props: Record<string, unknown>): RoofAspect | undefined {
  // OS NGD property names: roofslopedirectionroofaspect{direction}
  const get = (key: string): number => Number(props[key] ?? props[key.replace('northeast', 'ne').replace('southeast', 'se').replace('southwest', 'sw').replace('northwest', 'nw')] ?? 0)
  const aspect: RoofAspect = {
    n:  get('roofslopedirectionroofaspectn'),
    ne: get('roofslopedirectionroofaspectnortheast'),
    e:  get('roofslopedirectionroofaspecte'),
    se: get('roofslopedirectionroofaspectsoutheast'),
    s:  get('roofslopedirectionroofaspects'),
    sw: get('roofslopedirectionroofaspectsouthwest'),
    w:  get('roofslopedirectionroofaspectw'),
    nw: get('roofslopedirectionroofaspectnorthwest'),
  }
  const total = Object.values(aspect).reduce((a, b) => a + b, 0)
  return total > 0 ? aspect : undefined
}

type GeoJsonCoords = unknown

function extractRings(geom: { type: string; coordinates: GeoJsonCoords }): number[][] | null {
  const coords = geom.coordinates
  if (geom.type === 'Polygon') {
    return (coords as number[][][])[0]
  }
  if (geom.type === 'MultiPolygon') {
    const polys = coords as number[][][][]
    const largest = polys.reduce((best, poly) => poly[0].length > best[0].length ? poly : best, polys[0])
    return largest[0]
  }
  return null
}

function featuresToBuilding(features: Record<string, unknown>[], allowMultiPart: boolean = false): OsBuilding | null {
  // Parse every valid feature into a BuildingPart, tracking original index
  interface PartEntry { part: BuildingPart; featureIndex: number }
  const entries: PartEntry[] = []

  for (let fi = 0; fi < features.length; fi++) {
    const f = features[fi]
    const geom = f.geometry as { type: string; coordinates: GeoJsonCoords } | null
    if (!geom) continue
    const ring = extractRings(geom)
    if (!ring) continue

    const wgs84: [number, number][] = ring as [number, number][]
    const c = polygonCentroid(wgs84)
    const local = wgs84ToLocalMetres(wgs84, c)
    const areaM2 = polygonArea(local)
    if (areaM2 < 2) continue  // skip degenerate slivers

    const props = (f.properties ?? {}) as Record<string, unknown>
    const eaveHeightM = Number(props['relativeheightroofonset'] ?? props['relativeheightroofbase'] ?? 0) || undefined
    const ridgeHeightM = Number(props['relativeheightmaximum'] ?? 0) || undefined
    const roofPitchDeg =
      eaveHeightM !== undefined && ridgeHeightM !== undefined
        ? derivePitchDeg(eaveHeightM, ridgeHeightM, local, areaM2)
        : undefined

    entries.push({
      part: { footprintPolygon: wgs84, areaM2, eaveHeightM, ridgeHeightM, roofPitchDeg },
      featureIndex: fi,
    })
  }

  if (entries.length === 0) return null

  // Sort largest first — index 0 is always the primary (main block)
  entries.sort((a, b) => b.part.areaM2 - a.part.areaM2)
  const primaryFeature = features[entries[0].featureIndex]
  const primaryPart = entries[0].part

  // Derive main OsBuilding fields from the primary feature (backward-compatible)
  const wgs84Ring = primaryPart.footprintPolygon
  const centre = polygonCentroid(wgs84Ring)
  const localRing = wgs84ToLocalMetres(wgs84Ring, centre)
  const areaM2 = polygonArea(localRing)

  const props = (primaryFeature.properties ?? {}) as Record<string, unknown>
  const eaveHeightM = Number(props['relativeheightroofonset'] ?? props['relativeheightroofbase'] ?? 0) || undefined
  const ridgeHeightM = Number(props['relativeheightmaximum'] ?? 0) || undefined
  const roofAspect = extractRoofAspect(props)
  const roofAzimuthDeg = roofAspect ? bestSolarAzimuth(roofAspect) : undefined
  const roofPitchDeg =
    eaveHeightM !== undefined && ridgeHeightM !== undefined
      ? derivePitchDeg(eaveHeightM, ridgeHeightM, localRing, areaM2)
      : undefined

  // Only attach multi-part data when the features came from a UPRN query (all parts of the
  // same building) and also filter by proximity — detached outbuildings > 20m away are excluded
  let parts: BuildingPart[] | undefined
  if (allowMultiPart && entries.length > 1) {
    const maxDistM = Math.max(20, Math.sqrt(areaM2) * 2)
    const nearby = entries.filter((e, i) => {
      if (i === 0) return true  // always keep primary
      const partCentroid = polygonCentroid(e.part.footprintPolygon)
      const [[dx, dz]] = wgs84ToLocalMetres([partCentroid], centre)
      return Math.sqrt(dx * dx + dz * dz) <= maxDistM
    })
    if (nearby.length > 1) parts = nearby.map(e => e.part)
  }

  console.log(`[featuresToBuilding] ${features.length} raw features → ${entries.length} valid parts, multiPart=${allowMultiPart}, kept=${parts?.length ?? 1}, primary area: ${areaM2.toFixed(1)}m²`)

  return {
    footprintPolygon: wgs84Ring,
    source: 'os_ngd',
    areaM2,
    eaveHeightM,
    ridgeHeightM,
    roofAspect,
    roofAzimuthDeg,
    roofPitchDeg,
    parts,
  }
}

// ─── Mock fallbacks ───────────────────────────────────────────────────────────

function mockSearchAddresses(query: string): OsAddress[] {
  const q = query.trim() || 'Test Road'
  return [
    { uprn: '100023336956', address: `1 ${q}, Norwich, NR1 2AA`, lat: 52.628, lng: 1.2992, postcode: 'NR1 2AA' },
    { uprn: '100023336957', address: `2 ${q}, Norwich, NR1 2AA`, lat: 52.629, lng: 1.2994, postcode: 'NR1 2AA' },
    { uprn: '100023336958', address: `3 ${q}, Norwich, NR1 2AB`, lat: 52.630, lng: 1.2996, postcode: 'NR1 2AB' },
    { uprn: '100023336959', address: `4 ${q}, Norwich, NR1 2AB`, lat: 52.631, lng: 1.2998, postcode: 'NR1 2AB' },
    { uprn: '100023336960', address: `5 ${q}, Norwich, NR1 2AC`, lat: 52.632, lng: 1.3000, postcode: 'NR1 2AC' },
  ]
}

