'use client'

import { useCallback, useRef, useState } from 'react'
import type { Dispatch } from 'react'
import type { AddressState, JourneyAction, JourneyState, RoofState } from '@/lib/journey/types'
import type { OsAddress } from '@/lib/types'
import { Eyebrow, GhostButton, StepShell } from '../ui'

interface AddressStepProps {
  state: JourneyState
  dispatch: Dispatch<JourneyAction>
  installerSlug: string
}

const FOCUS_RING = '0 0 0 3px color-mix(in srgb, var(--brand-primary) 35%, transparent)'

export function AddressStep({ state, dispatch, installerSlug }: AddressStepProps) {
  const [query, setQuery] = useState(state.address?.raw ?? '')
  const [results, setResults] = useState<OsAddress[]>([])
  const [searching, setSearching] = useState(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<OsAddress | null>(null)
  const [deriving, setDeriving] = useState(false)
  const [deriveError, setDeriveError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const confirmed = state.address?.confirmed ?? false

  const runSearch = useCallback((q: string) => {
    setQuery(q)
    setPending(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.trim().length < 3) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      setOpen(true)
      try {
        const res = await fetch(`/api/os/address?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        setResults((data.results as OsAddress[]) ?? [])
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
  }, [])

  const pickAddress = useCallback((addr: OsAddress) => {
    setPending(addr)
    setQuery(addr.address)
    setResults([])
    setOpen(false)
    setDeriveError(null)
  }, [])

  const confirmProperty = useCallback(async () => {
    if (!pending) return
    setDeriving(true)
    setDeriveError(null)
    try {
      const res = await fetch(`/api/${installerSlug}/journey/derive-roof`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lat: pending.lat,
          lng: pending.lng,
          postcode: pending.postcode,
          uprn: pending.uprn,
        }),
      })
      if (!res.ok) throw new Error('derive-roof failed')
      const data = (await res.json()) as { roof: RoofState }

      const address: AddressState = {
        raw: pending.address,
        lat: pending.lat,
        lng: pending.lng,
        postcode: pending.postcode,
        uprn: pending.uprn,
        confirmed: true,
      }
      dispatch({ type: 'SET_ADDRESS', address })
      dispatch({ type: 'SET_ROOF', roof: data.roof })
    } catch {
      setDeriveError("We couldn't model this roof just now. Please try again.")
    } finally {
      setDeriving(false)
    }
  }, [pending, installerSlug, dispatch])

  const searchAgain = useCallback(() => {
    setPending(null)
    setResults([])
    setQuery('')
    setOpen(false)
    setDeriveError(null)
  }, [])

  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const thumbSrc =
    pending && mapsKey
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${pending.lat},${pending.lng}` +
        `&zoom=20&size=600x340&scale=2&maptype=satellite&key=${mapsKey}`
      : null

  // Confirmed view — address locked in.
  if (confirmed && state.address) {
    return (
      <StepShell
        eyebrow="Step 1 · Your address"
        title="Your property is confirmed"
        subtitle="We've located your home and started modelling your roof."
      >
        <div
          className="rounded-xl p-4"
          style={{ background: 'var(--ss-s1)', border: '1.5px solid var(--brand-primary)' }}
        >
          <p className="font-medium" style={{ color: 'var(--ss-t1)' }}>
            {state.address.raw}
          </p>
          <p className="mt-0.5 text-sm" style={{ color: 'var(--ss-t3)' }}>
            {state.address.postcode}
          </p>
        </div>
        <GhostButton onClick={searchAgain}>Use a different address</GhostButton>
      </StepShell>
    )
  }

  return (
    <StepShell
      eyebrow="Step 1 · Your address"
      title="Where's your home?"
      subtitle="Start typing your address and pick it from the list. We'll model your roof from satellite imagery."
    >
      {!pending ? (
        <div className="space-y-3">
          <div className="relative">
            <input
              type="text"
              value={query}
              autoComplete="off"
              placeholder="Start typing a UK address…"
              onChange={(e) => runSearch(e.target.value)}
              className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition"
              style={{
                background: 'var(--ss-ink)',
                border: '1.5px solid var(--ss-border-h)',
                color: 'var(--ss-t1)',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--brand-primary)'
                e.currentTarget.style.boxShadow = FOCUS_RING
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--ss-border-h)'
                e.currentTarget.style.boxShadow = 'none'
              }}
            />
          </div>

          {open ? (
            <div
              className="overflow-hidden rounded-xl"
              style={{ border: '1.5px solid var(--ss-border)', background: 'var(--ss-s1)' }}
            >
              {searching ? (
                <p className="px-4 py-3 text-sm" style={{ color: 'var(--ss-t3)' }}>
                  Searching…
                </p>
              ) : results.length === 0 ? (
                <p className="px-4 py-3 text-sm" style={{ color: 'var(--ss-t3)' }}>
                  No addresses found. Try a different search.
                </p>
              ) : (
                <ul role="listbox">
                  {results.map((addr, i) => (
                    <li key={addr.uprn || `${addr.lat},${addr.lng}-${i}`}>
                      <button
                        type="button"
                        onClick={() => pickAddress(addr)}
                        className="flex w-full flex-col items-start px-4 py-3 text-left transition"
                        style={{
                          borderTop: i === 0 ? 'none' : '1px solid var(--ss-border)',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'var(--ss-s2)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <span className="text-sm font-medium" style={{ color: 'var(--ss-t1)' }}>
                          {addr.address}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--ss-t3)' }}>
                          {addr.postcode}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div
            className="overflow-hidden rounded-xl"
            style={{ border: '1.5px solid var(--ss-border-h)', background: 'var(--ss-s1)' }}
          >
            <div
              className="relative w-full"
              style={{ aspectRatio: '16 / 9', background: 'var(--ss-s2)' }}
            >
              {thumbSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbSrc}
                  alt="Satellite view of the selected property"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                  <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
                    Satellite preview unavailable
                  </p>
                </div>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-sm font-medium" style={{ color: 'var(--ss-t1)' }}>
                {pending.address}
              </p>
              <p className="text-xs" style={{ color: 'var(--ss-t3)' }}>
                {pending.postcode}
              </p>
            </div>
          </div>

          <Eyebrow>Is this the correct property?</Eyebrow>

          {deriveError ? (
            <p className="text-sm" style={{ color: 'var(--ss-blue, #B04020)' }}>
              {deriveError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={confirmProperty}
              disabled={deriving}
              className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-sm transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: 'var(--brand-primary)' }}
              onFocus={(e) => {
                if (!e.currentTarget.disabled) e.currentTarget.style.boxShadow = FOCUS_RING
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = ''
              }}
            >
              {deriving ? (
                <>
                  <span
                    className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"
                    aria-hidden
                  />
                  Modelling your roof…
                </>
              ) : (
                'Yes, that’s my home'
              )}
            </button>
            <GhostButton onClick={searchAgain} disabled={deriving}>
              Search again
            </GhostButton>
          </div>
        </div>
      )}
    </StepShell>
  )
}
