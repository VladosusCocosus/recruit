import { formatTime } from '@renderer/components'
import type { PendingDebrief } from '@shared/types'

const dayLocal = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

const DAY_MS = 86_400_000

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** "Today 14:00–14:45", "Yesterday 09:30–10:00", "Thursday 3 September 16:00–17:00". */
export function callWhen(call: PendingDebrief, now: number = Date.now()): string {
  const start = call.startsAt ? new Date(Date.parse(call.startsAt)) : null
  if (!start || !Number.isFinite(start.getTime())) return 'Recently'

  const today = new Date(now)
  const day = sameLocalDay(start, today)
    ? 'Today'
    : sameLocalDay(start, new Date(now - DAY_MS))
      ? 'Yesterday'
      : dayLocal.format(start)

  const end = call.endsAt ? Date.parse(call.endsAt) : NaN
  const times =
    Number.isFinite(end) && end > start.getTime()
      ? `${formatTime(call.startsAt)}–${formatTime(call.endsAt)}`
      : formatTime(call.startsAt)

  return `${day} ${times}`
}
