'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import type { EnrichedRoofPlane } from '@/types/solar'

interface RoofPlaneMeshProps {
  plane: EnrichedRoofPlane
  color: string
  showLabel?: boolean
}

export function RoofPlaneMesh({ plane, color, showLabel = false }: RoofPlaneMeshProps) {
  const geometry = useMemo(() => {
    const { polygon, azimuthDegrees, pitchDegrees, heightM, refX, refZ } = plane

    // Remove closing vertex from closed ring
    const ring: [number, number][] = (
      polygon.length > 1 &&
      polygon[0][0] === polygon[polygon.length - 1][0] &&
      polygon[0][1] === polygon[polygon.length - 1][1]
    ) ? polygon.slice(0, -1) as [number, number][] : polygon as [number, number][]

    const azRad = (azimuthDegrees * Math.PI) / 180
    const pitchRad = (pitchDegrees * Math.PI) / 180

    // Downhill unit vector in XZ local space
    const faceX = Math.sin(azRad)
    const faceZ = -Math.cos(azRad)

    const n = ring.length
    const cx = ring.reduce((s, p) => s + p[0], 0) / n
    const cz = ring.reduce((s, p) => s + p[1], 0) / n

    // Use original segment centre as the stable height reference point
    const rX = refX ?? cx
    const rZ = refZ ?? cz

    const getY = (vx: number, vz: number): number => {
      const faceProj = (vx - rX) * faceX + (vz - rZ) * faceZ
      return heightM - faceProj * Math.tan(pitchRad)
    }

    // Proper triangulation via ShapeUtils — handles non-convex polygons correctly
    const contour = ring.map(([vx, vz]) => new THREE.Vector2(vx, vz))
    const triangles = THREE.ShapeUtils.triangulateShape(contour, [])

    const positions = new Float32Array(triangles.length * 9)
    for (let t = 0; t < triangles.length; t++) {
      const [ia, ib, ic] = triangles[t]
      const base = t * 9
      const [ax, az] = ring[ia]; const [bx, bz] = ring[ib]; const [dx, dz] = ring[ic]
      positions[base + 0] = ax; positions[base + 1] = getY(ax, az); positions[base + 2] = az
      positions[base + 3] = bx; positions[base + 4] = getY(bx, bz); positions[base + 5] = bz
      positions[base + 6] = dx; positions[base + 7] = getY(dx, dz); positions[base + 8] = dz
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.computeVertexNormals()
    return geo
  }, [plane])

  const labelPos = useMemo((): [number, number, number] => {
    const ring = plane.polygon.slice(0, -1) as [number, number][]
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length
    return [cx, plane.heightM + 0.5, cz]
  }, [plane])

  return (
    <>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color={color} side={THREE.DoubleSide} roughness={0.7} />
      </mesh>
      {showLabel && (
        <group position={labelPos}>
          {/* Label rendering delegated to parent via showLabel prop */}
        </group>
      )}
    </>
  )
}
