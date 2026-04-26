'use client'

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  LineChart, Line, ReferenceLine, PieChart, Pie, Cell, Legend,
} from 'recharts'
import type { PieLabelRenderProps } from 'recharts'

const NAVY = '#1E3A5F'
const GOLD = '#F59E0B'
const GREEN = '#10B981'
const MUTED = '#94A3B8'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// ─── Monthly generation bar chart ─────────────────────────────────────────────

export function MonthlyGenChart({ monthlyKwh }: { monthlyKwh: number[] }) {
  const data = MONTHS.map((month, i) => ({ month, kWh: monthlyKwh[i] ?? 0 }))
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: MUTED }} />
        <YAxis tick={{ fontSize: 11, fill: MUTED }} unit=" kWh" width={60} />
        <Tooltip
          formatter={(v) => [`${v ?? 0} kWh`, 'Generation']}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Bar dataKey="kWh" fill={GOLD} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── Self-consumption donut ───────────────────────────────────────────────────

const renderPieLabel = ({ name, percent }: PieLabelRenderProps) =>
  `${name ?? ''} ${(((percent as number | undefined) ?? 0) * 100).toFixed(0)}%`

export function SelfConsumptionDonut({
  selfConsumptionKwh,
  exportKwh,
}: {
  selfConsumptionKwh: number
  exportKwh: number
}) {
  const data = [
    { name: 'Self-consumed', value: selfConsumptionKwh },
    { name: 'Exported to grid', value: exportKwh },
  ]
  return (
    <ResponsiveContainer width="100%" height={200}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={80}
          dataKey="value"
          label={renderPieLabel}
          labelLine={false}
        >
          <Cell fill={GREEN} />
          <Cell fill={MUTED} />
        </Pie>
        <Tooltip
          formatter={(v) => [`${v ?? 0} kWh`]}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ─── 25-year cumulative savings ───────────────────────────────────────────────

export function CumulativeSavingsChart({
  savings,
}: {
  savings: { year: number; cumulative: number }[]
  systemCost: number
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={savings} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
        <XAxis
          dataKey="year"
          tick={{ fontSize: 11, fill: MUTED }}
          label={{ value: 'Year', position: 'insideBottom', offset: -2, fontSize: 11, fill: MUTED }}
        />
        <YAxis
          tick={{ fontSize: 11, fill: MUTED }}
          tickFormatter={(v) => `£${(v / 1000).toFixed(0)}k`}
          width={55}
        />
        <Tooltip
          formatter={(v) => [`£${(v as number ?? 0).toLocaleString()}`, 'Cumulative Net Saving']}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <ReferenceLine y={0} stroke={NAVY} strokeDasharray="4 2" strokeWidth={1.5} />
        <Line
          type="monotone"
          dataKey="cumulative"
          stroke={GREEN}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 5, fill: GREEN }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Bill comparison ──────────────────────────────────────────────────────────

export function BillSavingsChart({
  annualBillBefore,
  annualBillAfter,
}: {
  annualBillBefore: number
  annualBillAfter: number
  annualSavings: number
}) {
  const data = [
    { label: 'Without solar', amount: Math.round(annualBillBefore) },
    { label: 'With solar', amount: Math.round(annualBillAfter) },
  ]
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 80, bottom: 4 }}>
        <XAxis type="number" tickFormatter={(v) => `£${v}`} tick={{ fontSize: 11, fill: MUTED }} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: NAVY }} width={80} />
        <Tooltip
          formatter={(v) => [`£${v ?? 0}`, 'Annual bill']}
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
        />
        <Bar dataKey="amount" radius={[0, 4, 4, 0]}>
          <Cell fill={MUTED} />
          <Cell fill={GREEN} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
