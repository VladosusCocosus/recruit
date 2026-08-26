import { describe, expect, it } from 'vitest'
import { PREFILTER_THRESHOLD_DEFAULT, type PrefilterContext, type PrefilterMessage } from '@shared/types'
import { score } from '@main/prefilter/index'

/** A message with every signal switched off. Tests turn on exactly what they mean to test. */
function message(patch: Partial<PrefilterMessage> = {}): PrefilterMessage {
  return {
    fromAddr: 'someone@example.com',
    fromDomain: 'example.com',
    subject: 'Lunch tomorrow?',
    bodyText: 'Hey, are you free at noon?',
    bodyHtml: null,
    threadKey: 'mid:plain-1@example.com',
    listUnsubscribe: null,
    attachments: [],
    ...patch
  }
}

function context(patch: Partial<PrefilterContext> = {}): PrefilterContext {
  return {
    itemDomains: new Set<string>(),
    linkedThreadKeys: new Set<string>(),
    ...patch
  }
}

const codes = (result: { reasons: Array<{ code: string }> }): string[] =>
  result.reasons.map((r) => r.code)

describe('prefilter — ATS senders', () => {
  it('flags a Greenhouse notification on the domain alone', () => {
    // "applying" does NOT match the keyword pattern (it looks for "applicat"), so this
    // message clears the bar on the ATS domain by itself — which is the point of the +0.5.
    const result = score(
      message({
        fromAddr: 'no-reply@greenhouse.io',
        fromDomain: 'greenhouse.io',
        subject: 'Thanks for applying to Northwind',
        threadKey: 'mid:gh-1@greenhouse.io'
      }),
      context()
    )
    expect(codes(result)).toEqual(['ats_domain'])
    expect(result.score).toBe(0.5)
    expect(result.isCandidate).toBe(true)
  })

  it('adds the subject keyword on top of the ATS domain when it matches', () => {
    const result = score(
      message({
        fromAddr: 'no-reply@greenhouse.io',
        fromDomain: 'greenhouse.io',
        subject: 'Your application to Northwind',
        threadKey: 'mid:gh-1b@greenhouse.io'
      }),
      context()
    )
    expect(codes(result)).toEqual(['ats_domain', 'subject_keyword'])
    expect(result.score).toBeCloseTo(0.8, 5) // 0.5 ATS + 0.3 subject ("applicat")
  })

  it('matches ATS subdomains', () => {
    const result = score(
      message({ fromDomain: 'mail.us.greenhouse-mail.io', subject: 'Update', threadKey: 'mid:x' }),
      context()
    )
    expect(result.score).toBe(0.5)
    expect(result.isCandidate).toBe(true)
  })

  it('reports the most specific ATS domain as the reason detail', () => {
    const result = score(
      message({ fromDomain: 'us.greenhouse-mail.io', subject: null, threadKey: 'mid:x' }),
      context()
    )
    const ats = result.reasons.find((r) => r.code === 'ats_domain')
    expect(ats?.detail).toBe('us.greenhouse-mail.io')
  })

  it('does not match a lookalike domain', () => {
    const result = score(
      message({ fromDomain: 'notgreenhouse.io', subject: null, threadKey: 'mid:x' }),
      context()
    )
    expect(codes(result)).not.toContain('ats_domain')
    expect(result.isCandidate).toBe(false)
  })

  it('derives the domain from fromAddr when fromDomain is missing', () => {
    const result = score(
      message({ fromAddr: 'jobs@lever.co', fromDomain: null, subject: null, threadKey: 'mid:x' }),
      context()
    )
    expect(codes(result)).toContain('ats_domain')
  })
})

describe('prefilter — thread already linked to an item', () => {
  it('is the strongest single signal and clears the bar on its own', () => {
    const result = score(
      message({ subject: 'Re: coffee', threadKey: 'mid:thread-42@northwind.example' }),
      context({ linkedThreadKeys: new Set(['mid:thread-42@northwind.example']) })
    )
    expect(codes(result)).toEqual(['thread_linked'])
    expect(result.score).toBe(0.9)
    expect(result.isCandidate).toBe(true)
  })

  it('ignores a thread key that is not linked', () => {
    const result = score(
      message({ threadKey: 'mid:unrelated@example.com' }),
      context({ linkedThreadKeys: new Set(['mid:thread-42@northwind.example']) })
    )
    expect(codes(result)).not.toContain('thread_linked')
  })
})

