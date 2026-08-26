import type { ReactNode } from 'react'
import { Dot } from './Badge'

export interface ListRowProps {
  /** Primary line — subject, company, event title. */
  title: ReactNode
  /** Second line — sender, role, item name. */
  subtitle?: ReactNode
  /** Right-aligned on the title line. Usually a date. */
  meta?: ReactNode
  /** Third line, clamped to two lines. Message snippets go here. */
  snippet?: ReactNode
  /** Chips / badges under the text. */
  tags?: ReactNode
  /** Leading marker column: unread dot by default, or supply your own node. */
  lead?: ReactNode
  unread?: boolean
  selected?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  /** Native tooltip for the whole row. */
  tooltip?: string
}

/**
 * The one row primitive every list in the app uses — mail list, candidates,
 * item list, up-next. Renders as a <button> so keyboard and focus work for free.
 */
export function ListRow({
  title,
  subtitle,
  meta,
  snippet,
  tags,
  lead,
  unread = false,
  selected = false,
  onClick,
  onDoubleClick,
  tooltip
}: ListRowProps): JSX.Element {
  const classes =
    'list-row' + (selected ? ' is-selected' : '') + (unread ? ' is-unread' : '')
  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      aria-current={selected ? 'true' : undefined}
      title={tooltip}
    >
      <span className="list-row-lead">{lead ?? (unread ? <Dot unread /> : null)}</span>
      <span className="list-row-main">
        <span className="list-row-top">
          <span className="list-row-title">{title}</span>
          {meta ? <span className="list-row-meta">{meta}</span> : null}
        </span>
        {subtitle ? <span className="list-row-subtitle">{subtitle}</span> : null}
        {snippet ? <span className="list-row-snippet">{snippet}</span> : null}
        {tags ? <span className="list-row-tags">{tags}</span> : null}
      </span>
    </button>
  )
}

/** Vertical container for ListRows. */
export function List({ children }: { children: ReactNode }): JSX.Element {
  return <div className="list">{children}</div>
}
