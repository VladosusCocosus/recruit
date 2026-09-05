import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  Pane,
  PaneBody,
  PaneHeader,
  useAsync,
  useRecruitEvent,
  useStatuses
} from '@renderer/components'
import type { PendingDebrief, Status } from '@shared/types'
import { PendingDebriefs } from '@renderer/views/Debrief'
import { groupByDay, todayLabel } from './datetime'
import { EventRow } from './EventRow'
import './upnext.css'

export interface UpNextProps {
  /** Navigate to an item's detail view. */
  onOpenItem?: (itemId: number) => void
  /** How many events to pull. This is a horizon, not an archive. */
  limit?: number
  /** Finished calls still owing a debrief. Pinned above the schedule. */
  pendingDebriefs?: PendingDebrief[]
  onOpenDebrief?: (eventId: number) => void
}

const DEFAULT_LIMIT = 100
/** Often enough that "in 12m" and "Now" stay honest, rarely enough not to churn the tree. */
const TICK_MS = 60_000

/**
 * Every event still ahead of you across every application, soonest first.
 *
 * The one view that ignores the tracker's structure entirely: an interview on Thursday
 * matters whether it belongs to a Screening or an Offer, so events group by day and nothing
 * else. Each row links back to the application it came from.
 *
 * Days are the only grouping, and each day is one inset group rather than a stack of cards
 * — a schedule is a list, and a border around every line makes the eye stop at each one.
 * The view leads with today, and says so when today is already done; the absence of a
 * "Today" heading is otherwise silent, and reads as though something failed to load.
 */
export function UpNext({
  onOpenItem,
  limit = DEFAULT_LIMIT,
  pendingDebriefs = [],
  onOpenDebrief
}: UpNextProps): JSX.Element {
  const events = useAsync(() => window.recruit.listUpcomingEvents(limit), [limit])
  const statuses = useStatuses()
  const [now, setNow] = useState(() => Date.now())

  const reload = events.reload

  // Accepting a proposal can add a meeting; so can a re-synced .ics.
  useRecruitEvent('itemsChanged', () => reload())
  useRecruitEvent('proposalsChanged', () => reload())

  // Keeps countdowns truthful, rolls "Today" over at midnight, and retires a meeting
  // from the schedule once it has actually finished.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const statusMap = useMemo(
    () => new Map<string, Status>((statuses.data ?? []).map((s) => [s.key, s])),
    [statuses.data]
  )

  const days = useMemo(() => (events.data ? groupByDay(events.data, now) : []), [events.data, now])

  const openUrl = useCallback((url: string) => {
    void window.recruit.openExternal(url).catch(() => undefined)
  }, [])

  const capped = (events.data?.length ?? 0) >= limit

  const debriefs =
    onOpenDebrief && pendingDebriefs.length > 0 ? (
      <PendingDebriefs pending={pendingDebriefs} onOpen={onOpenDebrief} now={now} />
    ) : null

  let body: JSX.Element
  if (events.loading && events.data === null) {
    body = <LoadingState label="Loading schedule…" />
  } else if (days.length === 0) {
    body = (
      <>
        {debriefs}
        <EmptyState
          icon="calendar"
          title="Nothing scheduled"
          message="Interviews, calls and deadlines land here as soon as an invite is parsed or you add an event to an application."
        />
      </>
    )
  } else {
    body = (
      <div className="un-col">
        {debriefs}
        {days[0]?.isToday ? null : <p className="un-clear">Nothing left today.</p>}

        {days.map((day) => (
          <section className={'un-day' + (day.isToday ? ' is-today' : '')} key={day.key}>
            <h2 className="un-day-label">
              <span className="un-day-name">{day.label}</span>
              <span className="un-day-count tabular">{day.events.length}</span>
            </h2>
            <div className="un-day-rows">
              {day.events.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  statuses={statusMap}
                  now={now}
                  onOpenItem={onOpenItem}
                  onOpenUrl={openUrl}
                />
              ))}
            </div>
          </section>
        ))}

        {capped ? <p className="un-foot">Showing the next {limit} events.</p> : null}
      </div>
    )
  }

  return (
    <Pane kind="detail">
      <ErrorBanner error={events.error} onRetry={reload} />
      {/* No Refresh button: the list reloads on every event that could change it, ticks
          itself every minute, and the error banner owns the one case where a manual retry
          is the right answer. The date earns the space instead — the day headings below say
          "Today" and "Tomorrow" and then jump straight to weekday names, which needs an
          anchor somewhere on screen. */}
      <PaneHeader title="Up next" actions={<span className="un-date">{todayLabel(now)}</span>} />
      <PaneBody>{body}</PaneBody>
    </Pane>
  )
}

export default UpNext
