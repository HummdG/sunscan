/**
 * Whether a postcode falls within an installer's served areas (outward-code
 * prefix match against InstallerConfig.coverageAreasJson). An empty/absent
 * coverage list means the installer serves everywhere.
 */
export function isInCoverage(postcode: string, coverageAreas: unknown): boolean {
  if (!Array.isArray(coverageAreas) || coverageAreas.length === 0) return true
  const cleaned = postcode.replace(/\s+/g, '').toUpperCase()
  const outward = cleaned.length > 3 ? cleaned.slice(0, cleaned.length - 3) : cleaned
  return coverageAreas.some(
    (a) => typeof a === 'string' && a.length > 0 && outward.startsWith(a.toUpperCase()),
  )
}
