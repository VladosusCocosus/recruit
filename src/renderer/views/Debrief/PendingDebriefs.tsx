/**
 * The list of calls still owing a debrief, rendered above the schedule in Up next.
 * Each row reopens the debrief modal for that call.
 */
import { Icon } from '@renderer/components'
import { CALL_TYPE_LABEL, type PendingDebrief } from '@shared/types'
import type { JSX } from 'react'
import { callWhen } from './format'
import './debrief.css'

interface Props {
  pending: PendingDebrief[]
  onOpen: (eventId: number) => void
  now?: number
}

export function PendingDebriefs({ pending, onOpen, now = Date.now() }: Props): JSX.Element | null {
  if (pending.length === 0) return null

  return (
    <section className="db-pending">
      <h2 className="db-pending-label">
        <Icon name="alert" size={12} />
        {pending.length === 1 ? 'A call needs a debrief' : `${pending.length} calls need a debrief`}
      </h2>
      <div className="db-pending-rows">
        {pending.map((call) => (
          <button
            type="button"
            className="db-pending-row"
            key={call.id}
            onClick={() => onOpen(call.id)}
          >
            <Icon name="calendar" size={13} />
            <span className="db-pending-main">
              <span className="truncate">
                {call.callType ? CALL_TYPE_LABEL[call.callType] : 'Call'}
                {' · '}
                {call.item.role ? `${call.item.company} — ${call.item.role}` : call.item.company}
              </span>
              <span className="db-pending-when">{callWhen(call, now)}</span>
            </span>
            <Icon name="chevronRight" size={12} />
          </button>
        ))}
      </div>
    </section>
  )
}
