'use client'

import type { PanelLayout } from '@/types/solar'

interface SolarPanelMeshProps {
  layout: PanelLayout
  panelWidthM: number
  panelHeightM: number
}

export function SolarPanelMesh({ layout, panelWidthM, panelHeightM }: SolarPanelMeshProps) {
  return (
    <>
      {layout.panels.map((panel, i) => (
        <mesh
          key={i}
          position={panel.position}
          rotation={[panel.pitchRad, Math.PI - panel.rotationY, 0]}
          castShadow
        >
          <boxGeometry args={[panelWidthM, 0.03, panelHeightM]} />
          <meshStandardMaterial color="#1a1a3e" roughness={0.4} metalness={0.2} />
        </mesh>
      ))}
    </>
  )
}
