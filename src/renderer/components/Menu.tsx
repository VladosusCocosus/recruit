/**
 * The app's contextual menu.
 *
 * macOS answers "act on this object" with a menu that appears at the pointer, so every
 * surface that shows a list of objects — the board, the item table, the mail list — opens
 * this one. It is deliberately a menu and not a popover of buttons: a menu is dismissible
 * from anywhere, arrow-navigable, and carries the grammar (checkmarks, sections,
 * submenus, key equivalents) that tells you what a row will do before you pick it.
 *
 * Three conventions it follows on purpose, because breaking them is what makes a web
 * menu feel like a web menu:
 *
 *  - No icons on the rows. Finder, Mail and the Dock all set contextual menus as plain
 *    text; the leading gutter belongs to the checkmark that marks the current choice.
 *  - The row under the pointer takes a solid accent fill, not a grey tint. A tint beside
 *    real system menus reads as "disabled".
 *  - A key equivalent is shown only where the key is actually bound. A menu that lists
 *    shortcuts which do nothing is worse than one that lists none.
 *
 * One instance is mounted per surface rather than one per row, and it portals to <body>
 * because every one of those surfaces scrolls inside an `overflow` container that would
 * otherwise clip it.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Icon } from './Icon'

/* ── the model ───────────────────────────────────────────────────────────── */

export interface MenuAction {
  kind: 'action'
  id: string
  label: string
  /** Draws the leading checkmark. Pair with `role: 'menuitemradio'` for a set of choices. */
  checked?: boolean
  role?: 'menuitem' | 'menuitemradio' | 'menuitemcheckbox'
  disabled?: boolean
  /** Red label — reserved for something the user cannot get back by repeating the action. */
  danger?: boolean
  /** Key equivalent, e.g. '⏎'. Only set it when that key really is bound on the surface. */
  shortcut?: string
  onSelect: () => void
}

export interface MenuSubmenu {
  kind: 'submenu'
  id: string
  label: string
  items: MenuNodeList
}

/** A titled group with its own separator, the way a macOS menu labels a run of choices. */
export interface MenuSection {
  kind: 'section'
  id: string
  label: string
}

export interface MenuSeparator {
  kind: 'separator'
  id: string
}

export type MenuNode = MenuAction | MenuSubmenu | MenuSection | MenuSeparator

/**
 * `null` and `false` are allowed so a builder can write `cond && { … }` inline; the
 * separators around a row that drops out are cleaned up by `normalize`.
 */
export type MenuNodeList = ReadonlyArray<MenuNode | null | false | undefined>

/**
 * Drop the absent rows, then collapse the separators they leave behind — runs of two,
 * and any left stranded at the top or bottom. Without this, a message with no sender
 * address and no subject opens a menu with two rules and nothing between them.
 */
function normalize(items: MenuNodeList): MenuNode[] {
  const present = items.filter((node): node is MenuNode => Boolean(node))
  const out: MenuNode[] = []
  for (const node of present) {
    const isRule = node.kind === 'separator'
    if (isRule && (out.length === 0 || out[out.length - 1]?.kind === 'separator')) continue
    out.push(node)
  }
  while (out[out.length - 1]?.kind === 'separator') out.pop()
  return out
}

const isSelectable = (node: MenuNode): node is MenuAction | MenuSubmenu =>
  (node.kind === 'action' && !node.disabled) || node.kind === 'submenu'

/* ── anchoring ───────────────────────────────────────────────────────────── */

export interface MenuAnchor {
  x: number
  y: number
  /**
   * Set only for a submenu, which opens *beside* its parent row rather than at a point:
   * it slides up to fit rather than flipping over the anchor, and when it would run off
   * the right edge it mirrors so its right edge lands here instead.
   */
  flipX?: number
}

/** Anchors at the pointer — for `onContextMenu`. */
export function anchorFromEvent(e: { clientX: number; clientY: number }): MenuAnchor {
  return { x: e.clientX, y: e.clientY }
}

/** Anchors under a button, the way a pull-down opens. */
export function anchorFromElement(el: HTMLElement): MenuAnchor {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.bottom + 4 }
}

const MARGIN = 8
/** How far a submenu overlaps its parent, so the diagonal trip into it stays on the menu. */
const OVERLAP = 4
/** Hover dwell before a submenu opens, and the longer one before it closes again. */
const OPEN_DELAY_MS = 90
const CLOSE_DELAY_MS = 260

/**
 * Measure and place in one layout effect, writing straight to the node rather than
 * through state. Position-by-state needs a second render before the menu is really on
 * screen, and the focus() that follows would then run against a not-yet-visible element
 * and silently do nothing — which is the whole keyboard story for this control.
 */
