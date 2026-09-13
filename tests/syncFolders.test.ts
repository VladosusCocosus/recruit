import { describe, expect, it } from 'vitest'
import { advertisesGmailExtensions, selectSyncFolders, type MailboxInfo } from '@main/mail/sync'

function box(path: string, specialUse?: string, flags: string[] = []): MailboxInfo {
  return specialUse
    ? { path, specialUse, flags: new Set(flags) }
    : { path, flags: new Set(flags) }
}

const GMAIL: MailboxInfo[] = [
  box('INBOX'),
  box('Jobs'),
  box('Jobs/Rejections'),
  box('[Gmail]', undefined, ['\\Noselect', '\\HasChildren']),
  box('[Gmail]/All Mail', '\\All'),
  box('[Gmail]/Drafts', '\\Drafts'),
  box('[Gmail]/Important', '\\Important'),
  box('[Gmail]/Sent Mail', '\\Sent'),
  box('[Gmail]/Spam', '\\Junk'),
  box('[Gmail]/Starred', '\\Flagged'),
  box('[Gmail]/Trash', '\\Trash')
]

const PLAIN: MailboxInfo[] = [
  box('INBOX'),
  box('Archive', '\\Archive'),
  box('Drafts', '\\Drafts'),
  box('Junk', '\\Junk'),
  box('Sent', '\\Sent'),
  box('Trash', '\\Trash'),
  box('Clients', undefined, ['\\HasChildren']),
  box('Clients/Acme')
]

describe('selectSyncFolders', () => {
  it('puts INBOX first', () => {
    expect(selectSyncFolders(PLAIN)[0]).toBe('INBOX')
    expect(selectSyncFolders(GMAIL)[0]).toBe('INBOX')
  })

  it('takes every selectable folder on a plain IMAP server', () => {
    expect(selectSyncFolders(PLAIN)).toEqual([
      'INBOX',
      'Archive',
      'Clients',
      'Clients/Acme',
      'Drafts',
      'Junk',
      'Sent',
      'Trash'
    ])
  })

  it('reads Gmail through All Mail rather than through its labels', () => {
    expect(selectSyncFolders(GMAIL, { gmail: true })).toEqual([
      'INBOX',
      '[Gmail]/All Mail',
      '[Gmail]/Spam',
      '[Gmail]/Trash'
    ])
  })

  it('keeps every folder on a non-Gmail server that advertises \\All', () => {
    // Dovecot's virtual plugin: `mailbox virtual/All { special_use = \All }`. Its membership
    // is whatever the admin configured, so it is not a superset of the account.
    const DOVECOT: MailboxInfo[] = [
      box('INBOX'),
      box('Archive', '\\Archive'),
      box('Drafts', '\\Drafts'),
      box('Junk', '\\Junk'),
      box('Sent', '\\Sent'),
      box('Trash', '\\Trash'),
      box('virtual/All', '\\All'),
      box('Recruiters', undefined, ['\\HasChildren']),
      box('Recruiters/Acme'),
      box('Newsletters')
    ]

    const folders = selectSyncFolders(DOVECOT)
    expect(folders).toContain('Recruiters')
    expect(folders).toContain('Recruiters/Acme')
    expect(folders).toContain('Newsletters')
    expect(folders).toContain('Archive')
  })

  it('keeps user folders when a client put \\All on an Archive folder', () => {
    const folders = selectSyncFolders([
      box('INBOX'),
      box('Archive', '\\All'),
      box('Junk', '\\Junk'),
      box('Sent', '\\Sent'),
      box('Trash', '\\Trash'),
      box('Jobs')
    ])
    expect(folders).toContain('Jobs')
    expect(folders).toContain('Sent')
  })
})

describe('advertisesGmailExtensions', () => {
  it('is true only when the server lists X-GM-EXT-1', () => {
    expect(advertisesGmailExtensions(new Map([['X-GM-EXT-1', true]]))).toBe(true)
    expect(advertisesGmailExtensions(new Map([['x-gm-ext-1', true]]))).toBe(true)
    expect(advertisesGmailExtensions(new Map([['IDLE', true], ['SPECIAL-USE', true]]))).toBe(false)
  })

  it('is false when the server said nothing', () => {
    expect(advertisesGmailExtensions(undefined)).toBe(false)
    expect(advertisesGmailExtensions(null)).toBe(false)
    expect(advertisesGmailExtensions(new Map())).toBe(false)
  })

  it('reads mailbox attributes case-insensitively', () => {
    const folders = selectSyncFolders([
      box('INBOX'),
      box('Containers', undefined, ['\\NoSelect']),
      box('Work')
    ])
    expect(folders).toEqual(['INBOX', 'Work'])
  })

  it('skips containers that hold no messages', () => {
    expect(selectSyncFolders(GMAIL)).not.toContain('[Gmail]')
    expect(
      selectSyncFolders([box('INBOX'), box('Ghost', undefined, ['\\NonExistent'])])
    ).toEqual(['INBOX'])
  })

  it('skips the virtual flagged and important views on a non-Gmail server', () => {
    const folders = selectSyncFolders([
      box('INBOX'),
      box('Starred', '\\Flagged'),
      box('Priority', '\\Important'),
      box('Work')
    ])
    expect(folders).toEqual(['INBOX', 'Work'])
  })

  it('never lists INBOX twice', () => {
    const folders = selectSyncFolders([box('inbox'), box('INBOX'), box('Work')])
    expect(folders).toEqual(['INBOX', 'Work'])
  })
})
