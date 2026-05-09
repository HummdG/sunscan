'use client'

import * as THREE from 'three'
import { Html } from '@react-three/drei'
import type { Solar3DModel, LocalRoofSegment, HouseModel, EnrichedRoofPlane, PanelLayout } from '@/types/solar'
import { HouseBase, HouseBaseExtruded } from './HouseBase'
import { RoofSegmentMesh } from './RoofSegmentMesh'
import { RoofPlaneMesh } from './RoofPlaneMesh'
import { SolarPanelMesh } from './SolarPanelMesh'

function azimuthLabel(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
  return dirs[Math.round(((deg % 360) + 360) % 360 / 45)]
}

function planeLabelPos(plane: EnrichedRoofPlane): [number, number, number] {
  const ring = plane.polygon.length > 1 &&
    plane.polygon[0][0] === plane.polygon[plane.polygon.length - 1][0] &&
    plane.polygon[0][1] === plane.polygon[plane.polygon.length - 1][1]
    ? plane.polygon.slice(0, -1) as [number, number][]
    : plane.polygon as [number, number][]
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length
  return [cx, plane.heightM + 0.3, cz]
}

function heatmapColor(value: number, min: number, max: number): string {
  const t = max > min ? (value - min) / (max - min) : 0
  const lo = new THREE.Color('#64748B')
  const hi = new THREE.Color('#F59E0B')
  const c = lo.clone().lerp(hi, t)
  return `#${c.getHexString()}`
}

function segmentColor(
  seg: LocalRoofSegment,
  mode: 'model' | 'heatmap' | 'panels',
  sunNorm: number,
): string {
  if (mode === 'heatmap') return heatmapColor(sunNorm, 0, 1)
  const mcsOri = Math.abs(seg.azimuthDeg - 180)
  if (mcsOri < 45)  return '#D97706'
  if (mcsOri > 135) return '#94A3B8'
  return '#C8AE8A'
}

function planeColor(
  plane: EnrichedRoofPlane,
  mode: 'model' | 'heatmap' | 'panels',
  sunNorm: number,
): string {
  if (!plane.usable) return '#94A3B8'
  if (mode === 'heatmap') return heatmapColor(sunNorm, 0, 1)
  const mcsOri = Math.abs(plane.azimuthDegrees - 180)
  if (mcsOri < 45)  return '#D97706'
  if (mcsOri > 135) return '#94A3B8'
  return '#C8AE8A'
}

interface SolarModelViewerBaseProps {
  mode: 'model' | 'heatmap' | 'panels'
  panelLayouts?: PanelLayout[]
  panelWidthM?: number
  panelHeightM?: number
  showLabels: boolean
}

type SolarModelViewerProps =
  | (SolarModelViewerBaseProps & {
      model: Solar3DModel
      footprintLocal?: [number, number][]
      wallHeightM?: number
      houseModel?: never
    })
  | (SolarModelViewerBaseProps & { houseModel: HouseModel; model?: never })

export function SolarModelViewer({
  mode,
  panelLayouts,
  panelWidthM = 1.0,
  panelHeightM = 1.65,
  showLabels,
  ...rest
}: SolarModelViewerProps) {
  if ('houseModel' in rest && rest.houseModel) {
    const houseModel = rest.houseModel
    const sunshineValues = houseModel.roofPlanes.map(plane => {
      const q = plane.sunshineQuantiles
      return q && q.length ? q[Math.floor(q.length / 2)] : 0
    })
    const sunMin = Math.min(...sunshineValues, 0)
    const sunMax = Math.max(...sunshineValues, 1)

    return (
      <>
        <HouseBaseExtruded
          footprintLocal={houseModel.footprintLocal}
          wallHeightM={houseModel.wallHeightM}
        />
        {houseModel.roofPlanes.map((plane, i) => {
          const sunNorm = sunMax > sunMin ? (sunshineValues[i] - sunMin) / (sunMax - sunMin) : 0
          const q = plane.sunshineQuantiles
          const sunHrs = q && q.length ? q[Math.floor(q.length / 2)] : null
          return (
            <group key={plane.id}>
              <RoofPlaneMesh
                plane={plane}
                color={planeColor(plane, mode, sunNorm)}
                showLabel={false}
              />
              {showLabels && (
                <Html position={planeLabelPos(plane)} center distanceFactor={12} style={{ pointerEvents: 'none' }}>
                  <div className="bg-white/90 border border-slate-200 rounded px-1.5 py-1 text-[10px] leading-tight shadow-md whitespace-nowrap">
                    <div className="font-semibold text-slate-800">
                      {azimuthLabel(plane.azimuthDegrees)} · {Math.round(plane.pitchDegrees)}°
                    </div>
                    <div className="text-slate-500">{Math.round(plane.areaM2)} m²</div>
                    {sunHrs !== null && (
                      <div className="text-amber-600">{Math.round(sunHrs).toLocaleString()} hrs/yr</div>
                    )}
                  </div>
                </Html>
              )}
            </group>
          )
        })}
        {mode === 'panels' && panelLayouts && panelLayouts.map((layout, i) => (
          <SolarPanelMesh
            key={i}
            layout={layout}
            panelWidthM={panelWidthM}
            panelHeightM={panelHeightM}
          />
        ))}
      </>
    )
  }

  const { model, footprintLocal, wallHeightM } = rest as { model: Solar3DModel; footprintLocal?: [number,number][]; wallHeightM?: number }
  const sunshineValues = model.segments.map(seg => {
    const q = seg.sunshineQuantiles
    return q.length ? q[Math.floor(q.length / 2)] : 0
  })
  const sunMin = Math.min(...sunshineValues, 0)
  const sunMax = Math.max(...sunshineValues, 1)

  return (
    <>
      {footprintLocal && footprintLocal.length >= 3 ? (
        <HouseBaseExtruded footprintLocal={footprintLocal} wallHeightM={wallHeightM ?? model.wallHeightM} />
      ) : (
        <HouseBase model={model} />
      )}
      {model.segments.map((seg, i) => {
        const sunNorm = sunMax > sunMin ? (sunshineValues[i] - sunMin) / (sunMax - sunMin) : 0
        return (
          <RoofSegmentMesh
            key={i}
            segment={seg}
            color={segmentColor(seg, mode, sunNorm)}
            showLabel={showLabels}
          />
        )
      })}
      {mode === 'panels' && panelLayouts && panelLayouts.map((layout, i) => (
        <SolarPanelMesh
          key={i}
          layout={layout}
          panelWidthM={panelWidthM}
          panelHeightM={panelHeightM}
        />
      ))}
    </>
  )
}
