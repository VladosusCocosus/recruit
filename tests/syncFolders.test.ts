import { describe, expect, it } from 'vitest'
import { selectSyncFolders, type MailboxInfo } from '@main/mail/sync'

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
    expect(selectSyncFolders(GMAIL)).toEqual([
      'INBOX',
      '[Gmail]/All Mail',
      '[Gmail]/Spam',
      '[Gmail]/Trash'
    ])
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
