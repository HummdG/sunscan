import type { PricingContext, SystemConfig, Tier } from './types'

const KWH_PER_KWP_UK = 950 // typical UK annual yield

const TIER_DEMAND_FACTOR: Record<Exclude<Tier, 'custom'>, number> = {
  essential: 0.5,
  standard: 0.7,
  premium: 0.9,
}

/**
 * Choose a target panel count from annual demand:
 *   target_kWp = (annualKwh × demandFactor) / 950 kWh/kWp
 *   panel_count = ceil(target_kWp × 1000 / panelW)
 * Then clamp to [6, roofMaxPanels].
 */
function targetPanelCountForTier(
  ctx: PricingContext,
  basePanelW: number,
  tier: Exclude<Tier, 'custom'>,
): number {
  const targetKwh = ctx.annualKwh * TIER_DEMAND_FACTOR[tier]
  const targetKwp = targetKwh / KWH_PER_KWP_UK
  const rawCount = Math.ceil((targetKwp * 1000) / basePanelW)
  const capped = Math.min(rawCount, ctx.roofMaxPanels)
  return Math.max(6, capped)
}

function defaultMountingSku(ctx: PricingContext): string {
  const match = ctx.catalogue.mounting.find(
    (m) => m.appliesTo === ctx.roofType && m.isDefault,
  )
  if (match) return match.sku
  // Fall back to any mounting matching roof type
  const fallback = ctx.catalogue.mounting.find((m) => m.appliesTo === ctx.roofType)
  if (fallback) return fallback.sku
  // Final fallback
  return ctx.catalogue.mounting[0]?.sku ?? 'MOUNT-PITCHED-TILE'
}

function panelSku(ctx: PricingContext, sku: string): string {
  const match = ctx.catalogue.panels.find((p) => p.sku === sku)
  if (match) return match.sku
  // If preferred panel isn't in catalogue, fall back to base panel
  const base = ctx.catalogue.panels.find((p) => p.isBase)
  return base?.sku ?? ctx.catalogue.panels[0]?.sku ?? 'DMEGC-DM430'
}

/**
 * Build the three preset tier configurations for a given context.
 * All three tiers are sized to fit the roof and customer demand.
 */
export function buildTierPresets(ctx: PricingContext): Record<Exclude<Tier, 'custom'>, SystemConfig> {
  const basePanel = ctx.catalogue.panels.find((p) => p.isBase)
  const basePanelW = basePanel?.wattPeak ?? 430
  const mounting = defaultMountingSku(ctx)

  const essentialPanels = targetPanelCountForTier(ctx, basePanelW, 'essential')
  const standardPanels = targetPanelCountForTier(ctx, basePanelW, 'standard')
  const premiumPanels = targetPanelCountForTier(ctx, basePanelW, 'premium')

  const essential: SystemConfig = {
    tier: 'essential',
    panelSku: panelSku(ctx, 'DMEGC-DM430'),
    panelCount: essentialPanels,
    mountingSku: mounting,
    battery: null,
    scaffoldingExtras: [],
    electricalExtras: [],
    optionalExtras: [],
    trenching: null,
    birdMesh: false,
    optimiserScope: 'none',
  }

  const standard: SystemConfig = {
    tier: 'standard',
    panelSku: panelSku(ctx, 'DMEGC-DM430'),
    panelCount: standardPanels,
    mountingSku: mounting,
    battery: { sku: 'FOX-EC2900', expansionUnits: 0, isRetrofit: false },
    scaffoldingExtras: [],
    electricalExtras: [],
    optionalExtras: [],
    trenching: null,
    birdMesh: false,
    optimiserScope: 'full',
  }

  const premium: SystemConfig = {
    tier: 'premium',
    panelSku: panelSku(ctx, 'REA-HD96-460'),
    panelCount: premiumPanels,
    mountingSku: mounting,
    battery: { sku: 'FOX-EVO-1024', expansionUnits: 0, isRetrofit: false },
    scaffoldingExtras: [],
    electricalExtras: [],
    optionalExtras: [{ sku: 'EPS-FOX', quantity: 1 }],
    trenching: null,
    birdMesh: true,
    optimiserScope: 'full',
  }

  return { essential, standard, premium }
}

const ESSENTIAL_INCLUSIONS = [
  'Mono-facial 430W panels (DMEGC)',
  'Default inverter & isolators',
  'Mounting kit & fixings',
  'Installation & DNO application',
]

const STANDARD_INCLUSIONS = [
  'Mono-facial 430W panels (DMEGC)',
  'Fox ESS EC2900 5.8 kWh battery',
  'Tigo TSA-04 optimisers (full system)',
  'Default inverter & isolators',
  'Mounting kit & fixings',
  'Installation & DNO application',
]

const PREMIUM_INCLUSIONS = [
  'Bifacial 460W panels (REA HD96)',
  'Fox ESS EVO All-in-One 10.24 kWh battery',
  'Tigo TSA-04 optimisers (full system)',
  'EnviroGuard bird-proofing mesh',
  'Fox ESS EPS Whole-Home Backup',
  'Mounting kit & fixings',
  'Installation & DNO application',
]

export function inclusionsForTier(tier: Exclude<Tier, 'custom'>): string[] {
  if (tier === 'essential') return ESSENTIAL_INCLUSIONS
  if (tier === 'standard') return STANDARD_INCLUSIONS
  return PREMIUM_INCLUSIONS
}
