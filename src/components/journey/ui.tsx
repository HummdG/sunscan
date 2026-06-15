'use client'

import type { ReactNode } from 'react'

// ─── Shared journey UI primitives ────────────────────────────────────────────
// Styled to the SunScan "solar engineering / parchment" design system. Colours
// come exclusively from the global `--ss-*` tokens and the per-installer
// `--brand-primary` / `--brand-accent` vars set by the layout.

const SELECTED_TINT = 'color-mix(in srgb, var(--brand-primary) 8%, var(--ss-s1))'
const FOCUS_RING = '0 0 0 3px color-mix(in srgb, var(--brand-primary) 35%, transparent)'

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p
      className="ss-mono text-[11px] uppercase"
      style={{ letterSpacing: '0.22em', color: 'var(--ss-t4)' }}
    >
      {children}
    </p>
  )
}

export function StepShell({
  eyebrow,
  title,
  subtitle,
  children,
  footnote,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  children?: ReactNode
  footnote?: ReactNode
}) {
  return (
    <div className="space-y-7">
      <header className="space-y-3">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h2
          className="ss-heading text-2xl sm:text-[1.9rem] leading-tight font-semibold tracking-tight"
          style={{ color: 'var(--ss-t1)' }}
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="text-base leading-relaxed" style={{ color: 'var(--ss-t2)' }}>
            {subtitle}
          </p>
        ) : null}
      </header>
      {children}
      {footnote ? (
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ss-t3)' }}>
          {footnote}
        </p>
      ) : null}
    </div>
  )
}

// ─── Option cards ─────────────────────────────────────────────────────────────

interface OptionItem<T extends string> {
  value: T
  label: string
  description?: string
}

function columnClass(columns?: number): string {
  switch (columns) {
    case 1:
      return 'grid-cols-1'
    case 3:
      return 'grid-cols-1 sm:grid-cols-3'
    case 2:
    default:
      return 'grid-cols-1 sm:grid-cols-2'
  }
}

function OptionCard({
  selected,
  multi,
  label,
  description,
  onClick,
}: {
  selected: boolean
  multi: boolean
  label: string
  description?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : undefined}
      aria-pressed={selected}
      aria-checked={multi ? selected : undefined}
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-xl px-4 py-3.5 text-left transition-all duration-200 hover:-translate-y-0.5 focus:outline-none"
      style={{
        background: selected ? SELECTED_TINT : 'var(--ss-s1)',
        border: `1.5px solid ${selected ? 'var(--brand-primary)' : 'var(--ss-border)'}`,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.borderColor = 'var(--ss-border-h)'
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.borderColor = 'var(--ss-border)'
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = FOCUS_RING
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <span
        aria-hidden
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center transition-all"
        style={{
          borderRadius: multi ? '0.3rem' : '9999px',
          border: `1.5px solid ${selected ? 'var(--brand-primary)' : 'var(--ss-border-h)'}`,
          background: selected ? 'var(--brand-primary)' : 'transparent',
        }}
      >
        {selected ? (
          multi ? (
            <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="white" strokeWidth={2}>
              <path d="M2.5 6.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <span className="h-2 w-2 rounded-full" style={{ background: 'white' }} />
          )
        ) : null}
      </span>
      <span className="min-w-0">
        <span
          className="block text-[0.95rem] font-medium leading-snug"
          style={{ color: 'var(--ss-t1)' }}
        >
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-sm leading-snug" style={{ color: 'var(--ss-t3)' }}>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  )
}

export function ChoiceGrid<T extends string>({
  options,
  value,
  onSelect,
  columns,
}: {
  options: OptionItem<T>[]
  value: T | null
  onSelect: (value: T) => void
  columns?: number
}) {
  return (
    <div className={`grid gap-3 ${columnClass(columns)}`} role="radiogroup">
      {options.map((opt) => (
        <OptionCard
          key={opt.value}
          selected={value === opt.value}
          multi={false}
          label={opt.label}
          description={opt.description}
          onClick={() => onSelect(opt.value)}
        />
      ))}
    </div>
  )
}

export function MultiChoiceGrid<T extends string>({
  options,
  values,
  onToggle,
  columns,
}: {
  options: OptionItem<T>[]
  values: T[]
  onToggle: (value: T) => void
  columns?: number
}) {
  return (
    <div className={`grid gap-3 ${columnClass(columns)}`}>
      {options.map((opt) => (
        <OptionCard
          key={opt.value}
          selected={values.includes(opt.value)}
          multi
          label={opt.label}
          description={opt.description}
          onClick={() => onToggle(opt.value)}
        />
      ))}
    </div>
  )
}

// ─── Text + number inputs ─────────────────────────────────────────────────────

interface FieldBaseProps {
  label: string
  hint?: string
  placeholder?: string
  id?: string
}

function fieldFocusHandlers() {
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = 'var(--brand-primary)'
      e.currentTarget.style.boxShadow = FOCUS_RING
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = 'var(--ss-border-h)'
      e.currentTarget.style.boxShadow = 'none'
    },
  }
}

