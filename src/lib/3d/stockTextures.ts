import * as THREE from 'three'
import type { BuildingSpec } from './buildingSpec'

type WallFamily = BuildingSpec['materials']['wallTexture']
type RoofFamily = BuildingSpec['materials']['roofTexture']

const wallFiles: Record<WallFamily, string> = {
  'brick':       '/textures/brick-tileable.jpg',
  'render':      '/textures/render-tileable.jpg',
  'stone':       '/textures/stone-tileable.jpg',
  'timber':      '/textures/timber-tileable.jpg',
  'pebble-dash': '/textures/pebble-dash-tileable.jpg',
  // 'mixed' uses the render texture as a generic neutral
  'mixed':       '/textures/render-tileable.jpg',
}

const roofFiles: Record<RoofFamily, string> = {
  'tile':      '/textures/tile-tileable.jpg',
  'slate':     '/textures/slate-tileable.jpg',
  'thatch':    '/textures/thatch-tileable.jpg',
  'metal':     '/textures/metal-tileable.jpg',
  'flat-felt': '/textures/slate-tileable.jpg',  // visually close enough
}

const cache = new Map<string, Promise<THREE.Texture>>()

async function loadTexture(url: string): Promise<THREE.Texture> {
  const cached = cache.get(url)
  if (cached) return cached
  const loader = new THREE.TextureLoader()
  const p = new Promise<THREE.Texture>((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.colorSpace = THREE.SRGBColorSpace
        resolve(tex)
      },
      undefined,
      () => {
        // Asset missing — return a 1×1 white texture so tinting still works
        const data = new Uint8Array([255, 255, 255, 255])
        const fallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
        fallback.needsUpdate = true
        resolve(fallback)
      },
    )
  })
  cache.set(url, p)
  return p
}

export async function getWallTexture(family: WallFamily): Promise<THREE.Texture> {
  return loadTexture(wallFiles[family])
}

export async function getRoofTexture(family: RoofFamily): Promise<THREE.Texture> {
  return loadTexture(roofFiles[family])
}
