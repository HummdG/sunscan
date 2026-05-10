/**
 * Brand mark — terracotta hexagon with a clean sun glyph inside.
 * Flat-top hexagon, 8-ray sun (4 cardinal + 4 ordinal) in cream.
 * Sized via the `size` prop (defaults to 32px).
 */
export function SunscanMark({
  className,
  size = 32,
}: {
  className?: string
  size?: number
}) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        background: 'var(--ss-blue)',
        clipPath:
          'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg
        width={size * 0.55}
        height={size * 0.55}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
      >
        <circle cx="12" cy="12" r="4" fill="#FAF6EC" />
        <g stroke="#FAF6EC" strokeWidth="1.8" strokeLinecap="round">
          <line x1="12" y1="6.5" x2="12" y2="3.5" />
          <line x1="12" y1="17.5" x2="12" y2="20.5" />
          <line x1="6.5" y1="12" x2="3.5" y2="12" />
          <line x1="17.5" y1="12" x2="20.5" y2="12" />
          <line x1="8.1" y1="8.1" x2="6" y2="6" />
          <line x1="15.9" y1="8.1" x2="18" y2="6" />
          <line x1="8.1" y1="15.9" x2="6" y2="18" />
          <line x1="15.9" y1="15.9" x2="18" y2="18" />
        </g>
      </svg>
    </div>
  )
}
