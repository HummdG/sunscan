import type { LocalRoofSegment, PanelLayout, PlacedPanel } from '@/types/solar'
import { MARGIN_M, GAP_M, STANDOFF_M, gridCapacity } from '@/lib/solar/layoutConstants'
import { rankSegments } from '@/lib/solar/sunlightRanking'
import {
  azimuthToElevation,
  computeElevationSpans,
  type Elevation,
  type PlacedBlockSpan,
} from '@/lib/solar/segmentElevation'
import {
  computeScaffoldCost,
  type ScaffoldRates,
  type ScaffoldCostResult,
} from '@/lib/solar/scaffoldCost'

export interface BlockPlan {
  cols: number
  rows: number
}

export interface OptimiserConfig {
  /** Final panel count from the caller (selectOptimalPanelConfig / tier). */
  targetPanelCount: number
  panelWidthM: number
  panelHeightM: number
  /** rankScore window within which the scaffold tie-break applies. */
  tieEpsilon?: number
  scaffoldRates?: ScaffoldRates
}

export interface OptimisedLayout {
  layouts: PanelLayout[]
  scaffold: ScaffoldCostResult
  totalPlaced: number
}

/** Default rankScore window for the scaffold-aware tie-break. */
export const DEFAULT_TIE_EPSILON = 0.05

/**
 * Largest clean rectangle that fits `maxPanels` on a segment. Never produces a
 * partial last row: full-width rows up to capacity, or a single capped row when
 * fewer than one full row is asked. Count is always `cols * rows`.
 */
export function planRectangularBlock(
  seg: LocalRoofSegment,
  panelWidthM: number,
  panelHeightM: number,
  maxPanels: number,
): BlockPlan {
  const { cols: colsMax, rows: rowsMax } = gridCapacity(
    seg.ridgeLenM,
    seg.groundDepthM,
    seg.pitchDeg,
    panelWidthM,
    panelHeightM,
  )
  if (colsMax === 0 || rowsMax === 0) return { cols: 0, rows: 0 }

  const want = Math.min(Math.floor(maxPanels), colsMax * rowsMax)
  if (want <= 0) return { cols: 0, rows: 0 }

  if (want < colsMax) return { cols: want, rows: 1 } // one full, narrower row
  return { cols: colsMax, rows: Math.floor(want / colsMax) }
}

/**
 * Place a rectangular block on a segment, centred both along the ridge and
 * down the slope (balanced ridge/eave margins). The eave/face/ridge trig is
 * the same frame as panelPlacementService.placePanelsOnSegment
 * (x=east, z=south, landscape: panelWidthM along ridge).
 */
export function placeBlock(
  seg: LocalRoofSegment,
  panelWidthM: number,
  panelHeightM: number,
  block: BlockPlan,
): PanelLayout {
  const { cols, rows } = block
  if (cols <= 0 || rows <= 0) {
    return { segmentIndex: seg.segmentIndex, panels: [], requestedCount: 0, placedCount: 0 }
  }

  const azRad = (seg.azimuthDeg * Math.PI) / 180
  const pitchRad = (seg.pitchDeg * Math.PI) / 180

  const faceX = Math.sin(azRad)
  const faceZ = -Math.cos(azRad)
  const ridgeX = Math.cos(azRad)
  const ridgeZ = Math.sin(azRad)

  const halfRise = (seg.groundDepthM / 2) * Math.tan(pitchRad)
  const eaveY = seg.heightAtCenterM - halfRise
  const eaveMidX = seg.center.x + faceX * (seg.groundDepthM / 2)
  const eaveMidZ = seg.center.z + faceZ * (seg.groundDepthM / 2)

  const slopeLenM = seg.groundDepthM / Math.cos(pitchRad)
  const usableSlope = Math.max(0, slopeLenM - 2 * MARGIN_M)

  const startRidge = -((cols * (panelWidthM + GAP_M) - GAP_M) / 2) + panelWidthM / 2
  const blockH = rows * (panelHeightM + GAP_M) - GAP_M
  const slopeStart = MARGIN_M + (usableSlope - blockH) / 2 + panelHeightM / 2

  const panels: PlacedPanel[] = []
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const alongRidge = startRidge + col * (panelWidthM + GAP_M)
      const slopeD = slopeStart + row * (panelHeightM + GAP_M)
      const groundD = slopeD * Math.cos(pitchRad)
      const riseD = slopeD * Math.sin(pitchRad)

      panels.push({
        segmentIndex: seg.segmentIndex,
        position: [
          eaveMidX + ridgeX * alongRidge - faceX * groundD,
          eaveY + riseD + STANDOFF_M,
          eaveMidZ + ridgeZ * alongRidge - faceZ * groundD,
        ],
        rotationY: azRad,
        pitchRad,
      })
    }
  }

  return {
    segmentIndex: seg.segmentIndex,
    panels,
    requestedCount: cols * rows,
    placedCount: panels.length,
  }
}

/**
 * Lexicographic layout: fill the sunniest / best-oriented segments first with
 * clean centred rectangular blocks until the target capacity is met. Scaffold
 * cost enters only as a near-tie tie-break — segments whose elevation is
 * already scaffolded are preferred, so panels concentrate onto fewer walls.
 */
export function optimiseLayout(
  segments: LocalRoofSegment[],
  cfg: OptimiserConfig,
): OptimisedLayout {
  const { targetPanelCount, panelWidthM, panelHeightM } = cfg
  const eps = cfg.tieEpsilon ?? DEFAULT_TIE_EPSILON

  const ranked = rankSegments(segments, panelWidthM, panelHeightM)
  const segByIndex = new Map(segments.map(s => [s.segmentIndex, s]))

  const candidates = [...ranked]
  const activeElevations = new Set<Elevation>()
  const layouts: PanelLayout[] = []
  const blockSpans: PlacedBlockSpan[] = []
  let remaining = targetPanelCount

  while (remaining > 0 && candidates.length > 0) {
    const top = candidates[0].rankScore
    // All candidates within the tie window of the current best.
    const tied = candidates.filter(c => c.rankScore >= top - eps)
    // Prefer one whose elevation is already scaffolded; else the strongest.
    const pick =
      tied.find(c => {
        const s = segByIndex.get(c.segmentIndex)!
        return activeElevations.has(azimuthToElevation(s.azimuthDeg))
      }) ?? tied[0]

    candidates.splice(candidates.indexOf(pick), 1)
    const seg = segByIndex.get(pick.segmentIndex)!

    const block = planRectangularBlock(seg, panelWidthM, panelHeightM, remaining)
    if (block.cols <= 0 || block.rows <= 0) continue

    const layout = placeBlock(seg, panelWidthM, panelHeightM, block)
    layouts.push(layout)
    remaining -= layout.placedCount
    activeElevations.add(azimuthToElevation(seg.azimuthDeg))
    blockSpans.push({
      segmentIndex: seg.segmentIndex,
      azimuthDeg: seg.azimuthDeg,
      blockWidthM: block.cols * (panelWidthM + GAP_M) - GAP_M,
    })
  }

  const scaffold = computeScaffoldCost(
    computeElevationSpans(blockSpans),
    cfg.scaffoldRates,
  )

  return {
    layouts,
    scaffold,
    totalPlaced: layouts.reduce((sum, l) => sum + l.placedCount, 0),
  }
}
