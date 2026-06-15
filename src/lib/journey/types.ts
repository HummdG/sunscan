// Homeowner journey state machine — the single source of truth for the wizard.
// Pure + serialisable (no DOM, no I/O) so it can be unit-tested and persisted.

import type { GoogleSolarBuildingInsights } from '@/lib/types'
import type { GeometrySource } from '@/lib/recommend/deriveGeometry'

// ─── Field unions (mirror the brief; map onto the Lead model at submit) ──────

export type PropertyType = 'detached' | 'semi' | 'terraced' | 'bungalow' | 'flat' | 'other'
export type Ownership = 'own' | 'mortgage' | 'rent' | 'social' | 'landlord' | 'other'
export type RoofConfidence = 'high' | 'medium' | 'low'
export type RoofSizeBand = 'small' | 'medium' | 'large' | 'unsure'
export type RoofDirection =
  | 'south' | 'south_east' | 'south_west' | 'east' | 'west' | 'east_west' | 'north' | 'unsure'
export type ShadingLevel = 'none' | 'trees' | 'buildings' | 'heavy' | 'unsure'
export type UsageSource = 'bill_ocr' | 'manual_kwh' | 'monthly_cost' | 'household'
export type TariffType =
  | 'standard' | 'economy7' | 'smart_tou' | 'import_export' | 'already_exports' | 'unknown'
export type ExistingSystem = 'none' | 'solar' | 'battery' | 'solar_battery' | 'unsure'
export type LifestyleTag =
  | 'home_daytime' | 'evening_use' | 'ev_now' | 'ev_planned'
  | 'heatpump_now' | 'heatpump_planned' | 'high_daytime'
export type Motivation =
  | 'reduce_bills' | 'price_protection' | 'cheap_tariffs' | 'earn_export'
  | 'independence' | 'carbon' | 'home_value' | 'exploring'
export type FinanceInterest = 'yes' | 'no' | 'maybe' | 'learn_more'

// ─── Sub-state shapes ────────────────────────────────────────────────────────

export interface AddressState {
  raw: string
  lat: number
  lng: number
  postcode: string
  uprn?: string
  confirmed: boolean
}

export interface RoofState {
  source: GeometrySource
  confidence: RoofConfidence
  maxPanelCount: number
  kwpPotential: number
  pitchDeg: number
  mcsOrientationDeg: number
  roofType: 'pitched' | 'flat' | 'ground'
  /** Stringified GoogleSolarBuildingInsights for the 2D viewer + recommendation. */
  insights: GoogleSolarBuildingInsights | null
}

export interface RoofFallbackState {
  sizeBand: RoofSizeBand | null
  direction: RoofDirection | null
  shading: ShadingLevel | null
}

export interface UsageState {
  source: UsageSource | null
  annualKwh: number | null
  unitRatePence: number | null
  standingChargePence: number | null
  exportTariffPence: number | null
  supplier: string | null
  monthlyCostGbp: number | null
  householdSize: number | null
}

// ─── Journey state ───────────────────────────────────────────────────────────

export type JourneyIntent = 'estimate' | 'survey'

export interface JourneyState {
  intent: JourneyIntent
  stepIndex: number
  address: AddressState | null
  roof: RoofState | null
  roofFallback: RoofFallbackState
  propertyType: PropertyType | null
  ownership: Ownership | null
  usage: UsageState
  lifestyle: LifestyleTag[]
  tariffType: TariffType | null
  existing: ExistingSystem | null
  motivation: Motivation | null
  budgetBandId: string | null
  financeInterest: FinanceInterest | null
}

export function createInitialJourneyState(intent: JourneyIntent = 'estimate'): JourneyState {
  return {
    intent,
    stepIndex: 0,
    address: null,
    roof: null,
    roofFallback: { sizeBand: null, direction: null, shading: null },
    propertyType: null,
    ownership: null,
    usage: {
      source: null,
      annualKwh: null,
      unitRatePence: null,
      standingChargePence: null,
      exportTariffPence: null,
      supplier: null,
      monthlyCostGbp: null,
      householdSize: null,
    },
    lifestyle: [],
    tariffType: null,
    existing: null,
    motivation: null,
    budgetBandId: null,
    financeInterest: null,
  }
}

// ─── Steps + conditional flow ────────────────────────────────────────────────

