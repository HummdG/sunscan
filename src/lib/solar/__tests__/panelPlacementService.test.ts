import { describe, it, expect } from 'vitest'
import {
  placePanelsOnSegment,
  computePanelLayouts,
  computeOptimisedPanelLayouts,
} from '@/lib/solar/panelPlacementService'
import type { Solar3DModel, LocalRoofSegment } from '@/types/solar'
import type { GoogleSolarPanelConfig } from '@/lib/types'

const W = 1.722
const H = 1.134

function seg(p: Partial<LocalRoofSegment> & { segmentIndex: number }): LocalRoofSegment {
  return {
    azimuthDeg: 180,
    pitchDeg: 35,
    heightAtCenterM: 6,
    areaM2: 30,
    sunshineQuantiles: [500],
    center: { x: 0, z: 0 },
    ridgeLenM: 12,
    groundDepthM: 7,
    ...p,
  }
}

describe('placePanelsOnSegment (refactored to centred rectangular blocks)', () => {
  it('preserves the public requestedCount field', () => {
    const layout = placePanelsOnSegment(seg({ segmentIndex: 0 }), W, H, 6)
    expect(layout.requestedCount).toBe(6)
    expect(layout.segmentIndex).toBe(0)
  })

  it('returns a clean rectangle no larger than requested', () => {
    const layout = placePanelsOnSegment(seg({ segmentIndex: 0 }), W, H, 7)
    expect(layout.placedCount).toBeLessThanOrEqual(7)
    expect(layout.placedCount).toBeGreaterThan(0)
    for (const p of layout.panels) {
      expect(p.position).toHaveLength(3)
      expect(typeof p.rotationY).toBe('number')
      expect(typeof p.pitchRad).toBe('number')
    }
  })

  it('returns an empty layout for a too-small segment without crashing', () => {
    const layout = placePanelsOnSegment(
      seg({ segmentIndex: 3, ridgeLenM: 0.1, groundDepthM: 0.1 }),
      W,
      H,
      4,
    )
    expect(layout.placedCount).toBe(0)
    expect(layout.panels).toEqual([])
  })
})

describe('computeOptimisedPanelLayouts / computePanelLayouts', () => {
  const model: Solar3DModel = {
    segments: [
      seg({ segmentIndex: 0, sunshineQuantiles: [200] }),
      seg({ segmentIndex: 1, sunshineQuantiles: [900] }),
    ],
    buildingBounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
    wallHeightM: 5.5,
  }

  it('computeOptimisedPanelLayouts returns valid PanelLayout shapes + scaffold', () => {
    const opt = computeOptimisedPanelLayouts(model, 8, W, H)
    expect(opt.totalPlaced).toBeGreaterThan(0)
    expect(opt.scaffold.totalPounds).toBeGreaterThan(0)
    for (const l of opt.layouts) {
      expect(typeof l.segmentIndex).toBe('number')
      expect(l.placedCount).toBe(l.panels.length)
    }
    // sunnier segment (1) filled first
    expect(opt.layouts[0].segmentIndex).toBe(1)
  })

  it('computePanelLayouts wrapper drives the optimiser from panelConfig.panelsCount', () => {
    const cfg: GoogleSolarPanelConfig = {
      panelsCount: 6,
      yearlyEnergyDcKwh: 2000,
      roofSegmentSummaries: [
        { segmentIndex: 0, panelsCount: 3, pitchDegrees: 35, azimuthDegrees: 180, yearlyEnergyDcKwh: 1000 },
        { segmentIndex: 1, panelsCount: 3, pitchDegrees: 35, azimuthDegrees: 180, yearlyEnergyDcKwh: 1000 },
      ],
    }
    const layouts = computePanelLayouts(model, cfg, W, H)
    const total = layouts.reduce((s, l) => s + l.placedCount, 0)
    expect(total).toBeLessThanOrEqual(6)
    expect(total).toBeGreaterThan(0)
  })
})
