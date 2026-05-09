'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { polygonPrincipalAxis } from '@/lib/geometry'

interface Props {
  footprintLocal: [number, number][]
  wallHeightM: number
  ridgeHeightM?: number
  pitchDeg?: number
}

export function RoofFromFootprintMesh({
  footprintLocal,
  wallHeightM,
  ridgeHeightM,
  pitchDeg = 30,
}: Props) {
  const geometries = useMemo(() => {
    // Remove closing vertex from GeoJSON-style closed ring
    const ring: [number, number][] = (
      footprintLocal.length > 1 &&
      footprintLocal[0][0] === footprintLocal[footprintLocal.length - 1][0] &&
      footprintLocal[0][1] === footprintLocal[footprintLocal.length - 1][1]
    ) ? footprintLocal.slice(0, -1) as [number, number][]
      : footprintLocal as [number, number][]

    const n = ring.length
    if (n < 3) return null

    const principalAngle = polygonPrincipalAxis(ring)
    let rdX = Math.cos(principalAngle)
    let rdZ = Math.sin(principalAngle)
    let pdX = -Math.sin(principalAngle)
    let pdZ = Math.cos(principalAngle)
    // Ensure the +p direction faces south (+z) so south face gets amber color
    if (pdZ < 0) { pdX = -pdX; pdZ = -pdZ }

    // Project footprint to ridge-aligned (r, p) space
    const rpVerts: [number, number][] = ring.map(([x, z]) => [
      x * rdX + z * rdZ,
      x * pdX + z * pdZ,
    ])

    let rMin = Infinity, rMax = -Infinity, pMin = Infinity, pMax = -Infinity
    for (const [r, p] of rpVerts) {
      if (r < rMin) rMin = r
      if (r > rMax) rMax = r
      if (p < pMin) pMin = p
      if (p > pMax) pMax = p
    }

    const rSpan = rMax - rMin
    const pSpan = pMax - pMin
    if (rSpan < 1 || pSpan < 1) return null

    const margin = rSpan * 0.12
    const pCenter = (pMin + pMax) / 2
    const pitchRad = (pitchDeg * Math.PI) / 180
    const pitchBasedRise = (pSpan / 2) * Math.tan(pitchRad)
    const ridgeRise = ridgeHeightM != null && (ridgeHeightM - wallHeightM) >= 1.5
      ? ridgeHeightM - wallHeightM
      : Math.max(pitchBasedRise, 0.5)

    function toWorld(r: number, p: number, y: number): [number, number, number] {
      return [r * rdX + p * pdX, y, r * rdZ + p * pdZ]
    }

    const southTris: number[] = []
    const northTris: number[] = []
    const hipTris: number[] = []
    const eaveTris: number[] = []

    function pushTri(
      buf: number[],
      a: [number, number, number],
      b: [number, number, number],
      c: [number, number, number],
    ) {
      buf.push(...a, ...b, ...c)
    }

    // Roof faces — one per polygon edge, sweeping eave → ridge
    for (let i = 0; i < n; i++) {
      const [r1, p1] = rpVerts[i]
      const [r2, p2] = rpVerts[(i + 1) % n]

      const eave1 = toWorld(r1, p1, wallHeightM)
      const eave2 = toWorld(r2, p2, wallHeightM)

      const ridgeR1 = Math.max(rMin + margin, Math.min(rMax - margin, r1))
      const ridgeR2 = Math.max(rMin + margin, Math.min(rMax - margin, r2))
      const ridge1 = toWorld(ridgeR1, pCenter, wallHeightM + ridgeRise)
      const ridge2 = toWorld(ridgeR2, pCenter, wallHeightM + ridgeRise)

      const avgP = (p1 + p2) / 2
      const pDelta = avgP - pCenter
      const buf = Math.abs(pDelta) < pSpan * 0.15 ? hipTris
        : pDelta > 0 ? southTris
        : northTris

      if (Math.abs(ridgeR1 - ridgeR2) < 0.01) {
        pushTri(buf, eave1, eave2, ridge1)
      } else {
        // Quad as two triangles
        pushTri(buf, eave1, eave2, ridge2)
        pushTri(buf, eave1, ridge2, ridge1)
      }
    }

    // Eave cap — flat polygon at wallHeightM (fan from centroid)
    const cx = ring.reduce((s, [x]) => s + x, 0) / n
    const cz = ring.reduce((s, [, z]) => s + z, 0) / n
    for (let i = 0; i < n; i++) {
      const [vx0, vz0] = ring[i]
      const [vx1, vz1] = ring[(i + 1) % n]
      pushTri(eaveTris, [cx, wallHeightM, cz], [vx0, wallHeightM, vz0], [vx1, wallHeightM, vz1])
    }

    function makeGeo(tris: number[]): THREE.BufferGeometry | null {
      if (tris.length === 0) return null
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3))
      geo.computeVertexNormals()
      return geo
    }

    return {
      south: makeGeo(southTris),
      north: makeGeo(northTris),
      hip:   makeGeo(hipTris),
      eave:  makeGeo(eaveTris),
    }
  }, [footprintLocal, wallHeightM, ridgeHeightM, pitchDeg])

  if (!geometries) return null

  return (
    <group>
      {geometries.south && (
        <mesh geometry={geometries.south} castShadow receiveShadow>
          <meshStandardMaterial color="#D97706" roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}
      {geometries.north && (
        <mesh geometry={geometries.north} castShadow receiveShadow>
          <meshStandardMaterial color="#94A3B8" roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}
      {geometries.hip && (
        <mesh geometry={geometries.hip} castShadow receiveShadow>
          <meshStandardMaterial color="#C8AE8A" roughness={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}
      {geometries.eave && (
        <mesh geometry={geometries.eave} receiveShadow>
          <meshStandardMaterial color="#E8E4DC" roughness={0.8} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}
