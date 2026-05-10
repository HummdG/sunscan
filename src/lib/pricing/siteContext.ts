import type { GoogleSolarBuildingInsights, OsBuilding } from '@/lib/types'
import type { RoofType } from './types'

export interface SiteContext {
  roofType: RoofType
  /** Suggested defaults the configurator should pre-tick (e.g. multi-storey scaffold). */
  suggestedExtras: Array<{ sku: string; quantity: number }>
  /** Maximum panels physically fitting on the roof. */
  roofMaxPanels: number
}

const DEFAULT_MAX_PANELS = 20
const FLAT_ROOF_PITCH_THRESHOLD_DEG = 10

/**
 * Derive site-context defaults from existing building data.
 *
 * - Roof type: 'flat' if pitch < 10°, else 'pitched'.
 * - Storey scaffolding: charge per storey above 2 (eave height proxy).
 * - Panel cap: prefer Google Solar maxArrayPanelsCount, fall back to layout estimate.
 */
export function deriveSiteContext(
  osBuilding: OsBuilding | null,
  solarInsights: GoogleSolarBuildingInsights | null,
  panelLayoutMaxPanels: number,
): SiteContext {
  const pitch =
    osBuilding?.roofPitchDeg ??
    solarInsights?.solarPotential.roofSegmentStats[0]?.pitchDegrees ??
    35
  const roofType: RoofType = pitch < FLAT_ROOF_PITCH_THRESHOLD_DEG ? 'flat' : 'pitched'

  const suggestedExtras: Array<{ sku: string; quantity: number }> = []
  const eave = osBuilding?.eaveHeightM ?? 5
  // Default UK 2-storey home eave ≈ 5–6 m. Charge applies for *every storey above 2*.
  const extraStoreys = eave >= 9 ? 2 : eave >= 6 ? 1 : 0
  if (extraStoreys > 0) {
    suggestedExtras.push({ sku: 'SCAFFOLD-EXTRA-STOREY', quantity: extraStoreys })
  }

  const roofMaxPanels =
    solarInsights?.solarPotential.maxArrayPanelsCount ??
    (panelLayoutMaxPanels > 0 ? panelLayoutMaxPanels : DEFAULT_MAX_PANELS)

  return { roofType, suggestedExtras, roofMaxPanels: Math.max(1, Math.round(roofMaxPanels)) }
}
