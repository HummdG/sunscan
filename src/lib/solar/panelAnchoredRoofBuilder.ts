import type { GoogleSolarBuildingInsights } from '@/lib/types'
import type { EnrichedRoofPlane } from '@/types/solar'
import { polygonPrincipalAxis } from '@/lib/geometry'
import { latLngToLocal } from './coordinateConverter'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function polyArea(poly: [number, number][]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i]
    const [x1, z1] = poly[(i + 1) % poly.length]
    a += x0 * z1 - x1 * z0
  }
  return Math.abs(a) / 2
}

function stripDup(ring: [number, number][]): [number, number][] {
  return ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1) as [number, number][]
    : ring
}

/** Sutherland-Hodgman: clip poly, keeping points where (pt-o)·n ≤ d */
function clipHalf(
  poly: [number, number][],
  ox: number, oz: number,
  nx: number, nz: number,
  d: number,
): [number, number][] {
  if (!poly.length) return []
  const out: [number, number][] = []
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i]
    const [bx, bz] = poly[(i + 1) % poly.length]
    const da = (ax - ox) * nx + (az - oz) * nz
    const db = (bx - ox) * nx + (bz - oz) * nz
    if (da <= d) out.push([ax, az])
    if ((da <= d) !== (db <= d)) {
      const t = (d - da) / (db - da)
      out.push([ax + t * (bx - ax), az + t * (bz - az)])
    }
  }
  return out
}

