import type { LocalRoofSegment, EnrichedRoofPlane } from '@/types/solar'
import { DEFAULT_WALL_HEIGHT_M } from './solarApiMapper'

function polyArea(poly: [number, number][]): number {
  let area = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]
    const [x1, z1] = poly[(i + 1) % poly.length]
    area += x0 * z1 - x1 * z0
  }
  return Math.abs(area) / 2
}

// Sutherland-Hodgman clip against a single half-plane.
// Keeps points where (pt - origin) · normal ≤ d.
function clipToHalfPlane(
  poly: [number, number][],
  cx: number, cz: number,
  nx: number, nz: number,
  d: number,
): [number, number][] {
  if (poly.length === 0) return []
  const result: [number, number][] = []
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[(i + 1) % poly.length]
    const da = (ax - cx) * nx + (az - cz) * nz
    const db = (bx - cx) * nx + (bz - cz) * nz
    if (da <= d) result.push([ax, az])
    if ((da <= d) !== (db <= d)) {
      const t = (d - da) / (db - da)
      result.push([ax + t * (bx - ax), az + t * (bz - az)])
    }
  }
  return result
}

/**
 * Build EnrichedRoofPlane[] by Voronoi-splitting the OS building footprint
 * using Google Solar segment centers.
 *
 * Each segment "claims" the portion of the footprint that is closer to its
 * detected center than to any other segment center. This naturally handles
 * L-shaped buildings and multiple extensions without depending on the Solar
 * API bounding boxes (which span entire terrace rows).
 *
 * Heights are re-anchored at each sub-polygon centroid so RoofPlaneMesh
 * extrapolation stays small regardless of footprint shape.
 */
export function buildRoofFromFootprint(
  segments: LocalRoofSegment[],
  footprintLocal: [number, number][],
  wallHeightM: number = DEFAULT_WALL_HEIGHT_M,
): EnrichedRoofPlane[] {
  if (segments.length === 0 || footprintLocal.length < 3) return []

  // Remove duplicate closing vertex from GeoJSON-style rings
  const fp: [number, number][] = (
    footprintLocal.length > 1 &&
    footprintLocal[0][0] === footprintLocal[footprintLocal.length - 1][0] &&
    footprintLocal[0][1] === footprintLocal[footprintLocal.length - 1][1]
  ) ? footprintLocal.slice(0, -1) as [number, number][]
    : footprintLocal as [number, number][]

  const planes: EnrichedRoofPlane[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    let poly: [number, number][] = [...fp]

    // Clip away the half of the footprint closer to every other segment center.
    // The surviving polygon is the Voronoi cell of segment i within the footprint.
    for (let j = 0; j < segments.length; j++) {
      if (j === i) continue
      const other = segments[j]

      const dx = seg.center.x - other.center.x
      const dz = seg.center.z - other.center.z
      const len = Math.sqrt(dx * dx + dz * dz)
      if (len < 0.1) continue  // centres coincide — skip this boundary

      // Perpendicular bisector midpoint and outward normal (pointing toward seg)
      const mx = (seg.center.x + other.center.x) / 2
      const mz = (seg.center.z + other.center.z) / 2
      const nx = dx / len
      const nz = dz / len

      // Keep vertices where (pt - midpoint) · normal ≥ 0 (closer to seg than other).
      // Equivalent to clipToHalfPlane with direction flipped: (pt - m)·(-n) ≤ 0
      poly = clipToHalfPlane(poly, mx, mz, -nx, -nz, 0)

      if (poly.length < 3) break
    }

    if (poly.length < 3 || polyArea(poly) < 1.0) continue

    const azRad = (seg.azimuthDeg * Math.PI) / 180
    const faceX = Math.sin(azRad)
    const faceZ = -Math.cos(azRad)
    const tanPitch = Math.tan((seg.pitchDeg * Math.PI) / 180)

    const n = poly.length
    const pcx = poly.reduce((s, [x]) => s + x, 0) / n
    const pcz = poly.reduce((s, [, z]) => s + z, 0) / n

    // Downhill distance from centroid to the eave (bottom edge) of this Voronoi cell.
    // The eave is at the vertices with the highest face-direction projection from the centroid.
    const maxFaceProjFromCentroid = Math.max(...poly.map(([vx, vz]) =>
      (vx - pcx) * faceX + (vz - pcz) * faceZ,
    ))

    // Anchor: the eave sits at wallHeightM. heightM is the height at the centroid reference.
    // getY(eaveVertex) = heightM - maxFaceProjFromCentroid * tanPitch = wallHeightM
    const heightM = wallHeightM + maxFaceProjFromCentroid * tanPitch

    planes.push({
      id: `roof-${seg.segmentIndex}`,
      pitchDegrees: seg.pitchDeg,
      azimuthDegrees: seg.azimuthDeg,
      heightM,
      refX: pcx,
      refZ: pcz,
      polygon: [...poly, poly[0]],
      areaM2: polyArea(poly),
      source: 'estimated',
      sunshineQuantiles: seg.sunshineQuantiles,
      solarSegmentIndex: seg.segmentIndex,
      usable: true,
    })
  }

  return planes
}
