'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/auth/supabaseBrowser'

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const supabase = createSupabaseBrowserClient()
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/admin` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--ss-ink)', color: 'var(--ss-t1)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-8"
        style={{ background: 'var(--ss-s1)', border: '1px solid var(--ss-border)' }}
      >
        <p
          className="ss-mono text-[11px] uppercase"
          style={{ letterSpacing: '0.24em', color: 'var(--ss-t4)' }}
        >
          SunScan · Installer
        </p>
        <h1 className="ss-heading mt-2 text-2xl font-semibold tracking-tight">Leads dashboard</h1>

        {sent ? (
          <p className="mt-6 text-sm" style={{ color: 'var(--ss-t2)' }}>
            Check your inbox — we&apos;ve sent a secure sign-in link to{' '}
            <strong>{email}</strong>.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span
                className="ss-mono text-[10px] uppercase"
                style={{ letterSpacing: '0.18em', color: 'var(--ss-t4)' }}
              >
                Work email
              </span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@installer.co.uk"
                className="mt-1 w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                style={{
                  background: 'var(--ss-ink)',
                  border: '1px solid var(--ss-border-h)',
                  color: 'var(--ss-t1)',
                }}
              />
            </label>
            {error ? (
              <p className="text-xs" role="alert" style={{ color: '#b04020' }}>
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={loading || !email}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-40"
              style={{ background: 'var(--ss-blue)' }}
            >
              {loading ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
