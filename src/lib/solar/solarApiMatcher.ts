import type { LidarRoofPlane, EnrichedRoofPlane, LocalRoofSegment } from '@/types/solar'
import type { RoofPlane } from '@/lib/types'
import { polygonArea } from '@/lib/geometry'

function circularDiff(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

function centroid2D(ring: [number, number][]): [number, number] {
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length]
}

// Half-space clip: keep vertices where faceProj ≥ limit (downhill/eave side of ridge)
function clipPolygonToFaceLimit(
  ring: [number, number][],
  cx: number, cz: number,
  faceX: number, faceZ: number,
  limit: number,
): [number, number][] {
  const proj = (p: [number, number]) => (p[0] - cx) * faceX + (p[1] - cz) * faceZ
  const inside = (p: [number, number]) => proj(p) >= limit

  const out: [number, number][] = []
  const n = ring.length

  for (let i = 0; i < n; i++) {
    const A = ring[i]
    const B = ring[(i + 1) % n]
    const inA = inside(A)
    const inB = inside(B)

    if (inA && inB) {
      out.push(B)
    } else if (inA && !inB) {
      const pA = proj(A), pB = proj(B)
      const t = (limit - pA) / (pB - pA)
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])])
    } else if (!inA && inB) {
      const pA = proj(A), pB = proj(B)
      const t = (limit - pA) / (pB - pA)
      out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])])
      out.push(B)
    }
    // both outside → skip
  }

  return out.length >= 3 ? out : ring
}