function anchorEaves(planes: EnrichedRoofPlane[], wallH: number): EnrichedRoofPlane[] {
  let minEave = Infinity
  for (const p of planes) {
    const az = (p.azimuthDegrees * Math.PI) / 180
    const fx = Math.sin(az), fz = -Math.cos(az)
    const tanP = Math.tan((p.pitchDegrees * Math.PI) / 180)
    const ring = stripDup(p.polygon as [number, number][])
    const maxFP = Math.max(...ring.map(([vx, vz]) => (vx - p.refX) * fx + (vz - p.refZ) * fz))
    const eaveY = p.heightM - maxFP * tanP
    if (eaveY < minEave) minEave = eaveY
  }
  if (!Number.isFinite(minEave)) return planes
  const off = wallH - minEave
  return Math.abs(off) < 0.001 ? planes : planes.map(p => ({ ...p, heightM: p.heightM + off }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Build a clean 2-slope (or more) gable roof from the OS footprint.
 *
 * Segments are grouped by azimuth direction: those within 60° of each other
 * form one slope with a weighted-average pitch. The ridge is placed at the
 * weighted centroid of all segment centres projected onto the pitch axis.
 * Each slope polygon is the OS footprint clipped to its side of the ridge —
 * guaranteeing full coverage with no seams WITHIN a slope group.
 */
export function buildPanelAnchoredRoof(
  insights: GoogleSolarBuildingInsights,
  footprintLocal: [number, number][],
  wallHeightM: number,
): EnrichedRoofPlane[] {
  const ring = stripDup(footprintLocal)
  if (ring.length < 3) return []

  const segments = insights.solarPotential.roofSegmentStats ?? []
  if (!segments.length) return []

  // ── Step 1: find the ridge axis from the footprint principal axis ──────────
  const principalAngle = polygonPrincipalAxis(ring)
  // Ridge direction = along principal axis. Pitch axis = perpendicular.
  let pitchX = -Math.sin(principalAngle)
  let pitchZ = Math.cos(principalAngle)
  // Convention: +pitch axis faces roughly south (+z) for colour consistency
  if (pitchZ < 0) { pitchX = -pitchX; pitchZ = -pitchZ }

  // ── Step 2: classify each segment onto +pitch or -pitch side ──────────────
  // Compute how well each segment's face direction aligns with the pitch axis
  type Group = { totalArea: number; pitchSum: number; azimuthX: number; azimuthZ: number; refX: number; refZ: number; heightM: number; sunshine: number[]; segIndex: number; count: number }
  const pos: Group = { totalArea: 0, pitchSum: 0, azimuthX: 0, azimuthZ: 0, refX: 0, refZ: 0, heightM: 0, sunshine: [], segIndex: -1, count: 0 }
  const neg: Group = { totalArea: 0, pitchSum: 0, azimuthX: 0, azimuthZ: 0, refX: 0, refZ: 0, heightM: 0, sunshine: [], segIndex: -1, count: 0 }

  let bestPosArea = -1, bestNegArea = -1

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const azRad = (seg.azimuthDegrees * Math.PI) / 180
    const faceX = Math.sin(azRad)
    const faceZ = -Math.cos(azRad)
    // Dot product of face direction with pitch axis
    const dot = faceX * pitchX + faceZ * pitchZ
    const area = seg.stats.areaMeters2
    const target = dot >= 0 ? pos : neg

    target.totalArea += area
    target.pitchSum += seg.pitchDegrees * area
    // Accumulate face vector (for weighted-average azimuth)
    target.azimuthX += faceX * area
    target.azimuthZ += faceZ * area

    // Use highest-area segment's Solar centre + height as the ref
    if (dot >= 0 && area > bestPosArea) {
      bestPosArea = area
      target.refX = latLngToLocal(seg.center, insights.center).x
      target.refZ = latLngToLocal(seg.center, insights.center).z
      target.heightM = seg.planeHeightAtCenterMeters
      target.sunshine = seg.stats.sunshineQuantiles ?? []
      target.segIndex = i
    } else if (dot < 0 && area > bestNegArea) {
      bestNegArea = area
      target.refX = latLngToLocal(seg.center, insights.center).x
      target.refZ = latLngToLocal(seg.center, insights.center).z
      target.heightM = seg.planeHeightAtCenterMeters
      target.sunshine = seg.stats.sunshineQuantiles ?? []
      target.segIndex = i
    }
    target.count++
  }

  // ── Step 3: derive weighted-average pitch and azimuth per group ────────────
  function groupToSlope(g: Group, defaultPitch: number): { pitch: number; azimuthDeg: number } {
    const pitch = g.totalArea > 0 ? g.pitchSum / g.totalArea : defaultPitch
    // Weighted-average face direction → azimuth
    const azimuthDeg = g.totalArea > 0
      ? ((Math.atan2(g.azimuthX, -g.azimuthZ) * 180) / Math.PI + 360) % 360
      : ((Math.atan2(pitchX, -pitchZ) * 180) / Math.PI + 360) % 360
    return { pitch, azimuthDeg }
  }

  const posFallbackPitch = 30
  const negFallbackPitch = 30

  // ── Step 4: place the ridge on the pitch axis ──────────────────────────────
  // Use the average pitch-axis projection of all segment centres (weighted by area)
  let ridgeP = 0, totalW = 0
  for (const seg of segments) {
    const c = latLngToLocal(seg.center, insights.center)
    const p = c.x * pitchX + c.z * pitchZ
    ridgeP += p * seg.stats.areaMeters2
    totalW += seg.stats.areaMeters2
  }
  ridgeP = totalW > 0 ? ridgeP / totalW : 0

  // ── Step 5: clip footprint into two slope polygons ─────────────────────────
  // +pitch slope: footprint with (pt·pitchAxis) ≥ ridgeP → keep points where -(pt·n) ≤ -ridgeP
  const posPoly = clipHalf(ring, 0, 0, -pitchX, -pitchZ, -ridgeP)
  const negPoly = clipHalf(ring, 0, 0,  pitchX,  pitchZ,  ridgeP)

  const planes: EnrichedRoofPlane[] = []

  function makeSlope(
    id: string,
    polygon: [number, number][],
    g: Group,
    fallbackPitch: number,
    segIdx: number,
  ): EnrichedRoofPlane | null {
    if (polygon.length < 3) return null
    if (polyArea(polygon) < 1.0) return null
    const { pitch, azimuthDeg } = groupToSlope(g, fallbackPitch)
    return {
      id,
      pitchDegrees: pitch,
      azimuthDegrees: azimuthDeg,
      heightM: g.totalArea > 0 ? g.heightM : segments[0].planeHeightAtCenterMeters,
      refX: g.totalArea > 0 ? g.refX : 0,
      refZ: g.totalArea > 0 ? g.refZ : 0,
      polygon: [...polygon, polygon[0]],
      areaM2: polyArea(polygon),
      source: 'estimated',
      sunshineQuantiles: g.totalArea > 0 ? g.sunshine : (segments[0].stats.sunshineQuantiles ?? []),
      solarSegmentIndex: segIdx >= 0 ? segIdx : 0,
      usable: true,
    }
  }

  const posSlope = makeSlope('roof-pos', posPoly, pos, posFallbackPitch, pos.segIndex)
  const negSlope = makeSlope('roof-neg', negPoly, neg, negFallbackPitch, neg.segIndex)

  if (posSlope) planes.push(posSlope)
  if (negSlope) planes.push(negSlope)

  if (!planes.length) return []
  return anchorEaves(planes, wallHeightM)
}
