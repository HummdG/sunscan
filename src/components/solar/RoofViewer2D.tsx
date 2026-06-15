'use client'

import { useState } from 'react'

// ─── RoofViewer2D ─────────────────────────────────────────────────────────────
// A clean, framed Google Maps Static satellite view of the property. Per-segment
// panel polygon overlays are a later phase — this is intentionally simple.

interface RoofViewer2DProps {
  lat: number
  lng: number
  maxPanelCount: number
  kwpPotential: number
}

export function RoofViewer2D({ lat, lng }: RoofViewer2DProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  const [errored, setErrored] = useState(false)

  const hasImage = Boolean(apiKey) && !errored
  const src = apiKey
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}` +
      `&zoom=20&size=640x400&scale=2&maptype=satellite&key=${apiKey}`
    : null

  return (
    <figure
      className="overflow-hidden rounded-xl"
      style={{
        border: '1.5px solid color-mix(in srgb, var(--brand-primary) 22%, var(--ss-border))',
        background: 'var(--ss-s1)',
      }}
    >
      <div
        className="relative w-full"
        style={{ aspectRatio: '16 / 10', background: 'var(--ss-s2)' }}
      >
        {hasImage && src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt="Satellite view of your property"
            className="h-full w-full object-cover"
            onError={() => setErrored(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8"
              fill="none"
              stroke="var(--ss-t4)"
              strokeWidth={1.5}
              aria-hidden
            >
              <path
                d="M3 8l6-3 6 3 6-3v11l-6 3-6-3-6 3V8z"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <path d="M9 5v11M15 8v11" strokeLinecap="round" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--ss-t3)' }}>
              Satellite preview unavailable
            </p>
          </div>
        )}
      </div>
      <figcaption
        className="ss-mono px-3 py-2 text-[10px] uppercase"
        style={{
          letterSpacing: '0.22em',
          color: 'var(--ss-t4)',
          borderTop: '1px solid var(--ss-border)',
        }}
      >
        Indicative · confirmed by survey
      </figcaption>
    </figure>
  )
}
