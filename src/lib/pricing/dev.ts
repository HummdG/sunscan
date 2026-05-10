// Dev verification harness — eyeballs tier-preset totals against the 2026 pricelist
// Run with: npx tsx src/lib/pricing/dev.ts

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local', override: false })
loadEnv({ path: '.env', override: false })

import { loadCatalogue } from './catalogueLoader'
import { computeQuote } from './computeQuote'
import { buildTierPresets } from './tiers'
import type { PricingContext } from './types'

function formatGbp(n: number): string {
  return `£${n.toLocaleString('en-GB')}`
}

async function main() {
  const catalogue = await loadCatalogue()
  console.log(`Catalogue version ${catalogue.version}`)
  console.log(
    `  ${catalogue.panels.length} panels · ${catalogue.batteries.length} batteries · ` +
      `${catalogue.extras.length} extras · ${catalogue.mounting.length} mounting · ` +
      `${catalogue.pvBasePrice.length} pv prices · ${catalogue.trenching.length} trench tiers`,
  )

  const ctx: PricingContext = {
    catalogue,
    roofMaxPanels: 24,
    annualKwh: 4500,
    roofType: 'pitched',
  }

  const presets = buildTierPresets(ctx)

  for (const tier of ['essential', 'standard', 'premium'] as const) {
    const config = presets[tier]
    const quote = computeQuote(config, ctx)
    console.log(
      `\n── ${tier.toUpperCase()} ── ${config.panelCount} × panels (${config.panelSku}) → ${formatGbp(
        quote.totalPounds,
      )}`,
    )
    for (const item of quote.lineItems) {
      const qtyStr = item.quantity > 1 ? `${item.quantity}× ` : '   '
      console.log(`  ${qtyStr}${item.label.padEnd(60)} ${formatGbp(item.totalGbp)}`)
    }
    for (const w of quote.warnings) {
      console.log(`  ⚠  ${w}`)
    }
  }

  // Sanity check: known cell — 14 panels DMEGC 430W base = £6,711
  const sanity = computeQuote(
    {
      tier: 'custom',
      panelSku: 'DMEGC-DM430',
      panelCount: 14,
      mountingSku: 'MOUNT-PITCHED-TILE',
      battery: null,
      scaffoldingExtras: [],
      electricalExtras: [],
      optionalExtras: [],
      trenching: null,
      birdMesh: false,
      optimiserScope: 'none',
    },
    ctx,
  )
  const expectedTotal = 6711 + 14 * 30 + 350 // PV base + mounting + admin
  console.log(
    `\nSanity check (14 panels DMEGC base + pitched mounting + admin): ${formatGbp(
      sanity.totalPounds,
    )} (expected ${formatGbp(expectedTotal)})`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
