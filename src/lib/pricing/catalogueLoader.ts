import { prisma } from '@/lib/db'
import type {
  CatalogueBattery,
  CatalogueExtra,
  CatalogueInverter,
  CatalogueMounting,
  CataloguePanel,
  CataloguePvBasePrice,
  CatalogueTrenching,
  PricingCatalogue,
  ProductTier,
  RoofType,
} from './types'

const CACHE_TTL_MS = 5 * 60 * 1000

/** Fallback catalogue version stamped on quotes when an installer has none set. */
export const CATALOGUE_VERSION = '2026-01'

interface CacheEntry {
  catalogue: PricingCatalogue
  loadedAt: number
}

// Keyed by installerId so each tenant's catalogue is cached independently.
const _cache = new Map<string, CacheEntry>()

// The default (single active) installer id, resolved lazily for legacy callers
// that don't yet carry an installer context. New journey code passes installerId.
let _defaultInstallerId: { id: string; loadedAt: number } | null = null

async function resolveDefaultInstallerId(): Promise<string> {
  if (_defaultInstallerId && Date.now() - _defaultInstallerId.loadedAt < CACHE_TTL_MS) {
    return _defaultInstallerId.id
  }
  const installer = await prisma.installer.findFirst({
    where: { status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (!installer) {
    throw new Error('No active installer found — run `npx tsx prisma/seed.ts` to seed one.')
  }
  _defaultInstallerId = { id: installer.id, loadedAt: Date.now() }
  return installer.id
}

/**
 * Load a single installer's pricing catalogue (5-min in-memory cache per tenant).
 * Pass `installerId` explicitly from new code; legacy callers may omit it, in
 * which case the single active installer is used.
 */
export async function loadCatalogue(installerId?: string): Promise<PricingCatalogue> {
  const id = installerId ?? (await resolveDefaultInstallerId())

  const cached = _cache.get(id)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.catalogue
  }

  const [installer, panels, inverters, pvBasePrice, mounting, batteries, extras, trenching] =
    await Promise.all([
      prisma.installer.findUnique({ where: { id }, select: { catalogueVersion: true } }),
      prisma.pricingPanel.findMany({ where: { installerId: id, isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
      prisma.pricingInverter.findMany({ where: { installerId: id, isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
      prisma.pricingPvBasePrice.findMany({ where: { installerId: id }, orderBy: { panelCount: 'asc' } }),
      prisma.pricingMounting.findMany({ where: { installerId: id, isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
      prisma.pricingBattery.findMany({ where: { installerId: id, isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
      prisma.pricingExtra.findMany({ where: { installerId: id, isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
      prisma.pricingTrenching.findMany({ where: { installerId: id }, orderBy: [{ surface: 'asc' }, { metresFrom: 'asc' }] }),
    ])

  const catalogue: PricingCatalogue = {
    version: installer?.catalogueVersion ?? CATALOGUE_VERSION,
    panels: panels.map(
      (p): CataloguePanel => ({
        sku: p.sku,
        modelName: p.modelName,
        manufacturer: p.manufacturer,
        wattPeak: p.wattPeak,
        widthMm: p.widthMm,
        heightMm: p.heightMm,
        depthMm: p.depthMm,
        upliftType: p.upliftType as CataloguePanel['upliftType'],
        upliftValue: p.upliftValue,
        productTier: p.productTier as ProductTier,
        isBase: p.isBase,
        sortOrder: p.sortOrder,
      }),
    ),
    inverters: inverters.map(
      (inv): CatalogueInverter => ({
        sku: inv.sku,
        modelName: inv.modelName,
        manufacturer: inv.manufacturer,
        ratedKw: inv.ratedKw,
        efficiency: inv.efficiency,
        productTier: inv.productTier as ProductTier,
        priceGbp: inv.priceGbp,
        isDefault: inv.isDefault,
        sortOrder: inv.sortOrder,
      }),
    ),
    pvBasePrice: pvBasePrice.map(
      (r): CataloguePvBasePrice => ({
        panelCount: r.panelCount,
        kwp: r.kwp,
        priceGbp: r.priceGbp,
      }),
    ),
    mounting: mounting.map(
      (m): CatalogueMounting => ({
        sku: m.sku,
        label: m.label,
        pricePerPanel: m.pricePerPanel,
        appliesTo: m.appliesTo as RoofType,
        isDefault: m.isDefault,
        sortOrder: m.sortOrder,
      }),
    ),
    batteries: batteries.map(
      (b): CatalogueBattery => ({
        sku: b.sku,
        modelName: b.modelName,
        tier: b.tier as CatalogueBattery['tier'],
        baseCapacityKwh: b.baseCapacityKwh,
        priceWithSolar: b.priceWithSolar,
        priceRetrofit: b.priceRetrofit,
        expansionSku: b.expansionSku,
        expansionCapacityKwh: b.expansionCapacityKwh,
        expansionPriceGbp: b.expansionPriceGbp,
        expansionMaxUnits: b.expansionMaxUnits,
        multiUnitDiscountGbp: b.multiUnitDiscountGbp,
        sortOrder: b.sortOrder,
      }),
    ),
    extras: extras.map(
      (e): CatalogueExtra => ({
        sku: e.sku,
        category: e.category as CatalogueExtra['category'],
        label: e.label,
        priceCalc: e.priceCalc as CatalogueExtra['priceCalc'],
        baseGbp: e.baseGbp,
        perPanelGbp: e.perPanelGbp,
        panelThreshold: e.panelThreshold,
        isMandatory: e.isMandatory,
        exclusiveGroup: e.exclusiveGroup,
        sortOrder: e.sortOrder,
      }),
    ),
    trenching: trenching.map(
      (t): CatalogueTrenching => ({
        sku: t.sku,
        surface: t.surface as 'soft' | 'hard',
        metresFrom: t.metresFrom,
        metresTo: t.metresTo,
        perMetreGbp: t.perMetreGbp,
        fixedFeeGbp: t.fixedFeeGbp,
        isBespoke: t.isBespoke,
        sortOrder: t.sortOrder,
      }),
    ),
  }

  _cache.set(id, { catalogue, loadedAt: Date.now() })
  return catalogue
}

/** Invalidate the in-memory cache — used by admin tooling. Pass an installerId to scope. */
export function invalidateCatalogueCache(installerId?: string): void {
  if (installerId) _cache.delete(installerId)
  else _cache.clear()
  _defaultInstallerId = null
}
