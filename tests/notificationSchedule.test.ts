import { describe, expect, it } from 'vitest'
import { DEBRIEF_GRACE_MS } from '../src/shared/debrief'
import {
  REMINDER_FRESHNESS_MS,
  debriefReminders,
  dueReminders,
  interviewReminders,
  leadPhrase,
  nextWakeAt,
  reminderKey,
  type Reminder
} from '../src/main/notifications/schedule'
import type { PendingDebrief, UpcomingEvent } from '../src/shared/types'

const START = '2026-09-08T14:00:00.000Z'
const START_MS = Date.parse(START)
const MINUTE = 60_000

function event(over: Partial<UpcomingEvent> = {}): UpcomingEvent {
  return {
    id: 1,
    itemId: 7,
    kind: 'meeting',
    title: 'Technical interview',
    bodyMd: null,
    occurredAt: null,
    startsAt: START,
    endsAt: '2026-09-08T15:00:00.000Z',
    tz: 'Europe/Berlin',
    location: null,
    meetingUrl: null,
    messageId: null,
    icsUid: null,
    icsSequence: null,
    source: 'ics',
    supersededBy: null,
    callType: null,
    callWith: null,
    outcome: null,
    debriefedAt: null,
    snoozeUntil: null,
    createdAt: START,
    item: { id: 7, company: 'Northwind', role: 'Staff Engineer', statusKey: 'interviewing' },
    ...over
  }
}

function call(over: Partial<PendingDebrief> = {}): PendingDebrief {
  return {
    ...event({ callType: 'technical', source: 'user' }),
    item: {
      id: 7,
      company: 'Northwind',
      role: 'Staff Engineer',
      statusKey: 'interviewing',
      contactName: 'the recruiter'
    },
    ...over
  } as PendingDebrief
}

describe('leadPhrase', () => {
  it('counts in minutes below an hour', () => {
    expect(leadPhrase(1)).toBe('in 1 minute')
    expect(leadPhrase(15)).toBe('in 15 minutes')
    expect(leadPhrase(59)).toBe('in 59 minutes')
  })

  it('switches to hours only on a whole hour', () => {
    expect(leadPhrase(60)).toBe('in 1 hour')
    expect(leadPhrase(120)).toBe('in 2 hours')
    expect(leadPhrase(90)).toBe('in 90 minutes')
  })
})

describe('interviewReminders', () => {
  it('falls due a lead time before the event starts', () => {
    const [reminder] = interviewReminders([event()], 15)
    expect(reminder.at).toBe(START_MS - 15 * MINUTE)
    expect(reminder.expiresAt).toBe(START_MS)
  })

  it('names the event and its company in the banner', () => {
    const [reminder] = interviewReminders([event()], 15)
    expect(reminder.title).toBe('Technical interview')
    expect(reminder.body).toBe('Northwind · Staff Engineer · in 15 minutes')
  })

  it('drops the role from the body when the item has none', () => {
    const [reminder] = interviewReminders([event({ item: { id: 7, company: 'Northwind', role: null, statusKey: 'interviewing' } })], 15)
    expect(reminder.body).toBe('Northwind · in 15 minutes')
  })

  it('skips all-day events, which no lead time can describe', () => {
    const allDay = event({
      startsAt: '2026-09-08T00:00:00.000Z',
      endsAt: '2026-09-09T00:00:00.000Z',
      tz: null
    })
    expect(interviewReminders([allDay], 15)).toEqual([])
  })

  it('skips events with no start stamp', () => {
    expect(interviewReminders([event({ startsAt: null })], 15)).toEqual([])
  })

  it('keys a rescheduled event separately so it reminds again', () => {
    const [before] = interviewReminders([event()], 15)
    const [after] = interviewReminders([event({ startsAt: '2026-09-08T16:00:00.000Z' })], 15)
    expect(reminderKey(before)).not.toBe(reminderKey(after))
  })
})

