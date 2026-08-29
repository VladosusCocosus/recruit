/**
 * The board. One column per OPEN status in sort order, then every closed status
 * collapsed into a single trailing column — a job search has one "done" pile, not four.
 *
 * Columns are groups, not panes: labelled regions on a recessed ground with the cards
 * inset inside them, the same shape the Settings pane uses for its grouped lists. The
 * old board drew a full-height hairline between every column, which is how macOS
 * separates *panes* — and made six columns read as six windows.
 *
 * Cards move by drag, or through the contextual menu on the card, which is the control
 * that carries close reasons, archiving and the keyboard path.
 */

import { useCallback, useMemo, useState } from 'react'
import type { CloseReason, ItemSummary, Status } from '@shared/types'
import type { DragEvent, JSX, KeyboardEvent } from 'react'
import { Button, EmptyState, Icon } from '@renderer/components'
import { ITEM_DRAG_TYPE, ItemCard } from './ItemCard'
import { ItemMenu, type ItemMenuTarget } from './ItemMenu'
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

/**
 * Arrow-key movement across the grid the board already draws.
 *
 * Tab alone gets you there, but a fifteen-card board is thirty tab stops, and a board is
 * two-dimensional — Finder's icon view and Mail's list both answer arrow keys, and this
 * is the same shape. Read off the DOM rather than the columns model so the order matched
 * is the order on screen, including whatever the current sort did.
 */
function focusNeighbour(board: HTMLElement, from: HTMLElement, key: string): boolean {
  const grid = [...board.querySelectorAll('.board-column')].map((col) => [
    ...col.querySelectorAll<HTMLElement>('.item-card-open')
  ])
  const colIndex = grid.findIndex((cards) => cards.includes(from))
  if (colIndex === -1) return false
  const rowIndex = grid[colIndex]!.indexOf(from)

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const next = grid[colIndex]![rowIndex + (key === 'ArrowDown' ? 1 : -1)]
    if (!next) return false
    next.focus()
    return true
  }

  // Sideways, skipping empty columns — stopping on one would strand the focus with
  // nothing to move to next.
  const step = key === 'ArrowRight' ? 1 : -1
  for (let i = colIndex + step; i >= 0 && i < grid.length; i += step) {
    const cards = grid[i]!
    if (cards.length === 0) continue
    cards[Math.min(rowIndex, cards.length - 1)]!.focus()
    return true
  }
  return false
}

export function Board({
  items,
  statusIndex,
  now,
  selectedItemId,
  onOpenItem,
  onChangeStatus,
  onArchiveItem,
  onCreateItem
}: {
  items: ItemSummary[]
  statusIndex: StatusIndex
  now: number
  selectedItemId?: number | null
  onOpenItem: (itemId: number) => void
  onChangeStatus: (itemId: number, statusKey: string, closeReason: CloseReason | null) => void
  /** Omit and the card menu leaves its archive row out. */
  onArchiveItem?: (itemId: number, archived: boolean) => void
  /** Creates an application already in that column, so the header's + lands where it says. */
  onCreateItem?: (statusKey: string) => void
}): JSX.Element {
  const [dragItemId, setDragItemId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [menu, setMenu] = useState<ItemMenuTarget | null>(null)

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    const from = e.target as HTMLElement
    if (!from.classList?.contains('item-card-open')) return
    if (focusNeighbour(e.currentTarget, from, e.key)) e.preventDefault()
  }, [])

  const columns = useMemo(() => buildColumns(statusIndex, items), [statusIndex, items])
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  if (statusIndex.statuses.length === 0) {
    return <EmptyState icon="board" title="No statuses configured" />
  }

  const firstOpen = statusIndex.open[0]?.key ?? 'saved'

  if (items.length === 0) {
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
    // reason-less and the card's menu is where the user says why.
    const wasClosed = statusIndex.kindOf(item) === 'closed'
    const reason: CloseReason | null = col.kind === 'closed' && wasClosed ? item.closeReason : null
    onChangeStatus(id, col.key, reason)
  }

  return (
    <div className="board" onKeyDown={onKeyDown}>
      {columns.map((col) => {
        const active = dropTarget === col.key
        return (
          <section
            key={col.key}
            className={'board-column' + (active ? ' is-drop-target' : '')}
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
              <span
                className="dot"
                aria-hidden="true"
                style={col.color ? { background: col.color } : undefined}
              />
              <span className="board-column-label truncate">{col.label}</span>
              <span className="board-column-count tabular">{col.items.length}</span>
              {onCreateItem && col.kind === 'open' ? (
                <button
                  type="button"
                  className="board-column-add"
                  aria-label={`Add an application to ${col.label}`}
                  onClick={() => onCreateItem(col.key)}
                >
                  <Icon name="plus" size={12} />
                </button>
              ) : null}
            </header>

            <div className="board-column-body">
              {col.items.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  statusIndex={statusIndex}
                  now={now}
                  selected={item.id === selectedItemId}
                  menuOpen={menu?.item.id === item.id}
                  dragging={item.id === dragItemId}
                  onOpen={onOpenItem}
                  onRequestMenu={setMenu}
                  onDragStateChange={setDragItemId}
                />
              ))}

              {/* Only while something is actually being dragged. A permanent dashed
                  "Nothing here" box in every empty column is six pieces of furniture
                  telling you nothing you couldn't already see. */}
              {dragItemId !== null && col.items.length === 0 ? (
                <div className="board-drop-hint">Drop here</div>
              ) : null}
            </div>
          </section>
        )
      })}

      {menu ? (
        <ItemMenu
          /* Keyed by the subject: right-clicking a second card while the first card's
             menu is open re-anchors the same component, and without a remount the
             highlighted row carries over from the application you just left. */
          key={menu.item.id}
          target={menu}
          statusIndex={statusIndex}
          actions={{
            onOpen: onOpenItem,
            onChangeStatus,
            ...(onArchiveItem ? { onArchive: onArchiveItem } : {})
          }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </div>
  )
}
