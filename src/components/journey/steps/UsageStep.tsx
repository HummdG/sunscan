'use client'

import { useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { JourneyAction, JourneyState, UsageSource } from '@/lib/journey/types'
import type { ParsedBill } from '@/lib/types'
import { ChoiceGrid, NumberField, StepShell } from '../ui'

interface UsageStepProps {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
}

const SOURCE_OPTIONS: { value: UsageSource; label: string; description: string }[] = [
  {
    value: 'bill_ocr',
    label: 'Upload my electricity bill',
    description: 'Most accurate — we read your usage and tariff automatically',
  },
  {
    value: 'manual_kwh',
    label: 'Enter my annual kWh',
    description: "If you know your yearly usage from a bill or app",
  },
  {
    value: 'monthly_cost',
    label: 'Enter my typical monthly cost',
    description: "We'll estimate your usage from what you spend",
  },
  {
    value: 'household',
    label: "I don't know",
    description: "We'll estimate from your household size",
  },
]

const HOUSEHOLD_OPTIONS: { value: string; label: string }[] = [
  { value: '1', label: '1 person' },
  { value: '2', label: '2 people' },
  { value: '3', label: '3 people' },
  { value: '4', label: '4 people' },
  { value: '5', label: '5 or more' },
]

export function UsageStep({ state, dispatch }: UsageStepProps) {
  const { usage } = state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [billError, setBillError] = useState<string | null>(null)
  const [billConfidence, setBillConfidence] = useState<ParsedBill['confidence'] | null>(null)

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setUploading(true)
    setBillError(null)
    const formData = new FormData()
    formData.append('bill', file)
    try {
      const res = await fetch('/api/bill/parse', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok && data.success && data.data) {
        const bill = data.data as ParsedBill
        setBillConfidence(bill.confidence)
        dispatch({
          type: 'PATCH_USAGE',
          patch: {
            source: 'bill_ocr',
            annualKwh: bill.annualKwh,
            unitRatePence: bill.tariffPencePerKwh,
            standingChargePence: bill.standingChargePencePerDay,
            exportTariffPence: bill.exportTariffPencePerKwh,
          },
        })
      } else {
        // 503 (no OCR key) or extraction miss — fall back to manual kWh entry.
        setBillError(
          (data.error as string) ??
            "We couldn't read this bill automatically. Please enter your annual kWh below.",
        )
        dispatch({ type: 'PATCH_USAGE', patch: { source: 'manual_kwh' } })
      }
    } catch {
      setBillError('Upload failed. Please enter your annual kWh below.')
      dispatch({ type: 'PATCH_USAGE', patch: { source: 'manual_kwh' } })
    } finally {
      setUploading(false)
    }
  }

  const chooseSource = (value: UsageSource) => {
    setBillError(null)
    setBillConfidence(null)
    // Reset the captured figures so a switch never carries stale data forward.
    dispatch({
      type: 'PATCH_USAGE',
      patch: {
        source: value,
        annualKwh: null,
        unitRatePence: null,
        standingChargePence: null,
        exportTariffPence: null,
        monthlyCostGbp: null,
        householdSize: null,
      },
    })
  }

  return (
    <StepShell
      eyebrow="Step · Electricity use"
      title="How much electricity do you use?"
      subtitle="The more accurate this is, the better we can size your system and estimate your savings."
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
            Do you have a recent electricity bill?
          </h3>
          <ChoiceGrid options={SOURCE_OPTIONS} value={usage.source} onSelect={chooseSource} />
        </section>

        {usage.source === 'bill_ocr' ? (
          <section className="space-y-3">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  fileInputRef.current?.click()
                }
              }}
              className="cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition"
              style={{ borderColor: 'var(--ss-border-h)', background: 'var(--ss-s1)' }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {uploading ? (
                <div className="space-y-2">
                  <span
                    className="mx-auto block h-7 w-7 animate-spin rounded-full border-2 border-t-transparent"
                    style={{ borderColor: 'var(--brand-primary)', borderTopColor: 'transparent' }}
                    aria-hidden
                  />
                  <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
                    Reading your bill…
                  </p>
                </div>
              ) : fileName ? (
                <div className="space-y-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--ss-t1)' }}>
                    {fileName}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--ss-t3)' }}>
                    Click to upload a different bill
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--ss-t1)' }}>
                    Upload your electricity bill
                  </p>
                  <p className="text-xs" style={{ color: 'var(--ss-t3)' }}>
                    PDF, JPEG, PNG or WebP · Max 10MB
                  </p>
                </div>
              )}
            </div>

            {billError ? (
              <p
                className="rounded-xl px-4 py-3 text-sm"
                style={{
                  color: 'var(--ss-t2)',
                  background: 'color-mix(in srgb, var(--brand-accent) 10%, var(--ss-s1))',
                  border: '1px solid var(--ss-border-h)',
                }}
              >
                {billError}
              </p>
            ) : null}

            {usage.annualKwh != null && !uploading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <NumberField
                  label="Annual usage"
                  suffix="kWh"
                  value={usage.annualKwh}
                  onChange={(v) => dispatch({ type: 'PATCH_USAGE', patch: { annualKwh: v } })}
                  min={100}
                  step={50}
                  hint={
                    billConfidence
                      ? `Read from your bill (${billConfidence} confidence). Edit if needed.`
                      : 'Edit if needed.'
                  }
                />
                <NumberField
                  label="Unit rate"
                  suffix="p/kWh"
                  value={usage.unitRatePence}
                  onChange={(v) => dispatch({ type: 'PATCH_USAGE', patch: { unitRatePence: v } })}
                  min={0}
                  step={0.1}
                />
              </div>
            ) : null}
          </section>
        ) : null}

        {usage.source === 'manual_kwh' ? (
          <section>
            <NumberField
              label="Annual electricity usage"
              suffix="kWh"
              placeholder="e.g. 3500"
              value={usage.annualKwh}
              onChange={(v) => dispatch({ type: 'PATCH_USAGE', patch: { annualKwh: v } })}
              min={100}
              step={50}
              hint="You'll find this on an annual statement or your supplier's app. A typical UK home uses 2,700–4,000 kWh per year."
            />
          </section>
        ) : null}

        {usage.source === 'monthly_cost' ? (
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField
              label="Typical monthly electricity cost"
              prefix="£"
              placeholder="e.g. 90"
              value={usage.monthlyCostGbp}
              onChange={(v) => dispatch({ type: 'PATCH_USAGE', patch: { monthlyCostGbp: v } })}
              min={0}
              step={1}
              hint="Roughly what you pay for electricity each month."
            />
            <NumberField
              label="Unit rate (optional)"
              suffix="p/kWh"
              placeholder="e.g. 24.5"
              value={usage.unitRatePence}
              onChange={(v) => dispatch({ type: 'PATCH_USAGE', patch: { unitRatePence: v } })}
              min={0}
              step={0.1}
              hint="Leave blank and we'll use a typical rate."
            />
          </section>
        ) : null}

        {usage.source === 'household' ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ss-t2)' }}>
              How many people live in your home?
            </h3>
            <ChoiceGrid
              columns={3}
              options={HOUSEHOLD_OPTIONS}
              value={usage.householdSize != null ? String(usage.householdSize) : null}
              onSelect={(value) =>
                dispatch({ type: 'PATCH_USAGE', patch: { householdSize: Number(value) } })
              }
            />
            <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
              Estimates based on household size are less accurate — uploading a bill or entering your
              kWh gives a sharper result.
            </p>
          </section>
        ) : null}
      </div>
    </StepShell>
  )
}
