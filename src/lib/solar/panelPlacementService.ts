import type { GoogleSolarPanelConfig } from '@/lib/types'
import type { Solar3DModel, LocalRoofSegment, PanelLayout, PlacedPanel, EnrichedRoofPlane, HouseModel } from '@/types/solar'

const MARGIN_M  = 0.3
const GAP_M     = 0.02
const STANDOFF_M = 0.05

export function placePanelsOnSegment(
  seg: LocalRoofSegment,
  panelWidthM: number,
  panelHeightM: number,
  requestedCount: number,
): PanelLayout {
  const azRad   = (seg.azimuthDeg * Math.PI) / 180
  const pitchRad = (seg.pitchDeg  * Math.PI) / 180

  const faceX  =  Math.sin(azRad)
  const faceZ  = -Math.cos(azRad)
  const ridgeX =  Math.cos(azRad)
  const ridgeZ =  Math.sin(azRad)

  const halfRise  = (seg.groundDepthM / 2) * Math.tan(pitchRad)
  const eaveY     = seg.heightAtCenterM - halfRise
  const eaveMidX  = seg.center.x + faceX * seg.groundDepthM / 2
  const eaveMidZ  = seg.center.z + faceZ * seg.groundDepthM / 2

  const slopeLenM   = seg.groundDepthM / Math.cos(pitchRad)
  const usableRidge = Math.max(0, seg.ridgeLenM  - 2 * MARGIN_M)
  const usableSlope = Math.max(0, slopeLenM - 2 * MARGIN_M)

  // Landscape: panelWidthM along ridge, panelHeightM down slope
  const cols = Math.floor((usableRidge + GAP_M) / (panelWidthM  + GAP_M))
  const rows = Math.floor((usableSlope + GAP_M) / (panelHeightM + GAP_M))

  const startRidge = -(cols * (panelWidthM + GAP_M) - GAP_M) / 2 + panelWidthM / 2

  const panels: PlacedPanel[] = []

  outer: for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (panels.length >= requestedCount) break outer

      const alongRidge = startRidge + col * (panelWidthM + GAP_M)
      const slopeD     = MARGIN_M + row * (panelHeightM + GAP_M) + panelHeightM / 2
      const groundD    = slopeD * Math.cos(pitchRad)
      const riseD      = slopeD * Math.sin(pitchRad)

      const px = eaveMidX + ridgeX * alongRidge - faceX * groundD
      const py = eaveY    + riseD + STANDOFF_M
      const pz = eaveMidZ + ridgeZ * alongRidge - faceZ * groundD

      panels.push({
        segmentIndex: seg.segmentIndex,
        position: [px, py, pz],
        rotationY: azRad,
        pitchRad,
      })
    }
  }

  return {
    segmentIndex: seg.segmentIndex,
    panels,
    requestedCount,
    placedCount: panels.length,
  }
}

export function placePanelsOnPlane(
  plane: EnrichedRoofPlane,
  panelWidthM: number,
  panelHeightM: number,
  requestedCount: number,
  planeIdx: number,
): PanelLayout {
  const ring = (
    plane.polygon.length > 1 &&
    plane.polygon[0][0] === plane.polygon[plane.polygon.length - 1][0] &&
    plane.polygon[0][1] === plane.polygon[plane.polygon.length - 1][1]
  ) ? plane.polygon.slice(0, -1) : plane.polygon

  const azRad  = (plane.azimuthDegrees * Math.PI) / 180
  const faceX  =  Math.sin(azRad)
  const faceZ  = -Math.cos(azRad)
  const ridgeX =  Math.cos(azRad)
  const ridgeZ =  Math.sin(azRad)

  const ridgeProjs = ring.map(([x, z]) => x * ridgeX + z * ridgeZ)
  const faceProjs  = ring.map(([x, z]) => x * faceX  + z * faceZ)
  const ridgeLenM    = Math.max(1, Math.max(...ridgeProjs) - Math.min(...ridgeProjs))
  const groundDepthM = Math.max(1, Math.max(...faceProjs)  - Math.min(...faceProjs))

  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length

  const seg: LocalRoofSegment = {
    segmentIndex: planeIdx,
    azimuthDeg: plane.azimuthDegrees,
    pitchDeg: plane.pitchDegrees,
    heightAtCenterM: plane.heightM,
    areaM2: plane.areaM2,
    sunshineQuantiles: plane.sunshineQuantiles ?? [],
    center: { x: cx, z: cz },
    ridgeLenM,
    groundDepthM,
  }

  return placePanelsOnSegment(seg, panelWidthM, panelHeightM, requestedCount)
}

export function computePanelLayoutsForHouseModel(
  model: HouseModel,
  totalCount: number,
  panelWidthM: number,
  panelHeightM: number,
): PanelLayout[] {
  const usable = model.roofPlanes.filter(p => p.usable)
  if (usable.length === 0) return []

  const totalArea = usable.reduce((s, p) => s + p.areaM2, 0)

  return usable.map((plane, i) => {
    const count = Math.max(1, Math.round((plane.areaM2 / totalArea) * totalCount))
    return placePanelsOnPlane(plane, panelWidthM, panelHeightM, count, i)
  })
}

export function computePanelLayouts(
  model: Solar3DModel,
  panelConfig: GoogleSolarPanelConfig,
  panelWidthM: number,
  panelHeightM: number,
): PanelLayout[] {
  return panelConfig.roofSegmentSummaries
    .map(summary => {
      const seg = model.segments[summary.segmentIndex]
      if (!seg) return null
      return placePanelsOnSegment(seg, panelWidthM, panelHeightM, summary.panelsCount)
    })
    .filter((l): l is PanelLayout => l !== null)
}
