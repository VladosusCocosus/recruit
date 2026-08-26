import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

/* ── layout ──────────────────────────────────────────────────────────────── */

export function FormSection({
  title,
  hint,
  children
}: {
  title?: ReactNode
  hint?: ReactNode
  children: ReactNode
}): JSX.Element {
  return (
    <section className="form-section">
      {title ? <h2 className="form-section-title">{title}</h2> : null}
      {hint ? <p className="form-section-hint">{hint}</p> : null}
      {children}
    </section>
  )
}

/** Side-by-side fields, e.g. host + port. */
export function FieldRow({ children }: { children: ReactNode }): JSX.Element {
  return <div className="field-row">{children}</div>
}

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  /** Shrinks the field to port-number width inside a FieldRow. */
  narrow?: boolean
  htmlFor?: string
  children: ReactNode
}

export function Field({
  label,
  hint,
  error,
  narrow = false,
  htmlFor,
  children
}: FieldProps): JSX.Element {
  return (
    <div className={'field' + (narrow ? ' is-narrow' : '')}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? <div className="field-error">{error}</div> : null}
      {!error && hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  )
}

/* ── inputs ──────────────────────────────────────────────────────────────── */

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: string
  onValueChange: (value: string) => void
  type?: 'text' | 'email' | 'password' | 'url' | 'search'
}

export function TextInput({
  value,
  onValueChange,
  type = 'text',
  className,
  ...rest
}: TextInputProps): JSX.Element {
  return (
    <input
      type={type}
      className={'input' + (className ? ` ${className}` : '')}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      {...rest}
    />
  )
}

export interface NumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number | null
  onValueChange: (value: number | null) => void
}

export function NumberInput({
  value,
  onValueChange,
  className,
  ...rest
}: NumberInputProps): JSX.Element {
  return (
    <input
      type="number"
      className={'input' + (className ? ` ${className}` : '')}
      value={value === null ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value.trim()
        if (raw === '') return onValueChange(null)
        const n = Number(raw)
        onValueChange(Number.isFinite(n) ? n : null)
      }}
      {...rest}
    />
  )
}

export interface SelectOption<T extends string> {
  value: T
  label: string
}

export interface SelectProps<T extends string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onValueChange: (value: T) => void
}

export function Select<T extends string>({
  value,
  options,
  onValueChange,
  className,
  ...rest
}: SelectProps<T>): JSX.Element {
  return (
    <select
      className={'input' + (className ? ` ${className}` : '')}
      value={value}
      onChange={(e) => onValueChange(e.target.value as T)}
      {...rest}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export interface ToggleProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}

/** macOS-style switch. The whole row is the label, so the hit target is generous. */
export function Toggle({
  checked,
  onCheckedChange,
  label,
  hint,
  disabled = false
}: ToggleProps): JSX.Element {
  const id = useId()
  return (
    <div className="toggle">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onCheckedChange(e.target.checked)}
      />
      <label className="toggle-switch" htmlFor={id} />
      <label className="toggle-text" htmlFor={id}>
        <div className="toggle-title">{label}</div>
        {hint ? <div className="toggle-hint">{hint}</div> : null}
      </label>
    </div>
  )
}

export interface SliderProps {
  value: number
  onValueChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Rendered to the right of the track. Defaults to the raw value. */
  display?: ReactNode
  disabled?: boolean
  'aria-label'?: string
}

export function Slider({
  value,
  onValueChange,
  min = 0,
  max = 1,
  step = 0.05,
  display,
  disabled = false,
  'aria-label': ariaLabel
}: SliderProps): JSX.Element {
  return (
    <div className="slider-row">
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onValueChange(Number(e.target.value))}
      />
      <span className="slider-value">{display ?? value}</span>
    </div>
  )
}

export interface SegmentedProps<T extends string> {
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onValueChange: (value: T) => void
  'aria-label'?: string
}

/** Board / List, Light / Dark / System — a compact exclusive choice. */
export function Segmented<T extends string>({
  value,
  options,
  onValueChange,
  'aria-label': ariaLabel
}: SegmentedProps<T>): JSX.Element {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={'segmented-option' + (o.value === value ? ' is-active' : '')}
          onClick={() => onValueChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
