/**
 * A board card. Three lines, in the order somebody scanning the board actually reads
 * them: who, what the job is, and what happens next.
 *
 * What is deliberately NOT on it: the status. The card is sitting in the column that
 * spells the status out, so repeating it — as the old card did, in a full bordered popup
 * button — spent the loudest element on the card restating the layout. Changing status
 * now goes through drag, or the contextual menu on the ••• button and on right-click.
 */

import { useRef } from 'react'
import { Icon } from '@renderer/components'
import type { ItemSummary } from '@shared/types'
import type { DragEvent, JSX } from 'react'
import { itemSignal } from './format'
import type { StatusMenuTarget } from './StatusMenu'
import { menuTargetFromElement, menuTargetFromEvent } from './StatusMenu'
import type { StatusIndex } from './useTracker'

export const ITEM_DRAG_TYPE = 'application/x-recruit-item'

export function ItemCard({
  item,
  statusIndex,
  now,
  selected,
  dragging,
  onOpen,
  onRequestMenu,
  onDragStateChange
}: {
  item: ItemSummary
  statusIndex: StatusIndex
  now: number
  selected?: boolean
  dragging?: boolean
  onOpen: (itemId: number) => void
  /** Opens the shared contextual menu the board mounts once for every card. */
  onRequestMenu: (target: StatusMenuTarget) => void
  onDragStateChange?: (itemId: number | null) => void
}): JSX.Element {
  const menuButton = useRef<HTMLButtonElement | null>(null)
  const signal = itemSignal(item, statusIndex.kindOf(item), now)

  const handleDragStart = (e: DragEvent<HTMLDivElement>): void => {
    e.dataTransfer.setData(ITEM_DRAG_TYPE, String(item.id))
    // text/plain must also be set or the drag never starts in Chromium.
    e.dataTransfer.setData('text/plain', String(item.id))
    e.dataTransfer.effectAllowed = 'move'
    onDragStateChange?.(item.id)
  }

  return (
    <div
      className={
        'item-card' +
        (selected ? ' is-selected' : '') +
        (dragging ? ' is-dragging' : '') +
        (item.archivedAt ? ' is-archived' : '')
      }
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => onDragStateChange?.(null)}
      onClick={() => onOpen(item.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onRequestMenu(menuTargetFromEvent(item, e))
      }}
    >
      {/* The card used to be a div with role="button" holding its own controls. ARIA
          makes the children of a button presentational, so the status control nested
          inside it was pruned out of the accessibility tree entirely — invisible to a
          screen reader, and invalid markup besides.

          So the keyboard and assistive-tech affordance is this real <button>, stretched
          over the card to carry the focus ring, while the mouse keeps clicking the div
          around it. It takes no pointer events and no handler of its own: activating a
          button fires a click that bubbles to the div, so one handler serves both, and
          leaving the pointer to fall through is what keeps the title tooltips on the
          role and the signal line reachable. */}
      <button
        type="button"
        className="item-card-open"
        data-item-focus={item.id}
        aria-label={`${item.company}${item.role ? ` — ${item.role}` : ''}`}
      />

      <div className="item-card-head">
        <span className="item-card-company truncate" title={item.company}>
          {item.company}
        </span>
        <button
          ref={menuButton}
          type="button"
          className="item-card-menu"
          aria-label={`Change status of ${item.company}`}
          aria-haspopup="menu"
          onClick={(e) => {
            e.stopPropagation()
            if (menuButton.current) onRequestMenu(menuTargetFromElement(item, menuButton.current))
          }}
        >
          <Icon name="ellipsis" size={13} />
        </button>
      </div>

      {/* Role and location share one line, as two elements rather than one joined
          string: the role must win the space when both are long, and a card with no role
          must not silently promote its location into the role's slot. */}
      <div className="item-card-sub">
        <span
          className={item.role ? 'item-card-role truncate' : 'item-card-role truncate tertiary'}
          title={item.role ?? undefined}
        >
          {item.role ?? 'No role yet'}
        </span>
        {item.location ? (
          <span className="item-card-loc truncate" title={item.location}>
            {item.location}
          </span>
        ) : null}
        {item.messageCount > 0 ? (
          <span className="item-card-mail" title={`${item.messageCount} linked message(s)`}>
            <Icon name="mail" size={11} />
            <span className="tabular">{item.messageCount}</span>
          </span>
        ) : null}
      </div>

      <div className={`item-signal is-${signal.tone}`} title={signal.title}>
        <Icon name={signal.icon} size={11} />
        <span className="truncate">{signal.text}</span>
      </div>
    </div>
  )
}
