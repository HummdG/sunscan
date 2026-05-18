// Shared panel-layout geometry constants. Previously duplicated as module-private
// values in panelPlacementService.ts; centralised here so the optimiser, the
// sunlight-ranking capacity estimate, and panel placement all agree.

/** Edge setback from every roof-plane boundary (metres). */
export const MARGIN_M = 0.3
/** Gap between adjacent panels (metres). */
export const GAP_M = 0.02
/** Panel standoff above the roof surface (metres). */
export const STANDOFF_M = 0.05

/**
 * Max landscape panels a segment can physically hold (full grid, no capacity
 * cap). `panelWidthM` runs along the ridge, `panelHeightM` down the slope —
 * matching the convention in panelPlacementService.placePanelsOnSegment.
 */
export function gridCapacity(
  ridgeLenM: number,
  groundDepthM: number,
  pitchDeg: number,
  panelWidthM: number,
  panelHeightM: number,
): { cols: number; rows: number } {
  const pitchRad = (pitchDeg * Math.PI) / 180
  const slopeLenM = groundDepthM / Math.cos(pitchRad)
  const usableRidge = Math.max(0, ridgeLenM - 2 * MARGIN_M)
  const usableSlope = Math.max(0, slopeLenM - 2 * MARGIN_M)
  const cols = Math.floor((usableRidge + GAP_M) / (panelWidthM + GAP_M))
  const rows = Math.floor((usableSlope + GAP_M) / (panelHeightM + GAP_M))
  return { cols: Math.max(0, cols), rows: Math.max(0, rows) }
}
