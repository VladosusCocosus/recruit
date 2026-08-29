import { Button, Dot, Icon, formatCountdown, type IconName } from '@renderer/components'
import type { Status, TimelineEventKind, UpcomingEvent } from '@shared/types'
import { isAllDay, isImminent, isInProgress, rangeLabel, spanLabel, timeLabel } from './datetime'

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
 *
 * Urgency is carried by the time — accent when it is close, an accent edge and the word
 * "Now" while it runs — and never by washing the whole row in tint. A schedule where the
 * next two hours are a block of colour is harder to read, not easier, and the row is
 * already sorted into the position that says when it happens.
 */
export function EventRow({ event, statuses, now, onOpenItem, onOpenUrl }: Props): JSX.Element {
  const status = statuses.get(event.item.statusKey) ?? null
  // All-day events are never "Now", for the same reason `isImminent` excludes them: they
  // are the shape of the day, not a moment inside it, and an accent edge on one would
  // compete with the meeting that is genuinely starting. They still group under today —
  // that is `dayKey`'s job, and a different question.
  const running = isInProgress(event, now) && !isAllDay(event)
  const soon = isImminent(event, now)
  const meetingUrl = event.meetingUrl
  const span = spanLabel(event)
  // An all-day event has no meaningful countdown — its day header already says everything.
  const countdown = isAllDay(event) ? '' : running ? 'Now' : formatCountdown(event.startsAt, now)

  const statusLabel = status?.label ?? event.item.statusKey
  const summary = `${event.title} · ${rangeLabel(event)}\n${itemLabel(event.item)} — ${statusLabel}`

  const main = (
    <>
      {/* Inside the click target, not beside it: the time is part of what you are pointing
          at, and it puts "10:00, Technical screen" into the button's accessible name. */}
      <span className="un-time tabular">
        <span className="un-time-main">{timeLabel(event)}</span>
        {countdown ? <span className="un-countdown">{countdown}</span> : null}
      </span>
      <span className="un-kind">
        <Icon name={KIND_ICON[event.kind]} size={13} />
      </span>
      <span className="un-main">
        <span className="un-title truncate">{event.title}</span>
        <span className="un-item">
          {/* The status as a calendar colour rather than a pill: while reading a schedule
              you are asking who and when, not what stage the application is at. The label
              stays reachable through the row's tooltip and one click away on the item. */}
          <Dot color={status?.color ?? undefined} />
          <span className="truncate">{itemLabel(event.item)}</span>
        </span>
        {span || event.location ? (
          <span className="un-where">
            {span ? <span className="un-span">{span}</span> : null}
            {event.location ? (
              <span className="un-location">
                <Icon name="pin" size={11} />
                {/* The text needs its own box: `text-overflow` has nothing to act on when
                    the string is a bare child of a flex container, so a long venue would
                    clip mid-word with no ellipsis. */}
                <span className="truncate">{event.location}</span>
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <div className={'un-row' + (running ? ' is-now' : soon ? ' is-soon' : '')}>
      {onOpenItem ? (
        <button
          type="button"
          className="un-row-main is-clickable"
          title={summary}
          onClick={() => onOpenItem(event.item.id)}
        >
          {main}
        </button>
      ) : (
        <div className="un-row-main" title={summary}>
          {main}
        </div>
      )}

      {meetingUrl ? (
        <Button
          size="sm"
          /* Filled only in the window where joining is the thing you came here to do. */
          variant={running || soon ? 'primary' : 'outline'}
          className="un-join"
          icon="external"
          title={meetingUrl}
          onClick={() => onOpenUrl?.(meetingUrl)}
        >
          Join
        </Button>
      ) : null}
    </div>
  )
}
