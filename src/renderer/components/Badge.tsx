import type { ReactNode } from 'react'
import type { Status } from '@shared/types'

export type BadgeTone = 'neutral' | 'accent' | 'accent-soft' | 'danger' | 'warning' | 'success'

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  accent: ' is-accent',
  'accent-soft': ' is-accent-soft',
  danger: ' is-danger',
  warning: ' is-warning',
  success: ' is-success'
}

export interface BadgeProps {
  children: ReactNode
  tone?: BadgeTone
  title?: string
}

/** Small pill. Use for counts, short labels. */
export function Badge({ children, tone = 'neutral', title }: BadgeProps): JSX.Element {
  return (
    <span className={'badge' + TONE_CLASS[tone]} title={title}>
      {children}
    </span>
  )
}

export interface CountBadgeProps {
  count: number
  tone?: BadgeTone
  /** Render nothing at 0 (default). Set false to always show. */
  hideZero?: boolean
  /** Clamp display, e.g. 99 renders "99+" past that. */
  max?: number
  title?: string
}

/** The rail / RUN-button count pill. Returns null at 0 unless hideZero is false. */
export function CountBadge({
  count,
  tone = 'neutral',
  hideZero = true,
  max = 999,
  title
}: CountBadgeProps): JSX.Element | null {
  if (count <= 0 && hideZero) return null
  return (
    <Badge tone={tone} title={title}>
      {count > max ? `${max}+` : count}
    </Badge>
  )
}

export interface StatusBadgeProps {
  /** Full status row when you have one — gives the real colour + label. */
  status?: Status | null
  /** Fallback when only the key is at hand (e.g. a proposal payload). */
  statusKey?: string | null
}

const FALLBACK_LABEL: Record<string, string> = {
  saved: 'Saved',
  applied: 'Applied',
  screening: 'Screening',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed'
}

/** Coloured status chip for board cards, item rows and proposal cards. */
export function StatusBadge({ status, statusKey }: StatusBadgeProps): JSX.Element | null {
  const key = status?.key ?? statusKey ?? null
  if (!key) return null
  const label = status?.label ?? FALLBACK_LABEL[key] ?? key
  const closed = status?.kind === 'closed' || key === 'closed'
  return (
    <span className={'status-badge' + (closed ? ' is-closed' : '')}>
      <span className="dot" style={status?.color ? { background: status.color } : undefined} />
      {label}
    </span>
  )
}

/** A bare coloured dot. `unread` paints it accent. */
export function Dot({ unread = false, color }: { unread?: boolean; color?: string }): JSX.Element {
  return (
    <span className={'dot' + (unread ? ' is-unread' : '')} style={color ? { background: color } : undefined} />
  )
}

/** Low-emphasis inline tag: "3 messages", "greenhouse.io", "remote". */
export function Chip({ children, title }: { children: ReactNode; title?: string }): JSX.Element {
  return (
    <span className="chip" title={title}>
      {children}
    </span>
  )
}