// Andrew's monotone chain convex hull — returns CCW hull in standard math coords.
// S-H requires a convex clip polygon; non-convex footprints (L/T-shapes) must be hulled first.
function convexHull2D(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts
  const sorted = [...pts].sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1])
  const cross2 = (O: [number, number], A: [number, number], B: [number, number]) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0])
  const lower: [number, number][] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross2(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (upper.length >= 2 && cross2(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return [...lower, ...upper]
}

// Sutherland-Hodgman clip against a CONVEX polygon (hull must be CCW in standard math coords).
function sutherlandHodgmanClip(
  subject: [number, number][],
  convexClip: [number, number][],
): [number, number][] {
  let output = [...subject]
  for (let e = 0; e < convexClip.length; e++) {
    if (output.length === 0) return []
    const input = [...output]
    output = []
    const A = convexClip[e]
    const B = convexClip[(e + 1) % convexClip.length]
    const eX = B[0] - A[0], eZ = B[1] - A[1]
    // Andrew's chain gives CCW hull in standard x-y coords (positive signed area).
    // In x-z space the winding appears CW, but the cross product formula is identical,
    // so "inside" = left of directed edge = cross ≥ 0.
    const inside = (p: [number, number]) =>
      eX * (p[1] - A[1]) - eZ * (p[0] - A[0]) >= 0
    const intersect = (P: [number, number], Q: [number, number]): [number, number] => {
      const dx = Q[0] - P[0], dz = Q[1] - P[1]
      const denom = eX * dz - eZ * dx
      if (Math.abs(denom) < 1e-10) return P
      const t = (eZ * (P[0] - A[0]) - eX * (P[1] - A[1])) / denom
      return [P[0] + t * dx, P[1] + t * dz]
    }
    for (let i = 0; i < input.length; i++) {
      const curr = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      if (inside(curr)) {
        if (!inside(prev)) output.push(intersect(prev, curr))
        output.push(curr)
      } else if (inside(prev)) {
        output.push(intersect(prev, curr))
      }
    }
  }
  return output.length >= 3 ? output : []
}

/** Clip each roof plane to the convex hull of the OS building footprint (+ eave buffer). */
export function clipRoofPlanesToFootprint(
  planes: EnrichedRoofPlane[],
  footprint: [number, number][],
): EnrichedRoofPlane[] {
  const fp: [number, number][] = (
    footprint.length > 1 &&
    footprint[0][0] === footprint[footprint.length - 1][0] &&
    footprint[0][1] === footprint[footprint.length - 1][1]
  ) ? footprint.slice(0, -1) as [number, number][]
    : footprint as [number, number][]

  if (fp.length < 3) return planes

  // Convex hull so S-H always works, regardless of L/T-shaped building footprints
  const hull = convexHull2D(fp)
  if (hull.length < 3) return planes

  // Expand hull 0.5 m radially for eave overhangs and coord jitter
  const cxH = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const czH = hull.reduce((s, p) => s + p[1], 0) / hull.length
  const clip: [number, number][] = hull.map(([x, z]) => {
    const dx = x - cxH, dz = z - czH
    const len = Math.sqrt(dx * dx + dz * dz)
    return len > 0 ? [x + (dx / len) * 0.5, z + (dz / len) * 0.5] : [x, z]
  })

  return planes.flatMap(plane => {
    const openRing: [number, number][] = (
      plane.polygon.length > 1 &&
      plane.polygon[0][0] === plane.polygon[plane.polygon.length - 1][0] &&
      plane.polygon[0][1] === plane.polygon[plane.polygon.length - 1][1]
    ) ? plane.polygon.slice(0, -1) as [number, number][]
      : plane.polygon as [number, number][]

    const clipped = sutherlandHodgmanClip(openRing, clip)
    if (clipped.length < 3) return []   // plane doesn't intersect footprint — discard

    const closedRing: [number, number][] = [...clipped, clipped[0]]
    return [{ ...plane, polygon: closedRing, areaM2: Math.abs(polygonArea(clipped)) }]
  })
}

export function clipRoofPlanes(planes: EnrichedRoofPlane[]): EnrichedRoofPlane[] {
  const rings: [number, number][][] = planes.map(p => {
    const poly = p.polygon
    const last = poly.length - 1
    if (poly[0][0] === poly[last][0] && poly[0][1] === poly[last][1]) {
      return poly.slice(0, last) as [number, number][]
    }
    return poly as [number, number][]
  })

  for (let i = 0; i < planes.length; i++) {
    for (let j = i + 1; j < planes.length; j++) {
      if (circularDiff(planes[i].azimuthDegrees, planes[j].azimuthDegrees) < 150) continue

      const piR = (planes[i].azimuthDegrees * Math.PI) / 180
      const pjR = (planes[j].azimuthDegrees * Math.PI) / 180

      const fiX = Math.sin(piR), fiZ = -Math.cos(piR)
      const fjX = Math.sin(pjR), fjZ = -Math.cos(pjR)

      const tanI = Math.tan((planes[i].pitchDegrees * Math.PI) / 180)
      const tanJ = Math.tan((planes[j].pitchDegrees * Math.PI) / 180)
      const denom = tanI + tanJ
      if (Math.abs(denom) < 1e-6) continue

      // Use stable segment-centre reference points — these survive clipping unchanged
      const rxI = planes[i].refX, rzI = planes[i].refZ
      const rxJ = planes[j].refX, rzJ = planes[j].refZ
      const hI = planes[i].heightM, hJ = planes[j].heightM

      // Ridge distance from each plane's ref centre along its face direction
      const deltaI = (rxI - rxJ) * fiX + (rzI - rzJ) * fiZ
      const sRidgeI = (hI - hJ - deltaI * tanJ) / denom

      const deltaJ = (rxJ - rxI) * fjX + (rzJ - rzI) * fjZ
      const sRidgeJ = (hJ - hI - deltaJ * tanI) / denom

      rings[i] = clipPolygonToFaceLimit(rings[i], rxI, rzI, fiX, fiZ, sRidgeI)
      rings[j] = clipPolygonToFaceLimit(rings[j], rxJ, rzJ, fjX, fjZ, sRidgeJ)
    }
  }

  return planes.map((plane, i) => {
    const ring = rings[i]
    const closedRing: [number, number][] = [...ring, ring[0]]
    return { ...plane, polygon: closedRing, areaM2: Math.abs(polygonArea(ring)) }
  })
}

/**
 * Convert Solar API segments directly to EnrichedRoofPlanes.
 * Each segment's center + ridge/depth dimensions become a rectangular polygon.
 * heightAdjust shifts all plane heights when the OS eave differs from the Solar API default.
 */
export function solarSegmentsToEnrichedPlanes(
  segments: LocalRoofSegment[],
  heightAdjust = 0,
): EnrichedRoofPlane[] {
  const planes = segments.map((seg, i) => {
    const azRad   = (seg.azimuthDeg * Math.PI) / 180
    const faceX   =  Math.sin(azRad)
    const faceZ   = -Math.cos(azRad)
    const ridgeX  =  Math.cos(azRad)
    const ridgeZ  =  Math.sin(azRad)

    const cx = seg.center.x
    const cz = seg.center.z
    const hr = seg.ridgeLenM    / 2
    const hd = seg.groundDepthM / 2

    const corners: [number, number][] = [
      [cx - ridgeX * hr - faceX * hd, cz - ridgeZ * hr - faceZ * hd],
      [cx + ridgeX * hr - faceX * hd, cz + ridgeZ * hr - faceZ * hd],
      [cx + ridgeX * hr + faceX * hd, cz + ridgeZ * hr + faceZ * hd],
      [cx - ridgeX * hr + faceX * hd, cz - ridgeZ * hr + faceZ * hd],
    ]

    return {
      id: `solar-${i}`,
      pitchDegrees:   seg.pitchDeg,
      azimuthDegrees: seg.azimuthDeg,
      heightM:        seg.heightAtCenterM + heightAdjust,
      refX:           cx,
      refZ:           cz,
      polygon:        [...corners, corners[0]],
      areaM2:         seg.areaM2,
      source:         'estimated' as const,
      sunshineQuantiles:  seg.sunshineQuantiles,
      solarSegmentIndex:  seg.segmentIndex,
      usable:         true,
    }
  })
  return clipRoofPlanes(planes)
}


export function matchAndEnrich(
  lidarPlanes: (LidarRoofPlane & { refX?: number; refZ?: number })[],
  solarSegments: LocalRoofSegment[],
  azimuthTolDeg = 30,
  pitchTolDeg = 20,
): EnrichedRoofPlane[] {
  return lidarPlanes.map(plane => {
    let bestSeg: LocalRoofSegment | null = null
    let bestScore = Infinity

    for (const seg of solarSegments) {
      const dAz    = circularDiff(plane.azimuthDegrees, seg.azimuthDeg)
      const dPitch = Math.abs(plane.pitchDegrees - seg.pitchDeg)
      if (dAz <= azimuthTolDeg && dPitch <= pitchTolDeg) {
        const score = dAz + dPitch * 0.5
        if (score < bestScore) {
          bestScore = score
          bestSeg = seg
        }
      }
    }

    const ring: [number, number][] = plane.polygon.length > 1 &&
      plane.polygon[0][0] === plane.polygon[plane.polygon.length - 1][0] &&
      plane.polygon[0][1] === plane.polygon[plane.polygon.length - 1][1]
      ? plane.polygon.slice(0, -1) as [number, number][]
      : plane.polygon as [number, number][]
    const fallbackRefX = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const fallbackRefZ = ring.reduce((s, p) => s + p[1], 0) / ring.length

    return {
      ...plane,
      refX: plane.refX ?? fallbackRefX,
      refZ: plane.refZ ?? fallbackRefZ,
      sunshineQuantiles: bestSeg?.sunshineQuantiles,
      solarSegmentIndex: bestSeg?.segmentIndex,
      usable: bestSeg !== null,
    }
  })
}

export function enrichEstimatedPlanes(
  estimatedPlanes: RoofPlane[],
  solarSegments: LocalRoofSegment[],
  wallHeightM: number,
): EnrichedRoofPlane[] {
  const lidarPlanes: (LidarRoofPlane & { refX: number; refZ: number })[] = estimatedPlanes.map((plane, i) => {
    const ring = plane.cornersLocal as [number, number][]
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length
    return {
      id: `estimated-${i}`,
      pitchDegrees: plane.tiltDeg,
      azimuthDegrees: plane.facingDeg,
      heightM: wallHeightM,
      refX: cx,
      refZ: cz,
      polygon: [...ring, ring[0]],
      areaM2: plane.areaM2,
      source: 'estimated' as const,
    }
  })
  return matchAndEnrich(lidarPlanes, solarSegments)
}
