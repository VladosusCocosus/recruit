/**
 * Calendar-stamp rules. Pure functions, shared by the main process and the renderer so
 * both agree on what an all-day event is.
 */

const DAY_MS = 86_400_000

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/**
 * An all-day .ics event arrives as tz:null with both stamps at UTC midnight
 * (see the mail agent's note on RFC 5545). Detect it so views can drop the time.
 */
export function isAllDay(
  startsAt: string | null,
  endsAt: string | null,
  tz: string | null
): boolean {
  if (tz !== null) return false
  const s = parse(startsAt)
  if (s === null) return false
  if (s % DAY_MS !== 0) return false
  const e = parse(endsAt)
  return e === null || e % DAY_MS === 0
}
