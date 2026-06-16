import { describe, it, expect } from 'vitest'
import { scoreLead, type LeadScoreInput } from '../scoreLead'

const base: LeadScoreInput = {
  ownership: 'own',
  propertyType: 'detached',
  hasUprn: true,
  roofConfidence: 'high',
  maxPanelCount: 16,
  usageSource: 'bill_ocr',
  budgetMaxGbp: 12000,
  reportRequested: true,
  surveyRequested: false,
  hasPhone: true,
  lifestyle: [],
}

describe('scoreLead', () => {
  it('scores a strong owner-occupier survey request as hot', () => {
    const r = scoreLead({ ...base, surveyRequested: true })
    // own+2, uprn+1, roof high+2, capacity+2, bill+1, budget+2, survey+3, phone+2 = 15
    expect(r.score).toBe(15)
    expect(r.band).toBe('hot')
    expect(r.reasons.length).toBeGreaterThan(0)
  })

  it('scores a mid owner-occupier report-only as warm', () => {
    // own+2, uprn+1, roof medium+1, capacity (10 <12 → 0), monthly_cost (0), budget 7k (0), phone+2 = 6
    const r = scoreLead({
      ...base,
      roofConfidence: 'medium',
      maxPanelCount: 10,
      usageSource: 'monthly_cost',
      budgetMaxGbp: 7000,
    })
    expect(r.score).toBe(6)
    expect(r.band).toBe('warm')
  })

  it('scores a renter in a flat on household estimate as nurture', () => {
    // rent-3, flat-2, uprn+1, roof low-2, capacity 6(0), household-1, low budget-2, no phone-1 = -10
    const r = scoreLead({
      ...base,
      ownership: 'rent',
      propertyType: 'flat',
      roofConfidence: 'low',
      maxPanelCount: 6,
      usageSource: 'household',
      budgetMaxGbp: 6000,
      hasPhone: false,
    })
    expect(r.score).toBeLessThan(4)
    expect(r.band).toBe('nurture')
  })

  it('rewards EV / heat pump ownership', () => {
    const withEv = scoreLead({ ...base, lifestyle: ['ev_now'] })
    const without = scoreLead(base)
    expect(withEv.score).toBe(without.score + 1)
  })
})
