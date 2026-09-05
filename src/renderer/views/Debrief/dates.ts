/**
 * Conversions between `<input type="date">` values and the ISO stamps a `task` event
 * carries. A date-only value resolves to `DUE_HOUR` in the viewer's local zone.
 */

/** Local hour a follow-up is due at. */
const DUE_HOUR = 9

/** ISO -> "2026-09-10" in the viewer's zone. */
export function toDateInputValue(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** "2026-09-10" -> ISO at the local working hour. Null when empty or unparseable. */
export function fromDateInputValue(value: string): string | null {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!parts) return null
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]), DUE_HOUR, 0, 0, 0)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

/** Tomorrow, as a date-input value — what a fresh follow-up row defaults to. */
export function tomorrowInputValue(now: number = Date.now()): string {
  return toDateInputValue(new Date(now + 86_400_000).toISOString())
}
