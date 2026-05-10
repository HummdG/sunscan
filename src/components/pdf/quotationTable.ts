// Helpers to render a QuoteBreakdown as PDF table rows.

import type { LineItemCategory, QuoteBreakdown } from '@/lib/pricing/types'

export interface QuotationRow {
  kind: 'category-header' | 'item' | 'subtotal'
  label: string
  qty?: string
  unit?: string
  total?: string
}

const CATEGORY_LABELS: Record<LineItemCategory, string> = {
  pv: 'Solar PV system',
  panel_uplift: 'Panel uplift',
  mounting: 'Mounting',
  battery: 'Battery storage',
  scaffold: 'Scaffolding',
  electrical: 'General & electrical',
  optional: 'Optional extras',
  trenching: 'Cable trenching',
  admin: 'Administration',
}

const CATEGORY_ORDER: LineItemCategory[] = [
  'pv',
  'panel_uplift',
  'mounting',
  'battery',
  'scaffold',
  'electrical',
  'optional',
  'trenching',
  'admin',
]

export function formatGbp(n: number): string {
  return `£${n.toLocaleString('en-GB')}`
}

/**
 * Group line items by category and emit:
 *   - one category-header row per non-empty category
 *   - one item row per line in that category
 *
 * Preserves the input order within each category.
 */
export function lineItemsToRows(quote: QuoteBreakdown): QuotationRow[] {
  const grouped = new Map<LineItemCategory, typeof quote.lineItems>()
  for (const item of quote.lineItems) {
    if (!grouped.has(item.category)) grouped.set(item.category, [])
    grouped.get(item.category)!.push(item)
  }

  const rows: QuotationRow[] = []
  for (const cat of CATEGORY_ORDER) {
    const items = grouped.get(cat)
    if (!items || items.length === 0) continue
    rows.push({ kind: 'category-header', label: CATEGORY_LABELS[cat] })
    for (const item of items) {
      rows.push({
        kind: 'item',
        label: item.label,
        qty: item.quantity > 1 ? `${item.quantity}` : '1',
        unit: formatGbp(item.unitGbp),
        total: formatGbp(item.totalGbp),
      })
    }
  }
  return rows
}
