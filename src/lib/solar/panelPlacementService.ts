import type { GoogleSolarPanelConfig } from '@/lib/types'
import type { Solar3DModel, LocalRoofSegment, PanelLayout, EnrichedRoofPlane, HouseModel } from '@/types/solar'
import {
  optimiseLayout,
  planRectangularBlock,
  placeBlock,
  type OptimisedLayout,
} from '@/lib/solar/layoutOptimiser'

/**
 * Place up to `requestedCount` panels on a segment. Delegates to the optimiser's
 * centred rectangular-block placement so every caller gets symmetric arrays and
 * no ragged final rows. The public `requestedCount` is preserved for callers
 * that inspect it; `placedCount` is the clean-rectangle count actually placed.
 */
export function placePanelsOnSegment(
  seg: LocalRoofSegment,
  panelWidthM: number,
  panelHeightM: number,
  requestedCount: number,
): PanelLayout {
  const block = planRectangularBlock(seg, panelWidthM, panelHeightM, requestedCount)
  const layout = placeBlock(seg, panelWidthM, panelHeightM, block)
  return { ...layout, requestedCount }
}

/**
 * Optimised multi-segment layout: fills the sunniest / best-oriented segments
 * first with clean centred blocks up to `targetPanelCount`, and returns the
 * estimated scaffold cost. This is the production entry point.
 */
export function computeOptimisedPanelLayouts(
  model: Solar3DModel,
  targetPanelCount: number,
  panelWidthM: number,
  panelHeightM: number,
): OptimisedLayout {
  return optimiseLayout(model.segments, {
    targetPanelCount,
    panelWidthM,
    panelHeightM,
  })
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

/**
 * Back-compat wrapper. Drives the optimiser from the chosen Google config's
 * total panel count so existing callers (e.g. SolarRoofViewer) get the
 * sunlight-aware, centred layout without a signature change.
 */
export function computePanelLayouts(
  model: Solar3DModel,
  panelConfig: GoogleSolarPanelConfig,
  panelWidthM: number,
  panelHeightM: number,
): PanelLayout[] {
  return computeOptimisedPanelLayouts(
    model,
    panelConfig.panelsCount,
    panelWidthM,
    panelHeightM,
  ).layouts
}
