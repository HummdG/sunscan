// Maps roof segments to building elevations (cardinal walls) for the scaffold
// cost heuristic. NOTE: this is an estimate. We bucket by segment azimuth only
// — Solar3DModel carries buildingBounds but not the footprint polygon, so we
// approximate the scaffold-relevant run on a wall as the sum of the panel
// blocks facing that cardinal. A future refinement could project blocks onto
// the actual footprint edges.

export type Elevation = 'N' | 'E' | 'S' | 'W'

const ORDER: Elevation[] = ['N', 'E', 'S', 'W']

export interface PlacedBlockSpan {
  segmentIndex: number
  azimuthDeg: number
  /** Ridge-aligned width of the placed panel block (metres). */
  blockWidthM: number
}

export interface ElevationSpan {
  elevation: Elevation
  /** Total panel-block width facing this elevation (metres). */
  spanM: number
  segmentIndexes: number[]
}

/** Round a compass azimuth to the nearest cardinal: 0=N, 90=E, 180=S, 270=W. */
export function azimuthToElevation(azimuthDeg: number): Elevation {
  const idx = ((Math.round(azimuthDeg / 90) % 4) + 4) % 4
  return ORDER[idx]
}

/**
 * Group placed blocks by the cardinal elevation they face and sum their
 * ridge-aligned widths. Zero-width blocks (segments too small for a panel) are
 * ignored. Returned in N/E/S/W order, only for elevations with panels.
 */
export function computeElevationSpans(blocks: PlacedBlockSpan[]): ElevationSpan[] {
  const acc = new Map<Elevation, ElevationSpan>()
  for (const b of blocks) {
    if (b.blockWidthM <= 0) continue
    const el = azimuthToElevation(b.azimuthDeg)
    const existing = acc.get(el)
    if (existing) {
      existing.spanM += b.blockWidthM
      existing.segmentIndexes.push(b.segmentIndex)
    } else {
      acc.set(el, { elevation: el, spanM: b.blockWidthM, segmentIndexes: [b.segmentIndex] })
    }
  }
  return ORDER.filter(el => acc.has(el)).map(el => acc.get(el)!)
}
