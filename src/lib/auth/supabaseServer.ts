import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

/**
 * Supabase client for Server Components / Route Handlers. In Next 16 `cookies()`
 * is async. Writes from a Server Component are swallowed (the middleware refresh
 * handles token rotation); Route Handlers can write cookies normally.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  return createServerClient(URL, KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component render — ignore; middleware refreshes the session.
        }
      },
    },
  })
}
