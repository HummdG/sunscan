import * as THREE from 'three'

/**
 * Assign each triangle in `geometry` its own square slot in a grid atlas and
 * write the corresponding UVs. The triangle occupies the lower-left half of
 * its slot — vertex 0 → (0, 0), vertex 1 → (1, 0), vertex 2 → (0, 1) within
 * the slot's UV range.
 *
 * Guarantees non-overlapping UVs without any external library. Slot size is
 * picked so all triangles fit in a √N × √N grid. A small inset (~1 texel)
 * keeps neighbour slot bleed at zero when the atlas is sampled with linear
 * filtering.
 *
 * The returned geometry is non-indexed (one triangle = 3 unique vertices)
 * because each vertex's UV is slot-specific.
 */
export function applySlotAtlas(geometry: THREE.BufferGeometry, atlasSize = 2048): THREE.BufferGeometry {
  // Operate on a non-indexed clone so each triangle owns its three vertices.
  const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  flat.clearGroups()

  const pos = flat.getAttribute('position') as THREE.BufferAttribute
  const triCount = pos.count / 3
  const grid = Math.max(1, Math.ceil(Math.sqrt(triCount)))
  // Slot size in atlas-UV units, with a 1-texel inset for filter safety.
  const slot = 1 / grid
  const inset = 1 / atlasSize  // one texel
  const usable = slot - 2 * inset

  const uv = new Float32Array(pos.count * 2)
  for (let t = 0; t < triCount; t++) {
    const sx = t % grid
    const sy = Math.floor(t / grid)
    const u0 = sx * slot + inset
    const v0 = sy * slot + inset

    // Triangle vertices land at slot-relative (0,0), (1,0), (0,1)
    uv[(t * 3 + 0) * 2 + 0] = u0
    uv[(t * 3 + 0) * 2 + 1] = v0
    uv[(t * 3 + 1) * 2 + 0] = u0 + usable
    uv[(t * 3 + 1) * 2 + 1] = v0
    uv[(t * 3 + 2) * 2 + 0] = u0
    uv[(t * 3 + 2) * 2 + 1] = v0 + usable
  }

  flat.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return flat
}
