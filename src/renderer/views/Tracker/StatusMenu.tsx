/**
 * The board's status control: a real contextual menu.
 *
 * Every card used to carry its own popup button. On a fifteen-card board that is fifteen
 * bordered controls each announcing the status of the column they are already sitting
 * in — the single loudest thing on screen, spent on the one fact the layout had already
 * told you. macOS answers "act on this object" with a contextual menu, so that is what
 * this is: right-click anywhere on a card, or use the ••• button that appears on hover,
 * selection and keyboard focus.
 *
 * One instance is mounted per surface (the board, the list) rather than one per row, and
 * it portals to <body> because both surfaces scroll inside `overflow` containers that
 * would otherwise clip it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import type { CloseReason, ItemSummary } from '@shared/types'
import { CLOSE_REASONS } from './format'
import type { StatusIndex } from './useTracker'

/** What the caller stores while the menu is open. */
export interface StatusMenuTarget {
  item: ItemSummary
  /** Viewport coordinates of the click, or of the trigger button's corner. */
  x: number
  y: number
}

/** Anchors the menu at a mouse event — for `onContextMenu`. */
export function menuTargetFromEvent(item: ItemSummary, e: { clientX: number; clientY: number }): StatusMenuTarget {
  return { item, x: e.clientX, y: e.clientY }
}

/** Anchors the menu under a button, the way a pull-down opens. */
export function menuTargetFromElement(item: ItemSummary, el: HTMLElement): StatusMenuTarget {
  const r = el.getBoundingClientRect()
  return { item, x: r.left, y: r.bottom + 4 }
}

type Row =
  | { kind: 'item'; id: string; label: string; statusKey: string; reason: CloseReason | null; color: string | null }
  | { kind: 'section'; id: string; label: string }

function buildRows(statusIndex: StatusIndex): Row[] {
  const rows: Row[] = []
  for (const s of statusIndex.open) {
    rows.push({ kind: 'item', id: s.key, label: s.label, statusKey: s.key, reason: null, color: s.color })
  }
  for (const s of statusIndex.closed) {
    rows.push({ kind: 'section', id: `sec-${s.key}`, label: s.label })
    for (const r of CLOSE_REASONS) {
      rows.push({
        kind: 'item',
        id: `${s.key}:${r.value}`,
        label: r.label,
        statusKey: s.key,
        reason: r.value,
        color: s.color
      })
    }
    rows.push({ kind: 'item', id: `${s.key}:none`, label: 'No reason given', statusKey: s.key, reason: null, color: s.color })
  }
  return rows
}

const MARGIN = 8

export function StatusMenu({
  target,
  statusIndex,
  onChange,
  onClose
}: {
  target: StatusMenuTarget
  statusIndex: StatusIndex
  onChange: (itemId: number, statusKey: string, closeReason: CloseReason | null) => void
  onClose: () => void
}): JSX.Element {
  const { item } = target
  const rows = buildRows(statusIndex)
  const selectable = rows.filter((r): r is Extract<Row, { kind: 'item' }> => r.kind === 'item')

  const currentId = selectable.find(
    (r) => r.statusKey === item.statusKey && r.reason === (item.closeReason ?? null)
  )?.id

  const [active, setActive] = useState(
    () => Math.max(0, selectable.findIndex((r) => r.id === currentId))
  )
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Focus goes back to the item on dismiss, so a keyboard user keeps their place.
  //
  // Not simply back to whatever was focused when the menu opened: choosing a status is
  // exactly the case where that element stops existing — the card moves to another
  // column and React unmounts the ••• button that was focused, leaving focus on <body>.
  // So remember the node, and if it has since left the document, find the item's own
  // focusable element wherever it landed. `focus()` scrolls it into view, which is the
  // right behaviour when the card has just moved somewhere off screen.
  const returnFocus = useRef<HTMLElement | null>(null)
  const itemId = item.id
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    return () => {
      const remembered = returnFocus.current
      if (remembered?.isConnected) return remembered.focus()
      const moved = document.querySelector<HTMLElement>(`[data-item-focus="${itemId}"]`)
      moved?.focus()
    }
  }, [itemId])

  // Measured and placed in one layout effect, writing straight to the node rather than
  // through state. Position-by-state needs a second render before the menu is really on
  // screen, and the focus() below would then run against a not-yet-visible element and
  // silently do nothing — which is the whole keyboard story for this control.
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = Math.max(MARGIN, Math.min(target.x, window.innerWidth - width - MARGIN))
    // Flip above the pointer when there is no room below, then clamp, so a card near the
    // bottom of a scrolled column still gets a whole menu.
    const fitsBelow = target.y + height + MARGIN <= window.innerHeight
    const top = fitsBelow
      ? target.y
      : Math.max(MARGIN, Math.min(target.y - height, window.innerHeight - height - MARGIN))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.opacity = '1'
    el.focus({ preventScroll: true })
  }, [target.x, target.y])

  const choose = useCallback(
    (row: Extract<Row, { kind: 'item' }>) => {
      if (!(row.statusKey === item.statusKey && row.reason === (item.closeReason ?? null))) {
        onChange(item.id, row.statusKey, row.reason)
      }
      onClose()
    },
    [item, onChange, onClose]
  )

  // pointerdown, not click: a click outside would otherwise land on whatever is under
  // the cursor as well as closing the menu.
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) onClose()
    }
    // The board and every column body scroll, and scroll events do not bubble — hence
    // the capture phase. But the menu itself scrolls when it is taller than the window,
    // and closing it under the user's own wheel would make a long status list unusable.
    const scrolled = (e: Event): void => {
      if (menuRef.current?.contains(e.target as Node)) return
      onClose()
    }
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('resize', onClose)
    document.addEventListener('scroll', scrolled, true)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('resize', onClose)
      document.removeEventListener('scroll', scrolled, true)
    }
  }, [onClose])

  const move = (delta: number): void =>
    setActive((i) => (i + delta + selectable.length) % selectable.length)

  return createPortal(
    <div
      ref={menuRef}
      className="st-menu"
      role="menu"
      tabIndex={-1}
      aria-label={`Status for ${item.company}`}
      // Painted transparent for the one frame before the layout effect measures it.
      // Transparent rather than hidden: a `visibility: hidden` element cannot take focus.
      style={{ left: 0, top: 0, opacity: 0 }}
      onKeyDown={(e) => {
        switch (e.key) {
          case 'ArrowDown': e.preventDefault(); return move(1)
          case 'ArrowUp': e.preventDefault(); return move(-1)
          case 'Home': e.preventDefault(); return setActive(0)
          case 'End': e.preventDefault(); return setActive(selectable.length - 1)
          case 'Enter':
          case ' ': {
            e.preventDefault()
            const row = selectable[active]
            if (row) choose(row)
            return
          }
          case 'Escape':
          case 'Tab':
            e.preventDefault()
            return onClose()
        }
      }}
    >
      {rows.map((row) => {
        if (row.kind === 'section') {
          return (
            <div key={row.id} className="st-menu-section" role="presentation">
              {row.label}
            </div>
          )
        }
        const index = selectable.indexOf(row)
        const checked = row.id === currentId
        return (
          <div
            key={row.id}
            role="menuitemradio"
            aria-checked={checked}
            tabIndex={-1}
            className={'st-menu-item' + (index === active ? ' is-active' : '')}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(row)}
          >
            <span className="st-menu-check" aria-hidden="true">
              {checked ? '✓' : ''}
            </span>
            <span
              className="dot"
              aria-hidden="true"
              style={row.color ? { background: row.color } : undefined}
            />
            <span className="st-menu-label">{row.label}</span>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
