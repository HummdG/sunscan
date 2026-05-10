import { prisma } from '@/lib/db'
import type {
  CatalogueBattery,
  CatalogueExtra,
  CatalogueMounting,
  CataloguePanel,
  CataloguePvBasePrice,
  CatalogueTrenching,
  PricingCatalogue,
  RoofType,
} from './types'

const CACHE_TTL_MS = 5 * 60 * 1000
let _cache: { catalogue: PricingCatalogue; loadedAt: number } | null = null

export const CATALOGUE_VERSION = '2026-01'

export async function loadCatalogue(): Promise<PricingCatalogue> {
  if (_cache && Date.now() - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache.catalogue
  }

  const [panels, pvBasePrice, mounting, batteries, extras, trenching] = await Promise.all([
    prisma.pricingPanel.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
    prisma.pricingPvBasePrice.findMany({ orderBy: { panelCount: 'asc' } }),
    prisma.pricingMounting.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
    prisma.pricingBattery.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
    prisma.pricingExtra.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }] }),
    prisma.pricingTrenching.findMany({ orderBy: [{ surface: 'asc' }, { metresFrom: 'asc' }] }),
  ])

  const catalogue: PricingCatalogue = {
    version: CATALOGUE_VERSION,
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
        isBase: p.isBase,
        sortOrder: p.sortOrder,
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

  _cache = { catalogue, loadedAt: Date.now() }
  return catalogue
}

/** Invalidate the in-memory cache — used by admin tooling. */
export function invalidateCatalogueCache(): void {
  _cache = null
}