describe('prefilter — known company domain', () => {
  it('flags mail from a company already on the board', () => {
    const result = score(
      message({
        fromAddr: 'dana@northwind.example',
        fromDomain: 'northwind.example',
        subject: 'Quick question',
        threadKey: 'mid:n-1'
      }),
      context({ itemDomains: new Set(['northwind.example']) })
    )
    expect(codes(result)).toEqual(['known_company_domain'])
    expect(result.score).toBe(0.6)
    expect(result.isCandidate).toBe(true)
  })

  it('matches a subdomain of a tracked company', () => {
    const result = score(
      message({ fromDomain: 'careers.northwind.example', subject: null, threadKey: 'mid:n-2' }),
      context({ itemDomains: new Set(['northwind.example']) })
    )
    expect(codes(result)).toContain('known_company_domain')
  })
})

describe('prefilter — meeting signals', () => {
  it('flags a .ics attachment', () => {
    const result = score(
      message({
        subject: 'Tomorrow',
        threadKey: 'mid:m-1',
        attachments: [{ filename: 'invite.ics', mimeType: 'text/calendar', isCalendar: true }]
      }),
      context()
    )
    expect(codes(result)).toEqual(['meeting_signal'])
    expect(result.score).toBe(0.3)
    // 0.3 alone is below the bar — an invite still needs a second signal.
    expect(result.isCandidate).toBe(false)
  })

  it('recognises a .ics by filename even when the flags disagree', () => {
    const result = score(
      message({
        subject: null,
        threadKey: 'mid:m-2',
        attachments: [{ filename: 'meeting.ICS', mimeType: 'application/octet-stream', isCalendar: false }]
      }),
      context()
    )
    expect(codes(result)).toContain('meeting_signal')
  })

  it('flags a meeting URL in the body', () => {
    const result = score(
      message({ subject: null, threadKey: 'mid:m-3', bodyText: 'Join at https://acme.zoom.us/j/1' }),
      context()
    )
    expect(codes(result)).toContain('meeting_signal')
  })

  it('finds a meeting URL in the HTML body too', () => {
    const result = score(
      message({
        subject: null,
        threadKey: 'mid:m-4',
        bodyText: null,
        bodyHtml: '<a href="https://teams.microsoft.com/l/meetup-join/x">Join</a>'
      }),
      context()
    )
    expect(codes(result)).toContain('meeting_signal')
  })

  it('counts the meeting signal once, not once per source', () => {
    const result = score(
      message({
        subject: null,
        threadKey: 'mid:m-5',
        bodyText: 'https://meet.google.com/a-b-c',
        attachments: [{ filename: 'invite.ics', mimeType: 'text/calendar', isCalendar: true }]
      }),
      context()
    )
    expect(result.reasons.filter((r) => r.code === 'meeting_signal')).toHaveLength(1)
  })

  it('combines with the subject keyword to clear the threshold', () => {
    const result = score(
      message({
        subject: 'Interview scheduling',
        threadKey: 'mid:m-6',
        attachments: [{ filename: 'invite.ics', mimeType: 'text/calendar', isCalendar: true }]
      }),
      context()
    )
    expect(result.score).toBeCloseTo(0.6, 5)
    expect(result.isCandidate).toBe(true)
  })
})