describe('debriefReminders', () => {
  it('falls due once the grace period after the call has passed', () => {
    const [reminder] = debriefReminders([call()])
    expect(reminder.at).toBe(Date.parse('2026-09-08T15:00:00.000Z') + DEBRIEF_GRACE_MS)
    expect(reminder.expiresAt).toBe(reminder.at + REMINDER_FRESHNESS_MS)
  })

  it('waits for a snooze that outlasts the grace period', () => {
    const snoozed = call({ snoozeUntil: '2026-09-08T18:00:00.000Z' })
    const [reminder] = debriefReminders([snoozed])
    expect(reminder.at).toBe(Date.parse('2026-09-08T18:00:00.000Z'))
  })

  it('asks in the same words the debrief form uses', () => {
    const [reminder] = debriefReminders([call()])
    expect(reminder.title).toBe('How did it go?')
    expect(reminder.body).toBe('Technical interview · Northwind')
  })

  it('ignores calls that were already answered or superseded', () => {
    expect(debriefReminders([call({ debriefedAt: '2026-09-08T15:30:00.000Z' })])).toEqual([])
    expect(debriefReminders([call({ supersededBy: 99 })])).toEqual([])
  })

  it('ignores meetings that were never logged as calls', () => {
    expect(debriefReminders([call({ callType: null })])).toEqual([])
  })

  it('ignores calls with no end stamp, which can never come due', () => {
    expect(debriefReminders([call({ endsAt: null })])).toEqual([])
  })
})

describe('dueReminders', () => {
  const reminders = (): Reminder[] => interviewReminders([event()], 15)

  it('stays quiet before the reminder falls due', () => {
    expect(dueReminders(reminders(), new Set(), START_MS - 16 * MINUTE)).toEqual([])
  })

  it('fires once the moment arrives', () => {
    expect(dueReminders(reminders(), new Set(), START_MS - 15 * MINUTE)).toHaveLength(1)
  })

  it('still fires for an app opened inside the lead window', () => {
    expect(dueReminders(reminders(), new Set(), START_MS - 2 * MINUTE)).toHaveLength(1)
  })

  it('never fires a reminder for an event that already started', () => {
    expect(dueReminders(reminders(), new Set(), START_MS)).toEqual([])
    expect(dueReminders(reminders(), new Set(), START_MS + MINUTE)).toEqual([])
  })

  it('lets a stale debrief reminder expire rather than arrive hours late', () => {
    const due = debriefReminders([call()])
    const at = due[0].at
    expect(dueReminders(due, new Set(), at + REMINDER_FRESHNESS_MS - 1)).toHaveLength(1)
    expect(dueReminders(due, new Set(), at + REMINDER_FRESHNESS_MS)).toEqual([])
  })

  it('does not repeat a reminder that already fired', () => {
    const list = reminders()
    const fired = new Set([reminderKey(list[0])])
    expect(dueReminders(list, fired, START_MS - 15 * MINUTE)).toEqual([])
  })
})

describe('nextWakeAt', () => {
  it('returns the soonest moment still ahead', () => {
    const soon = event({ id: 1, startsAt: '2026-09-08T14:00:00.000Z' })
    const later = event({ id: 2, startsAt: '2026-09-08T17:00:00.000Z' })
    const list = interviewReminders([later, soon], 15)
    expect(nextWakeAt(list, new Set(), START_MS - 60 * MINUTE)).toBe(START_MS - 15 * MINUTE)
  })

  it('skips moments that have already passed', () => {
    const soon = event({ id: 1, startsAt: '2026-09-08T14:00:00.000Z' })
    const later = event({ id: 2, startsAt: '2026-09-08T17:00:00.000Z' })
    const list = interviewReminders([soon, later], 15)
    expect(nextWakeAt(list, new Set(), START_MS)).toBe(Date.parse('2026-09-08T17:00:00.000Z') - 15 * MINUTE)
  })

  it('skips reminders that already fired', () => {
    const list = interviewReminders([event()], 15)
    const fired = new Set([reminderKey(list[0])])
    expect(nextWakeAt(list, fired, START_MS - 60 * MINUTE)).toBeNull()
  })

  it('returns null when nothing is left to wake for', () => {
    expect(nextWakeAt([], new Set(), START_MS)).toBeNull()
  })
})
