'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BudgetExplorer } from './BudgetExplorer'
import type { BudgetLadder, BudgetStep } from '@/lib/recommend/ladderTypes'

/**
 * Report-page host for the budget slider. Selecting a step and applying it
 * persists that config via the existing configuration endpoint (which recomputes
 * the quote and regenerates the PDF), then refreshes so the detailed report and
 * the fine-grained configurator re-initialise from the saved system.
 */
export function ReportBudgetExplorer({
  reportId,
  ladder,
  brandPrimary,
  initialBudgetGbp,
}: {
  reportId: string
  ladder: BudgetLadder
  brandPrimary: string
  initialBudgetGbp?: number
}) {
  const router = useRouter()
  const [step, setStep] = useState<BudgetStep | null>(null)
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')

  const apply = async () => {
    if (!step) return
    setStatus('saving')
    try {
      const res = await fetch(`/api/report/${reportId}/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: step.config }),
      })
      if (!res.ok) throw new Error(`Save failed (${res.status})`)
      setStatus('idle')
      router.refresh()
    } catch {
      setStatus('error')
    }
  }

  const footer = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={() => void apply()}
        disabled={status === 'saving'}
        className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-semibold text-white shadow-sm transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: brandPrimary }}
      >
        {status === 'saving' ? 'Updating your report…' : 'Apply this system & update my report'}
      </button>
      {status === 'error' ? (
        <span className="text-sm" style={{ color: 'var(--ss-t3)' }}>
          Sorry — we couldn’t update the report just now. Please try again.
        </span>
      ) : null}
    </div>
  )

  return (
    <BudgetExplorer
      ladder={ladder}
      brandPrimary={brandPrimary}
      initialBudgetGbp={initialBudgetGbp}
      onStepChange={setStep}
      footer={footer}
    />
  )
}
