/**
 * The contextual menu for one application, shared by the board and the item table.
 *
 * It replaced a menu that only ever changed status. That menu was right about the
 * gesture and too narrow about the contents: a card is an object, and the things you
 * want to do to it — open it, move it, file it away, grab the company name for a job
 * board search — were spread across the detail pane, a drag, and nowhere at all.
 *
 * Status now sits behind "Move to ▸" rather than filling the menu. Eleven of the sixteen
 * rows a flat version needs are statuses and close reasons, and burying Open and Archive
 * under that pile to save one hover is the wrong trade — especially when dragging a card
 * across columns is still the one-gesture path, and always was.
 *
 * What is NOT here is deleting. `deleteItem` is permanent, and the reversible way to get
 * an application off the board is Archive, which is what this offers. Permanent deletion
 * keeps its two-step confirmation in the inspector, where there is room to say what it
 * means; a menu row cannot ask.
 */

import type { JSX } from 'react'
import type { CloseReason, ItemSummary } from '@shared/types'
import { Menu, anchorFromElement, anchorFromEvent } from '@renderer/components'
import type { MenuAnchor, MenuNode, MenuNodeList } from '@renderer/components'
import { copyText } from '@renderer/components'
import { CLOSE_REASONS } from './format'
import type { StatusIndex } from './useTracker'

/** What the caller stores while the menu is open. */
export interface ItemMenuTarget {
  item: ItemSummary
  anchor: MenuAnchor
}

/** Anchors the menu at a right-click. */
export function itemMenuTargetFromEvent(
  item: ItemSummary,
  e: { clientX: number; clientY: number }
): ItemMenuTarget {
  return { item, anchor: anchorFromEvent(e) }
}

/** Anchors the menu under the ••• button, the way a pull-down opens. */
export function itemMenuTargetFromElement(item: ItemSummary, el: HTMLElement): ItemMenuTarget {
  return { item, anchor: anchorFromElement(el) }
}

export interface ItemMenuActions {
  onOpen: (itemId: number) => void
  onChangeStatus: (itemId: number, statusKey: string, closeReason: CloseReason | null) => void
  /** Omit to leave the archive row out entirely — a surface that cannot archive says so. */
  onArchive?: (itemId: number, archived: boolean) => void
}

/**
 * The status choices, as one radio group split across an open list and a section per
 * closed status. A close reason is part of *which* status you are choosing, not a
 * follow-up question, so the reasons are rows here rather than a second dialog.
 */
function moveToItems(
  item: ItemSummary,
  statusIndex: StatusIndex,
  onChangeStatus: ItemMenuActions['onChangeStatus']
): MenuNode[] {
  const currentReason = item.closeReason ?? null
  const rows: MenuNode[] = []

  const choice = (
    id: string,
    label: string,
    statusKey: string,
    reason: CloseReason | null
  ): MenuNode => ({
    kind: 'action',
    id,
    label,
    role: 'menuitemradio',
    checked: statusKey === item.statusKey && reason === currentReason,
    onSelect: () => {
      // Re-picking what it already is should be a no-op, not a write that stamps
      // `updatedAt` and reshuffles anything sorted by it.
      if (statusKey === item.statusKey && reason === currentReason) return
      onChangeStatus(item.id, statusKey, reason)
    }
  })

  for (const s of statusIndex.open) rows.push(choice(s.key, s.label, s.key, null))

  for (const s of statusIndex.closed) {
    rows.push({ kind: 'section', id: `sec-${s.key}`, label: s.label })
    for (const r of CLOSE_REASONS) {
      rows.push(choice(`${s.key}:${r.value}`, r.label, s.key, r.value))
    }
    rows.push(choice(`${s.key}:none`, 'No reason given', s.key, null))
  }

  return rows
}

function itemMenuItems(
  item: ItemSummary,
  statusIndex: StatusIndex,
  actions: ItemMenuActions
): MenuNodeList {
  const archived = Boolean(item.archivedAt)

  return [
    {
      kind: 'action',
      id: 'open',
      label: 'Open',
      // Real: the card's stretched button and the table row both open on Enter.
      shortcut: '⏎',
      onSelect: () => actions.onOpen(item.id)
    },
    { kind: 'submenu', id: 'move', label: 'Move to', items: moveToItems(item, statusIndex, actions.onChangeStatus) },
    { kind: 'separator', id: 'sep-copy' },
    {
      kind: 'action',
      id: 'copy-company',
      label: 'Copy company',
      onSelect: () => void copyText(item.company)
    },
    actions.onArchive && { kind: 'separator' as const, id: 'sep-archive' },
    actions.onArchive && {
      kind: 'action' as const,
      id: 'archive',
      label: archived ? 'Move out of archive' : 'Archive',
      onSelect: () => actions.onArchive?.(item.id, !archived)
    }
  ]
}

export function ItemMenu({
  target,
  statusIndex,
  actions,
  onClose
}: {
  target: ItemMenuTarget
  statusIndex: StatusIndex
  actions: ItemMenuActions
  onClose: () => void
}): JSX.Element {
  const { item } = target
  return (
    <Menu
      anchor={target.anchor}
      items={itemMenuItems(item, statusIndex, actions)}
      label={item.role ? `${item.company} — ${item.role}` : item.company}
      // The card that opened this may have moved to another column by the time it
      // closes, taking the focused ••• button with it. Both surfaces stamp the item's
      // focusable element with this, wherever it lands.
      returnFocusTo={`[data-item-focus="${item.id}"]`}
      onClose={onClose}
    />
  )
}
