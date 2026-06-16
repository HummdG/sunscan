import type { Installer, InstallerUser } from '@prisma/client'
import { prisma } from '@/lib/db'
import { createSupabaseServerClient } from './supabaseServer'

export type InstallerSession = InstallerUser & { installer: Installer }

/**
 * The signed-in installer user, resolved from the Supabase session email to an
 * InstallerUser row. Returns null when not authenticated OR authenticated but
 * not linked to any installer. Lazily backfills authUserId on first login.
 */
export async function getInstallerSession(): Promise<InstallerSession | null> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return null

  const installerUser = await prisma.installerUser.findUnique({
    where: { email: user.email.toLowerCase() },
    include: { installer: true },
  })
  if (!installerUser) return null

  if (!installerUser.authUserId) {
    await prisma.installerUser
      .update({ where: { id: installerUser.id }, data: { authUserId: user.id } })
      .catch(() => {})
  }
  return installerUser
}
