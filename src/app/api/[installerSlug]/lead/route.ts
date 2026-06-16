import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { resolveInstaller } from '@/lib/tenant/resolveInstaller'
import { scoreLead } from '@/lib/lead/scoreLead'
import { deliverLead } from '@/lib/lead/deliver'
import { DEFAULT_ANNUAL_KWH } from '@/lib/consumption'

const OptionSchema = z
  .object({
    kind: z.string(),
    label: z.string(),
    panelCount: z.number(),
    systemKwp: z.number(),
    priceGbp: z.number(),
    batteryType: z.string().nullable().optional(),
    results: z.object({ paybackYears: z.number(), annualSavingsPounds: z.number() }).passthrough(),
    sentinel: z.object({ enabled: z.boolean(), upliftPercent: z.number() }).passthrough(),
  })
  .passthrough()

const Body = z.object({
  outcome: z.enum(['report', 'survey']),
  surveyType: z.enum(['remote', 'onsite', 'installer_choice']).nullable().optional(),
  contact: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().nullable().optional(),
    addressRaw: z.string(),
    postcode: z.string(),
    preferredContact: z.string().nullable().optional(),
    bestTime: z.string().nullable().optional(),
    comments: z.string().nullable().optional(),
    consent: z.boolean(),
  }),
  journey: z.object({
    uprn: z.string().nullable().optional(),
    roof: z.object({
      confidence: z.enum(['high', 'medium', 'low']),
      maxPanelCount: z.number(),
      kwpPotential: z.number(),
    }),
    propertyType: z.string(),
    ownership: z.string(),
    usage: z.object({
      source: z.string().nullable(),
      annualKwh: z.number().nullable(),
      monthlyCostGbp: z.number().nullable(),
    }),
    tariffType: z.string().nullable(),
    existing: z.string().nullable(),
    lifestyle: z.array(z.string()),
    motivation: z.string().nullable(),
    budgetBandId: z.string().nullable(),
    financeInterest: z.string().nullable(),
  }),
  optionSet: z.object({ recommendedId: z.string(), options: z.array(OptionSchema) }),
})
type BodyT = z.infer<typeof Body>

const EXISTING_MAP: Record<string, string> = {
  none: 'new', solar: 'upgrade', battery: 'retrofit', solar_battery: 'optimisation', unsure: 'new',
}

function lifestyleStatus(lifestyle: string[], now: string, planned: string): string {
  if (lifestyle.includes(now)) return 'now'
  if (lifestyle.includes(planned)) return 'planned'
  return 'none'
}

function esc(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
}

