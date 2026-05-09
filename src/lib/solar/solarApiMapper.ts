import type { GoogleSolarBuildingInsights } from '@/lib/types'
import type { Solar3DModel } from '@/types/solar'
import { buildLocalSegment } from './roofPlaneBuilder'
import { bboxToLocal } from './coordinateConverter'

export const DEFAULT_WALL_HEIGHT_M = 3.5

export function buildSolar3DModel(
  insights: GoogleSolarBuildingInsights,
  wallHeightM = DEFAULT_WALL_HEIGHT_M,
): Solar3DModel {
  const segs = insights.solarPotential.roofSegmentStats ?? []

  if (segs.length === 0) {
    const buildingBounds = bboxToLocal(
      insights.boundingBox.sw,
      insights.boundingBox.ne,
      insights.center,
    )
    return { segments: [], buildingBounds, wallHeightM }
  }

  // Pass 1: build with zero offset to get actual geometry (groundDepthM, pitchDeg)
  const rawSegs = segs.map((seg, i) => buildLocalSegment(seg, insights.center, 0, i))

  // Anchor the lowest EAVE at the provided wallHeightM (OS eave height when available)
  const minEaveRaw = Math.min(...rawSegs.map(seg => {
    const pitchRad = (seg.pitchDeg * Math.PI) / 180
    return seg.heightAtCenterM - (seg.groundDepthM / 2) * Math.tan(pitchRad)
  }))
  const heightOffset = wallHeightM - minEaveRaw

  // Pass 2: apply correct vertical offset
  const segments = segs.map((seg, i) =>
    buildLocalSegment(seg, insights.center, heightOffset, i),
  )

  const buildingBounds = bboxToLocal(
    insights.boundingBox.sw,
    insights.boundingBox.ne,
    insights.center,
  )

  return { segments, buildingBounds, wallHeightM }
}
