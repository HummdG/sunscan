import { prisma } from '@/lib/db'
import { sendEmail } from '@/lib/email/resend'
import { deliverWebhook, type WebhookAttempt } from './webhook'

export interface DeliverLeadParams {
  leadId: string
  notificationEmail: string
  emailSubject: string
  emailHtml: string
  replyTo?: string
  webhook: { url: string | null; secret: string | null }
  webhookPayload: unknown
}

export interface DeliverLeadResult {
  emailSent: boolean
  emailSkipped: boolean
  emailError?: string
  webhookAttempts: WebhookAttempt[]
}

/**
 * Deliver a persisted lead to the installer: email notification + signed CRM
 * webhook. The Lead row must already exist (persist-first) so a delivery
 * failure never loses the lead. Records emailSentAt + WebhookDelivery rows.
 * Never throws.
 */
export async function deliverLead(params: DeliverLeadParams): Promise<DeliverLeadResult> {
  const email = await sendEmail({
    to: params.notificationEmail,
    subject: params.emailSubject,
    html: params.emailHtml,
    replyTo: params.replyTo,
  })

  if (email.sent) {
    await prisma.lead
      .update({ where: { id: params.leadId }, data: { emailSentAt: new Date() } })
      .catch(() => {})
  }

  let webhookAttempts: WebhookAttempt[] = []
  if (params.webhook.url) {
    webhookAttempts = await deliverWebhook(
      { url: params.webhook.url, secret: params.webhook.secret },
      params.webhookPayload,
    )
    for (const a of webhookAttempts) {
      await prisma.webhookDelivery
        .create({
          data: {
            leadId: params.leadId,
            url: params.webhook.url,
            attempt: a.attempt,
            status: a.status,
            httpStatus: a.httpStatus,
            responseBody: a.responseBody,
            signature: a.signature,
          },
        })
        .catch(() => {})
    }
  }

  return {
    emailSent: email.sent,
    emailSkipped: !!email.skipped,
    emailError: email.error,
    webhookAttempts,
  }
}
