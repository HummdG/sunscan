// Lead scoring — hot / warm / nurture from the brief's criteria. Pure.

export type LeadBand = 'hot' | 'warm' | 'nurture'

export interface LeadScoreInput {
  ownership: string // own | mortgage | rent | social | landlord | other
  propertyType: string // detached | semi | terraced | bungalow | flat | other
  hasUprn: boolean
  roofConfidence: 'high' | 'medium' | 'low'
  maxPanelCount: number
  usageSource: string // bill_ocr | manual_kwh | monthly_cost | household
  budgetMaxGbp: number
  reportRequested: boolean
  surveyRequested: boolean
  hasPhone: boolean
  lifestyle: string[]
}

export interface LeadScore {
  score: number
  band: LeadBand
  reasons: string[]
}

/**
 * Point model: ≥8 = hot, 4–7 = warm, <4 = nurture. Each contributing factor is
 * recorded in `reasons` for the installer dashboard.
 */
export function scoreLead(i: LeadScoreInput): LeadScore {
  let score = 0
  const reasons: string[] = []
  const add = (pts: number, why: string) => {
    score += pts
    reasons.push(`${pts > 0 ? '+' : ''}${pts} ${why}`)
  }

  if (i.ownership === 'own' || i.ownership === 'mortgage') add(2, 'owns property')
  else if (i.ownership === 'rent' || i.ownership === 'social') add(-3, 'renter / social housing')

  if (i.propertyType === 'flat') add(-2, 'flat / apartment')

  if (i.hasUprn) add(1, 'confirmed address')

  if (i.roofConfidence === 'high') add(2, 'high roof-model confidence')
  else if (i.roofConfidence === 'medium') add(1, 'medium roof-model confidence')
  else add(-2, 'low / estimated roof confidence')

  if (i.maxPanelCount >= 12) add(2, 'strong roof capacity')

  if (i.usageSource === 'bill_ocr' || i.usageSource === 'manual_kwh') add(1, 'bill / kWh provided')
  else if (i.usageSource === 'household') add(-1, 'usage from household estimate only')

  if (i.budgetMaxGbp > 8000) add(2, 'budget above £8k')
  else if (i.budgetMaxGbp > 0 && i.budgetMaxGbp <= 6000) add(-2, 'low budget')

  if (i.surveyRequested) add(3, 'requested a survey')
  if (i.hasPhone) add(2, 'provided phone')
  else add(-1, 'no phone number')

  if (i.lifestyle.includes('ev_now') || i.lifestyle.includes('heatpump_now')) {
    add(1, 'has EV / heat pump')
  }

  const band: LeadBand = score >= 8 ? 'hot' : score >= 4 ? 'warm' : 'nurture'
  return { score, band, reasons }
}
