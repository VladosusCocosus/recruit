/**
 * Debrief scheduling: which logged calls still owe a debrief, and when the recruiter
 * nudge falls due. Pure functions, shared by the main process and the renderer.
 */
import type { CallOutcome, TimelineEvent } from './types'

/** How long after a call ends before Jobbox asks about it. */
export const DEBRIEF_GRACE_MS = 15 * 60_000

/** How long "Remind me later" holds one back. */
export const DEBRIEF_SNOOZE_MS = 2 * 3_600_000

/** Default gap between the call and the nudge, in business days. */
export const NUDGE_BUSINESS_DAYS = 3

export type DebriefCandidate = Pick<
  TimelineEvent,
  'kind' | 'callType' | 'endsAt' | 'debriefedAt' | 'snoozeUntil' | 'supersededBy'
>

/** True when this call has finished, has not been answered or skipped, and is not snoozed. */
export function isDebriefPending(event: DebriefCandidate, now: number = Date.now()): boolean {
  if (event.kind !== 'meeting' || event.callType === null) return false
  if (event.debriefedAt !== null) return false
  if (event.supersededBy !== null) return false

  const ends = event.endsAt ? Date.parse(event.endsAt) : NaN
  if (!Number.isFinite(ends)) return false
  if (now < ends + DEBRIEF_GRACE_MS) return false

  const snooze = event.snoozeUntil ? Date.parse(event.snoozeUntil) : NaN
  return !(Number.isFinite(snooze) && now < snooze)
}

/**
 * `fromIso` plus `days` weekdays, keeping the time of day. Saturday and Sunday are
 * skipped; public holidays are not. Weekends are evaluated in the viewer's local zone.
 *
 * Throws when `fromIso` is unparseable.
 */
export function addBusinessDays(fromIso: string, days: number): string {
  const at = Date.parse(fromIso)
  if (!Number.isFinite(at)) throw new Error(`addBusinessDays: unparseable date ${fromIso}`)

  const d = new Date(at)
  let left = Math.max(0, Math.trunc(days))
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) left -= 1
  }
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

/** The nudge a debrief offers by default: N business days after the call ended. */
export function defaultNudgeAt(endsAtIso: string): string {
  return addBusinessDays(endsAtIso, NUDGE_BUSINESS_DAYS)
}

/** "Nudge Dana about Senior Backend Engineer" — whichever halves are known. */
export function defaultNudgeTitle(who: string | null, role: string | null, company: string): string {
  const person = who?.trim() || 'the recruiter'
  const about = role?.trim() || company.trim()
  return about ? `Nudge ${person} about ${about}` : `Nudge ${person}`
}

/** Outcome as it reads at the head of a debrief note. */
export const OUTCOME_NOTE_PREFIX: Record<CallOutcome, string> = {
  well: 'Went well',
  mixed: 'Mixed',
  badly: 'Went badly'
}
