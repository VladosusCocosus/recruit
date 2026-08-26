/**
 * Compact table alternative to the board. Same data, one row per item, sortable.
 */

import { useMemo, useState } from 'react'
import type { CloseReason, ItemSummary } from '@shared/types'
import type { JSX } from 'react'
import { Button, EmptyState, StatusBadge } from '@renderer/components'
import { eventWhen, formatCountdown, formatRelative, lastActivityAt, staleness } from './format'
import { closeReasonLabel, StatusSelect } from './StatusSelect'
import type { StatusIndex } from './useTracker'

type SortKey = 'company' | 'role' | 'status' | 'next' | 'activity'

const COLUMNS: ReadonlyArray<{ key: SortKey; label: string; className?: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status', className: 'col-status' },
  { key: 'next', label: 'Next', className: 'col-next' },
  { key: 'activity', label: 'Last activity', className: 'col-activity' }
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
    case 'activity':
      return lastActivityAt(b).localeCompare(lastActivityAt(a))
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
  const [sort, setSort] = useState<SortKey>('activity')
  const [desc, setDesc] = useState(false)

  const rows = useMemo(() => {
    const sorted = [...items].sort((a, b) => compare(a, b, sort, statusIndex))
    return desc ? sorted.reverse() : sorted
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
              <td className="col-activity tertiary tabular">
                {formatRelative(lastActivityAt(item), now)}
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
