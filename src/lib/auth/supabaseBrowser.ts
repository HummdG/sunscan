import { createBrowserClient } from '@supabase/ssr'

/** Supabase client for client components (magic-link sign-in, sign-out). */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
