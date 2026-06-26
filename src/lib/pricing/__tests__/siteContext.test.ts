import { describe, it, expect } from 'vitest'
import { deriveSiteContext } from '../siteContext'
import type { GoogleSolarBuildingInsights } from '@/lib/types'

// Google insights with an absurd whole-roof count — deriveSiteContext must
// ignore it now and trust the realistic count the caller passes in.
function insightsWithMaxArray(maxArrayPanelsCount: number): GoogleSolarBuildingInsights {
  return {
    solarPotential: {
      maxArrayPanelsCount,
      roofSegmentStats: [{ pitchDegrees: 35 }],
    },
  } as unknown as GoogleSolarBuildingInsights
}

describe('deriveSiteContext', () => {
  it('uses the passed-in realistic count, not Google maxArrayPanelsCount', () => {
    const { roofMaxPanels } = deriveSiteContext(null, insightsWithMaxArray(86), 13)
    expect(roofMaxPanels).toBe(13)
  })

  it('falls back to the default cap when the realistic count is 0', () => {
    const { roofMaxPanels } = deriveSiteContext(null, insightsWithMaxArray(86), 0)
    expect(roofMaxPanels).toBe(20)
  })
})