function place(el: HTMLElement, anchor: MenuAnchor): void {
  const { width, height } = el.getBoundingClientRect()
  const beside = anchor.flipX !== undefined

  const maxLeft = window.innerWidth - width - MARGIN
  let left = anchor.x
  if (beside && left > maxLeft) left = (anchor.flipX as number) - width
  el.style.left = `${Math.max(MARGIN, Math.min(left, maxLeft))}px`

  const maxTop = window.innerHeight - height - MARGIN
  // A menu opened at the pointer flips above it; one opened beside a row keeps its edge
  // against that row and slides up instead, which is what a macOS submenu does.
  const top = anchor.y > maxTop && !beside ? anchor.y - height : anchor.y
  el.style.top = `${Math.max(MARGIN, Math.min(top, maxTop))}px`

  el.style.opacity = '1'
}

/* ── the menu ────────────────────────────────────────────────────────────── */

export interface MenuProps {
  anchor: MenuAnchor
  items: MenuNodeList
  /** Names the menu for screen readers: "Northwind Labs", "Actions for <subject>". */
  label: string
  onClose: () => void
  /**
   * Selector for the element to focus if the one that opened the menu is gone by the
   * time it closes. See the focus note below — this is the common case, not the edge.
   */
  returnFocusTo?: string
}

