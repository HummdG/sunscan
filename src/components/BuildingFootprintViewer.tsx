'use client'

import { useRef, useCallback } from 'react'
import { Camera } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { RoofAspect } from '@/lib/types'

interface BuildingFootprintViewerProps {
  polygonLocalM: [number, number][]
  source: 'os_ngd' | 'estimated'
  roofAspect?: RoofAspect
  onCapture?: (dataUrl: string) => void
}

function shoelaceArea(poly: [number, number][]): number {
  let area = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % n]
    area += x1 * z2 - x2 * z1
  }
  return Math.abs(area) / 2
}

const SVG_W = 600
const SVG_H = 360
const PADDING = 48

type DirKey = keyof RoofAspect
const DIRS: { key: DirKey; angle: number; label: string; solar: boolean }[] = [
  { key: 'n',  angle: -Math.PI / 2,         label: 'N',  solar: false },
  { key: 'ne', angle: -Math.PI / 4,         label: 'NE', solar: false },
  { key: 'e',  angle: 0,                    label: 'E',  solar: false },
  { key: 'se', angle: Math.PI / 4,          label: 'SE', solar: true  },
  { key: 's',  angle: Math.PI / 2,          label: 'S',  solar: true  },
  { key: 'sw', angle: (3 * Math.PI) / 4,    label: 'SW', solar: true  },
  { key: 'w',  angle: Math.PI,              label: 'W',  solar: false },
  { key: 'nw', angle: -(3 * Math.PI) / 4,   label: 'NW', solar: false },
]

function RoofAspectCompass({ aspect, cx, cy }: { aspect: RoofAspect; cx: number; cy: number }) {
  const MAX_R = 44
  const maxVal = Math.max(...Object.values(aspect) as number[], 1)

  return (
    <g>
      <circle cx={cx} cy={cy} r={MAX_R + 24} fill="white" fillOpacity="0.92" stroke="#e2e8f0" strokeWidth="1" />
      <text x={cx} y={cy - MAX_R - 13} textAnchor="middle" fontSize="8.5" fill="#64748b" fontFamily="system-ui, sans-serif" fontWeight="600" letterSpacing="0.05em">
        ROOF ASPECTS (m²)
      </text>
      {[0.33, 0.67, 1].map(f => (
        <circle key={f} cx={cx} cy={cy} r={MAX_R * f} fill="none" stroke="#e8edf2" strokeWidth="0.5" />
      ))}
      {DIRS.map(({ key, angle, label, solar }) => {
        const val = aspect[key] as number
        const r = val > 0 ? (val / maxVal) * MAX_R : 0
        const guideX = cx + MAX_R * Math.cos(angle)
        const guideY = cy + MAX_R * Math.sin(angle)
        const barX = cx + r * Math.cos(angle)
        const barY = cy + r * Math.sin(angle)
        const lx = cx + (MAX_R + 14) * Math.cos(angle)
        const ly = cy + (MAX_R + 14) * Math.sin(angle)
        return (
          <g key={key}>
            <line x1={cx} y1={cy} x2={guideX} y2={guideY} stroke="#e8edf2" strokeWidth="0.5" />
            {r > 0 && (
              <line x1={cx} y1={cy} x2={barX} y2={barY}
                stroke={solar ? '#f59e0b' : '#94a3b8'}
                strokeWidth="7"
                strokeLinecap="round"
              />
            )}
            <text x={lx} y={ly + 3.5} textAnchor="middle" fontSize="8"
              fill={solar ? '#d97706' : '#94a3b8'}
              fontFamily="system-ui, sans-serif"
              fontWeight={solar ? '700' : '400'}
            >
              {label}
            </text>
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={3} fill="#1e3a5f" />
    </g>
  )
}

export function BuildingFootprintViewer({
  polygonLocalM,
  source,
  roofAspect,
  onCapture,
}: BuildingFootprintViewerProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  const xs = polygonLocalM.map(([x]) => x)
  const zs = polygonLocalM.map(([, z]) => z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const rangeX = maxX - minX || 1
  const rangeZ = maxZ - minZ || 1

  const innerW = SVG_W - PADDING * 2
  const innerH = SVG_H - PADDING * 2
  const scale = Math.min(innerW / rangeX, innerH / rangeZ)
  const offsetX = PADDING + (innerW - rangeX * scale) / 2
  const offsetZ = PADDING + (innerH - rangeZ * scale) / 2

  // local X=east → SVG X right; local Z=south → SVG Y down (north is up)
  const toSvg = ([x, z]: [number, number]): string =>
    `${offsetX + (x - minX) * scale},${offsetZ + (z - minZ) * scale}`

  const points = polygonLocalM.map(toSvg).join(' ')
  const areaM2 = shoelaceArea(polygonLocalM)

  const handleCapture = useCallback(() => {
    if (!svgRef.current || !onCapture) return
    const serializer = new XMLSerializer()
    const svgStr = serializer.serializeToString(svgRef.current)
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = SVG_W
      canvas.height = SVG_H
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#f8fafc'
      ctx.fillRect(0, 0, SVG_W, SVG_H)
      ctx.drawImage(img, 0, 0)
      onCapture(canvas.toDataURL('image/png'))
    }
    img.src = dataUrl
  }, [onCapture])

  return (
    <div
      className="relative w-full rounded-xl overflow-hidden border border-slate-200"
      style={{ height: 360 }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        width="100%"
        height="100%"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect width={SVG_W} height={SVG_H} fill="#f8fafc" />
        <defs>
          <pattern id="fp-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={SVG_W} height={SVG_H} fill="url(#fp-grid)" />

        {/* Building footprint */}
        <polygon
          points={points}
          fill="#dbeafe"
          stroke="#2563eb"
          strokeWidth="2"
          strokeLinejoin="round"
        />

        {/* North arrow */}
        <g transform={`translate(${SVG_W - 38}, 38)`}>
          <circle r="22" fill="white" stroke="#cbd5e1" strokeWidth="1.5" />
          <text textAnchor="middle" y="-5" fontSize="10" fontWeight="700" fill="#1e3a5f" fontFamily="system-ui, sans-serif">N</text>
          <polygon points="0,-16 3.5,-5 -3.5,-5" fill="#1e3a5f" />
          <polygon points="0,16 3.5,5 -3.5,5" fill="#94a3b8" />
        </g>

        {/* Roof aspect compass — bottom-left corner */}
        {roofAspect && (
          <RoofAspectCompass aspect={roofAspect} cx={80} cy={SVG_H - 82} />
        )}

        {/* Area label */}
        <text
          x={roofAspect ? SVG_W / 2 : 14}
          y={SVG_H - 12}
          textAnchor={roofAspect ? 'middle' : 'start'}
          fontSize="11"
          fill="#64748b"
          fontFamily="system-ui, sans-serif"
        >
          {areaM2.toFixed(0)} m² footprint
        </text>
      </svg>

      {/* Source badge */}
      <div
        className={`absolute top-3 left-3 text-xs px-2.5 py-0.5 rounded-full font-medium border ${
          source === 'os_ngd'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-amber-50 text-amber-700 border-amber-200'
        }`}
      >
        {source === 'os_ngd' ? 'OS NGD Data' : 'Estimated'}
      </div>

      {onCapture && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-3 right-3 gap-1.5 shadow-sm"
          onClick={handleCapture}
        >
          <Camera className="h-4 w-4" />
          Capture View
        </Button>
      )}
    </div>
  )
}