const inputBaseStyle: React.CSSProperties = {
  background: 'var(--ss-ink)',
  border: '1.5px solid var(--ss-border-h)',
  color: 'var(--ss-t1)',
}

export function TextField({
  label,
  hint,
  placeholder,
  id,
  value,
  onChange,
}: FieldBaseProps & { value: string; onChange: (value: string) => void }) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--ss-t2)' }}>
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl px-4 py-3 text-base outline-none transition"
        style={inputBaseStyle}
        {...fieldFocusHandlers()}
      />
      {hint ? (
        <span className="mt-1.5 block text-sm" style={{ color: 'var(--ss-t3)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  )
}

export function NumberField({
  label,
  hint,
  placeholder,
  id,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
}: FieldBaseProps & {
  value: number | null
  onChange: (value: number | null) => void
  min?: number
  max?: number
  step?: number
  prefix?: string
  suffix?: string
}) {
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1.5 block text-sm font-medium" style={{ color: 'var(--ss-t2)' }}>
        {label}
      </span>
      <div className="relative flex items-center">
        {prefix ? (
          <span
            className="pointer-events-none absolute left-4 text-base"
            style={{ color: 'var(--ss-t3)' }}
          >
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value ?? ''}
          placeholder={placeholder}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const raw = e.target.value
            onChange(raw === '' ? null : Number(raw))
          }}
          className="w-full rounded-xl py-3 text-base outline-none transition"
          style={{
            ...inputBaseStyle,
            paddingLeft: prefix ? '2rem' : '1rem',
            paddingRight: suffix ? '3rem' : '1rem',
          }}
          {...fieldFocusHandlers()}
        />
        {suffix ? (
          <span
            className="pointer-events-none absolute right-4 text-sm"
            style={{ color: 'var(--ss-t3)' }}
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? (
        <span className="mt-1.5 block text-sm" style={{ color: 'var(--ss-t3)' }}>
          {hint}
        </span>
      ) : null}
    </label>
  )
}

// ─── Buttons ──────────────────────────────────────────────────────────────────

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-base font-semibold text-white shadow-sm transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
      style={{ background: 'var(--brand-primary)' }}
      onFocus={(e) => {
        if (!e.currentTarget.disabled) e.currentTarget.style.boxShadow = FOCUS_RING
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = ''
      }}
      onMouseEnter={(e) => {
        if (!e.currentTarget.disabled) e.currentTarget.style.opacity = '0.92'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.opacity = ''
      }}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-base font-medium transition focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
      style={{ color: 'var(--ss-t2)', border: '1.5px solid var(--ss-border-h)' }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = FOCUS_RING
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = 'none'
      }}
      onMouseEnter={(e) => {
        if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--ss-s1)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}
