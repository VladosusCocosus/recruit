import { Icon, StatusBadge, formatCountdown, type IconName } from '@renderer/components'
import type { Status, TimelineEventKind, UpcomingEvent } from '@shared/types'
import { isAllDay, isImminent, isInProgress, timeLabel } from './datetime'

interface Props {
  event: UpcomingEvent
  statuses: Map<string, Status>
  now: number
  onOpenItem?: (itemId: number) => void
  onOpenUrl?: (url: string) => void
}

const KIND_ICON: Record<TimelineEventKind, IconName> = {
  meeting: 'calendar',
  task: 'checkCircle',
  note: 'review',
  email: 'mail',
  status_change: 'board'
}

function itemLabel(item: UpcomingEvent['item']): string {
  return item.role ? `${item.company} · ${item.role}` : item.company
}

/**
 * One scheduled thing.
 *
 * The left column is the time and nothing else, so a column of these scans as a schedule
 * rather than as a list of sentences. "Join" sits outside the row's own click target:
 * joining a call and opening the application are different intents, and a button inside a
 * button is invalid HTML besides.
 */
export function EventRow({ event, statuses, now, onOpenItem, onOpenUrl }: Props): JSX.Element {
  const status = statuses.get(event.item.statusKey) ?? null
  const running = isInProgress(event, now)
  const soon = running || isImminent(event, now)
  const meetingUrl = event.meetingUrl
  // An all-day event has no meaningful countdown — its day header already says everything.
  const countdown = isAllDay(event) ? '' : running ? 'now' : formatCountdown(event.startsAt, now)

  const main = (
    <>
      <span className="un-kind" title={event.kind}>
        <Icon name={KIND_ICON[event.kind]} size={13} />
      </span>
      <span className="un-main">
        <span className="un-title truncate">{event.title}</span>
        <span className="un-item truncate">
          <StatusBadge status={status} statusKey={event.item.statusKey} />
          {itemLabel(event.item)}
        </span>
        {event.location ? (
          <span className="un-where">
            <span className="un-location truncate">
              <Icon name="target" size={11} />
              {event.location}
            </span>
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <div className={`un-row${soon ? ' is-soon' : ''}`}>
      <span className="un-time tabular">
        <span className="un-time-main">{timeLabel(event)}</span>
        {countdown ? (
          <span className={`un-countdown${running ? ' is-now' : ''}`}>{countdown}</span>
        ) : null}
      </span>

      {onOpenItem ? (
        <button
          type="button"
          className="un-row-main is-clickable"
          onClick={() => onOpenItem(event.item.id)}
          title={`Open ${itemLabel(event.item)}`}
        >
          {main}
        </button>
      ) : (
        <div className="un-row-main">{main}</div>
      )}

      {meetingUrl ? (
        <button
          type="button"
          className="btn is-sm is-outline un-join"
          title={meetingUrl}
          onClick={() => onOpenUrl?.(meetingUrl)}
        >
          <Icon name="external" size={12} />
          Join
        </button>
      ) : null}
    </div>
  )
}
