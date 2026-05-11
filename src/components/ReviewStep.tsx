'use client'

import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'
import type {
  DataConfidence,
  GoogleSolarBuildingInsights,
  OsBuilding,
  SolarAssumptions,
} from '@/lib/types'

export interface ReviewBill {
  annualKwh: number
  tariffPencePerKwh: number
  standingChargePencePerDay: number
  exportTariffPencePerKwh: number
  source: 'ocr' | 'manual' | 'default'
  ocrConfidence?: 'high' | 'medium' | 'low'
}

interface ReviewStepProps {
  osBuilding: OsBuilding | null
  solarInsights: GoogleSolarBuildingInsights | null
  assumptions: SolarAssumptions
  bill: ReviewBill
  onAssumptionsChange: (a: SolarAssumptions) => void
  onBillChange: (b: ReviewBill) => void
}

/**
 * Lets the user confirm — or correct — every figure that drives the proposal,
 * before any PDF is generated. Returns a {@link DataConfidence} object from
 * {@link computeDataConfidence} that the parent passes to /api/report/generate.
 */
export function ReviewStep({
  osBuilding,
  solarInsights,
  assumptions,
  bill,
  onAssumptionsChange,
  onBillChange,
}: ReviewStepProps) {
  const roofState = deriveRoofState(osBuilding, solarInsights)
  const billState = deriveBillState(bill)

  return (
    <div className="space-y-6">
      <div>
        <h2
          className="ss-heading font-extrabold tracking-tight"
          style={{ fontSize: 'clamp(26px,3vw,36px)', color: 'var(--ss-t1)', lineHeight: 1.05 }}
        >
          Confirm before we generate.
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
          Every figure on your proposal is sourced from the data below. Verify it &mdash; or fix anything
          that looks wrong &mdash; before we run the numbers. There are no &ldquo;estimate only&rdquo; caveats on what you confirm here.
        </p>
      </div>

      {/* ── Roof card ────────────────────────────────────────────────── */}
      <RoofCard
        roofState={roofState}
        assumptions={assumptions}
        onAssumptionsChange={onAssumptionsChange}
      />

      {/* ── Consumption card ─────────────────────────────────────────── */}
      <ConsumptionCard
        bill={bill}
        billState={billState}
        onBillChange={onBillChange}
      />
    </div>
  )
}

// ─── Roof card ──────────────────────────────────────────────────────────────

type RoofState =
  | { kind: 'auto'; source: 'google_solar' | 'os_ngd' }
  | { kind: 'partial'; source: 'os_ngd' }
  | { kind: 'missing' }

function deriveRoofState(
  osBuilding: OsBuilding | null,
  solarInsights: GoogleSolarBuildingInsights | null,
): RoofState {
  if (solarInsights) return { kind: 'auto', source: 'google_solar' }
  if (osBuilding && osBuilding.roofPitchDeg !== undefined && osBuilding.roofAzimuthDeg !== undefined) {
    return { kind: 'auto', source: 'os_ngd' }
  }
  if (osBuilding) return { kind: 'partial', source: 'os_ngd' }
  return { kind: 'missing' }
}

function RoofCard({
  roofState,
  assumptions,
  onAssumptionsChange,
}: {
  roofState: RoofState
  assumptions: SolarAssumptions
  onAssumptionsChange: (a: SolarAssumptions) => void
}) {
  if (roofState.kind === 'missing') {
    return (
      <Card>
        <CardHeader badge="ROOF" tone="bad">
          <XCircle className="h-4 w-4" />
          Roof not found
        </CardHeader>
        <div className="text-[14px] leading-relaxed" style={{ color: 'var(--ss-t2)' }}>
          We couldn&rsquo;t find your roof in either Ordnance Survey or Google Solar imagery. Until we can
          verify your roof, we can&rsquo;t generate a proposal for this address. Please check the address on
          the previous step, or contact us to do a manual survey.
        </div>
      </Card>
    )
  }

  if (roofState.kind === 'auto') {
    const sourceLabel = roofState.source === 'google_solar' ? 'Google Solar imagery' : 'Ordnance Survey NGD'
    return (
      <Card>
        <CardHeader badge="ROOF" tone="good">
          <CheckCircle2 className="h-4 w-4" />
          Detected from {sourceLabel}
        </CardHeader>
        <div className="grid grid-cols-2 gap-3 text-[14px]">
          <Stat label="Pitch" value={`${Math.round(assumptions.roofPitchDeg)}°`} />
          <Stat label="Orientation" value={`${Math.round(assumptions.roofOrientationDeg)}° from South`} />
        </div>
        <details className="mt-4 text-[13px]" style={{ color: 'var(--ss-t3)' }}>
          <summary className="cursor-pointer hover:underline">Looks wrong? Adjust manually</summary>
          <ManualRoofInputs assumptions={assumptions} onChange={onAssumptionsChange} />
        </details>
      </Card>
    )
  }

  // partial — OS found a building but pitch/orientation are missing
  return (
    <Card>
      <CardHeader badge="ROOF" tone="warn">
        <AlertTriangle className="h-4 w-4" />
        Building found, roof shape needs your input
      </CardHeader>
      <div className="text-[13px] mb-3" style={{ color: 'var(--ss-t3)' }}>
        We located your building on Ordnance Survey, but the roof pitch and orientation aren&rsquo;t
        published for this address. Please tell us so we can size the system correctly.
      </div>
      <ManualRoofInputs assumptions={assumptions} onChange={onAssumptionsChange} />
    </Card>
  )
}

