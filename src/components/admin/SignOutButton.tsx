'use client'

import { useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/auth/supabaseBrowser'

export function SignOutButton() {
  const [loading, setLoading] = useState(false)
  async function signOut() {
    setLoading(true)
    await createSupabaseBrowserClient().auth.signOut()
    window.location.href = '/admin/login'
  }
  return (
    <button
      onClick={signOut}
      disabled={loading}
      className="ss-mono text-[10px] uppercase transition disabled:opacity-40"
      style={{ letterSpacing: '0.18em', color: 'var(--ss-t3)' }}
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
