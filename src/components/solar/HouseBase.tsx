'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import type { Solar3DModel } from '@/types/solar'

interface HouseBaseProps {
  model: Solar3DModel
}

export function HouseBase({ model }: HouseBaseProps) {
  const { buildingBounds: b, wallHeightM } = model
  const wallW = Math.abs(b.maxX - b.minX)
  const wallD = Math.abs(b.maxZ - b.minZ)
  const cx    = (b.minX + b.maxX) / 2
  const cz    = (b.minZ + b.maxZ) / 2

  return (
    <mesh position={[cx, wallHeightM / 2, cz]} castShadow receiveShadow>
      <boxGeometry args={[wallW, wallHeightM, wallD]} />
      <meshStandardMaterial color="#E8E4DC" roughness={0.8} />
    </mesh>
  )
}

interface HouseBaseExtrudedProps {
  footprintLocal: [number, number][]
  wallHeightM: number
}

export function HouseBaseExtruded({ footprintLocal, wallHeightM }: HouseBaseExtrudedProps) {
  const geometry = useMemo(() => {
    // Remove duplicate closing vertex if present
    const pts = (
      footprintLocal.length > 1 &&
      footprintLocal[0][0] === footprintLocal[footprintLocal.length - 1][0] &&
      footprintLocal[0][1] === footprintLocal[footprintLocal.length - 1][1]
    ) ? footprintLocal.slice(0, -1) : footprintLocal

    // Shape in XY plane: x = local_x (east), y = -local_z so that after
    // rotateX(-π/2) the footprint maps to world XZ with +z = south ✓
    const shape = new THREE.Shape()
    shape.moveTo(pts[0][0], -pts[0][1])
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], -pts[i][1])
    shape.closePath()

    const geo = new THREE.ExtrudeGeometry(shape, { depth: wallHeightM, bevelEnabled: false })
    // rotateX(-π/2): shape_x→world_x, shape_y→world_-z→world_z (via negation above), extrude→world_y
    geo.rotateX(-Math.PI / 2)
    return geo
  }, [footprintLocal, wallHeightM])

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color="#E8E4DC" roughness={0.8} />
    </mesh>
  )
}
