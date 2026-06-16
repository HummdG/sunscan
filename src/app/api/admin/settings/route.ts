import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getInstallerSession } from '@/lib/auth/session'
import { invalidateInstallerCache } from '@/lib/tenant/resolveInstaller'
import { invalidateCatalogueCache } from '@/lib/pricing/catalogueLoader'

const Body = z.object({
  notificationEmail: z.string().email(),
  crmWebhookUrl: z.string().nullable().optional(),
  crmWebhookSecret: z.string().nullable().optional(),
  sentinelEnabled: z.boolean(),
  sentinelBaseUpliftPercent: z.number().min(0).max(0.5),
  marginPercent: z.number().min(0).max(1),
  budgetBands: z
    .array(z.object({ id: z.string(), label: z.string(), minGbp: z.number(), maxGbp: z.number() }))
    .optional(),
  branding: z.object({
    primaryColor: z.string(),
    accentColor: z.string(),
    companyTagline: z.string().nullable().optional(),
    contactEmail: z.string().nullable().optional(),
    logoUrl: z.string().nullable().optional(),
  }),
})

export async function POST(req: Request) {
  const session = await getInstallerSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const installerId = session.installerId

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 })
  }
  const b = parsed.data

  const existing = await prisma.installerConfig.findUnique({ where: { installerId } })
  const sentinelConfig = {
    ...((existing?.sentinelConfigJson as object | null) ?? {}),
    enabled: b.sentinelEnabled,
    baseUpliftPercent: b.sentinelBaseUpliftPercent,
  }

  await prisma.installerConfig.update({
    where: { installerId },
    data: {
      notificationEmail: b.notificationEmail,
      crmWebhookUrl: b.crmWebhookUrl ? b.crmWebhookUrl : null,
      crmWebhookSecret: b.crmWebhookSecret ? b.crmWebhookSecret : null,
      sentinelEnabled: b.sentinelEnabled,
      marginPercent: b.marginPercent,
      sentinelConfigJson: sentinelConfig as Prisma.InputJsonValue,
      ...(b.budgetBands ? { budgetBandsJson: b.budgetBands as Prisma.InputJsonValue } : {}),
    },
  })

  await prisma.installerBranding.update({
    where: { installerId },
    data: {
      primaryColor: b.branding.primaryColor,
      accentColor: b.branding.accentColor,
      companyTagline: b.branding.companyTagline ? b.branding.companyTagline : null,
      contactEmail: b.branding.contactEmail ? b.branding.contactEmail : null,
      logoUrl: b.branding.logoUrl ? b.branding.logoUrl : null,
    },
  })

  // Bust the per-process caches so edits take effect on the next request.
  invalidateInstallerCache(session.installer.slug)
  invalidateCatalogueCache(installerId)

  return NextResponse.json({ ok: true })
}
