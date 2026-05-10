import React from 'react'
import { Svg, G, Rect, Path, Line, Polyline, Text as SvgText } from '@react-pdf/renderer'

// Cream palette — matches PDF ReportDocument and the web design tokens.
const NAVY  = '#B04020' // terracotta brand (kept name for diff minimalism)
const GOLD  = '#D97706' // deep amber accent
const GREEN = '#5A7842' // olive — environmental
const MUTED = '#B19068' // sun-faded ochre — axis text & inactive segments
const GRID  = '#DECB99' // warm divider — chart grid lines
const TEXT  = '#5C3A24' // coffee — primary chart text

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// react-pdf SVGTextProps omits fontSize/fontFamily — extend via wrapper
type TProps = {
  x: number | string
  y: number | string
  fontSize?: number
  fontFamily?: string
  fill?: string
  textAnchor?: 'start' | 'middle' | 'end'
  children: React.ReactNode
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function T({ children, ...rest }: TProps) {
  return <SvgText {...(rest as any)}>{children}</SvgText>
}

// ─── Monthly Generation Bar Chart ─────────────────────────────────────────────

export function PdfMonthlyGenChart({ monthlyKwh }: { monthlyKwh: number[] }) {
  const W = 460, H = 148
  const padL = 46, padR = 8, padT = 8, padB = 24
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const maxVal = Math.max(...monthlyKwh, 1)
  const yMax = Math.ceil(maxVal / 50) * 50

  const slotW = plotW / 12
  const barW = slotW * 0.65

  const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map(f => ({
    val: Math.round(yMax * f),
    y: padT + plotH * (1 - f),
  }))

  return (
    <Svg width={W} height={H}>
      {yTicks.map((t, i) => (
        <Line key={i}
          x1={padL} y1={t.y} x2={padL + plotW} y2={t.y}
          stroke={i === 0 ? MUTED : GRID}
          strokeWidth={i === 0 ? 0.8 : 0.4}
        />
      ))}

      {yTicks.slice(1).map((t, i) => (
        <T key={i} x={padL - 4} y={t.y + 3} fontSize={7} fill={MUTED} textAnchor="end">
          {t.val}
        </T>
      ))}

      {monthlyKwh.map((v, i) => {
        const barH = Math.max((v / yMax) * plotH, 0)
        const x = padL + i * slotW + (slotW - barW) / 2
        const y = padT + plotH - barH
        return <Rect key={i} x={x} y={y} width={barW} height={Math.max(barH, 0.5)} fill={GOLD} rx={2} />
      })}

      {MONTHS.map((m, i) => (
        <T key={m} x={padL + i * slotW + slotW / 2} y={padT + plotH + 14} fontSize={7} fill={MUTED} textAnchor="middle">
          {m}
        </T>
      ))}

      <Line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={MUTED} strokeWidth={0.8} />
      <Line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke={MUTED} strokeWidth={0.8} />
    </Svg>
  )
}

// ─── Self-Consumption Donut ───────────────────────────────────────────────────

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function donutArcPath(cx: number, cy: number, R: number, r: number, startDeg: number, endDeg: number): string {
  const safeDeg = Math.min(endDeg, startDeg + 359.9)
  const s = polarToXY(cx, cy, R, startDeg)
  const e = polarToXY(cx, cy, R, safeDeg)
  const si = polarToXY(cx, cy, r, startDeg)
  const ei = polarToXY(cx, cy, r, safeDeg)
  const large = safeDeg - startDeg > 180 ? 1 : 0
  return [
    `M ${s.x.toFixed(2)} ${s.y.toFixed(2)}`,
    `A ${R} ${R} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`,
    `L ${ei.x.toFixed(2)} ${ei.y.toFixed(2)}`,
    `A ${r} ${r} 0 ${large} 0 ${si.x.toFixed(2)} ${si.y.toFixed(2)}`,
    'Z',
  ].join(' ')
}

export function PdfSelfConsumptionDonut({ selfKwh, exportKwh }: { selfKwh: number; exportKwh: number }) {
  const total = selfKwh + exportKwh || 1
  const selfFrac = Math.max(0.01, Math.min(0.99, selfKwh / total))
  const selfDeg = selfFrac * 360
  const cx = 78, cy = 70, R = 58, r = 33
  const W = 260, H = 148

  const legX = 152, legY = 32

  return (
    <Svg width={W} height={H}>
      <Path d={donutArcPath(cx, cy, R, r, 0, selfDeg)} fill={GREEN} />
      <Path d={donutArcPath(cx, cy, R, r, selfDeg, 360)} fill={MUTED} />

      <T x={cx} y={cy - 5} fontSize={14} fontFamily="Helvetica-Bold" fill={NAVY} textAnchor="middle">
        {(selfFrac * 100).toFixed(0)}%
      </T>
      <T x={cx} y={cy + 9} fontSize={7} fill={MUTED} textAnchor="middle">self-used</T>

      <Rect x={legX} y={legY} width={9} height={9} fill={GREEN} rx={2} />
      <T x={legX + 13} y={legY + 8} fontSize={8} fill={TEXT}>Self-consumed</T>
      <T x={legX + 13} y={legY + 19} fontSize={8} fill={MUTED}>{selfKwh.toLocaleString()} kWh</T>

      <Rect x={legX} y={legY + 32} width={9} height={9} fill={MUTED} rx={2} />
      <T x={legX + 13} y={legY + 40} fontSize={8} fill={TEXT}>Exported to grid</T>
      <T x={legX + 13} y={legY + 51} fontSize={8} fill={MUTED}>{exportKwh.toLocaleString()} kWh</T>
    </Svg>
  )
}

// ─── Cumulative 25-Year Savings Line Chart ────────────────────────────────────

export function PdfCumulativeSavingsChart({ savings }: { savings: { year: number; cumulative: number }[] }) {
  if (savings.length === 0) return null
  const W = 460, H = 148
  const padL = 52, padR = 8, padT = 8, padB = 24
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const values = savings.map(s => s.cumulative)
  const minVal = Math.min(...values)
  const maxVal = Math.max(...values)
  const range = maxVal - minVal || 1

  const toX = (year: number) => padL + ((year - 1) / (savings.length - 1)) * plotW
  const toY = (val: number) => padT + plotH - ((val - minVal) / range) * plotH

  const points = savings.map(s => `${toX(s.year).toFixed(1)},${toY(s.cumulative).toFixed(1)}`).join(' ')
  const zeroY = toY(0)
  const showZeroLine = zeroY >= padT && zeroY <= padT + plotH

  const yTicks = Array.from({ length: 5 }, (_, i) => ({
    val: minVal + (i / 4) * (maxVal - minVal),
    y: padT + (1 - i / 4) * plotH,
  }))

  const formatY = (v: number) => {
    if (v < 0) return `-£${Math.abs(v / 1000).toFixed(0)}k`
    if (Math.abs(v / 1000) >= 1) return `£${(v / 1000).toFixed(0)}k`
    return `£${Math.round(v)}`
  }

  const xTicks = [5, 10, 15, 20, 25]

  return (
    <Svg width={W} height={H}>
      {yTicks.map((t, i) => (
        <Line key={i} x1={padL} y1={t.y} x2={padL + plotW} y2={t.y} stroke={GRID} strokeWidth={0.4} />
      ))}

      {showZeroLine && (
        <Line x1={padL} y1={zeroY} x2={padL + plotW} y2={zeroY}
          stroke={NAVY} strokeWidth={1} strokeDasharray="4 2" />
      )}

      <Polyline points={points} fill="none" stroke={GREEN} strokeWidth={2} />

      {yTicks.map((t, i) => (
        <T key={i} x={padL - 4} y={t.y + 3} fontSize={7} fill={MUTED} textAnchor="end">
          {formatY(t.val)}
        </T>
      ))}

      {xTicks.map(yr => (
        <T key={yr} x={toX(yr)} y={padT + plotH + 14} fontSize={7} fill={MUTED} textAnchor="middle">
          Yr {yr}
        </T>
      ))}

      <Line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={MUTED} strokeWidth={0.8} />
      <Line x1={padL} y1={padT + plotH} x2={padL + plotW} y2={padT + plotH} stroke={MUTED} strokeWidth={0.8} />
    </Svg>
  )
}

// ─── Bill Savings Comparison Bar Chart ───────────────────────────────────────

export function PdfBillSavingsChart({ before, after }: { before: number; after: number }) {
  const W = 380, H = 76
  const padL = 90, padR = 62, padT = 8, padB = 8
  const plotW = W - padL - padR
  const barH = 22, gap = 8

  const maxVal = Math.max(before, after, 1)

  const bars = [
    { label: 'Without solar', val: before, fill: MUTED, y: padT },
    { label: 'With solar', val: Math.max(after, 0), fill: GREEN, y: padT + barH + gap },
  ]

  return (
    <Svg width={W} height={H}>
      {bars.map(b => {
        const bW = Math.max((b.val / maxVal) * plotW, 4)
        return (
          <G key={b.label}>
            <T x={padL - 6} y={b.y + barH - 7} fontSize={8} fill={NAVY} textAnchor="end">
              {b.label}
            </T>
            <Rect x={padL} y={b.y} width={bW} height={barH} fill={b.fill} rx={3} />
            <T x={padL + bW + 6} y={b.y + barH - 7} fontSize={9} fontFamily="Helvetica-Bold" fill={TEXT}>
              £{Math.round(b.val).toLocaleString()}
            </T>
          </G>
        )
      })}
    </Svg>
  )
}
