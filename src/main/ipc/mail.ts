/**
 * The mail service: one MailSync per account, plus the persist + prefilter step that
 * MailSync deliberately does not own (it never touches the DB or the Keychain).
 *
 * MailSync has two message paths on purpose: the `message` EVENT is fire-and-forget for
 * observers, while `options.onMessage` is AWAITED. Only the awaited one persists — that is
 * what gives backpressure against the IMAP stream and what makes newMessages/newCandidates
 * in the status events real numbers instead of zeros.
 */
import type {
  Account,
  PrefilterContext,
  PrefilterMessage,
  SyncResult,
  SyncStatus
} from '@shared/types'
import * as db from '@main/db'
import * as keychain from '@main/keychain'
import { MailSync, type MessageStoreResult, type SyncedMessage } from '@main/mail/sync'
import { score } from '@main/prefilter'
import { getSettings } from '@main/settings'
import { broadcast } from './bridge'

/** The prefilter context is two small queries; memoize it across one sync burst. */
const CONTEXT_TTL_MS = 3_000

const PREFILTER_CHUNK = 250

export interface MailService {
  /** Boots background sync (backfill -> IDLE -> poll) for every configured account. */
  startAll(): Promise<void>
  syncNow(accountId?: number): Promise<SyncResult>
  cancel(): void
  status(): SyncStatus
  /** Re-reads the account row + password and restarts its sync. Call after saveAccount. */
  refreshAccount(accountId: number): Promise<void>
  /** Tears down one account's sync. Call before deleteAccount. */
  forgetAccount(accountId: number): Promise<void>
  rescore(): { scored: number; candidates: number }
  dispose(): Promise<void>
}

function idleStatus(accountId: number | null = null): SyncStatus {
  return {
    phase: 'idle',
    accountId,
    processed: 0,
    total: 0,
    newMessages: 0,
    newCandidates: 0,
    lastSyncAt: null,
    error: null
  }
}

/**
 * Persist + score one fetched message. Exported so the mapping can be exercised directly:
 * almost every field here is `string | null` on both sides, so a swapped pair (to/cc,
 * subject/snippet) typechecks perfectly and only a real message catches it.
 */
export function persistSyncedMessage(m: SyncedMessage, ctx: PrefilterContext): MessageStoreResult {
  const p = m.parsed

  const { id, created } = db.upsertMessage({
    accountId: m.accountId,
    folder: m.folder,
    uid: m.uid,
    uidValidity: m.uidValidity,
    messageId: p.messageId,
    inReplyTo: p.inReplyTo,
    references: p.references,
    threadKey: p.threadKey,
    fromName: p.fromName,
    fromAddr: p.fromAddr,
    fromDomain: p.fromDomain,
    to: p.to,
    cc: p.cc,
    subject: p.subject,
    dateUtc: p.dateUtc ?? m.internalDate,
    snippet: p.snippet,
    bodyText: p.bodyText,
    bodyHtml: p.bodyHtml,
    listUnsubscribe: p.listUnsubscribe,
    hasAttachments: p.hasAttachments,
    flags: m.flags,
    // v1 keeps attachment metadata only — nothing is written to disk.
    attachments: p.attachments.map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      contentId: a.contentId,
      isCalendar: a.isCalendar,
      diskPath: null
    }))
  })

  const input: PrefilterMessage = {
    fromAddr: p.fromAddr,
    fromDomain: p.fromDomain,
    subject: p.subject,
    bodyText: p.bodyText,
    bodyHtml: p.bodyHtml,
    threadKey: p.threadKey,
    listUnsubscribe: p.listUnsubscribe,
    attachments: p.attachments.map((a) => ({
      filename: a.filename,
      mimeType: a.mimeType,
      isCalendar: a.isCalendar
    }))
  }
  const result = score(input, ctx)
  // Never clobbers a processed/dismissed/linked message — only unseen <-> candidate.
  db.setPrefilterResult(id, result.score, result.reasons, result.isCandidate)

  return { stored: created, isCandidate: result.isCandidate }
}

