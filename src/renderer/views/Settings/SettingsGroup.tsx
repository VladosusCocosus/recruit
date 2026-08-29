/**
 * The grouped inset list — the unit macOS System Settings is built out of.
 *
 * A <SettingsBlock> is one labelled box plus its footnote:
 *
 *   Appearance                     ← optional header, above and outside the box
 *   ┌───────────────────────────┐
 *   │ Theme        [ System… ]  │  ← <SettingsRow>: label left, control right
 *   ├───────────────────────────┤  ← divider, inset to the label's leading edge
 *   │ Accent       [ Blue    ]  │
 *   └───────────────────────────┘
 *   Explanatory prose goes here.  ← optional footnote, below and outside
 *
 * Two rules do most of the work. Prose lives in the footnote, not in the rows, so
 * rows keep a uniform height and the pane stays scannable. And controls are sized
 * to their content rather than stretched — a full-width input is the loudest tell
 * that a settings screen was built for the web.
 *
 * These are deliberately NOT built on <ListRow>: that renders a <button>, and a
 * settings row whose control is itself a button or a select would nest interactive
 * elements. Only <SettingsRow onClick> becomes a button, and then it carries no
 * other control.
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, NumberInput, TextInput } from '@renderer/components'

/* ── block: header + group + footnote ────────────────────────────────────── */

export interface SettingsBlockProps {
  /** Sentence case, no trailing punctuation. Omit it when the rows speak for themselves. */
  title?: ReactNode
  /** The "what does this do" prose. Sits under the box in 11px secondary. */
  footnote?: ReactNode
  children: ReactNode
}

export function SettingsBlock({ title, footnote, children }: SettingsBlockProps): JSX.Element {
  return (
    <section className="set-block">
      {title ? <h3 className="set-block-title">{title}</h3> : null}
      <div className="set-group">{children}</div>
      {footnote ? <p className="set-block-foot">{footnote}</p> : null}
    </section>
  )
}

/* ── row ─────────────────────────────────────────────────────────────────── */

export interface SettingsRowProps {
  label: ReactNode
  /** Second line under the label. Keep it to one short sentence — long prose is a footnote. */
  description?: ReactNode
  /** The control. Sized to its content; never stretched to the row width. */
  children?: ReactNode
  /**
   * Makes the whole row activate. The row becomes a <button>, so it must not also
   * contain a control — pass a trailing chevron via `chevron` instead.
   */
  onClick?: () => void
  /** Trailing disclosure chevron. Only meaningful with `onClick`. */
  chevron?: boolean
  /** Renders the label in the danger colour. For "Remove account…" and friends. */
  destructive?: boolean
  /** Renders the label in the accent colour. For "Add an account…" and friends. */
  accent?: boolean
  disabled?: boolean
  title?: string
}

export function SettingsRow({
  label,
  description,
  children,
  onClick,
  chevron = false,
  destructive = false,
  accent = false,
  disabled = false,
  title
}: SettingsRowProps): JSX.Element {
  const cls =
    'set-row' +
    (description ? ' is-tall' : '') +
    (onClick ? ' is-action' : '') +
    (destructive ? ' is-destructive' : '') +
    (accent ? ' is-accent' : '')

  const body = (
    <>
      <span className="set-row-label">
        <span className="set-row-title">{label}</span>
        {description ? <span className="set-row-desc">{description}</span> : null}
      </span>
      {children ? <span className="set-row-control">{children}</span> : null}
      {chevron ? (
        <Icon name="chevronRight" size={12} className="set-row-chevron" />
      ) : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} disabled={disabled} title={title}>
        {body}
      </button>
    )
  }
  return (
    <div className={cls} title={title}>
      {body}
    </div>
  )
}

/* ── read-only value ─────────────────────────────────────────────────────── */

/** A row's trailing slot when there is nothing to operate — About's version numbers. */
export function SettingsValue({
  children,
  mono = false
}: {
  children: ReactNode
  mono?: boolean
}): JSX.Element {
  return (
    <span className={'set-value' + (mono ? ' is-mono' : '')}>{children}</span>
  )
}

/* ── fields that commit on blur ──────────────────────────────────────────── */

/**
 * Settings apply immediately, which is right for a switch, a slider or a popup —
 * the value is complete the moment it changes. A typed field is not: "365" passes
 * through 3 and 36 on the way.
 *
 * That matters here because updateSettings is not free. It rewrites settings.json,
 * broadcasts settingsChanged, and for the two sync fields main drops and re-opens
 * the IMAP connection for every account. Committing per keystroke turns one edit
 * into three reconnects. Main also clamps and echoes the value back, so a
 * per-keystroke field fights the typist: a leading 0 rewrites itself to the minimum
 * mid-edit and the caret jumps to the end.
 *
 * So these hold a local draft and commit on blur or Enter; Escape reverts. The
 * draft resyncs whenever the committed value changes underneath (another window,
 * or main clamping what we sent).
 */

function useDraft<T>(value: T): [T, (next: T) => void, () => void] {
  const [draft, setDraft] = useState<T>(value)
  useEffect(() => setDraft(value), [value])
  return [draft, setDraft, () => setDraft(value)]
}

function commitKeys(revert: () => void) {
  return (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur()
    else if (e.key === 'Escape') {
      revert()
      e.currentTarget.blur()
    }
  }
}

export interface CommittedNumberProps {
  value: number
  min: number
  max: number
  label: string
  onCommit: (value: number) => void
}

export function CommittedNumber({
  value,
  min,
  max,
  label,
  onCommit
}: CommittedNumberProps): JSX.Element {
  const [draft, setDraft, revert] = useDraft<number | null>(value)
  return (
    <NumberInput
      value={draft}
      min={min}
      max={max}
      aria-label={label}
      className="set-w-num"
      onValueChange={setDraft}
      onKeyDown={commitKeys(revert)}
      onBlur={() => {
        // An empty or unparseable field is not an edit — put the stored value back.
        if (draft === null) return revert()
        const clamped = Math.min(max, Math.max(min, Math.round(draft)))
        setDraft(clamped)
        if (clamped !== value) onCommit(clamped)
      }}
    />
  )
}

export interface CommittedTextProps {
  value: string
  label: string
  placeholder?: string
  /** Substituted when the field is committed empty. Lets the box actually be cleared. */
  fallback?: string
  className?: string
  onCommit: (value: string) => void
}

export function CommittedText({
  value,
  label,
  placeholder,
  fallback = '',
  className,
  onCommit
}: CommittedTextProps): JSX.Element {
  const [draft, setDraft, revert] = useDraft(value)
  return (
    <TextInput
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      spellCheck={false}
      className={className}
      onValueChange={setDraft}
      onKeyDown={commitKeys(revert)}
      onBlur={() => {
        const next = draft.trim() || fallback
        setDraft(next)
        if (next !== value) onCommit(next)
      }}
    />
  )
}
