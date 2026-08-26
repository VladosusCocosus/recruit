/**
 * The item timeline: ONE vertical list mixing past (occurred_at) and future (starts_at).
 *
 * Order is what you'd actually act on — upcoming soonest-first at the top, then a "now"
 * hairline, then history newest-first below it. Future rows are visually distinct and
 * carry relative time. Events superseded by a newer .ics SEQUENCE are hidden behind a
 * toggle rather than dropped, so a reschedule keeps its paper trail.
 */

import { useMemo, useState } from 'react'
import { Button, Chip, Icon, IconButton } from '@renderer/components'
import type { IconName } from '@renderer/components'
import type { JSX, ReactNode } from 'react'
import type { TimelineEvent, TimelineEventKind } from '@shared/types'
import { eventTime, eventWhen, formatCountdown, isFutureEvent } from './format'
import { Markdown } from './Markdown'

const KIND_ICON: Record<TimelineEventKind, IconName> = {
  email: 'mail',
  meeting: 'calendar',
  status_change: 'target',
  task: 'check',
  note: 'info'
}

function sourceChip(source: TimelineEvent['source']): ReactNode {
  if (source === 'agent') {
    return (
      <span className="chip is-agent" title="Added by Claude from your mail">
        <Icon name="sparkle" size={10} />
        Claude
      </span>
    )
  }
  if (source === 'ics') {
    return (
      <Chip title="Imported from a calendar invitation">
        <Icon name="calendar" size={10} />
        Invite
      </Chip>
    )
  }
  return null
}

function EventRow({
  event,
  now,
  superseded,
  onDelete,
  onOpenMeeting
}: {
  event: TimelineEvent
  now: number
  superseded: boolean
  onDelete?: (eventId: number) => void
  onOpenMeeting?: (url: string) => void
}): JSX.Element {
  const future = isFutureEvent(event, now)
  const classes = ['tl-row']
  if (future) classes.push('is-future')
  if (superseded) classes.push('is-superseded')

  return (
    <li className={classes.join(' ')}>
      <span className="tl-marker" aria-hidden="true">
        <Icon name={KIND_ICON[event.kind]} size={12} />
      </span>
      <div className="tl-body">
        <div className="tl-head">
          <span className="tl-title selectable">{event.title}</span>
          {sourceChip(event.source)}
          {superseded ? <Chip>Superseded</Chip> : null}
          <span className="tl-spacer" />
          {future ? (
            <span className="tl-relative tabular" title={eventWhen(event)}>
              {formatCountdown(event.startsAt, now)}
            </span>
          ) : null}
          {onDelete && event.source === 'user' ? (
            <IconButton
              icon="trash"
              label="Delete entry"
              className="tl-delete"
              onClick={() => onDelete(event.id)}
            />
          ) : null}
        </div>

        <div className="tl-when tertiary">
          <Icon name="clock" size={11} />
          {eventWhen(event)}
          {event.tz ? <span className="tl-tz">{event.tz}</span> : null}
          {event.location ? <span className="tl-loc truncate">· {event.location}</span> : null}
        </div>

        {event.bodyMd ? (
          <div className="tl-note">
            <Markdown source={event.bodyMd} />
          </div>
        ) : null}

        {event.meetingUrl ? (
          <div className="tl-actions">
            <Button
              size="sm"
              variant="outline"
              icon="link"
              onClick={() => onOpenMeeting?.(event.meetingUrl as string)}
            >
              Join
            </Button>
            <span className="tertiary truncate tl-url selectable">{event.meetingUrl}</span>
          </div>
        ) : null}
      </div>
    </li>
  )
}

export function Timeline({
  events,
  now,
  onDeleteEvent,
  onOpenMeeting
}: {
  events: TimelineEvent[]
  now: number
  onDeleteEvent?: (eventId: number) => void
  onOpenMeeting?: (url: string) => void
}): JSX.Element {
  const [showSuperseded, setShowSuperseded] = useState(false)

  const { future, past, supersededCount } = useMemo(() => {
    const visible = events.filter((e) => showSuperseded || e.supersededBy === null)
    return {
      future: visible
        .filter((e) => isFutureEvent(e, now))
        .sort((a, b) => eventTime(a) - eventTime(b)),
      past: visible.filter((e) => !isFutureEvent(e, now)).sort((a, b) => eventTime(b) - eventTime(a)),
      supersededCount: events.filter((e) => e.supersededBy !== null).length
    }
  }, [events, now, showSuperseded])

  if (events.length === 0) {
    return (
      <div className="tl-empty tertiary">
        Nothing on the timeline yet. Linked mail, status changes and invites land here.
      </div>
    )
  }

  return (
    <div className="timeline">
      <ol className="tl-list">
        {future.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            now={now}
            superseded={e.supersededBy !== null}
            onDelete={onDeleteEvent}
            onOpenMeeting={onOpenMeeting}
          />
        ))}

        {future.length > 0 && past.length > 0 ? (
          <li className="tl-now" aria-hidden="true">
            <span className="tl-now-label">now</span>
          </li>
        ) : null}

        {past.map((e) => (
          <EventRow
            key={e.id}
            event={e}
            now={now}
            superseded={e.supersededBy !== null}
            onDelete={onDeleteEvent}
            onOpenMeeting={onOpenMeeting}
          />
        ))}
      </ol>

      {supersededCount > 0 ? (
        <div className="tl-foot">
          <Button size="sm" variant="subtle" onClick={() => setShowSuperseded((v) => !v)}>
            {showSuperseded
              ? `Hide ${supersededCount} superseded`
              : `Show ${supersededCount} superseded`}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
