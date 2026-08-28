/**
 * A board card: company, role, what happens next, and a stale dot when nothing has.
 */

import { Chip, Icon, initials } from '@renderer/components'
import type { CloseReason, ItemSummary } from '@shared/types'
import type { DragEvent, JSX } from 'react'
import { eventWhen, formatCountdown, formatRelative, lastContactAt, staleness } from './format'
import { StatusSelect } from './StatusSelect'
import type { StatusIndex } from './useTracker'

export const ITEM_DRAG_TYPE = 'application/x-recruit-item'

export function ItemCard({
  item,
  statusIndex,
  now,
  selected,
  onOpen,
  onChangeStatus,
  onDragStateChange
}: {
  item: ItemSummary
  statusIndex: StatusIndex
  now: number
  selected?: boolean
  onOpen: (itemId: number) => void
  onChangeStatus: (itemId: number, statusKey: string, closeReason: CloseReason | null) => void
  onDragStateChange?: (itemId: number | null) => void
}): JSX.Element {
  const stale = staleness(item, statusIndex.kindOf(item), now)
  const next = item.nextEvent

  const handleDragStart = (e: DragEvent<HTMLDivElement>): void => {
    e.dataTransfer.setData(ITEM_DRAG_TYPE, String(item.id))
    // text/plain must also be set or the drag never starts in Chromium.
    e.dataTransfer.setData('text/plain', String(item.id))
    e.dataTransfer.effectAllowed = 'move'
    onDragStateChange?.(item.id)
  }

  return (
    <div
      className={`item-card${selected ? ' is-selected' : ''}${stale.stale ? ' is-stale' : ''}`}
      draggable
      role="button"
      tabIndex={0}
      aria-label={`${item.company}${item.role ? ` — ${item.role}` : ''}`}
      onDragStart={handleDragStart}
      onDragEnd={() => onDragStateChange?.(null)}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => {
        // Only the card itself opens on Enter — otherwise confirming a choice in the
        // nested status dropdown would bubble up and open the item too.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(item.id)
        }
      }}
    >
      <div className="item-card-top">
        <span className="item-avatar" aria-hidden="true">
          {initials(item.company)}
        </span>
        <div className="item-card-headings">
          <div className="item-card-company truncate" title={item.company}>
            {item.company}
          </div>
          <div className={item.role ? 'item-card-role truncate' : 'item-card-role tertiary'}>
            {item.role ?? 'No role yet'}
          </div>
        </div>
        {stale.stale ? (
          <span
            className="stale-dot"
            title={`Nothing heard for ${stale.days} days — last contact ${formatRelative(
              lastContactAt(item),
              now
            )}`}
          >
            <span className="sr-only">Stale</span>
          </span>
        ) : null}
      </div>

      {next ? (
        <div className="item-card-next" title={eventWhen(next)}>
          <Icon name="calendar" size={12} />
          <span className="truncate">{next.title}</span>
          <span className="item-card-next-when tabular">{formatCountdown(next.startsAt, now)}</span>
        </div>
      ) : null}

      <div className="item-card-foot">
        <StatusSelect
          item={item}
          statusIndex={statusIndex}
          onChange={(statusKey, reason) => onChangeStatus(item.id, statusKey, reason)}
        />
        <span className="item-card-meta">
          {item.messageCount > 0 ? (
            <Chip title={`${item.messageCount} linked message(s)`}>
              <Icon name="mail" size={11} />
              {item.messageCount}
            </Chip>
          ) : null}
          {item.location ? (
            <span className="tertiary truncate" title={item.location}>
              {item.location}
            </span>
          ) : null}
        </span>
      </div>
    </div>
  )
}