export type StepId =
  | 'address' | 'roof' | 'roofFallback' | 'property'
  | 'usage' | 'lifestyle' | 'tariff' | 'existing' | 'motivation'

const STEP_ORDER: StepId[] = [
  'address', 'roof', 'roofFallback', 'property',
  'usage', 'lifestyle', 'tariff', 'existing', 'motivation',
]

export const STEP_META: Record<StepId, { label: string; code: string }> = {
  address: { label: 'Your address', code: 'SITE' },
  roof: { label: 'Your roof', code: 'ROOF' },
  roofFallback: { label: 'Roof details', code: 'ROOF+' },
  property: { label: 'Your property', code: 'PROP' },
  usage: { label: 'Electricity use', code: 'USE' },
  lifestyle: { label: 'Energy lifestyle', code: 'LIFE' },
  tariff: { label: 'Your tariff', code: 'TARIFF' },
  existing: { label: 'Existing system', code: 'EXIST' },
  motivation: { label: 'Goals & budget', code: 'GOALS' },
}

/**
 * The steps visible for the current state. `roofFallback` only appears when
 * roof mapping confidence is low — otherwise the mapping is trusted.
 */
export function visibleSteps(state: JourneyState): StepId[] {
  return STEP_ORDER.filter((id) => {
    if (id === 'roofFallback') return state.roof?.confidence === 'low'
    return true
  })
}

export function currentStep(state: JourneyState): StepId {
  const steps = visibleSteps(state)
  return steps[Math.min(state.stepIndex, steps.length - 1)]
}

// ─── Actions + reducer ───────────────────────────────────────────────────────

export type JourneyAction =
  | { type: 'SET_ADDRESS'; address: AddressState }
  | { type: 'SET_ROOF'; roof: RoofState }
  | { type: 'PATCH_ROOF_FALLBACK'; patch: Partial<RoofFallbackState> }
  | { type: 'SET_PROPERTY_TYPE'; value: PropertyType }
  | { type: 'SET_OWNERSHIP'; value: Ownership }
  | { type: 'PATCH_USAGE'; patch: Partial<UsageState> }
  | { type: 'TOGGLE_LIFESTYLE'; tag: LifestyleTag }
  | { type: 'SET_TARIFF'; value: TariffType }
  | { type: 'SET_EXISTING'; value: ExistingSystem }
  | { type: 'SET_MOTIVATION'; value: Motivation }
  | { type: 'SET_BUDGET'; value: string }
  | { type: 'SET_FINANCE'; value: FinanceInterest }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'GOTO'; stepIndex: number }

export function journeyReducer(state: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case 'SET_ADDRESS':
      return { ...state, address: action.address }
    case 'SET_ROOF':
      return { ...state, roof: action.roof }
    case 'PATCH_ROOF_FALLBACK':
      return { ...state, roofFallback: { ...state.roofFallback, ...action.patch } }
    case 'SET_PROPERTY_TYPE':
      return { ...state, propertyType: action.value }
    case 'SET_OWNERSHIP':
      return { ...state, ownership: action.value }
    case 'PATCH_USAGE':
      return { ...state, usage: { ...state.usage, ...action.patch } }
    case 'TOGGLE_LIFESTYLE': {
      const has = state.lifestyle.includes(action.tag)
      return {
        ...state,
        lifestyle: has
          ? state.lifestyle.filter((t) => t !== action.tag)
          : [...state.lifestyle, action.tag],
      }
    }
    case 'SET_TARIFF':
      return { ...state, tariffType: action.value }
    case 'SET_EXISTING':
      return { ...state, existing: action.value }
    case 'SET_MOTIVATION':
      return { ...state, motivation: action.value }
    case 'SET_BUDGET':
      return { ...state, budgetBandId: action.value }
    case 'SET_FINANCE':
      return { ...state, financeInterest: action.value }
    case 'NEXT': {
      const max = visibleSteps(state).length - 1
      return { ...state, stepIndex: Math.min(state.stepIndex + 1, max) }
    }
    case 'BACK':
      return { ...state, stepIndex: Math.max(state.stepIndex - 1, 0) }
    case 'GOTO':
      return { ...state, stepIndex: Math.max(0, action.stepIndex) }
    default:
      return state
  }
}
