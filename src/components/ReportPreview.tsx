'use client'

import { Download, Sun, Zap, Leaf, TrendingUp, Home, Battery } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { EstimatedBadge } from './EstimatedBadge'
import { RoofIsometricViewer } from './RoofIsometricViewer'
import { wgs84ToLocalMetres, polygonCentroid } from '@/lib/geometry'
import { selectOptimalPanelConfig } from '@/lib/googleSolarApi'
import {
  MonthlyGenChart,
  SelfConsumptionDonut,
  CumulativeSavingsChart,
  BillSavingsChart,
} from './ReportCharts'
import type { ReportData } from '@/lib/types'

interface ReportPreviewProps {
  data: ReportData
  pdfUrl?: string | null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function StatCard({
  icon: Icon,
  value,
  label,
  color,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  value: string
  label: string
  color?: string
}) {
  const accent = color ?? 'var(--ss-t1)'
  return (
    <div
      className="relative px-4 py-5 text-center"
      style={{
        background: 'var(--ss-ink)',
        border: '1px solid var(--ss-border-h)',
        borderRadius: 4,
      }}
    >
      <Icon className="h-8 w-8 mx-auto mb-2" style={{ color: accent }} />
      <div
        className="ss-heading text-2xl font-extrabold tracking-tight"
        style={{ color: accent }}
      >
        {value}
      </div>
      <div
        className="ss-mono text-[10px] uppercase mt-2"
        style={{ letterSpacing: '0.18em', color: 'var(--ss-t3)' }}
      >
        {label}
      </div>
    </div>
  )
}

export function ReportPreview({ data }: ReportPreviewProps) {
  const isEstimatedBill = data.billSource === 'default'
  const isEstimatedFootprint = data.footprintSource === 'estimated'

  // Parse footprint — use Google Solar building centre when available so segment
  // centers (also computed from that origin) align with the footprint polygon.
  const solarInsights = data.solarApiData ?? undefined
  let polygonLocalM: [number, number][] | null = null
  if (data.footprintGeojson) {
    try {
      const geojson = JSON.parse(data.footprintGeojson) as { type: string; coordinates: number[][][] }
      const ring = geojson.coordinates[0] as [number, number][]
      const centre = solarInsights
        ? [solarInsights.center.longitude, solarInsights.center.latitude] as [number, number]
        : polygonCentroid(ring)
      polygonLocalM = wgs84ToLocalMetres(ring, centre)
    } catch {
      // geojson parse error — fall through to null
    }
  }

  const solarConfigs = solarInsights?.solarPotential.solarPanelConfigs ?? []
  const selectedPanelConfig = selectOptimalPanelConfig(solarConfigs, data.annualKwh, 0.04, 0.14) ?? undefined
  const annualBillBefore = (data.annualKwh * data.tariffPencePerKwh) / 100 + (data.standingChargePencePerDay * 365) / 100
  const annualBillAfter = annualBillBefore - data.results.annualSavingsPounds

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">

      <div className="rounded-2xl text-white p-8 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #B04020 0%, #8B3219 60%, #6B240F 100%)', boxShadow: '0 20px 60px rgba(120,40,15,0.25), 0 4px 12px rgba(120,40,15,0.15)' }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sun className="h-6 w-6 text-amber-400" />
              <span className="text-xl font-bold text-amber-400">SunScan</span>
            </div>
            <h1 className="text-2xl font-bold">{data.addressRaw}</h1>
            <p className="text-slate-300 mt-1 text-sm">
              Quote {data.quoteNumber} · {new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <a href={`/api/report/${data.id}/pdf`} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary" className="gap-2">
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
          </a>
        </div>

        {(isEstimatedBill || isEstimatedFootprint) && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/20 border border-amber-400/30 text-amber-200 text-sm">
            ⚠ Some values in this report are estimated:{' '}
            {isEstimatedBill && 'energy consumption (no bill provided). '}
            {isEstimatedFootprint && 'building footprint (OS data unavailable).'}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Recommended System</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard icon={Sun} value={`${data.systemSizeKw.toFixed(2)} kWp`} label="System Size" color="var(--ss-amber)" />
          <StatCard icon={Home} value={String(data.panelCount)} label="Solar Panels" />
          <StatCard icon={Zap} value={`${data.results.annualGenerationKwh.toLocaleString()} kWh`} label="Est. Annual Generation" color="var(--ss-blue)" />
          <StatCard icon={TrendingUp} value={`£${data.results.annualSavingsPounds.toLocaleString()}`} label="Est. Annual Savings" color="var(--ss-green)" />
          <StatCard icon={TrendingUp} value={`${data.results.paybackYears} yrs`} label="Payback Period" />
          <StatCard icon={Leaf} value={`${data.results.co2SavedTonnesPerYear} t`} label="CO₂ Avoided/Year" color="var(--ss-green)" />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          Roof Schematic
          {isEstimatedFootprint && <EstimatedBadge reason="Building footprint is estimated from address coordinates. A site survey will verify the exact roof layout." />}
        </h2>
        {polygonLocalM ? (
          <RoofIsometricViewer
            polygonLocalM={polygonLocalM}
            wallHeightM={5.5}
            roofPitchDeg={data.assumptions.roofPitchDeg}
            source={data.footprintSource}
            solarInsights={solarInsights}
            selectedPanelConfig={selectedPanelConfig}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No building footprint data available.</p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">System Components</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-500" />
                Solar Panels × {data.panelCount}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="font-medium">{data.panelSpec.modelName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Power</span><span className="font-medium">{data.panelSpec.wattPeak}W peak</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Dimensions</span><span className="font-medium">{data.panelSpec.heightMm}×{data.panelSpec.widthMm}mm</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">System size</span><span className="font-medium">{data.systemSizeKw.toFixed(2)} kWp</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-blue-500" />
                Inverter
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="font-medium">{data.inverterSpec.modelName}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Rated output</span><span className="font-medium">{data.inverterSpec.ratedKw} kW</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Efficiency</span><span className="font-medium">{(data.inverterSpec.efficiency * 100).toFixed(0)}%</span></div>
            </CardContent>
          </Card>
          {data.batterySpec && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Battery className="h-4 w-4 text-green-500" />
                  Battery Storage
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Model</span><span className="font-medium">{data.batterySpec.modelName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Capacity</span><span className="font-medium">{data.batterySpec.capacityKwh} kWh</span></div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Monthly Generation</h2>
        <Card>
          <CardContent className="pt-6">
            <MonthlyGenChart monthlyKwh={data.results.monthlyGenKwh} />
            <div className="grid grid-cols-6 gap-1 mt-4 text-xs text-center">
              {MONTHS.map((m, i) => (
                <div key={m}>
                  <div className="text-muted-foreground">{m}</div>
                  <div className="font-medium">{data.results.monthlyGenKwh[i]} kWh</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold mb-4">Energy Usage Breakdown</h2>
          <Card>
            <CardContent className="pt-6">
              <SelfConsumptionDonut
                selfConsumptionKwh={data.results.selfConsumptionKwh}
                exportKwh={data.results.exportKwh}
              />
              <div className="mt-2 text-sm text-center text-muted-foreground">
                Self-consumption rate: {(data.results.selfConsumptionRate * 100).toFixed(0)}%
              </div>
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="text-lg font-semibold mb-4">
            Bill Savings
            {isEstimatedBill && <EstimatedBadge reason="Based on UK average consumption (3,500 kWh/yr). Upload a bill for personalised figures." />}
          </h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <BillSavingsChart
                annualBillBefore={annualBillBefore}
                annualBillAfter={annualBillAfter}
                annualSavings={data.results.annualSavingsPounds}
              />
              <Separator />
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Annual saving</span>
                <span className="font-bold text-green-600">£{data.results.annualSavingsPounds.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">25-Year Investment Returns</h2>
        <Card>
          <CardContent className="pt-6">
            <CumulativeSavingsChart
              savings={data.results.twentyFiveYearSavings}
              systemCost={data.assumptions.systemCostPounds}
            />
            <div className="grid grid-cols-3 gap-4 mt-6 text-center text-sm">
              <div>
                <div className="text-muted-foreground">System cost</div>
                <div className="font-bold text-lg">£{data.assumptions.systemCostPounds.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Payback</div>
                <div className="font-bold text-lg">{data.results.paybackYears} years</div>
              </div>
              <div>
                <div className="text-muted-foreground">25-yr net saving</div>
                <div className="font-bold text-lg text-green-600">
                  £{(data.results.twentyFiveYearSavings[24]?.cumulative ?? 0).toLocaleString()}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Environmental Impact</h2>
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Leaf} value={`${data.results.co2SavedTonnesPerYear} t`} label="CO₂ avoided/year" color="text-green-600" />
          <StatCard icon={Leaf} value={`${Math.round(data.results.co2SavedTonnesPerYear * 25)} t`} label="CO₂ over 25 years" color="text-green-600" />
          <StatCard icon={Leaf} value={`${Math.round(data.results.co2SavedTonnesPerYear * 45)}`} label="Equivalent trees planted" color="text-green-600" />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Assumptions</h2>
        <Card>
          <CardContent className="pt-6">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {[
                ['MCS Zone', data.mcsZone],
                ['In-plane irradiance', `${Math.round(data.irradianceKwhPerM2)} kWh/m²/yr`],
                ['Roof pitch', `${Math.round(data.assumptions.roofPitchDeg)}°`],
                ['Roof orientation', `${Math.round(data.assumptions.roofOrientationDeg)}° from South`],
                ['Shading loss', `${(data.assumptions.shadingLoss * 100).toFixed(0)}%`],
                ['Inverter loss', `${(data.assumptions.inverterLoss * 100).toFixed(0)}%`],
                ['System loss', `${(data.assumptions.systemLoss * 100).toFixed(0)}%`],
                ['Export tariff (SEG)', `${data.assumptions.exportTariffPencePerKwh}p/kWh`],
                ['Annual consumption', `${data.annualKwh.toLocaleString()} kWh`],
                ['Consumption source', data.billSource === 'default' ? 'UK average' : data.billSource === 'ocr' ? 'OCR from bill' : 'Manual entry'],
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between border-b border-muted pb-1">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{val}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground bg-muted/30 rounded-lg p-4 leading-relaxed">
        <strong>Disclaimer:</strong> This report is based on estimated data and is intended as a guide only. Actual solar generation,
        savings, and payback may vary depending on precise roof orientation, shading, system degradation, occupant behaviour, and future energy prices.
        A physical site survey is required before a final system specification and firm quotation can be provided.
        All generation figures are calculated using the MCS Performance Estimate methodology.
      </div>
    </div>
  )
}