export function createMailService(): MailService {
  const syncs = new Map<number, MailSync>()
  let last: SyncStatus = idleStatus()

  let cachedContext: PrefilterContext | null = null
  let cachedAt = 0

  function prefilterContext(): PrefilterContext {
    const now = Date.now()
    if (!cachedContext || now - cachedAt > CONTEXT_TTL_MS) {
      cachedContext = db.getPrefilterContext()
      cachedAt = now
    }
    return { ...cachedContext, threshold: getSettings().prefilterThreshold }
  }

  function invalidateContext(): void {
    cachedContext = null
  }

  /** Awaited by MailSync, so persisting backpressures against the IMAP stream. */
  const storeMessage = (m: SyncedMessage): MessageStoreResult =>
    persistSyncedMessage(m, prefilterContext())

  async function credentialsFor(account: Account): Promise<{ user: string; password: string }> {
    const password = account.keychainRefImap
      ? await keychain.getPasswordByRef(account.keychainRefImap)
      : await keychain.getPassword(account.email, 'imap')
    if (!password) {
      throw new Error(
        `No stored IMAP password for ${account.email}. Re-enter it in Settings and test the connection.`
      )
    }
    return { user: account.imapUser || account.email, password }
  }

  function wire(sync: MailSync): MailSync {
    sync.on('status', (status) => {
      last = status
      broadcast('syncStatus', status)
      if (status.phase === 'done' && status.newMessages > 0) {
        invalidateContext()
        broadcast('mailChanged', {
          accountId: status.accountId ?? sync.accountId,
          newMessages: status.newMessages,
          newCandidates: status.newCandidates
        })
      }
    })

    sync.on('uidState', (e) => {
      db.setAccountCursor(e.accountId, e.uidValidity, e.lastUid)
    })

    sync.on('resync', (e) => {
      // UIDVALIDITY moved: every stored UID for this folder now means something else.
      // v1 does NOT delete the old rows (they may be linked to tracker items); the UNIQUE
      // key includes uid_validity, so the refetch simply lands alongside them.
      console.warn(
        `[mail] UIDVALIDITY changed for account ${e.accountId} ${e.folder}: ` +
          `${e.previousUidValidity} -> ${e.uidValidity}; refetching from scratch.`
      )
      db.setAccountCursor(e.accountId, e.uidValidity, 0)
    })

    sync.on('error', (e) => {
      last = { ...last, accountId: e.accountId, phase: 'error', error: e.message }
      broadcast('syncStatus', last)
      if (e.isAuthError) {
        console.error(`[mail] auth rejected for account ${e.accountId}: ${e.message}`)
      }
    })

    return sync
  }

  async function ensure(account: Account): Promise<MailSync> {
    const existing = syncs.get(account.id)
    if (existing) return existing

    const settings = getSettings()
    const sync = wire(
      new MailSync({
        account,
        credentials: await credentialsFor(account),
        onMessage: storeMessage,
        backfillDays: settings.syncBackfillDays,
        pollIntervalMs: Math.max(1, settings.syncIntervalMinutes) * 60_000
      })
    )
    syncs.set(account.id, sync)
    return sync
  }

  async function drop(accountId: number): Promise<void> {
    const sync = syncs.get(accountId)
    if (!sync) return
    syncs.delete(accountId)
    try {
      await sync.stop()
    } catch {
      /* closing a dead socket is not an error worth surfacing */
    }
  }

  return {
    async startAll() {
      for (const account of db.listAccounts()) {
        try {
          const sync = await ensure(account)
          await sync.start()
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          last = { ...idleStatus(account.id), phase: 'error', error: message }
          broadcast('syncStatus', last)
          console.error(`[mail] could not start sync for ${account.email}: ${message}`)
        }
      }
    },

    async syncNow(accountId?: number) {
      const account = accountId != null ? db.getAccount(accountId) : (db.listAccounts()[0] ?? null)
      if (!account) throw new Error('No mail account configured. Add one in Settings.')

      const startedMs = Date.now()
      let sync: MailSync
      try {
        // ensure() reads the Keychain, so "no stored password" lands here too — that is a
        // SyncResult with an error, not a rejected IPC call.
        sync = await ensure(account)
        // start(), not syncOnce(): a rejected login LATCHES inside MailSync so the poll
        // can't brute-force the provider, and start() is the only thing that re-arms it.
        // A user clicking "Sync now" after fixing the password is exactly that moment,
        // and it cannot loop — it takes a click. It also refreshes the poll timer.
        await sync.start()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        last = { ...last, accountId: account.id, phase: 'error', error: message }
        broadcast('syncStatus', last)
        return {
          accountId: account.id,
          newMessages: 0,
          newCandidates: 0,
          durationMs: Date.now() - startedMs,
          error: message
        }
      }

      const status = sync.getStatus()
      return {
        accountId: account.id,
        newMessages: status.newMessages,
        newCandidates: status.newCandidates,
        durationMs: Date.now() - startedMs,
        error: status.error
      }
    },

    cancel() {
      for (const sync of syncs.values()) sync.cancel()
    },

    status() {
      return last
    },

    async refreshAccount(accountId: number) {
      await drop(accountId)
      const account = db.getAccount(accountId)
      if (!account) return
      const sync = await ensure(account)
      await sync.start()
    },

    async forgetAccount(accountId: number) {
      await drop(accountId)
      if (last.accountId === accountId) last = idleStatus()
    },

    /**
     * Full rescore, e.g. after the threshold moved or an item gained a company domain.
     * Chunked so a big mailbox never loads every body at once.
     */
    rescore() {
      invalidateContext()
      const ctx = prefilterContext()
      const ids = db.listMessageIdsForPrefilter()
      let scored = 0
      let candidates = 0
      for (let i = 0; i < ids.length; i += PREFILTER_CHUNK) {
        for (const input of db.getPrefilterInputs(ids.slice(i, i + PREFILTER_CHUNK))) {
          const result = score(input, ctx)
          db.setPrefilterResult(input.id, result.score, result.reasons, result.isCandidate)
          scored += 1
          if (result.isCandidate) candidates += 1
        }
      }
      return { scored, candidates }
    },

    async dispose() {
      const all = [...syncs.values()]
      syncs.clear()
      await Promise.all(
        all.map(async (sync) => {
          try {
            await sync.stop()
          } catch {
            /* ignore */
          }
        })
      )
    }
  }
}