export function Menu({ anchor, items, label, onClose, returnFocusTo }: MenuProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null)

  /**
   * Focus goes back to the object on dismiss, so a keyboard user keeps their place.
   *
   * Not simply back to whatever was focused when the menu opened: acting on an object is
   * exactly the case where that element stops existing — moving a card to another column
   * unmounts the ••• button that was focused, leaving focus on <body>. So remember the
   * node, and if it has since left the document, look the object up wherever it landed.
   * `focus()` scrolls it into view, which is the right behaviour when it has just moved
   * somewhere off screen.
   */
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    return () => {
      const remembered = returnFocus.current
      if (remembered?.isConnected) return remembered.focus()
      if (returnFocusTo) document.querySelector<HTMLElement>(returnFocusTo)?.focus()
    }
  }, [returnFocusTo])

  // pointerdown, not click: a click outside would otherwise land on whatever is under the
  // cursor as well as closing the menu.
  useEffect(() => {
    const away = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    // Every surface this opens over scrolls inside its own container, and scroll events
    // do not bubble — hence the capture phase. But a menu taller than the window scrolls
    // too, and closing it under the user's own wheel would make a long list unusable.
    const scrolled = (e: Event): void => {
      if (rootRef.current?.contains(e.target as Node)) return
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

  return createPortal(
    <MenuPanel
      rootRef={rootRef}
      items={items}
      anchor={anchor}
      label={label}
      onCloseAll={onClose}
      onCloseSelf={onClose}
    />,
    document.body
  )
}

/* ── one panel — the root menu, or a submenu ─────────────────────────────── */

function MenuPanel({
  rootRef,
  items,
  anchor,
  label,
  onCloseAll,
  onCloseSelf
}: {
  /** The root panel hands its node up so <Menu> can test "was that click inside?". */
  rootRef?: { current: HTMLDivElement | null }
  items: MenuNodeList
  anchor: MenuAnchor
  label: string
  /** Pick an action: run it, then take the whole stack of panels down. */
  onCloseAll: () => void
  /** Escape or ArrowLeft: close just this panel and hand focus back to its parent. */
  onCloseSelf: () => void
}): JSX.Element {
  const rows = normalize(items)
  const selectable = rows.filter(isSelectable)

  const panelRef = useRef<HTMLDivElement | null>(null)
  // The cursor starts on the current choice where there is one, so opening "Move to"
  // lands on the status the item already has and the arrow keys move relative to it.
  const [active, setActive] = useState(() => {
    const checked = selectable.findIndex((node) => node.kind === 'action' && node.checked)
    return checked === -1 ? 0 : checked
  })
  const [open, setOpen] = useState<{ node: MenuSubmenu; anchor: MenuAnchor } | null>(null)
  const rowIdPrefix = useId()

  const setPanel = (el: HTMLDivElement | null): void => {
    panelRef.current = el
    if (rootRef) rootRef.current = el
  }

  useLayoutEffect(() => {
    const el = panelRef.current
    if (!el) return
    place(el, anchor)
    el.focus({ preventScroll: true })
  }, [anchor.x, anchor.y, anchor.flipX])

  /* Hover: one timer covers both directions. Opening waits ~90ms so a pointer crossing a
     submenu row on its way somewhere else does not flash a panel; closing waits longer so
     the diagonal trip from the parent row down to the submenu — which necessarily passes
     over sibling rows — does not shut the thing you are reaching for. */
  const hoverTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  const openSubmenu = useCallback((node: MenuSubmenu, row: HTMLElement) => {
    const panel = panelRef.current
    if (!panel) return
    const r = row.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    // Vertically the submenu's first row lines up with the row that opened it; the 5px
    // is the panel's own top padding plus its border.
    setOpen({ node, anchor: { x: p.right - OVERLAP, y: r.top - 5, flipX: p.left + OVERLAP } })
  }, [])

  const closeSubmenu = useCallback((refocus: boolean) => {
    setOpen(null)
    if (refocus) panelRef.current?.focus({ preventScroll: true })
  }, [])

  const hover = (node: MenuNode, index: number, row: HTMLElement): void => {
    setActive(index)
    window.clearTimeout(hoverTimer.current)
    const wanted = node.kind === 'submenu' ? node : null
    if (wanted?.id === open?.node.id) return
    hoverTimer.current = window.setTimeout(
      () => (wanted ? openSubmenu(wanted, row) : closeSubmenu(false)),
      wanted ? OPEN_DELAY_MS : CLOSE_DELAY_MS
    )
  }

  const choose = (node: MenuAction | MenuSubmenu, row: HTMLElement): void => {
    if (node.kind === 'submenu') return openSubmenu(node, row)
    node.onSelect()
    onCloseAll()
  }

  const move = (delta: number): void =>
    setActive((i) => (i + delta + selectable.length) % selectable.length)

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // A submenu is a DOM child of this panel, so its keystrokes bubble here. Focus always
    // sits on a panel itself — the rows are not focusable — so this tells them apart.
    if (e.target !== e.currentTarget) return
    const current = selectable[active]
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        return move(1)
      case 'ArrowUp':
        e.preventDefault()
        return move(-1)
      case 'Home':
        e.preventDefault()
        return setActive(0)
      case 'End':
        e.preventDefault()
        return setActive(selectable.length - 1)
      case 'ArrowRight': {
        e.preventDefault()
        if (current?.kind !== 'submenu') return
        const row = panelRef.current?.querySelector<HTMLElement>(`[data-menu-row="${current.id}"]`)
        if (row) openSubmenu(current, row)
        return
      }
      case 'ArrowLeft':
        e.preventDefault()
        // Only meaningful inside a submenu; on the root panel `onCloseSelf` is `onClose`,
        // which is why this arm is not shared with Escape.
        return anchor.flipX === undefined ? undefined : onCloseSelf()
      case 'Enter':
      case ' ': {
        e.preventDefault()
        if (!current) return
        const row = panelRef.current?.querySelector<HTMLElement>(`[data-menu-row="${current.id}"]`)
        if (row) choose(current, row)
        return
      }
      case 'Escape':
        e.preventDefault()
        return onCloseSelf()
      case 'Tab':
        e.preventDefault()
        return onCloseAll()
    }
  }

  const activeId = selectable[active] ? `${rowIdPrefix}${selectable[active]?.id}` : undefined

  return (
    <div
      ref={setPanel}
      className="menu"
      role="menu"
      tabIndex={-1}
      aria-label={label}
      aria-activedescendant={activeId}
      // Painted transparent for the one frame before the layout effect measures it.
      // Transparent rather than hidden: a `visibility: hidden` element cannot take focus.
      style={{ left: 0, top: 0, opacity: 0 }}
      onKeyDown={onKeyDown}
    >
      {rows.map((node) => {
        if (node.kind === 'separator') {
          return <div key={node.id} className="menu-sep" role="separator" />
        }
        if (node.kind === 'section') {
          return (
            <div key={node.id} className="menu-section" role="presentation">
              {node.label}
            </div>
          )
        }

        const index = selectable.indexOf(node)
        const isActive = index >= 0 && index === active
        const disabled = node.kind === 'action' && node.disabled === true
        const row = (
          <div
            key={node.id}
            id={`${rowIdPrefix}${node.id}`}
            data-menu-row={node.id}
            role={node.kind === 'submenu' ? 'menuitem' : (node.role ?? 'menuitem')}
            aria-checked={node.kind === 'action' && node.role ? node.checked === true : undefined}
            aria-disabled={disabled || undefined}
            aria-haspopup={node.kind === 'submenu' ? 'menu' : undefined}
            aria-expanded={node.kind === 'submenu' ? open?.node.id === node.id : undefined}
            className={
              'menu-item' +
              (isActive ? ' is-active' : '') +
              (disabled ? ' is-disabled' : '') +
              (node.kind === 'action' && node.danger ? ' is-danger' : '')
            }
            onMouseEnter={(e) => {
              if (disabled) return
              hover(node, index, e.currentTarget)
            }}
            onClick={(e) => {
              if (disabled) return
              choose(node, e.currentTarget)
            }}
          >
            <span className="menu-check" aria-hidden="true">
              {node.kind === 'action' && node.checked ? '✓' : ''}
            </span>
            <span className="menu-label">{node.label}</span>
            {node.kind === 'submenu' ? (
              <span className="menu-arrow" aria-hidden="true">
                <Icon name="chevronRight" size={11} />
              </span>
            ) : node.shortcut ? (
              <span className="menu-shortcut" aria-hidden="true">
                {node.shortcut}
              </span>
            ) : null}
          </div>
        )

        // The submenu is a sibling of the row inside a presentational wrapper — the ARIA
        // pattern — rather than a child of it, which would make the panel a descendant of
        // a menuitem and prune its rows out of the accessibility tree.
        return node.kind === 'submenu' && open?.node.id === node.id ? (
          <div key={node.id} role="none">
            {row}
            <MenuPanel
              items={open.node.items}
              anchor={open.anchor}
              label={open.node.label}
              onCloseAll={onCloseAll}
              onCloseSelf={() => closeSubmenu(true)}
            />
          </div>
        ) : (
          row
        )
      })}
    </div>
  )
}
