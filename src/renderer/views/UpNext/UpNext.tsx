import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
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
import type { Status } from '@shared/types'
import { groupByDay } from './datetime'
import { EventRow } from './EventRow'
import './upnext.css'

export interface UpNextProps {
  /** Navigate to an item's detail view. */
  onOpenItem?: (itemId: number) => void
  /** How many events to pull. This is a horizon, not an archive. */
  limit?: number
}

const DEFAULT_LIMIT = 100
/** Often enough that "in 12m" and "now" stay honest, rarely enough not to churn the tree. */
const TICK_MS = 60_000

/**
 * Every future timeline event across every application, soonest first.
 *
 * The one view that ignores the tracker's structure entirely: an interview on Thursday
 * matters whether it belongs to a Screening or an Offer, so events group by day and nothing
 * else. Each row links back to the application it came from.
 */
export function UpNext({ onOpenItem, limit = DEFAULT_LIMIT }: UpNextProps): JSX.Element {
  const events = useAsync(() => window.recruit.listUpcomingEvents(limit), [limit])
  const statuses = useStatuses()
  const [now, setNow] = useState(() => Date.now())

  const reload = events.reload

  // Accepting a proposal can add a meeting; so can a re-synced .ics.
  useRecruitEvent('itemsChanged', () => reload())
  useRecruitEvent('proposalsChanged', () => reload())

  // Keeps countdowns truthful, and rolls "Today" over at midnight.
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

  const total = events.data?.length ?? 0

  let body: JSX.Element
  if (events.loading && events.data === null) {
    body = <LoadingState label="Loading schedule…" />
  } else if (days.length === 0) {
    body = (
      <EmptyState
        icon="calendar"
        title="Nothing scheduled"
        message="Interviews, calls and deadlines land here as soon as an invite is parsed or you add an event to an application."
      />
    )
  } else {
    body = (
      <div className="un-days">
        {days.map((day) => (
          <section className="un-day" key={day.key}>
            <h2 className="un-day-label">
              {day.label}
              <Badge>{day.events.length}</Badge>
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
      </div>
    )
  }

  return (
    <Pane kind="detail">
      <ErrorBanner error={events.error} onRetry={reload} />

      <PaneHeader
        title="Up next"
        actions={
          <Button
            variant="subtle"
            size="sm"
            icon="refresh"
            busy={events.loading && events.data !== null}
            onClick={reload}
          >
            Refresh
          </Button>
        }
      >
        {total > 0 ? <Badge>{total}</Badge> : null}
      </PaneHeader>

      <PaneBody padded>{body}</PaneBody>
    </Pane>
  )
}

export default UpNext
