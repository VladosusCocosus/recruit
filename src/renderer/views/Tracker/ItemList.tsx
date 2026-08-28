/**
 * Compact table alternative to the board. Same data, one row per item, sortable.
 */

import { useMemo, useState } from 'react'
import type { CloseReason, ItemSummary } from '@shared/types'
import type { JSX } from 'react'
import { Button, EmptyState, StatusBadge } from '@renderer/components'
import {
  eventWhen,
  formatCountdown,
  formatDateTime,
  formatRelative,
  lastMessageAt,
  staleness
} from './format'
import { closeReasonLabel, StatusSelect } from './StatusSelect'
import type { StatusIndex } from './useTracker'

type SortKey = 'company' | 'role' | 'status' | 'next' | 'lastMessage'

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; className?: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status', className: 'col-status' },
  { key: 'next', label: 'Next', className: 'col-next' },
  { key: 'lastMessage', label: 'Last message', className: 'col-last-message' }
]

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
  onCreateItem?: () => void
}): JSX.Element {
  const [sort, setSort] = useState<SortKey>('lastMessage')
  const [desc, setDesc] = useState(false)

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
    return (
      <EmptyState
        icon="board"
        title="No applications yet"
        message="Run a scan over your candidate mail, or add the first one by hand."
        actions={
          onCreateItem ? (
            <Button variant="primary" icon="plus" onClick={onCreateItem}>
              Add application
            </Button>
          ) : null
        }
      />
    )
  }

  return (
    <table className="item-table">
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th key={col.key} className={col.className} aria-sort={sort === col.key ? (desc ? 'descending' : 'ascending') : 'none'}>
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
          return (
            <tr
              key={item.id}
              className={`item-row${item.id === selectedItemId ? ' is-selected' : ''}`}
              tabIndex={0}
              onClick={() => onOpenItem(item.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpenItem(item.id)
              }}
            >
              <td className="col-company">
                <span className="truncate" title={item.company}>
                  {item.company}
                </span>
                {stale.stale ? <span className="stale-dot" title={`Stale — ${stale.days} days quiet`} /> : null}
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
              <td className="col-next secondary">
                {item.nextEvent ? (
                  <span className="truncate" title={eventWhen(item.nextEvent)}>
                    {item.nextEvent.title} · {formatCountdown(item.nextEvent.startsAt, now)}
                  </span>
                ) : (
                  <span className="tertiary">—</span>
                )}
              </td>
              <td className="col-last-message tertiary tabular">
                {lastMessage ? (
                  <span title={formatDateTime(lastMessage)}>
                    {formatRelative(lastMessage, now)}
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                <StatusSelect
                  item={item}
                  statusIndex={statusIndex}
                  onChange={(statusKey, closeReason) =>
                    onChangeStatus(item.id, statusKey, closeReason)
                  }
                />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
