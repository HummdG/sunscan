import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/auth/supabaseServer'

/** Magic-link callback: exchange the code for a session, then land on /admin. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/admin'

  if (code) {
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
  }
  return NextResponse.redirect(`${origin}/admin/login?error=auth`)
}
