/**
 * Compact table alternative to the board. Same data, one row per item, sortable.
 *
 * A table is for comparing, so unlike the board it keeps every fact in its own column
 * rather than collapsing them into one signal line — but it borrows the board's colour
 * language: an imminent interview reads accent, a thread that has gone quiet reads
 * warning, everything else stays quiet.
 */

import { useMemo, useState } from 'react'
import type { CloseReason, ItemSummary } from '@shared/types'
import type { JSX } from 'react'
import { Button, EmptyState, Icon, StatusBadge } from '@renderer/components'
import {
  closeReasonLabel,
  eventWhen,
  formatCountdown,
  formatDateTime,
  formatRelative,
  isFutureEvent,
  lastMessageAt,
  staleness
} from './format'
import { StatusMenu, menuTargetFromElement, menuTargetFromEvent, type StatusMenuTarget } from './StatusMenu'
import type { StatusIndex } from './useTracker'

type SortKey = 'company' | 'role' | 'status' | 'next' | 'lastMessage'

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; className?: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status', className: 'col-status' },
  { key: 'next', label: 'Next', className: 'col-next' },
  { key: 'lastMessage', label: 'Last message', className: 'col-last-message' }
]

/** Within this window the next event is something you are about to do. Matches `itemSignal`. */
const SOON_MS = 2 * 24 * 60 * 60 * 1000

function compare(a: ItemSummary, b: ItemSummary, key: SortKey, statusIndex: StatusIndex): number {
  switch (key) {
    case 'company':
      return a.company.localeCompare(b.company)
    case 'role':
      return (a.role ?? '').localeCompare(b.role ?? '')
    case 'status': {
      const ao = statusIndex.byKey.get(a.statusKey)?.sortOrder ?? 99
      const bo = statusIndex.byKey.get(b.statusKey)?.sortOrder ?? 99
      return ao - bo || a.company.localeCompare(b.company)
    }
    case 'next': {
      // Items with nothing scheduled sort last, whichever direction you're sorting.
      const an = a.nextEvent?.startsAt ?? ''
      const bn = b.nextEvent?.startsAt ?? ''
      if (!an && !bn) return a.company.localeCompare(b.company)
      if (!an) return 1
      if (!bn) return -1
      return an.localeCompare(bn)
    }
    case 'lastMessage': {
      // Most recent mail first. Items with no mail are parked at the end afterwards,
      // in both directions — see `rows`.
      const am = lastMessageAt(a)
      const bm = lastMessageAt(b)
      if (!am && !bm) return a.company.localeCompare(b.company)
      if (!am) return 1
      if (!bm) return -1
      return bm.localeCompare(am)
    }
    default:
      return 0
  }
}

export function ItemList({
  items,
  statusIndex,
  now,
  selectedItemId,
  onOpenItem,
  onChangeStatus,
  onCreateItem
}: {
  items: ItemSummary[]
  statusIndex: StatusIndex
  now: number
  selectedItemId?: number | null
  onOpenItem: (itemId: number) => void
  onChangeStatus: (itemId: number, statusKey: string, closeReason: CloseReason | null) => void
  onCreateItem?: (statusKey: string) => void
}): JSX.Element {
  const [sort, setSort] = useState<SortKey>('lastMessage')
  const [desc, setDesc] = useState(false)
  const [menu, setMenu] = useState<StatusMenuTarget | null>(null)

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => compare(a, b, sort, statusIndex))
    if (desc) sorted.reverse()
    // Flipping to oldest-first is how you find the threads that have gone quiet, and a
    // row with no mail has no answer to "how long ago?" — park those at the end either
    // way instead of letting the flip float a wall of blanks to the top.
    if (sort === 'lastMessage') {
      return [...sorted.filter((i) => lastMessageAt(i)), ...sorted.filter((i) => !lastMessageAt(i))]
    }
    return sorted
  }, [items, sort, desc, statusIndex])

  if (items.length === 0) {
    const firstOpen = statusIndex.open[0]?.key ?? 'saved'
    return (
      <EmptyState
        icon="board"
        title="No applications yet"
        message="Run a scan over your candidate mail, or add the first one by hand."
        actions={
          onCreateItem ? (
            <Button variant="primary" icon="plus" onClick={() => onCreateItem(firstOpen)}>
              Add application
            </Button>
          ) : null
        }
      />
    )
  }

  return (
    <>
      <table className="item-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={col.className}
                aria-sort={sort === col.key ? (desc ? 'descending' : 'ascending') : 'none'}
              >
                <button
                  type="button"
                  className="item-table-sort"
                  onClick={() => {
                    if (sort === col.key) setDesc((d) => !d)
                    else {
                      setSort(col.key)
                      setDesc(false)
                    }
                  }}
                >
                  {col.label}
                  {sort === col.key ? <span aria-hidden="true">{desc ? ' ↓' : ' ↑'}</span> : null}
                </button>
              </th>
            ))}
            <th className="col-actions">
              <span className="sr-only">Change status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const status = statusIndex.byKey.get(item.statusKey)
            const kind = statusIndex.kindOf(item)
            const stale = staleness(item, kind, now)
            const lastMessage = lastMessageAt(item)
            const reason = closeReasonLabel(item.closeReason)
            const next = item.nextEvent
            const soon =
              next && isFutureEvent(next, now) && Date.parse(next.startsAt ?? '') - now <= SOON_MS
            return (
              <tr
                key={item.id}
                className={`item-row${item.id === selectedItemId ? ' is-selected' : ''}`}
                data-item-focus={item.id}
                tabIndex={0}
                onClick={() => onOpenItem(item.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu(menuTargetFromEvent(item, e))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onOpenItem(item.id)
                }}
              >
                <td className="col-company">
                  <span className="truncate" title={item.company}>
                    {item.company}
                  </span>
                  {stale.stale ? (
                    <span
                      className="stale-dot"
                      title={`Nothing heard for ${stale.days} days, and nothing booked`}
                    >
                      <span className="sr-only">Quiet</span>
                    </span>
                  ) : null}
                </td>
                <td className="col-role secondary">
                  <span className="truncate" title={item.role ?? undefined}>
                    {item.role ?? '—'}
                  </span>
                </td>
                <td className="col-status">
                  <StatusBadge status={status ?? null} statusKey={item.statusKey} />
                  {reason ? <span className="tertiary close-reason">{reason}</span> : null}
                </td>
                <td className={'col-next ' + (soon ? 'is-urgent' : 'secondary')}>
                  {next ? (
                    <span className="truncate" title={eventWhen(next)}>
                      {next.title} · {formatCountdown(next.startsAt, now)}
                    </span>
                  ) : (
                    <span className="tertiary">—</span>
                  )}
                </td>
                {/* The warning tint belongs on a date that has gone stale, not on the
                    dash that stands in for "no mail at all" — colouring an em dash says
                    nothing and spends the one colour that should mean "chase this". */}
                <td
                  className={
                    'col-last-message tabular ' +
                    (stale.stale && lastMessage ? 'is-quiet-warning' : 'tertiary')
                  }
                >
                  {lastMessage ? (
                    <span title={formatDateTime(lastMessage)}>{formatRelative(lastMessage, now)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="item-row-menu"
                    aria-label={`Change status of ${item.company}`}
                    aria-haspopup="menu"
                    onClick={(e) => setMenu(menuTargetFromElement(item, e.currentTarget))}
                  >
                    <Icon name="ellipsis" size={13} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {menu ? (
        <StatusMenu
          target={menu}
          statusIndex={statusIndex}
          onChange={onChangeStatus}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </>
  )
}
