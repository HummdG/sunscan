'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AddressSearch } from './AddressSearch'
import { BillUpload } from './BillUpload'
import { AssumptionsPanel } from './AssumptionsPanel'
import { SolarRoofViewer } from './SolarRoofViewer'
import { TierSelectStep } from './TierSelectStep'
import { ReviewStep, isReviewReady, computeDataConfidence } from './ReviewStep'
import { Sun, FileText, Loader2, CheckCircle2, ChevronRight, ChevronLeft, AlertTriangle, ListChecks, MapPin, ShieldCheck } from 'lucide-react'
import type {
  OsAddress,
  OsBuilding,
  SolarAssumptions,
  GoogleSolarBuildingInsights,
  GoogleSolarDataLayers,
} from '@/lib/types'
import type { TierPresetSummary, RoofType } from '@/lib/pricing/types'
import { DEFAULT_ASSUMPTIONS } from '@/lib/solarCalculations'

interface BillData {
  annualKwh: number
  tariffPencePerKwh: number
  standingChargePencePerDay: number
  exportTariffPencePerKwh: number
  source: 'ocr' | 'manual' | 'default'
  ocrConfidence?: 'high' | 'medium' | 'low'
}

const DEFAULT_BILL: BillData = {
  annualKwh: 3500,
  tariffPencePerKwh: 24.5,
  standingChargePencePerDay: 53,
  exportTariffPencePerKwh: 15,
  source: 'default',
}

const STEPS = [
  { label: 'Address', code: 'INTAKE', accent: 'var(--ss-blue)', icon: MapPin },
  { label: 'Energy Bill', code: 'TARIFF', accent: 'var(--ss-amber)', icon: FileText },
  { label: 'Review', code: 'VERIFY', accent: 'var(--ss-amber)', icon: ShieldCheck },
  { label: 'Choose System', code: 'CONFIG', accent: 'var(--ss-violet-l)', icon: ListChecks },
  { label: 'Your Report', code: 'EXPORT', accent: 'var(--ss-green)', icon: Sun },
]

// ─── Engineering stage strip — replaces the generic Progress bar ──────────────
function StageStrip({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-2 md:grid-cols-5 gap-x-3 gap-y-4">
      {STEPS.map((s, i) => {
        const state = i < step ? 'done' : i === step ? 'active' : 'upcoming'
        const accent =
          state === 'done' ? 'var(--ss-amber)' :
          state === 'active' ? 'var(--ss-blue)' :
          'var(--ss-t4)'
        return (
          <li key={s.label}>
            <div
              className="ss-mono text-[10px] uppercase flex items-center gap-2 mb-1.5"
              style={{ letterSpacing: '0.18em' }}
            >
              <span
                style={{
                  background: state !== 'upcoming' ? accent : 'transparent',
                  border: state === 'upcoming' ? `1px solid ${accent}` : 'none',
                  color: state !== 'upcoming' ? 'var(--ss-ink)' : accent,
                  padding: '2px 6px',
                  borderRadius: 2,
                  fontWeight: 800,
                  minWidth: 26,
                  textAlign: 'center',
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ color: accent, fontWeight: 700 }}>{s.code}</span>
              {state === 'done' && (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {state === 'active' && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: accent, animation: 'ss-pulse-dot 1.4s ease infinite' }}
                />
              )}
            </div>
            <div
              className="ss-heading text-[15px]"
              style={{
                color: state === 'upcoming' ? 'var(--ss-t4)' : 'var(--ss-t1)',
                fontWeight: state === 'upcoming' ? 500 : 700,
              }}
            >
              {s.label}
            </div>
            <div
              className="h-0.5 mt-2"
              style={{
                background:
                  state === 'done' ? accent :
                  state === 'active' ? `linear-gradient(to right, ${accent} 50%, var(--ss-border) 50%)` :
                  'var(--ss-border)',
              }}
            />
          </li>
        )
      })}
    </ol>
  )
}

