import type { Installer, InstallerBranding, InstallerConfig } from '@prisma/client'
import { prisma } from '@/lib/db'

/** An installer with its config + branding eagerly loaded. */
export type ResolvedInstaller = Installer & {
  config: InstallerConfig | null
  branding: InstallerBranding | null
}

const CACHE_TTL_MS = 5 * 60 * 1000
const _cache = new Map<string, { installer: ResolvedInstaller; loadedAt: number }>()

/**
 * Resolve the active installer for a URL slug (e.g. `/hsenergy/...`).
 * Returns null for unknown or suspended installers — the caller should 404.
 * Cached in-memory for 5 minutes (mirrors the catalogue loader).
 */
export async function resolveInstaller(slug: string): Promise<ResolvedInstaller | null> {
  const cached = _cache.get(slug)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.installer
  }

  const installer = await prisma.installer.findUnique({
    where: { slug },
    include: { config: true, branding: true },
  })

  if (!installer || installer.status !== 'active') return null

  _cache.set(slug, { installer, loadedAt: Date.now() })
  return installer
}

/** Invalidate the resolver cache — used by admin tooling after config edits. */
export function invalidateInstallerCache(slug?: string): void {
  if (slug) _cache.delete(slug)
  else _cache.clear()
}