describe('prefilter — newsletters', () => {
  it('pushes a job-board newsletter below the threshold', () => {
    const result = score(
      message({
        fromAddr: 'digest@jobsweekly.example',
        fromDomain: 'jobsweekly.example',
        subject: '12 new opportunities for you this week',
        threadKey: 'mid:nl-1@jobsweekly.example',
        listUnsubscribe: '<https://jobsweekly.example/u/abc>, <mailto:unsub@jobsweekly.example>'
      }),
      context()
    )
    expect(codes(result)).toEqual(['subject_keyword', 'newsletter_penalty'])
    // 0.3 keyword - 0.4 penalty
    expect(result.score).toBeCloseTo(-0.1, 5)
    expect(result.isCandidate).toBe(false)
  })

  it('does NOT penalize an ATS mail that also carries List-Unsubscribe', () => {
    // Greenhouse and Lever both set the header. Penalizing them would hide real rejections.
    const result = score(
      message({
        fromAddr: 'no-reply@greenhouse.io',
        fromDomain: 'greenhouse.io',
        subject: 'Your application to Northwind',
        threadKey: 'mid:gh-2@greenhouse.io',
        listUnsubscribe: '<https://greenhouse.io/unsub>'
      }),
      context()
    )
    expect(codes(result)).not.toContain('newsletter_penalty')
    expect(result.score).toBeCloseTo(0.8, 5)
    expect(result.isCandidate).toBe(true)
  })

  it('does not let two weak signals rescue a newsletter', () => {
    // subject (0.3) + meeting (0.3) are both < 0.5, so the penalty still applies.
    const result = score(
      message({
        fromDomain: 'jobsweekly.example',
        subject: 'Webinar: hiring trends',
        threadKey: 'mid:nl-2',
        bodyText: 'Register: https://acme.zoom.us/j/9',
        listUnsubscribe: '<https://jobsweekly.example/u>'
      }),
      context()
    )
    expect(codes(result)).toContain('newsletter_penalty')
    expect(result.score).toBeCloseTo(0.2, 5)
    expect(result.isCandidate).toBe(false)
  })

  it('ignores a blank List-Unsubscribe header', () => {
    const result = score(
      message({ subject: 'Interview', threadKey: 'mid:nl-3', listUnsubscribe: '   ' }),
      context()
    )
    expect(codes(result)).not.toContain('newsletter_penalty')
  })
})

describe('prefilter — plain personal email', () => {
  it('scores zero and stays out of the agent’s reach', () => {
    const result = score(message(), context())
    expect(result.reasons).toEqual([])
    expect(result.score).toBe(0)
    expect(result.isCandidate).toBe(false)
  })

  it('stays below the threshold even with a chatty subject', () => {
    const result = score(
      message({ subject: 'Are you free for a role-play tonight?', threadKey: 'mid:p-1' }),
      context()
    )
    // "role" matches the keyword pattern, but 0.3 alone is not enough.
    expect(result.score).toBe(0.3)
    expect(result.isCandidate).toBe(false)
  })
})

describe('prefilter — thresholds and arithmetic', () => {
  it('treats a score exactly at the threshold as a candidate', () => {
    const result = score(
      message({ fromDomain: 'lever.co', subject: null, threadKey: 'mid:t-1' }),
      context()
    )
    expect(result.score).toBe(PREFILTER_THRESHOLD_DEFAULT)
    expect(result.isCandidate).toBe(true)
  })

  it('honours a custom threshold', () => {
    const msg = message({ fromDomain: 'lever.co', subject: null, threadKey: 'mid:t-2' })
    expect(score(msg, context({ threshold: 0.9 })).isCandidate).toBe(false)
    expect(score(msg, context({ threshold: 0.2 })).isCandidate).toBe(true)
  })

  it('does not leak binary float noise into the score', () => {
    // 0.6 + 0.3 is 0.8999999999999999 in IEEE 754; the score must read 0.9.
    const result = score(
      message({
        fromDomain: 'northwind.example',
        subject: 'Interview next week',
        threadKey: 'mid:t-3'
      }),
      context({ itemDomains: new Set(['northwind.example']) })
    )
    expect(result.score).toBe(0.9)
  })

  it('stacks every signal for a live interview thread from a tracked company', () => {
    const result = score(
      message({
        fromAddr: 'dana@northwind.example',
        fromDomain: 'northwind.example',
        subject: 'Re: Onsite interview logistics',
        threadKey: 'mid:thread-42@northwind.example',
        bodyText: 'https://meet.google.com/a-b-c',
        attachments: [{ filename: 'invite.ics', mimeType: 'text/calendar', isCalendar: true }]
      }),
      context({
        itemDomains: new Set(['northwind.example']),
        linkedThreadKeys: new Set(['mid:thread-42@northwind.example'])
      })
    )
    expect(result.score).toBe(2.1) // 0.6 + 0.9 + 0.3 + 0.3
    expect(result.isCandidate).toBe(true)
  })

  it('is pure — the same input scores the same twice', () => {
    const msg = message({ fromDomain: 'greenhouse.io', subject: 'Interview', threadKey: 'mid:pure' })
    const ctx = context()
    expect(score(msg, ctx)).toEqual(score(msg, ctx))
  })
})
