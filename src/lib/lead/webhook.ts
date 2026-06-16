import crypto from 'node:crypto'

// Signed CRM webhook delivery: HMAC-SHA256 over the JSON body, with retry +
// per-attempt records for the WebhookDelivery audit table.

export interface WebhookTarget {
  url: string
  secret: string | null
}

export interface WebhookAttempt {
  attempt: number
  status: 'success' | 'failed'
  httpStatus: number | null
  responseBody: string | null
  signature: string
}

export function signPayload(body: string, secret: string | null): string {
  if (!secret) return ''
  return crypto.createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * POST the payload to the installer's CRM webhook, retrying on failure with
 * linear backoff. Returns every attempt for logging. Never throws.
 */
export async function deliverWebhook(
  target: WebhookTarget,
  payload: unknown,
  maxAttempts = 3,
): Promise<WebhookAttempt[]> {
  const body = JSON.stringify(payload)
  const signature = signPayload(body, target.secret)
  const attempts: WebhookAttempt[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(target.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sunscan-Signature': signature,
          'X-Sunscan-Event': 'lead.created',
        },
        body,
      })
      const responseBody = (await res.text().catch(() => '')).slice(0, 500)
      const ok = res.ok
      attempts.push({ attempt, status: ok ? 'success' : 'failed', httpStatus: res.status, responseBody, signature })
      if (ok) break
    } catch (e) {
      attempts.push({
        attempt,
        status: 'failed',
        httpStatus: null,
        responseBody: (e instanceof Error ? e.message : 'request error').slice(0, 500),
        signature,
      })
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, 300 * attempt))
    }
  }

  return attempts
}
