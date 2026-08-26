import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractMeetingUrl, parseIcs, parseIcsEvent, supersedes } from '@main/mail/ics'

const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf8')

const googleInvite = fixture('google-invite.ics')
const reschedule = fixture('reschedule-seq2.ics')
const allDay = fixture('allday-onsite.ics')

describe('parseIcs — Google Calendar invite', () => {
  const event = parseIcsEvent(googleInvite)!

  it('parses exactly one VEVENT', () => {
    expect(parseIcs(googleInvite)).toHaveLength(1)
  })

  it('reads identity and scheduling metadata', () => {
    expect(event.uid).toBe('04d9k2m1c8vhq7@google.com')
    expect(event.sequence).toBe(0)
    expect(event.method).toBe('REQUEST')
    expect(event.status).toBe('CONFIRMED')
    expect(event.isCancelled).toBe(false)
    expect(event.summary).toBe('Phone Screen — Senior Engineer @ Northwind')
  })

  it('normalizes the TZID-anchored times to UTC and keeps the zone for display', () => {
    // 10:00 America/Los_Angeles on 2026-09-02 is PDT (UTC-7) => 17:00Z
    expect(event.startsAt).toBe('2026-09-02T17:00:00.000Z')
    expect(event.endsAt).toBe('2026-09-02T17:45:00.000Z')
    expect(event.tz).toBe('America/Los_Angeles')
  })

  it('unwraps CN parameters and strips the mailto: scheme', () => {
    expect(event.organizer).toEqual({ name: 'Dana Reyes', address: 'dana.reyes@northwind.example' })
    expect(event.attendees).toEqual([
      { name: 'Pavel', address: 'razin36986@gmail.com' },
      { name: 'Dana Reyes', address: 'dana.reyes@northwind.example' }
    ])
  })

  it('prefers X-GOOGLE-CONFERENCE for the meeting URL', () => {
    expect(event.meetingUrl).toBe('https://meet.google.com/xzy-abcd-efg')
  })

  it('has no LOCATION, so location is null rather than an empty string', () => {
    expect(event.location).toBeNull()
  })
})

describe('parseIcs — reschedule with a bumped SEQUENCE', () => {
  const original = parseIcsEvent(googleInvite)!
  const updated = parseIcsEvent(reschedule)!

  it('keeps the same UID so the update can be matched to the original', () => {
    expect(updated.uid).toBe(original.uid)
  })

  it('carries the higher SEQUENCE', () => {
    expect(original.sequence).toBe(0)
    expect(updated.sequence).toBe(2)
  })

  it('supersedes the original, and not the other way round', () => {
    expect(supersedes(updated, original)).toBe(true)
    expect(supersedes(original, updated)).toBe(false)
  })

  it('does not supersede an event with a different UID', () => {
    expect(supersedes(updated, { uid: 'someone-else@example.com', sequence: 0 })).toBe(false)
  })

  it('moves the meeting to the new time', () => {
    expect(updated.startsAt).toBe('2026-09-04T19:00:00.000Z')
    expect(updated.endsAt).toBe('2026-09-04T19:45:00.000Z')
  })

  it('reports no tz for a plain Z timestamp instead of the "Etc/UTC" placeholder', () => {
    expect(updated.tz).toBeNull()
  })

  it('extracts a tenant-subdomain Zoom URL out of LOCATION', () => {
    expect(updated.meetingUrl).toBe('https://northwind.zoom.us/j/98765432101?pwd=Zm9vYmFyYmF6')
  })
})

describe('parseIcs — all-day event', () => {
  const event = parseIcsEvent(allDay)!

  it('anchors a VALUE=DATE start at UTC midnight of the stated calendar day', () => {
    // node-ical builds date-only values in LOCAL time, so on any machine east of UTC the
    // raw Date is the *previous* day. The parser must re-anchor it.
    expect(event.startsAt).toBe('2026-09-10T00:00:00.000Z')
  })

  it('keeps DTEND exclusive, per RFC 5545', () => {
    expect(event.endsAt).toBe('2026-09-11T00:00:00.000Z')
  })

  it('reports no timezone for an all-day event', () => {
    expect(event.tz).toBeNull()
  })

  it('unescapes commas in LOCATION', () => {
    expect(event.location).toBe('Northwind HQ, 500 Market St, San Francisco, CA')
  })

  it('has no meeting URL', () => {
    expect(event.meetingUrl).toBeNull()
  })
})

describe('parseIcs — cancellations', () => {
  it('flags METHOD:CANCEL', () => {
    const cancelled = parseIcsEvent(
      reschedule.replace('METHOD:REQUEST', 'METHOD:CANCEL').replace('STATUS:CONFIRMED', 'STATUS:CANCELLED')
    )!
    expect(cancelled.isCancelled).toBe(true)
    expect(cancelled.method).toBe('CANCEL')
  })
})

describe('parseIcs — robustness', () => {
  it('returns [] for non-calendar input rather than throwing', () => {
    expect(parseIcs('this is not an ics file')).toEqual([])
    expect(parseIcs('')).toEqual([])
    expect(parseIcsEvent('nope')).toBeNull()
  })

  it('accepts a Buffer', () => {
    expect(parseIcsEvent(Buffer.from(googleInvite, 'utf8'))?.uid).toBe('04d9k2m1c8vhq7@google.com')
  })
})

describe('extractMeetingUrl', () => {
  it('finds Google Meet, Zoom and Teams links, including on subdomains', () => {
    expect(extractMeetingUrl('join https://meet.google.com/abc-defg-hij now')).toBe(
      'https://meet.google.com/abc-defg-hij'
    )
    expect(extractMeetingUrl('https://acme.zoom.us/j/123')).toBe('https://acme.zoom.us/j/123')
    expect(
      extractMeetingUrl('Join <https://teams.microsoft.com/l/meetup-join/19%3ameeting_x>')
    ).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x')
  })

  it('strips trailing sentence punctuation', () => {
    expect(extractMeetingUrl('See https://meet.google.com/abc-defg-hij.')).toBe(
      'https://meet.google.com/abc-defg-hij'
    )
  })

  it('ignores unrelated links', () => {
    expect(extractMeetingUrl('https://northwind.example/careers')).toBeNull()
    expect(extractMeetingUrl(null, undefined, '')).toBeNull()
  })

  it('does not match a lookalike host', () => {
    expect(extractMeetingUrl('https://notzoom.us/j/1')).toBeNull()
    expect(extractMeetingUrl('https://meet.google.com.evil.example/x')).toBeNull()
  })

  it('takes the first match in argument order', () => {
    expect(
      extractMeetingUrl(null, 'https://acme.zoom.us/j/1', 'https://meet.google.com/a-b-c')
    ).toBe('https://acme.zoom.us/j/1')
  })
})