function ManualRoofInputs({
  assumptions,
  onChange,
}: {
  assumptions: SolarAssumptions
  onChange: (a: SolarAssumptions) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 mt-3">
      <div>
        <Label className="text-[12px]">Pitch (degrees)</Label>
        <Input
          type="number"
          min={0}
          max={70}
          step={1}
          value={Math.round(assumptions.roofPitchDeg)}
          onChange={(e) => onChange({ ...assumptions, roofPitchDeg: parseFloat(e.target.value) || 0 })}
        />
        <p className="text-[11px] mt-1" style={{ color: 'var(--ss-t4)' }}>
          Typical UK pitched roof: 30–45°. Flat roof: 0–10°.
        </p>
      </div>
      <div>
        <Label className="text-[12px]">Orientation from South (degrees)</Label>
        <Input
          type="number"
          min={0}
          max={180}
          step={5}
          value={Math.round(assumptions.roofOrientationDeg)}
          onChange={(e) => onChange({ ...assumptions, roofOrientationDeg: parseFloat(e.target.value) || 0 })}
        />
        <p className="text-[11px] mt-1" style={{ color: 'var(--ss-t4)' }}>
          0° = roof faces due south. 90° = east or west. 180° = north.
        </p>
      </div>
    </div>
  )
}

// ─── Consumption card ───────────────────────────────────────────────────────

type BillState =
  | { kind: 'ocr-high' }
  | { kind: 'ocr-needs-review' }
  | { kind: 'manual' }
  | { kind: 'default' }

function deriveBillState(bill: ReviewBill): BillState {
  if (bill.source === 'ocr' && bill.ocrConfidence === 'high') return { kind: 'ocr-high' }
  if (bill.source === 'ocr') return { kind: 'ocr-needs-review' }
  if (bill.source === 'manual') return { kind: 'manual' }
  return { kind: 'default' }
}