function buildEmailHtml(b: BodyT, band: string, reasons: string[], budgetMaxGbp: number): string {
  const c = b.contact
  const opts = b.optionSet.options
    .map(
      (o) =>
        `<tr><td>${esc(o.label)}</td><td>${o.panelCount}</td><td>${o.systemKwp} kWp</td><td>£${o.priceGbp.toLocaleString()}</td><td>${o.results.paybackYears.toFixed(1)} yrs</td><td>${o.sentinel.enabled ? `+${Math.round(o.sentinel.upliftPercent * 100)}%` : '—'}</td></tr>`,
    )
    .join('')
  const row = (k: string, v: string) => `<tr><td style="color:#666;padding:2px 12px 2px 0">${k}</td><td>${esc(v)}</td></tr>`
  return `
  <div style="font-family:system-ui,sans-serif;max-width:640px">
    <h2>New ${band.toUpperCase()} lead — ${esc(c.firstName)} ${esc(c.lastName)}</h2>
    <p style="color:#666">Source: SunScan Calculator · ${b.outcome === 'survey' ? `Survey requested (${b.surveyType ?? 'any'})` : 'Detailed report requested'}</p>
    <table style="border-collapse:collapse;font-size:14px">
      ${row('Email', c.email)}
      ${row('Phone', c.phone ?? '—')}
      ${row('Address', `${c.addressRaw} (${c.postcode})`)}
      ${row('Property', `${b.journey.propertyType} · ${b.journey.ownership}`)}
      ${row('Roof', `confidence ${b.journey.roof.confidence}, up to ${b.journey.roof.maxPanelCount} panels (${b.journey.roof.kwpPotential} kWp)`)}
      ${row('Usage', `${b.journey.usage.source ?? '—'} · ${b.journey.usage.annualKwh ?? '—'} kWh`)}
      ${row('Tariff', b.journey.tariffType ?? '—')}
      ${row('Budget', `up to £${budgetMaxGbp.toLocaleString()}`)}
      ${row('Motivation', b.journey.motivation ?? '—')}
      ${row('Preferred contact', `${c.preferredContact ?? '—'}${c.bestTime ? ` · ${c.bestTime}` : ''}`)}
      ${row('Lead score', `${band.toUpperCase()} — ${reasons.join(', ')}`)}
    </table>
    <h3>Options shown</h3>
    <table style="border-collapse:collapse;font-size:13px" border="1" cellpadding="6">
      <tr><th>Option</th><th>Panels</th><th>Size</th><th>Price</th><th>Payback</th><th>Sentinel</th></tr>
      ${opts}
    </table>
    ${c.comments ? `<p><b>Comments:</b> ${esc(c.comments)}</p>` : ''}
  </div>`
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ installerSlug: string }> },
) {
  const { installerSlug } = await params
  const installer = await resolveInstaller(installerSlug)
  if (!installer) return NextResponse.json({ error: 'unknown-installer' }, { status: 404 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 })
  }
  const b = parsed.data
  if (!b.contact.consent) {
    return NextResponse.json({ error: 'consent-required' }, { status: 400 })
  }
  const cfg = installer.config
  const j = b.journey

  const bands = (cfg?.budgetBandsJson as Array<{ id: string; maxGbp: number }> | undefined) ?? []
  const budgetMaxGbp = bands.find((x) => x.id === j.budgetBandId)?.maxGbp ?? 30000

  const reportRequested = b.outcome === 'report'
  const surveyRequested = b.outcome === 'survey'

  const { score, band, reasons } = scoreLead({
    ownership: j.ownership,
    propertyType: j.propertyType,
    hasUprn: !!j.uprn,
    roofConfidence: j.roof.confidence,
    maxPanelCount: j.roof.maxPanelCount,
    usageSource: j.usage.source ?? 'household',
    budgetMaxGbp,
    reportRequested,
    surveyRequested,
    hasPhone: !!b.contact.phone,
    lifestyle: j.lifestyle,
  })

  const sentinelShown = b.optionSet.options.some((o) => o.sentinel.enabled)
  const paybacks = b.optionSet.options.map((o) => ({
    kind: o.kind,
    paybackYears: o.results.paybackYears,
    sentinelUpliftPercent: o.sentinel.upliftPercent,
  }))

  // Persist first — a delivery failure must never lose the lead.
  const lead = await prisma.lead.create({
    data: {
      installerId: installer.id,
      leadSource: installerSlug,
      firstName: b.contact.firstName,
      lastName: b.contact.lastName,
      email: b.contact.email,
      phone: b.contact.phone ?? null,
      addressRaw: b.contact.addressRaw,
      postcode: b.contact.postcode,
      uprn: j.uprn ?? null,
      propertyType: j.propertyType,
      ownership: j.ownership,
      permissionFlag: j.ownership === 'rent' || j.ownership === 'social',
      roofConfidence: j.roof.confidence,
      maxPanelCount: j.roof.maxPanelCount,
      systemSizePotentialKwp: j.roof.kwpPotential,
      usageSource: j.usage.source ?? 'household',
      annualKwh: j.usage.annualKwh ?? DEFAULT_ANNUAL_KWH,
      monthlyCostGbp: j.usage.monthlyCostGbp ?? null,
      tariffType: j.tariffType ?? 'unknown',
      existingSolar: EXISTING_MAP[j.existing ?? 'none'] ?? 'new',
      evStatus: lifestyleStatus(j.lifestyle, 'ev_now', 'ev_planned'),
      heatPumpStatus: lifestyleStatus(j.lifestyle, 'heatpump_now', 'heatpump_planned'),
      lifestyleTags: j.lifestyle,
      motivation: j.motivation ?? null,
      budgetBandId: j.budgetBandId ?? 'unsure',
      financeInterest: ['yes', 'maybe', 'learn_more'].includes(j.financeInterest ?? ''),
      optionsJson: b.optionSet.options as unknown as Prisma.InputJsonValue,
      recommendedOptionId: b.optionSet.recommendedId,
      sentinelShown,
      paybacksJson: paybacks as unknown as Prisma.InputJsonValue,
      reportRequested,
      surveyRequested,
      surveyType: b.surveyType ?? null,
      preferredContact: b.contact.preferredContact ?? null,
      bestTime: b.contact.bestTime ?? null,
      comments: b.contact.comments ?? null,
      consent: b.contact.consent,
      leadScore: band,
      leadScoreReasons: reasons,
    },
  })

  const webhookPayload = {
    event: 'lead.created',
    leadId: lead.id,
    installer: installer.slug,
    leadSource: 'SunScan Calculator',
    score: band,
    scoreValue: score,
    outcome: b.outcome,
    surveyType: b.surveyType ?? null,
    contact: b.contact,
    property: { type: j.propertyType, ownership: j.ownership },
    roof: j.roof,
    usage: j.usage,
    tariffType: j.tariffType,
    budgetBandId: j.budgetBandId,
    recommendedOptionId: b.optionSet.recommendedId,
    options: b.optionSet.options.map((o) => ({
      kind: o.kind,
      panelCount: o.panelCount,
      systemKwp: o.systemKwp,
      priceGbp: o.priceGbp,
      paybackYears: o.results.paybackYears,
      sentinelUpliftPercent: o.sentinel.upliftPercent,
    })),
    createdAt: lead.createdAt.toISOString(),
  }

  const delivery = await deliverLead({
    leadId: lead.id,
    notificationEmail: cfg?.notificationEmail ?? installer.branding?.contactEmail ?? '',
    emailSubject: `New ${band.toUpperCase()} lead — ${b.contact.firstName} ${b.contact.lastName} (${b.contact.postcode})`,
    emailHtml: buildEmailHtml(b, band, reasons, budgetMaxGbp),
    replyTo: b.contact.email,
    webhook: { url: cfg?.crmWebhookUrl ?? null, secret: cfg?.crmWebhookSecret ?? null },
    webhookPayload,
  })

  return NextResponse.json({
    ok: true,
    leadId: lead.id,
    band,
    delivery: {
      emailSent: delivery.emailSent,
      emailSkipped: delivery.emailSkipped,
      webhookAttempts: delivery.webhookAttempts.length,
    },
  })
}
