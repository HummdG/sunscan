import type { PanelPosition, PanelSpec, RoofPlane } from './types'

const MARGIN_M = 0.3 // 300mm edge margin (industry minimum)
const GAP_M = 0.02 // 20mm between panels

/**
 * Calculate how many panels fit on a roof plane and their 3D positions.
 * Uses simple grid packing; tests both portrait and landscape orientations.
 * Returns positions in local 3D space aligned to the roof plane.
 *
 * TODO: Replace with polygon-aware packing for complex roof shapes.
 */
export function calculatePanelLayout(
  roofPlane: RoofPlane,
  panelSpec: PanelSpec,
  wallHeightM: number = 5.5,
): { positions: PanelPosition[]; count: number } {
  const panelW = panelSpec.widthMm / 1000
  const panelH = panelSpec.heightMm / 1000

  // Estimate usable roof dimensions from area
  const usableArea = roofPlane.areaM2
  const pitchRad = (roofPlane.tiltDeg * Math.PI) / 180
  const roofWidth = Math.sqrt(usableArea * 2) - MARGIN_M * 2
  const roofDepth = (usableArea / Math.max(roofWidth, 1)) - MARGIN_M * 2

  // Try portrait (widthMm horizontal)
  const portraitCols = Math.floor((roofWidth + GAP_M) / (panelW + GAP_M))
  const portraitRows = Math.floor((roofDepth + GAP_M) / (panelH + GAP_M))
  const portraitCount = Math.max(0, portraitCols * portraitRows)

  // Try landscape (heightMm horizontal)
  const landscapeCols = Math.floor((roofWidth + GAP_M) / (panelH + GAP_M))
  const landscapeRows = Math.floor((roofDepth + GAP_M) / (panelW + GAP_M))
  const landscapeCount = Math.max(0, landscapeCols * landscapeRows)

  const usePortrait = portraitCount >= landscapeCount
  const cols = usePortrait ? portraitCols : landscapeCols
  const rows = usePortrait ? portraitRows : landscapeRows
  const cellW = usePortrait ? panelW : panelH
  const cellH = usePortrait ? panelH : panelW

  // Ridge is along the principal axis; panels start at eave and go up
  // Eave Y = wallHeightM, ridge Y = wallHeightM + roofDepth * sin(pitch)
  const startX = -(cols * (cellW + GAP_M)) / 2 + cellW / 2
  const eaveY = wallHeightM
  const panelDepth = panelSpec.depthMm / 1000
  const ABOVE_ROOF = 0.05 // 50mm standoff above roof surface

  const positions: PanelPosition[] = []

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const localX = startX + col * (cellW + GAP_M)
      // Along-slope distance from eave
      const slopeD = MARGIN_M + row * (cellH + GAP_M) + cellH / 2
      // 3D position
      const y = eaveY + slopeD * Math.sin(pitchRad) + ABOVE_ROOF + panelDepth / 2
      const z = -slopeD * Math.cos(pitchRad)

      positions.push({
        col,
        row,
        x: localX,
        y,
        z,
        rotationY: 0,
      })
    }
  }

  return { positions, count: positions.length }
}