function ConsumptionCard({
  bill,
  billState,
  onBillChange,
}: {
  bill: ReviewBill
  billState: BillState
  onBillChange: (b: ReviewBill) => void
}) {
  const tone =
    billState.kind === 'ocr-high' ? 'good' :
    billState.kind === 'default' ? 'bad' :
    'warn'

  const headerText =
    billState.kind === 'ocr-high' ? 'Extracted from your bill' :
    billState.kind === 'ocr-needs-review' ? 'Extracted from your bill — please review' :
    billState.kind === 'manual' ? 'Entered manually — please confirm' :
    'No bill data provided'

  const headerIcon =
    billState.kind === 'ocr-high' ? <CheckCircle2 className="h-4 w-4" /> :
    billState.kind === 'default' ? <XCircle className="h-4 w-4" /> :
    <AlertTriangle className="h-4 w-4" />

  const setField = (key: keyof Omit<ReviewBill, 'source' | 'ocrConfidence'>) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value) || 0
      // Any edit to a default-source bill promotes it to manual confirmation.
      const newSource: ReviewBill['source'] =
        bill.source === 'default' ? 'manual' : bill.source
      onBillChange({ ...bill, [key]: v, source: newSource })
    }

  return (
    <Card>
      <CardHeader badge="CONSUMPTION" tone={tone}>
        {headerIcon}
        {headerText}
      </CardHeader>

      {billState.kind === 'default' && (
        <div
          className="flex items-start gap-2 p-3 mb-3 text-[13px] rounded-sm"
          style={{
            background: 'rgba(176,64,32,0.10)',
            border: '1px solid rgba(176,64,32,0.35)',
            color: 'var(--ss-blue)',
          }}
        >
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <span>
            Enter your annual usage and unit rate, or go back and upload an electricity bill. We
            won&rsquo;t use the &ldquo;UK average&rdquo; default to generate your proposal.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-[12px]">Annual usage (kWh)</Label>
          <Input type="number" min={100} max={100000} step={50} value={bill.annualKwh} onChange={setField('annualKwh')} />
        </div>
        <div>
          <Label className="text-[12px]">Unit rate (p / kWh)</Label>
          <Input type="number" min={1} max={100} step={0.1} value={bill.tariffPencePerKwh} onChange={setField('tariffPencePerKwh')} />
        </div>
        <div>
          <Label className="text-[12px]">Standing charge (p / day)</Label>
          <Input type="number" min={0} max={200} step={0.5} value={bill.standingChargePencePerDay} onChange={setField('standingChargePencePerDay')} />
        </div>
        <div className="col-span-2">
          <Label className="text-[12px]">SEG export rate (p / kWh)</Label>
          <Input type="number" min={0} max={50} step={0.1} value={bill.exportTariffPencePerKwh} onChange={setField('exportTariffPencePerKwh')} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--ss-t4)' }}>
            Smart Export Guarantee. Common rates: Octopus 15p, OVO 4p, no export tariff 0p.
          </p>
        </div>
      </div>
    </Card>
  )
}

// ─── Building blocks ────────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="p-5 md:p-6"
      style={{
        background: 'var(--ss-s1)',
        border: '1px solid var(--ss-border-h)',
        borderRadius: 6,
      }}
    >
      {children}
    </div>
  )
}

function CardHeader({
  badge,
  tone,
  children,
}: {
  badge: string
  tone: 'good' | 'warn' | 'bad'
  children: React.ReactNode
}) {
  const colour =
    tone === 'good' ? 'var(--ss-green)' :
    tone === 'warn' ? 'var(--ss-amber)' :
    'var(--ss-blue)'
  return (
    <div className="flex items-center gap-2 mb-4">
      <span
        className="ss-mono text-[10px] uppercase"
        style={{
          letterSpacing: '0.22em',
          padding: '2px 6px',
          background: colour,
          color: 'var(--ss-ink)',
          fontWeight: 800,
          borderRadius: 2,
        }}
      >
        {badge}
      </span>
      <span
        className="flex items-center gap-1.5 text-[14px] font-semibold"
        style={{ color: colour }}
      >
        {children}
      </span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ss-t3)' }}>{label}</div>
      <div className="text-[18px] font-semibold ss-mono" style={{ color: 'var(--ss-t1)' }}>{value}</div>
    </div>
  )
}

// ─── Public helpers ─────────────────────────────────────────────────────────

/**
 * Inputs: the raw state the user reviewed. Returns true if every required field
 * is present and acceptable for generation.
 */
export function isReviewReady(args: {
  osBuilding: OsBuilding | null
  solarInsights: GoogleSolarBuildingInsights | null
  assumptions: SolarAssumptions
  bill: ReviewBill
}): boolean {
  const roof = deriveRoofState(args.osBuilding, args.solarInsights)
  if (roof.kind === 'missing') return false
  if (roof.kind === 'partial') {
    if (args.assumptions.roofPitchDeg <= 0) return false
    if (args.assumptions.roofOrientationDeg < 0) return false
  }
  if (args.bill.source === 'default') return false
  if (args.bill.annualKwh <= 0 || args.bill.tariffPencePerKwh <= 0) return false
  return true
}

/**
 * Builds the {@link DataConfidence} object that ships to /api/report/generate.
 * Caller must have already verified {@link isReviewReady}.
 */
export function computeDataConfidence(args: {
  osBuilding: OsBuilding | null
  solarInsights: GoogleSolarBuildingInsights | null
  bill: ReviewBill
}): DataConfidence {
  const roof = deriveRoofState(args.osBuilding, args.solarInsights)
  return {
    roof: roof.kind === 'auto' ? 'os-confirmed' : 'user-confirmed',
    consumption: args.bill.source === 'ocr' ? 'ocr-confirmed' : 'manual-confirmed',
    tariff: args.bill.source === 'ocr' ? 'ocr' : 'manual',
  }
}

