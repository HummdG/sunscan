// Minimal Resend client over the REST API (no SDK dependency).
// Gracefully no-ops when RESEND_API_KEY is absent so the lead pipeline still
// persists + webhooks without email configured.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'SunScan <onboarding@resend.dev>'

export interface EmailMessage {
  to: string
  subject: string
  html: string
  from?: string
  replyTo?: string
}

export interface EmailResult {
  sent: boolean
  skipped?: boolean
  id?: string
  error?: string
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { sent: false, skipped: true, error: 'RESEND_API_KEY not set' }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: msg.from ?? process.env.RESEND_FROM ?? DEFAULT_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
      }),
    })
    if (!res.ok) {
      return { sent: false, error: `Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}` }
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string }
    return { sent: true, id: data?.id }
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
