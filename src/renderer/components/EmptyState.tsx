import type { ReactNode } from 'react'
import { Icon, Spinner, type IconName } from './Icon'

export interface EmptyStateProps {
  icon?: IconName
  title: string
  message?: ReactNode
  /** Usually one or two Buttons. */
  actions?: ReactNode
  /** Tighter padding for empty panes inside a split view. */
  compact?: boolean
}

/** Centred "nothing here yet" panel. Fills its parent's height. */
export function EmptyState({
  icon,
  title,
  message,
  actions,
  compact = false
}: EmptyStateProps): JSX.Element {
  return (
    <div className={'empty' + (compact ? ' is-compact' : '')}>
      {icon ? (
        <span className="empty-icon">
          <Icon name={icon} size={compact ? 20 : 26} />
        </span>
      ) : null}
      <div className="empty-title">{title}</div>
      {message ? <div className="empty-message">{message}</div> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  )
}

/** In-pane loading placeholder. Deliberately quiet — no skeletons, no shimmer. */
export function LoadingState({ label = 'Loading…' }: { label?: string }): JSX.Element {
  return (
    <div className="loading-pad">
      <Spinner size={13} />
      {label}
    </div>
  )
}
