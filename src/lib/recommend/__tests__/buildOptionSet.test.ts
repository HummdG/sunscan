import { describe, it, expect } from 'vitest'
import { buildOptionSet } from '../buildOptionSet'
import { makeInput } from './catalogueFixture'

const sig = (o: { tier: string; panelCount: number }) => `${o.tier}:${o.panelCount}`

describe('buildOptionSet', () => {
  it('always returns exactly 3 distinct options ordered by price ascending', () => {
    const set = buildOptionSet(makeInput())
    expect(set.options).toHaveLength(3)
    expect(new Set(set.options.map(sig)).size).toBe(3)
    const prices = set.options.map((o) => o.priceGbp)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    expect(set.options.map((o) => o.kind)).toEqual(['budget_fit', 'better_value', 'recommended'])
  })

  it('exactly one option is recommended, and it is the highest-scoring of the three', () => {
    const set = buildOptionSet(makeInput())
    const flagged = set.options.filter((o) => o.isRecommended)
    expect(flagged).toHaveLength(1)
    const best = set.options.reduce((b, o) => (o.score > b.score ? o : b))
    expect(flagged[0].kind).toBe(best.kind)
    expect(set.recommendedId).toBe(flagged[0].kind)
  })

  it('budget-fit respects the stated budget when something fits', () => {
    const set = buildOptionSet(makeInput({ budgetMaxGbp: 9000 }))
    const bf = set.options.find((o) => o.kind === 'budget_fit')!
    expect(bf.priceGbp).toBeLessThanOrEqual(9000)
    expect(bf.aboveBudget).toBe(false)
  })

  it('flags aboveBudget when even the cheapest system exceeds the budget', () => {
    const set = buildOptionSet(makeInput({ budgetMaxGbp: 1000 }))
    expect(set.options).toHaveLength(3)
    const bf = set.options.find((o) => o.kind === 'budget_fit')!
    expect(bf.aboveBudget).toBe(true)
    // still the cheapest of the three
    expect(bf.priceGbp).toBe(Math.min(...set.options.map((o) => o.priceGbp)))
  })

  it('still produces 3 distinct options on a tiny roof (tiers differentiate)', () => {
    const set = buildOptionSet(makeInput({ roofMaxPanels: 6, maxPanels: 6 }))
    expect(set.options).toHaveLength(3)
    expect(new Set(set.options.map(sig)).size).toBe(3)
    // all capped at the roof
    expect(set.options.every((o) => o.panelCount <= 6)).toBe(true)
  })

  it('carries modelled results and pricing through to every option', () => {
    const set = buildOptionSet(makeInput())
    for (const o of set.options) {
      expect(o.priceGbp).toBeGreaterThan(0)
      expect(o.systemKwp).toBeGreaterThan(0)
      expect(o.results.twentyFiveYearSavings.length).toBeGreaterThan(0)
      expect(Number.isFinite(o.results.paybackYears)).toBe(true)
    }
  })
})
