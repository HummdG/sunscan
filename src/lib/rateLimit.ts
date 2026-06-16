import { NextResponse } from 'next/server'

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export interface RateLimitOptions {
  key: string
  limit: number
  windowMs: number
}

/**
 * In-memory fixed-window rate limit (per client IP, per key). Returns a 429
 * NextResponse when the limit is exceeded, otherwise null. Best-effort and
 * per-process — a backstop against abuse on public endpoints, not a hard quota.
 */
export function rateLimit(req: Request, opts: RateLimitOptions): NextResponse | null {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'local'
  const k = `${opts.key}:${ip}`
  const now = Date.now()
  const b = buckets.get(k)

  if (!b || now > b.resetAt) {
    buckets.set(k, { count: 1, resetAt: now + opts.windowMs })
    return null
  }
  if (b.count >= opts.limit) {
    return NextResponse.json(
      { error: 'rate-limited' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((b.resetAt - now) / 1000)) } },
    )
  }
  b.count += 1
  return null
}