// ─── Live Spec — progressively fills with real data as user advances ──────────
function LiveSpec({
  step,
  address,
  building,
  insights,
  assumptions,
  bill,
  selectedTier,
  presets,
}: {
  step: number
  address: OsAddress | null
  building: OsBuilding | null
  insights: GoogleSolarBuildingInsights | null
  assumptions: SolarAssumptions
  bill: BillData
  selectedTier: 'essential' | 'standard' | 'premium' | null
  presets: TierPresetSummary[] | null
}) {
  const selectedPreset = selectedTier ? presets?.find(p => p.tier === selectedTier) ?? null : null
  const roofUpdated = !!address && !!insights

  type Row = { k: string; v: string | null; mono?: boolean; truncate?: boolean }
  const sections: { num: string; code: string; stage: number; done: boolean; rows: Row[] }[] = [
    {
      num: '01', code: 'SITE', stage: 0, done: !!address,
      rows: [
        { k: 'Address', v: address?.address ?? null, truncate: true },
        { k: 'Postcode', v: address?.postcode ?? null, mono: true },
        { k: 'UPRN', v: address?.uprn ?? null, mono: true },
        { k: 'Footprint', v: building?.areaM2 != null ? `${building.areaM2.toFixed(1)} m²` : null },
      ],
    },
    {
      num: '02', code: 'ROOF', stage: 0, done: roofUpdated,
      rows: [
        { k: 'Pitch', v: address ? `${Math.round(assumptions.roofPitchDeg)}°` : null },
        { k: 'Azimuth', v: address ? `${Math.round(assumptions.roofOrientationDeg)}° from S` : null },
      ],
    },
    {
      num: '03', code: 'TARIFF', stage: 1, done: bill.source !== 'default',
      rows: [
        { k: 'Annual use', v: bill.source !== 'default' ? `${bill.annualKwh.toLocaleString()} kWh` : null },
        { k: 'Unit rate', v: bill.source !== 'default' ? `${bill.tariffPencePerKwh}p / kWh` : null },
        { k: 'Source', v: bill.source !== 'default' ? (bill.source === 'ocr' ? `OCR · ${bill.ocrConfidence ?? ''}`.trim() : 'Manual') : null, mono: true },
      ],
    },
    {
      num: '04', code: 'SYSTEM', stage: 3, done: !!selectedPreset,
      rows: [
        { k: 'Tier', v: selectedPreset ? selectedPreset.tier.charAt(0).toUpperCase() + selectedPreset.tier.slice(1) : null },
        { k: 'Panels', v: selectedPreset ? String(selectedPreset.panelCount) : null },
        { k: 'Capacity', v: selectedPreset ? `${selectedPreset.kwp.toFixed(2)} kWp` : null },
        { k: 'Total', v: selectedPreset ? `£${selectedPreset.totalPounds.toLocaleString()}` : null, mono: true },
      ],
    },
  ]

  return (
    <div className="flex flex-col h-full p-6 md:p-7">
      {/* Header */}
      <div
        className="ss-mono text-[10px] uppercase pb-3 mb-5 flex items-center gap-2 flex-wrap"
        style={{
          letterSpacing: '0.22em',
          color: 'var(--ss-t3)',
          borderBottom: '1px dashed var(--ss-border-h)',
        }}
      >
        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--ss-blue)' }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ss-blue)' }} />
          Live spec
        </span>
        <span style={{ color: 'var(--ss-t4)' }}>·</span>
        <span>fills as you go</span>
      </div>

      <div className="space-y-5">
        {sections.map((s) => {
          const isActive = s.stage === step && !s.done
          const accent = s.done ? 'var(--ss-amber)' : isActive ? 'var(--ss-blue)' : 'var(--ss-t4)'
          return (
            <div key={s.num}>
              <div
                className="ss-mono text-[10px] uppercase flex items-center gap-2 mb-2"
                style={{ letterSpacing: '0.18em' }}
              >
                <span
                  style={{
                    background: s.done || isActive ? accent : 'transparent',
                    border: !s.done && !isActive ? `1px solid ${accent}` : 'none',
                    color: s.done || isActive ? 'var(--ss-ink)' : accent,
                    padding: '1px 5px',
                    borderRadius: 2,
                    fontWeight: 800,
                  }}
                >
                  {s.num}
                </span>
                <span style={{ color: accent, fontWeight: 700 }}>{s.code}</span>
                {s.done && (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
                {isActive && (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: accent, animation: 'ss-pulse-dot 1.4s ease infinite' }}
                  />
                )}
              </div>
              <dl className="space-y-1">
                {s.rows.map((r) => (
                  <div
                    key={r.k}
                    className="flex items-baseline justify-between gap-3 text-[13px]"
                  >
                    <dt style={{ color: 'var(--ss-t3)' }}>{r.k}</dt>
                    <dd
                      className={`text-right ${r.mono ? 'ss-mono text-[11.5px]' : ''} ${r.truncate ? 'truncate max-w-[180px]' : ''}`}
                      style={{
                        color: r.v == null ? 'var(--ss-t4)' : 'var(--ss-t1)',
                        fontWeight: r.v == null ? 400 : 600,
                      }}
                      title={r.v ?? undefined}
                    >
                      {r.v ?? '–'}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )
        })}
      </div>

      {/* Footer — what they'll receive */}
      <div className="mt-auto pt-5" style={{ borderTop: '1px dashed var(--ss-border-h)' }}>
        <div
          className="ss-mono text-[10px] uppercase flex items-center gap-2 mb-3"
          style={{ letterSpacing: '0.22em', color: 'var(--ss-t3)' }}
        >
          <span style={{ color: 'var(--ss-amber)' }}>→</span>
          <span>You&rsquo;ll receive</span>
        </div>
        <ul className="space-y-2 text-[12.5px]" style={{ color: 'var(--ss-t2)' }}>
          {[
            { c: 'var(--ss-blue)', t: 'MCS-aligned proposal PDF' },
            { c: 'var(--ss-amber)', t: '25-year savings projection' },
            { c: 'var(--ss-violet-l)', t: 'Interactive 3D roof model' },
          ].map((i) => (
            <li key={i.t} className="flex items-start gap-2">
              <span
                className="w-1 h-1 rounded-full mt-2 flex-shrink-0"
                style={{ background: i.c }}
              />
              <span>{i.t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function SurveyForm() {
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Address
  const [selectedAddress, setSelectedAddress] = useState<OsAddress | null>(null)

  // OS building footprint
  const [osBuilding, setOsBuilding] = useState<OsBuilding | null>(null)

  // Solar API data
  const [solarInsights, setSolarInsights] = useState<GoogleSolarBuildingInsights | null>(null)
  const [dataLayers, setDataLayers] = useState<GoogleSolarDataLayers | null>(null)
  const [loadingSolar, setLoadingSolar] = useState(false)
  const [solarError, setSolarError] = useState<string | null>(null)

  // Bill
  const [billData, setBillData] = useState<BillData>(DEFAULT_BILL)

  // Assumptions (updated from Solar API best segment)
  const [assumptions, setAssumptions] = useState<SolarAssumptions>(DEFAULT_ASSUMPTIONS)

  // Tier presets (loaded after bill step)
  const [tierPresets, setTierPresets] = useState<TierPresetSummary[] | null>(null)
  const [selectedTier, setSelectedTier] = useState<'essential' | 'standard' | 'premium' | null>(null)
  const [loadingTiers, setLoadingTiers] = useState(false)

  // Captured 3D image for PDF
  const capturedModel3dRef = useRef<string | null>(null)

  function deriveRoofMaxPanels(): number {
    const fromGoogle = solarInsights?.solarPotential.maxArrayPanelsCount
    if (fromGoogle && fromGoogle > 0) return fromGoogle
    if (osBuilding?.areaM2) {
      // Rough estimate: ~2 m² per panel, half of footprint usable
      return Math.max(6, Math.round(osBuilding.areaM2 / 4))
    }
    return 20
  }

  function deriveRoofType(): RoofType {
    const pitch = osBuilding?.roofPitchDeg ?? assumptions.roofPitchDeg ?? 35
    return pitch < 10 ? 'flat' : 'pitched'
  }

  const handleLoadTiers = useCallback(async () => {
    setLoadingTiers(true)
    setError(null)
    try {
      const res = await fetch('/api/quote/tiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annualKwh: billData.annualKwh,
          roofMaxPanels: deriveRoofMaxPanels(),
          roofType: deriveRoofType(),
        }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Could not load system options')
      setTierPresets(result.presets)
      // Default-select Standard
      setSelectedTier('standard')
      setStep(3)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load system options')
    } finally {
      setLoadingTiers(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billData, osBuilding, solarInsights, assumptions])

  const handleAddressSelected = useCallback(async (address: OsAddress) => {
    setSelectedAddress(address)
    setSolarInsights(null)
    setDataLayers(null)
    setSolarError(null)
    setOsBuilding(null)
    setLoadingSolar(true)

    try {
      const [insightsRes, layersRes, buildingRes] = await Promise.all([
        fetch(`/api/solar/building?lat=${address.lat}&lng=${address.lng}`),
        fetch(`/api/solar/datalayers?lat=${address.lat}&lng=${address.lng}`),
        fetch(`/api/os/building?uprn=${encodeURIComponent(address.uprn)}&lat=${address.lat}&lng=${address.lng}`),
      ])

      let insights: GoogleSolarBuildingInsights | null = null
      let layers: GoogleSolarDataLayers | null = null

      if (insightsRes.ok) {
        const d = await insightsRes.json()
        insights = d.data ?? null
      }
      if (layersRes.ok) {
        const d = await layersRes.json()
        layers = d.data ?? null
      }
      if (buildingRes.ok) {
        const d = await buildingRes.json()
        if (d.building) setOsBuilding(d.building)
      }

      if (insights) {
        setSolarInsights(insights)
        setDataLayers(layers)

        // Apply best-sunshine segment to assumptions
        const segs = insights.solarPotential.roofSegmentStats ?? []
        if (segs.length > 0) {
          const p50 = (q: number[] | undefined) => q?.[Math.floor((q.length ?? 0) / 2)] ?? 0
          const best = segs.reduce((prev, cur) =>
            p50(cur.stats.sunshineQuantiles) > p50(prev.stats.sunshineQuantiles) ? cur : prev,
          )
          const mcsOri = Math.abs(((best.azimuthDegrees - 180 + 360) % 360) - 180)
          setAssumptions(prev => ({
            ...prev,
            roofPitchDeg: Math.round(Math.min(70, Math.max(5, best.pitchDegrees))),
            roofOrientationDeg: Math.round(mcsOri),
          }))
        }
      } else {
        setSolarError('Google Solar data is not available for this address. Calculations will use estimated defaults.')
      }
    } catch (err) {
      console.error('Solar API fetch failed', err)
      setSolarError('Could not load solar data. Calculations will use estimated defaults.')
    } finally {
      setLoadingSolar(false)
    }
  }, [])

  const handleGenerate = async () => {
    if (!selectedAddress) return
    if (!selectedTier || !tierPresets) {
      setError('Please choose a system package first.')
      return
    }
    const presetConfig = tierPresets.find((p) => p.tier === selectedTier)?.config
    if (!presetConfig) {
      setError('Selected package not found. Please re-select.')
      return
    }

    if (!isReviewReady({ osBuilding, solarInsights, assumptions, bill: billData })) {
      setError('Please confirm your roof and consumption on the Review step before generating.')
      setStep(2)
      return
    }

    const dataConfidence = computeDataConfidence({ osBuilding, solarInsights, bill: billData })

    setGenerating(true)
    setError(null)
    setStep(4)

    try {
      const payload = {
        addressRaw: selectedAddress.address,
        addressUprn: selectedAddress.uprn,
        lat: selectedAddress.lat,
        lng: selectedAddress.lng,
        postcode: selectedAddress.postcode,
        footprintGeojson: osBuilding
          ? JSON.stringify({ type: 'Polygon', coordinates: [osBuilding.footprintPolygon] })
          : null,
        footprintSource: osBuilding ? 'os_ngd' : solarInsights ? 'google_solar' : 'estimated',
        annualKwh: billData.annualKwh,
        tariffPencePerKwh: billData.tariffPencePerKwh,
        standingChargePencePerDay: billData.standingChargePencePerDay,
        exportTariffPencePerKwh: billData.exportTariffPencePerKwh,
        billSource: billData.source === 'default' ? 'manual' : billData.source,
        assumptions,
        solarApiJson: solarInsights ? JSON.stringify(solarInsights) : undefined,
        model3dImageBase64: capturedModel3dRef.current ?? undefined,
        chartImagesBase64: [],
        selectedTier,
        selectedConfig: presetConfig,
        dataConfidence,
      }

      const res = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const result = await res.json()
      if (!res.ok) throw new Error(result.error ?? 'Report generation failed')

      router.push(`/report/${result.reportId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setGenerating(false)
      setStep(3)
    }
  }

  void generating

  const brandBtn: React.CSSProperties = {
    background: 'var(--ss-blue)',
    color: '#fff',
    boxShadow: '0 0 20px rgba(176,64,32,0.22)',
    border: 'none',
  }
  const ghostBtn: React.CSSProperties = {
    background: 'transparent',
    color: 'var(--ss-t2)',
    border: '1px solid var(--ss-border-h)',
  }

  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] w-full">
      {/* ── Form column ─────────────────────────────────────────── */}
      <div className="flex flex-col w-full">
        {/* Stage strip — engineering-style replacement for Progress bar */}
        <div
          className="px-6 md:px-10 pt-7 md:pt-10 pb-6"
          style={{ borderBottom: '1px dashed var(--ss-border)' }}
        >
          <div className="w-full max-w-[640px] mx-auto">
            <StageStrip step={step} />
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 flex flex-col w-full max-w-[640px] mx-auto px-6 md:px-10 py-8 md:py-10 space-y-7">
          {/* Step 0: Address */}
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <h2
                  className="ss-heading font-extrabold tracking-tight"
                  style={{ fontSize: 'clamp(26px,3vw,36px)', color: 'var(--ss-t1)', lineHeight: 1.05 }}
                >
                  Find your property.
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
                  Start typing your UK address. We lock onto the UPRN and pull the roof geometry from Ordnance Survey automatically.
                </p>
              </div>

              <AddressSearch onAddressSelected={handleAddressSelected} />

              {loadingSolar && (
                <div
                  className="flex items-center gap-2 p-3 text-sm animate-pulse"
                  style={{
                    background: 'var(--ss-s2)',
                    border: '1px solid var(--ss-border-h)',
                    color: 'var(--ss-blue)',
                    borderRadius: 4,
                  }}
                >
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <span>Fetching Google Solar analysis for this property…</span>
                </div>
              )}

              {solarError && !loadingSolar && (
                <div
                  className="flex items-center gap-2 p-3 text-sm"
                  style={{
                    background: 'rgba(217,119,6,0.10)',
                    border: '1px solid rgba(217,119,6,0.35)',
                    color: 'var(--ss-amber)',
                    borderRadius: 4,
                  }}
                >
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{solarError}</span>
                </div>
              )}

              {selectedAddress && !loadingSolar && (
                <div className="space-y-4">
                  <div
                    className="flex items-center gap-2 p-3 text-sm"
                    style={{
                      background: 'rgba(90,120,66,0.10)',
                      border: '1px solid rgba(90,120,66,0.35)',
                      color: 'var(--ss-green)',
                      borderRadius: 4,
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span className="flex-1 font-medium" style={{ color: 'var(--ss-t1)' }}>
                      {selectedAddress.address}
                    </span>
                    {solarInsights ? (
                      <Badge
                        variant="outline"
                        className="text-xs shrink-0"
                        style={{ color: 'var(--ss-green)', borderColor: 'rgba(90,120,66,0.35)', background: 'transparent' }}
                      >
                        Google Solar loaded
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-xs shrink-0"
                        style={{ color: 'var(--ss-amber)', borderColor: 'rgba(217,119,6,0.35)', background: 'transparent' }}
                      >
                        Estimated defaults
                      </Badge>
                    )}
                  </div>

                  {solarInsights && (
                    <SolarRoofViewer
                      insights={solarInsights}
                      dataLayers={dataLayers}
                      lat={selectedAddress.lat}
                      lng={selectedAddress.lng}
                      osBuilding={osBuilding}
                      onCapture={(dataUrl) => { capturedModel3dRef.current = dataUrl }}
                    />
                  )}

                  <AssumptionsPanel value={assumptions} onChange={setAssumptions} />
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button
                  onClick={() => setStep(1)}
                  disabled={!selectedAddress || loadingSolar}
                  className="ss-heading gap-2 px-5 py-5 text-[15px]"
                  style={brandBtn}
                >
                  Next · Energy Bill <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 1: Bill */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2
                  className="ss-heading font-extrabold tracking-tight"
                  style={{ fontSize: 'clamp(26px,3vw,36px)', color: 'var(--ss-t1)', lineHeight: 1.05 }}
                >
                  Your energy usage.
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
                  Drop in an electricity bill and we&rsquo;ll read the unit rate, standing charge and annual kWh straight off the page.
                  Or use the UK average. You can refine later.
                </p>
              </div>

              <BillUpload value={billData} onChange={setBillData} />

              {error && (
                <div
                  className="p-3 text-sm"
                  style={{
                    background: 'rgba(176,64,32,0.10)',
                    border: '1px solid var(--ss-border-h)',
                    color: 'var(--ss-blue)',
                    borderRadius: 4,
                  }}
                >
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(0)}
                  className="ss-heading gap-2 px-5 py-5 text-[15px]"
                  style={ghostBtn}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={() => setStep(2)}
                  className="ss-heading gap-2 px-5 py-5 text-[15px]"
                  style={brandBtn}
                >
                  Next · Review <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Step 2: Review */}
          {step === 2 && (
            <div className="space-y-6">
              <ReviewStep
                osBuilding={osBuilding}
                solarInsights={solarInsights}
                assumptions={assumptions}
                bill={billData}
                onAssumptionsChange={setAssumptions}
                onBillChange={setBillData}
              />

              {error && (
                <div
                  className="p-3 text-sm"
                  style={{
                    background: 'rgba(176,64,32,0.10)',
                    border: '1px solid var(--ss-border-h)',
                    color: 'var(--ss-blue)',
                    borderRadius: 4,
                  }}
                >
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(1)}
                  className="ss-heading gap-2 px-5 py-5 text-[15px]"
                  style={ghostBtn}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={handleLoadTiers}
                  disabled={loadingTiers || !isReviewReady({ osBuilding, solarInsights, assumptions, bill: billData })}
                  className="ss-heading gap-2 px-5 py-5 text-[15px]"
                  style={brandBtn}
                >
                  {loadingTiers ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading options…
                    </>
                  ) : (
                    <>
                      Confirm &amp; Choose System <ChevronRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Tier select */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2
                  className="ss-heading font-extrabold tracking-tight"
                  style={{ fontSize: 'clamp(26px,3vw,36px)', color: 'var(--ss-t1)', lineHeight: 1.05 }}
                >
                  Choose your system.
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
                  Three MCS-aligned packages sized to your usage. Pick one. Every figure on your report flows from this choice.
                </p>
              </div>

              <TierSelectStep
                presets={tierPresets ?? []}
                selectedTier={selectedTier}
                onSelect={setSelectedTier}
                roofMaxPanels={deriveRoofMaxPanels()}
                loading={loadingTiers}
              />

              {error && (
                <div
                  className="p-3 text-sm"
                  style={{
                    background: 'rgba(176,64,32,0.10)',
                    border: '1px solid var(--ss-border-h)',
                    color: 'var(--ss-blue)',
                    borderRadius: 4,
                  }}
                >
                  {error}
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button
                  variant="outline"
                  onClick={() => setStep(2)}
                  className="ss-heading gap-2 px-5 py-5 text-[15px]"
                  style={ghostBtn}
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </Button>
                <Button
                  onClick={handleGenerate}
                  disabled={!selectedTier}
                  className="ss-heading gap-2 px-5 py-5 text-[15px]"
                  style={brandBtn}
                >
                  <Sun className="h-4 w-4" /> Generate My Report
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Generating */}
          {step === 4 && (
            <div className="text-center space-y-6 py-16 flex-1 flex flex-col items-center justify-center">
              <div
                className="h-20 w-20 rounded-full flex items-center justify-center"
                style={{
                  background: 'var(--ss-s2)',
                  border: '1px solid var(--ss-border-h)',
                  boxShadow: '0 0 32px rgba(217,119,6,0.25)',
                }}
              >
                <Loader2 className="h-9 w-9 animate-spin" style={{ color: 'var(--ss-amber)' }} />
              </div>
              <div>
                <h2
                  className="ss-heading font-extrabold tracking-tight"
                  style={{ fontSize: 'clamp(24px,2.6vw,32px)', color: 'var(--ss-t1)' }}
                >
                  Generating your solar report…
                </h2>
                <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
                  Running MCS calculations, packing the panel layout and rendering your PDF.
                </p>
              </div>
              <ul className="text-[13px] max-w-xs w-full mx-auto space-y-2 text-left">
                <li className="flex items-center gap-2" style={{ color: 'var(--ss-t2)' }}>
                  <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--ss-green)' }} />
                  Google Solar analysis loaded
                </li>
                <li className="flex items-center gap-2" style={{ color: 'var(--ss-t2)' }}>
                  <CheckCircle2 className="h-4 w-4" style={{ color: 'var(--ss-green)' }} />
                  MCS irradiance zone · {selectedAddress?.postcode}
                </li>
                <li className="flex items-center gap-2" style={{ color: 'var(--ss-t3)' }}>
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--ss-amber)' }} />
                  Generating PDF report…
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── Live Spec sidebar ────────────────────────────────────── */}
      <aside
        className="hidden lg:flex flex-col"
        style={{
          borderLeft: '1px dashed var(--ss-border-h)',
          background: 'rgba(237,224,191,0.35)',
        }}
      >
        <LiveSpec
          step={step}
          address={selectedAddress}
          building={osBuilding}
          insights={solarInsights}
          assumptions={assumptions}
          bill={billData}
          selectedTier={selectedTier}
          presets={tierPresets}
        />
      </aside>
    </div>
  )
}
