import { describe, it, expect, afterEach } from 'vitest'
import {
  DEFAULT_SCAFFOLD_RATES,
  getScaffoldRates,
  computeScaffoldCost,
} from '@/lib/solar/scaffoldCost'

describe('computeScaffoldCost', () => {
  const rates = { perLinearMetrePounds: 25, perElevationSetupPounds: 150 }

  it('charges setup + span*rate for a single elevation', () => {
    const r = computeScaffoldCost(
      [{ elevation: 'S', spanM: 8, segmentIndexes: [0] }],
      rates,
    )
    expect(r.totalPounds).toBe(150 + 8 * 25)
    expect(r.activeElevationCount).toBe(1)
    expect(r.perElevation[0]).toMatchObject({ elevation: 'S', spanM: 8 })
  })

  it('adds a second setup fee for a second elevation (so concentration is cheaper)', () => {
    const oneFace = computeScaffoldCost(
      [{ elevation: 'S', spanM: 10, segmentIndexes: [0, 1] }],
      rates,
    )
    const twoFaces = computeScaffoldCost(
      [
        { elevation: 'S', spanM: 5, segmentIndexes: [0] },
        { elevation: 'E', spanM: 5, segmentIndexes: [1] },
      ],
      rates,
    )
    // Same total span (10m) but two elevations costs one extra setup fee.
    expect(twoFaces.totalPounds - oneFace.totalPounds).toBe(150)
  })

  it('returns zero for no spans', () => {
    const r = computeScaffoldCost([], rates)
    expect(r.totalPounds).toBe(0)
    expect(r.activeElevationCount).toBe(0)
  })
})

describe('getScaffoldRates', () => {
  const origM = process.env.SCAFFOLD_PER_M_POUNDS
  const origS = process.env.SCAFFOLD_SETUP_POUNDS

  afterEach(() => {
    if (origM === undefined) delete process.env.SCAFFOLD_PER_M_POUNDS
    else process.env.SCAFFOLD_PER_M_POUNDS = origM
    if (origS === undefined) delete process.env.SCAFFOLD_SETUP_POUNDS
    else process.env.SCAFFOLD_SETUP_POUNDS = origS
  })

  it('falls back to defaults when env is unset', () => {
    delete process.env.SCAFFOLD_PER_M_POUNDS
    delete process.env.SCAFFOLD_SETUP_POUNDS
    expect(getScaffoldRates()).toEqual(DEFAULT_SCAFFOLD_RATES)
  })

  it('honours valid env overrides', () => {
    process.env.SCAFFOLD_PER_M_POUNDS = '40'
    process.env.SCAFFOLD_SETUP_POUNDS = '200'
    expect(getScaffoldRates()).toEqual({
      perLinearMetrePounds: 40,
      perElevationSetupPounds: 200,
    })
  })

  it('ignores non-finite env values and uses the default', () => {
    process.env.SCAFFOLD_PER_M_POUNDS = 'not-a-number'
    delete process.env.SCAFFOLD_SETUP_POUNDS
    expect(getScaffoldRates()).toEqual(DEFAULT_SCAFFOLD_RATES)
  })
})
