import { describe, expect, it } from 'vitest'
import {
  DEBRIEF_GRACE_MS,
  addBusinessDays,
  defaultNudgeTitle,
  isDebriefPending,
  type DebriefCandidate
} from '../src/shared/debrief'

const ENDED = '2026-09-04T14:45:00.000Z'
const ENDED_MS = Date.parse(ENDED)

function call(over: Partial<DebriefCandidate> = {}): DebriefCandidate {
  return {
    kind: 'meeting',
    callType: 'technical',
    endsAt: ENDED,
    debriefedAt: null,
    snoozeUntil: null,
    supersededBy: null,
    ...over
  }
}

describe('isDebriefPending', () => {
  it('waits out the grace period after the call ends', () => {
    expect(isDebriefPending(call(), ENDED_MS + 60_000)).toBe(false)
    expect(isDebriefPending(call(), ENDED_MS + DEBRIEF_GRACE_MS)).toBe(true)
  })

  it('ignores meetings that were not logged as calls', () => {
    expect(isDebriefPending(call({ callType: null }), ENDED_MS + DEBRIEF_GRACE_MS)).toBe(false)
    expect(isDebriefPending(call({ kind: 'task' }), ENDED_MS + DEBRIEF_GRACE_MS)).toBe(false)
  })

  it('stops asking once answered or skipped', () => {
    const answered = call({ debriefedAt: '2026-09-04T15:10:00.000Z' })
    expect(isDebriefPending(answered, ENDED_MS + DEBRIEF_GRACE_MS)).toBe(false)
  })

  it('holds off while snoozed and returns afterwards', () => {
    const snoozed = call({ snoozeUntil: '2026-09-04T17:00:00.000Z' })
    expect(isDebriefPending(snoozed, Date.parse('2026-09-04T16:00:00.000Z'))).toBe(false)
    expect(isDebriefPending(snoozed, Date.parse('2026-09-04T17:00:01.000Z'))).toBe(true)
  })

  it('skips a call superseded by a reschedule', () => {
    expect(isDebriefPending(call({ supersededBy: 12 }), ENDED_MS + DEBRIEF_GRACE_MS)).toBe(false)
  })

  it('needs an end stamp to know the call is over', () => {
    expect(isDebriefPending(call({ endsAt: null }), ENDED_MS + DEBRIEF_GRACE_MS)).toBe(false)
    expect(isDebriefPending(call({ endsAt: 'not a date' }), ENDED_MS + DEBRIEF_GRACE_MS)).toBe(false)
  })
})

describe('addBusinessDays', () => {
  const at = (iso: string): string => new Date(Date.parse(iso)).toISOString()

  it('counts weekdays only', () => {
    // Local Monday through Friday, so the arithmetic matches the reader's working week.
    const monday = at('2026-09-07T12:00:00.000Z')
    expect(addBusinessDays(monday, 3)).toBe(at('2026-09-10T12:00:00.000Z'))
  })

  it('jumps the weekend', () => {
    const thursday = at('2026-09-10T12:00:00.000Z')
    expect(addBusinessDays(thursday, 3)).toBe(at('2026-09-15T12:00:00.000Z'))
  })

  it('keeps the time of day', () => {
    expect(addBusinessDays('2026-09-07T09:30:00.000Z', 1)).toContain('09:30')
  })

  it('never lands on a weekend, even at zero days', () => {
    const saturday = new Date(Date.parse(addBusinessDays('2026-09-12T12:00:00.000Z', 0)))
    expect(saturday.getDay()).not.toBe(0)
    expect(saturday.getDay()).not.toBe(6)
  })

  it('rejects a date it cannot parse', () => {
    expect(() => addBusinessDays('whenever', 3)).toThrow()
  })
})

describe('defaultNudgeTitle', () => {
  it('names the person and the role', () => {
    expect(defaultNudgeTitle('Dana', 'Senior Backend Engineer', 'Northwind')).toBe(
      'Nudge Dana about Senior Backend Engineer'
    )
  })

  it('falls back to the company, then to the recruiter', () => {
    expect(defaultNudgeTitle('Dana', null, 'Northwind')).toBe('Nudge Dana about Northwind')
    expect(defaultNudgeTitle(null, null, 'Northwind')).toBe('Nudge the recruiter about Northwind')
  })
})
