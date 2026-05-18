import { describe, it, expect } from 'vitest'
import {
  planRectangularBlock,
  placeBlock,
  optimiseLayout,
} from '@/lib/solar/layoutOptimiser'
import { gridCapacity, MARGIN_M } from '@/lib/solar/layoutConstants'
import type { LocalRoofSegment } from '@/types/solar'

const W = 1.722
const H = 1.134

function seg(p: Partial<LocalRoofSegment> & { segmentIndex: number }): LocalRoofSegment {
  return {
    azimuthDeg: 180,
    pitchDeg: 35,
    heightAtCenterM: 6,
    areaM2: 30,
    sunshineQuantiles: [],
    center: { x: 0, z: 0 },
    ridgeLenM: 12,
    groundDepthM: 7,
    ...p,
  }
}

describe('planRectangularBlock', () => {
  const s = seg({ segmentIndex: 0 })
  const cap = gridCapacity(s.ridgeLenM, s.groundDepthM, s.pitchDeg, W, H)

  it('returns the full grid when capacity is requested', () => {
    const b = planRectangularBlock(s, W, H, 10_000)
    expect(b).toEqual({ cols: cap.cols, rows: cap.rows })
  })

  it('never leaves a partial row — count is always cols*rows', () => {
    for (let want = 1; want <= cap.cols * cap.rows; want++) {
      const b = planRectangularBlock(s, W, H, want)
      expect(b.cols * b.rows).toBeLessThanOrEqual(want)
      // a full rectangle: either a single row, or full-width rows
      if (b.rows > 1) expect(b.cols).toBe(cap.cols)
    }
  })

  it('makes a single full-width-capped row when fewer than one row is asked', () => {
    const b = planRectangularBlock(s, W, H, cap.cols - 1)
    expect(b).toEqual({ cols: cap.cols - 1, rows: 1 })
  })

  it('returns an empty block for a segment too small for a panel', () => {
    const tiny = seg({ segmentIndex: 9, ridgeLenM: 0.2, groundDepthM: 0.2 })
    expect(planRectangularBlock(tiny, W, H, 5)).toEqual({ cols: 0, rows: 0 })
  })
})

describe('placeBlock — symmetric centring', () => {
  // azimuth 0 ⇒ ridgeX=1, ridgeZ=0, faceX=0, faceZ=-1 ⇒ px = cx + alongRidge,
  // groundD = pz - (cz - depth/2). Lets us recover the layout geometry.
  const s = seg({ segmentIndex: 0, azimuthDeg: 0, center: { x: 0, z: 0 } })
  const pitchRad = (s.pitchDeg * Math.PI) / 180

  it('centres a sub-capacity block horizontally on the ridge', () => {
    const layout = placeBlock(s, W, H, { cols: 3, rows: 2 })
    const xs = layout.panels.map(p => p.position[0])
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean).toBeCloseTo(0, 6) // centred on segment centre.x = 0
    expect(Math.min(...xs)).toBeCloseTo(-Math.max(...xs), 6)
  })

  it('centres the block down-slope (balanced ridge/eave margins)', () => {
    const block = { cols: 2, rows: 2 }
    const layout = placeBlock(s, W, H, block)
    const eaveMidZ = s.center.z - s.groundDepthM / 2
    const slopeDs = layout.panels.map(
      p => (p.position[2] - eaveMidZ) / Math.cos(pitchRad),
    )
    const slopeLenM = s.groundDepthM / Math.cos(pitchRad)
    const usableSlope = slopeLenM - 2 * MARGIN_M
    const centre = MARGIN_M + usableSlope / 2
    const minD = Math.min(...slopeDs)
    const maxD = Math.max(...slopeDs)
    // panel centres are symmetric about the usable-slope midpoint
    expect(centre - minD).toBeCloseTo(maxD - centre, 6)
  })

  it('reports placedCount === cols*rows', () => {
    const layout = placeBlock(s, W, H, { cols: 4, rows: 3 })
    expect(layout.placedCount).toBe(12)
    expect(layout.panels).toHaveLength(12)
  })
})

describe('optimiseLayout', () => {
  it('fills the sunniest segment before a dim one', () => {
    const segs = [
      seg({ segmentIndex: 0, sunshineQuantiles: [100], azimuthDeg: 180 }),
      seg({ segmentIndex: 1, sunshineQuantiles: [900], azimuthDeg: 180 }),
    ]
    const r = optimiseLayout(segs, { targetPanelCount: 6, panelWidthM: W, panelHeightM: H })
    expect(r.layouts[0].segmentIndex).toBe(1)
    expect(r.layouts[0].placedCount).toBeGreaterThan(0)
  })

  it('every emitted layout is a full rectangle (no ragged rows)', () => {
    const segs = [seg({ segmentIndex: 0, sunshineQuantiles: [500] })]
    const r = optimiseLayout(segs, { targetPanelCount: 7, panelWidthM: W, panelHeightM: H })
    for (const l of r.layouts) {
      // recover columns from a south-ish segment via distinct x positions
      const xs = new Set(l.panels.map(p => p.position[0].toFixed(4)))
      expect(l.placedCount % xs.size).toBe(0)
    }
  })

  it('does not exceed the target by more than one row of the last block', () => {
    const segs = [seg({ segmentIndex: 0, sunshineQuantiles: [500] })]
    const target = 5
    const r = optimiseLayout(segs, { targetPanelCount: target, panelWidthM: W, panelHeightM: H })
    expect(r.totalPlaced).toBeLessThanOrEqual(target)
  })

  it('prefers an already-active elevation on a near-tie (scaffold-aware)', () => {
    // Two segments with identical sun/pitch. seg0 (S) ranks first and opens the
    // S elevation. seg1 (also S) and seg2 (E) tie on score; the optimiser should
    // take seg1 next because S scaffold is already paid for.
    const segs = [
      seg({ segmentIndex: 0, azimuthDeg: 180, sunshineQuantiles: [500] }),
      seg({ segmentIndex: 1, azimuthDeg: 180, sunshineQuantiles: [500] }),
      seg({ segmentIndex: 2, azimuthDeg: 90, sunshineQuantiles: [500] }),
    ]
    const r = optimiseLayout(segs, {
      targetPanelCount: 9999,
      panelWidthM: W,
      panelHeightM: H,
    })
    const order = r.layouts.map(l => l.segmentIndex)
    expect(order.indexOf(1)).toBeLessThan(order.indexOf(2))
    expect(r.scaffold.activeElevationCount).toBe(2) // S and E
    expect(r.scaffold.totalPounds).toBeGreaterThan(0)
  })

  it('handles no segments without crashing', () => {
    const r = optimiseLayout([], { targetPanelCount: 10, panelWidthM: W, panelHeightM: H })
    expect(r).toEqual({ layouts: [], totalPlaced: 0, scaffold: r.scaffold })
    expect(r.scaffold.totalPounds).toBe(0)
  })

  it('places at most the roof capacity when the target exceeds it', () => {
    const segs = [seg({ segmentIndex: 0, ridgeLenM: 4, groundDepthM: 3, sunshineQuantiles: [500] })]
    const cap = gridCapacity(4, 3, 35, W, H)
    const r = optimiseLayout(segs, {
      targetPanelCount: 100_000,
      panelWidthM: W,
      panelHeightM: H,
    })
    expect(r.totalPlaced).toBeLessThanOrEqual(cap.cols * cap.rows)
  })
})
