/**
 * The board. One column per OPEN status in sort order, then every closed status
 * collapsed into a single trailing column — a job search has one "done" pile, not four.
 *
 * Cards move by drag or by the status dropdown on the card itself; the dropdown is the
 * real control (keyboard reachable, carries close reasons) and drag is the shortcut.
 */

import { useMemo, useState } from 'react'
import type { CloseReason, ItemSummary, Status } from '@shared/types'
import type { DragEvent, JSX } from 'react'
import { Badge, Button, Dot, EmptyState } from '@renderer/components'
import { ITEM_DRAG_TYPE, ItemCard } from './ItemCard'
import type { StatusIndex } from './useTracker'

interface Column {
  key: string
  label: string
  color: string | null
  kind: 'open' | 'closed'
  statuses: Status[]
  items: ItemSummary[]
}

function buildColumns(statusIndex: StatusIndex, items: ItemSummary[]): Column[] {
  const columns: Column[] = statusIndex.open.map((s) => ({
    key: s.key,
    label: s.label,
    color: s.color,
    kind: 'open',
    statuses: [s],
    items: []
  }))

  const closedStatuses = statusIndex.closed
  if (closedStatuses.length > 0) {
    const primary = closedStatuses[0] as Status
    columns.push({
      key: primary.key,
      label: closedStatuses.length === 1 ? primary.label : 'Closed',
      color: primary.color,
      kind: 'closed',
      statuses: closedStatuses,
      items: []
    })
  }

  const byKey = new Map<string, Column>()
  for (const col of columns) for (const s of col.statuses) byKey.set(s.key, col)

  // An item whose status key isn't in the statuses table would otherwise vanish from the
  // board entirely. Park it in the first column so it stays reachable.
  const fallback = columns[0]
  for (const item of items) {
    const col = byKey.get(item.statusKey) ?? fallback
    col?.items.push(item)
  }

  for (const col of columns) {
    col.items.sort((a, b) => {
      const an = a.nextEvent?.startsAt ?? null
      const bn = b.nextEvent?.startsAt ?? null
      if (an && bn) return an.localeCompare(bn)
      if (an) return -1
      if (bn) return 1
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    })
  }

  return columns
}

export function Board({
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
  const [dragItemId, setDragItemId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const columns = useMemo(() => buildColumns(statusIndex, items), [statusIndex, items])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  if (statusIndex.statuses.length === 0) {
    return <EmptyState icon="board" title="No statuses configured" />
  }

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

  const readDragId = (e: DragEvent<HTMLElement>): number | null => {
    const raw = e.dataTransfer.getData(ITEM_DRAG_TYPE) || e.dataTransfer.getData('text/plain')
    const id = Number.parseInt(raw, 10)
    return Number.isFinite(id) ? id : dragItemId
  }

  const handleDrop = (e: DragEvent<HTMLElement>, col: Column): void => {
    e.preventDefault()
    setDropTarget(null)
    setDragItemId(null)
    const id = readDragId(e)
    if (id === null) return
    const item = byId.get(id)
    if (!item) return
    if (col.statuses.some((s) => s.key === item.statusKey)) return

    // Dragging into Closed keeps a reason the item already had; otherwise it lands
    // reason-less and the card's dropdown is where the user says why.
    const wasClosed = statusIndex.kindOf(item) === 'closed'
    const reason: CloseReason | null = col.kind === 'closed' && wasClosed ? item.closeReason : null
    onChangeStatus(id, col.key, reason)
  }

  return (
    <div className="board">
      {columns.map((col) => {
        const active = dropTarget === col.key
        return (
          <section
            key={col.key}
            className={`board-column${active ? ' is-drop-target' : ''}${
              col.kind === 'closed' ? ' is-closed' : ''
            }`}
            onDragOver={(e) => {
              if (dragItemId === null && !e.dataTransfer.types.includes(ITEM_DRAG_TYPE)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dropTarget !== col.key) setDropTarget(col.key)
            }}
            onDragLeave={(e) => {
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
              setDropTarget((t) => (t === col.key ? null : t))
            }}
            onDrop={(e) => handleDrop(e, col)}
          >
            <header className="board-column-head">
              <Dot color={col.color ?? undefined} />
              <span className="board-column-label">{col.label}</span>
              <Badge>{col.items.length}</Badge>
            </header>
            <div className="board-column-body">
              {col.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  statusIndex={statusIndex}
                  now={now}
                  selected={item.id === selectedItemId}
                  onOpen={onOpenItem}
                  onChangeStatus={onChangeStatus}
                  onDragStateChange={setDragItemId}
                />
              ))}
              {col.items.length === 0 ? (
                <div className="board-column-empty tertiary">
                  {active ? 'Drop here' : 'Nothing here'}
                </div>
              ) : null}
            </div>
          </section>
        )
      })}
    </div>
  )
}
