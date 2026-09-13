import { beforeEach, describe, expect, it } from 'vitest'
import {
  countMessages,
  createAccount,
  getMessage,
  openDatabase,
  upsertMessage,
  type MessageUpsertInput
} from '@main/db'

let accountId: number

beforeEach(() => {
  openDatabase({ path: ':memory:', reopen: true })
  accountId = createAccount({
    email: 'someone@example.test',
    imapHost: 'imap.example.test',
    imapPort: 993,
    imapSecure: true,
    imapUser: 'someone@example.test'
  }).id
})

function stored(overrides: Partial<MessageUpsertInput> = {}): MessageUpsertInput {
  return {
    accountId,
    folder: 'INBOX',
    uid: 1,
    uidValidity: 1,
    messageId: '<a@example.test>',
    subject: 'A subject',
    fromAddr: 'recruiter@example.test',
    dateUtc: '2026-09-01T10:00:00.000Z',
    ...overrides
  }
}

describe('message identity', () => {
  it('keeps one copy of a Gmail message reachable through INBOX and All Mail', () => {
    upsertMessage(stored({ folder: 'INBOX', uid: 11 }))
    upsertMessage(stored({ folder: '[Gmail]/All Mail', uid: 900 }))

    expect(countMessages(accountId)).toBe(1)
  })

  it('lets the INBOX copy own the row when All Mail saw it first', () => {
    const first = upsertMessage(stored({ folder: '[Gmail]/All Mail', uid: 900 }))
    upsertMessage(stored({ folder: 'INBOX', uid: 11 }))

    expect(countMessages(accountId)).toBe(1)
    expect(getMessage(first.id)?.folder).toBe('INBOX')
  })

  it('does not collapse two different messages that share a Message-ID', () => {
    // Bulk senders and ATS batches reuse a Message-ID, and spam forges it outright.
    upsertMessage(
      stored({
        uid: 11,
        messageId: '<batch@ats.test>',
        subject: 'Interview scheduled',
        dateUtc: '2026-09-01T10:00:00.000Z'
      })
    )
    upsertMessage(
      stored({
        uid: 12,
        messageId: '<batch@ats.test>',
        subject: 'We are moving forward',
        dateUtc: '2026-09-04T16:30:00.000Z'
      })
    )

    expect(countMessages(accountId)).toBe(2)
  })

  it('does not destroy the first subject when a Message-ID is reused', () => {
    const first = upsertMessage(
      stored({
        uid: 11,
        messageId: '<batch@ats.test>',
        subject: 'Interview scheduled',
        dateUtc: '2026-09-01T10:00:00.000Z'
      })
    )
    upsertMessage(
      stored({
        uid: 12,
        messageId: '<batch@ats.test>',
        subject: 'We are moving forward',
        dateUtc: '2026-09-04T16:30:00.000Z'
      })
    )

    expect(getMessage(first.id)?.subject).toBe('Interview scheduled')
  })

  it('still merges a message with no date seen under a second folder', () => {
    upsertMessage(stored({ folder: 'INBOX', uid: 11, dateUtc: null }))
    upsertMessage(stored({ folder: '[Gmail]/All Mail', uid: 900, dateUtc: null }))

    expect(countMessages(accountId)).toBe(1)
  })

  it('stores a message with no Message-ID once per folder, not once per account', () => {
    upsertMessage(stored({ folder: 'INBOX', uid: 11, messageId: null, subject: 'First' }))
    upsertMessage(stored({ folder: 'INBOX', uid: 12, messageId: null, subject: 'Second' }))

    expect(countMessages(accountId)).toBe(2)
  })

  it('re-fetching the same folder and uid updates rather than duplicates', () => {
    const first = upsertMessage(stored({ uid: 11, subject: 'Before' }))
    const again = upsertMessage(stored({ uid: 11, subject: 'After' }))

    expect(again.id).toBe(first.id)
    expect(again.created).toBe(false)
    expect(countMessages(accountId)).toBe(1)
    expect(getMessage(first.id)?.subject).toBe('After')
  })
})
