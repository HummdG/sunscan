'use client'

import * as THREE from 'three'
import { Html } from '@react-three/drei'
import type { LocalRoofSegment } from '@/types/solar'

function makeQuadGeo(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): THREE.BufferGeometry {
  const verts = new Float32Array([...a, ...b, ...c, ...a, ...c, ...d])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  geo.computeVertexNormals()
  return geo
}

function makeEdgesFromQuad(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  d: [number, number, number],
): THREE.BufferGeometry {
  const verts = new Float32Array([
    ...a, ...b,
    ...b, ...c,
    ...c, ...d,
    ...d, ...a,
    ...a, ...c,
  ])
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
  return geo
}

function azimuthLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45)]
}

function sunshineP50(quantiles: number[]): number {
  if (!quantiles?.length) return 0
  return quantiles[Math.floor(quantiles.length / 2)]
}

function computeCorners(seg: LocalRoofSegment): {
  corners: [[number,number,number],[number,number,number],[number,number,number],[number,number,number]]
  centerY: number
} {
  const azRad   = (seg.azimuthDeg * Math.PI) / 180
  const pitchRad = (seg.pitchDeg  * Math.PI) / 180

  const faceX  =  Math.sin(azRad)
  const faceZ  = -Math.cos(azRad)
  const ridgeX =  Math.cos(azRad)
  const ridgeZ =  Math.sin(azRad)

  const halfRise  = (seg.groundDepthM / 2) * Math.tan(pitchRad)
  const eaveY     = seg.heightAtCenterM - halfRise
  const ridgeY    = seg.heightAtCenterM + halfRise
  const eaveMidX  = seg.center.x + faceX * seg.groundDepthM / 2
  const eaveMidZ  = seg.center.z + faceZ * seg.groundDepthM / 2
  const ridgeMidX = seg.center.x - faceX * seg.groundDepthM / 2
  const ridgeMidZ = seg.center.z - faceZ * seg.groundDepthM / 2
  const hl = seg.ridgeLenM / 2

  return {
    corners: [
      [eaveMidX  - ridgeX * hl, eaveY,  eaveMidZ  - ridgeZ * hl],
      [eaveMidX  + ridgeX * hl, eaveY,  eaveMidZ  + ridgeZ * hl],
      [ridgeMidX + ridgeX * hl, ridgeY, ridgeMidZ + ridgeZ * hl],
      [ridgeMidX - ridgeX * hl, ridgeY, ridgeMidZ - ridgeZ * hl],
    ],
    centerY: seg.heightAtCenterM,
  }
}

interface RoofSegmentMeshProps {
  segment: LocalRoofSegment
  color: string
  showLabel: boolean
}

export function RoofSegmentMesh({ segment, color, showLabel }: RoofSegmentMeshProps) {
  const { corners, centerY } = computeCorners(segment)
  const mesh  = makeQuadGeo(...corners)
  const edges = makeEdgesFromQuad(...corners)

  return (
    <group>
      <mesh geometry={mesh} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.7} metalness={0.05} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#1e293b" linewidth={1} opacity={0.5} transparent />
      </lineSegments>
      {showLabel && (
        <Html
          position={[segment.center.x, centerY, segment.center.z]}
          center
          distanceFactor={12}
          style={{ pointerEvents: 'none' }}
        >
          <div className="bg-white/90 border border-slate-200 rounded px-1.5 py-1 text-[10px] leading-tight shadow-md whitespace-nowrap">
            <div className="font-semibold text-slate-800">
              {azimuthLabel(segment.azimuthDeg)} · {Math.round(segment.pitchDeg)}°
            </div>
            <div className="text-slate-500">{Math.round(segment.areaM2)} m²</div>
            <div className="text-amber-600">
              {Math.round(sunshineP50(segment.sunshineQuantiles)).toLocaleString()} hrs/yr
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}
