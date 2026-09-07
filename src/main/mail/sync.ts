/**
 * IMAP sync for one account, across every folder the server lists. Read-only: this module
 * never sets a flag, never moves a message and never deletes anything. v1 mail is strictly
 * observational.
 *
 * Shape of a session:
 *   connect -> per folder, backfill (last 90 days) then everything above that folder's
 *   cursor -> IDLE on INBOX for push, with a 5-minute poll that sweeps every folder
 *
 * Credentials are a PARAMETER. This module never touches the Keychain — the secrets module
 * resolves the password and hands it in, so there is exactly one place that reads secrets.
 *
 * Two data paths, deliberately:
 *   - `on('message')`  fire-and-forget, for observers (logging, counters, the renderer).
 *   - `options.onMessage`  awaited, for the ONE consumer that persists. Awaiting it gives
 *     backpressure against the IMAP stream and lets sync report accurate new/candidate
 *     counts in its status events. Emitting alone cannot do either — listeners are sync.
 */

import { EventEmitter } from 'node:events'
import { ImapFlow, type FetchMessageObject, type ImapFlowOptions, type MailboxLockObject } from 'imapflow'
import type {
  Account,
  ConnectionTestInput,
  ConnectionTestResult,
  FolderCursor,
  SyncStatus
} from '@shared/types'
import { parseMessageSource, type ParsedMessage } from './parse'

const INBOX = 'INBOX'
/**
 * Special-use mailboxes that are a view over other folders rather than storage of their own.
 * Reading one stores every message it lists a second time.
 */
const VIRTUAL_SPECIAL_USE = new Set(['\\Flagged', '\\Important'])
const DEFAULT_BACKFILL_DAYS = 90
/** Poll fallback for servers where IDLE is missing or the connection silently stalls. */
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000
/** UIDs per FETCH command. Keeps the command line sane on a big backfill. */
const FETCH_BATCH_SIZE = 200
/** Collapse a burst of EXISTS notifications into one sync. */
const IDLE_DEBOUNCE_MS = 1_500

const RECONNECT_BASE_MS = 2_000
const RECONNECT_MAX_MS = 60_000

/* ────────────────────────────────────────────────────────────────────────────
 * public shapes
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ImapCredentials {
  /** Defaults to account.imapUser when omitted. */
  user?: string
  password: string
}

/** One fetched message, already parsed. `source` is the raw RFC822 bytes. */
export interface SyncedMessage {
  accountId: number
  folder: string
  uid: number
  uidValidity: number
  flags: string[]
  /** IMAP INTERNALDATE, ISO-8601 UTC. */
  internalDate: string | null
  source: Buffer
  parsed: ParsedMessage
}

/** What the persisting consumer reports back so status counts stay honest. */
export interface MessageStoreResult {
  /** false when it was already in the DB (a re-fetch after UIDVALIDITY change). */
  stored: boolean
  /** true when the prefilter put it over the threshold. */
  isCandidate: boolean
}

/** Emitted whenever the server's UID state moves. Persist onto the folder's cursor. */
export interface UidStateEvent {
  accountId: number
  folder: string
  uidValidity: number
  lastUid: number
}

/** UIDVALIDITY changed: every stored UID for this folder is meaningless. Full resync. */
export interface ResyncEvent {
  accountId: number
  folder: string
  previousUidValidity: number | null
  uidValidity: number
}

export interface MailSyncError {
  accountId: number
  /** true when the password/username was rejected — the UI should say so, not "retrying". */
  isAuthError: boolean
  message: string
  cause?: unknown
}

export interface MailSyncEvents {
  message: [SyncedMessage]
  status: [SyncStatus]
  error: [MailSyncError]
  uidState: [UidStateEvent]
  resync: [ResyncEvent]
}

export interface MailSyncOptions {
  account: Account
  credentials: ImapCredentials
  /**
   * Awaited per message. Do the DB write and the prefilter here and return the counts.
   * Throwing aborts only that message; sync logs and continues.
   */
  onMessage?: (message: SyncedMessage) => Promise<MessageStoreResult> | MessageStoreResult
  /** An explicit folder list. Omit to read every folder the server lists. */
  folders?: string[]
  /** Where the previous pass stopped. A folder with no cursor gets the backfill window. */
  cursors?: FolderCursor[]
  backfillDays?: number
  pollIntervalMs?: number
  /** Pipe imapflow's protocol log somewhere. Off by default. */
  debug?: boolean
}

/* ────────────────────────────────────────────────────────────────────────────
 * helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const AUTH_ERROR_PATTERN =
  /auth|credential|password|login|invalid user|AUTHENTICATIONFAILED|Application-specific password/i

function isAuthFailure(error: unknown): boolean {
  if (!error) return false
  const err = error as { authenticationFailed?: boolean; responseText?: string; message?: string; code?: string }
  if (err.authenticationFailed === true) return true
  if (err.code === 'AUTHENTICATIONFAILED') return true
  return AUTH_ERROR_PATTERN.test(`${err.responseText ?? ''} ${err.message ?? ''}`)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const err = error as { responseText?: string; message?: string } | null
  return err?.responseText ?? err?.message ?? String(error)
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** One mailbox as `client.list()` reports it, narrowed to what folder selection reads. */
export interface MailboxInfo {
  path: string
  flags: Set<string>
  specialUse?: string
}

/** IMAP mailbox attributes are case-insensitive, and servers disagree about `\Noselect`. */
function hasFlag(box: MailboxInfo, flag: string): boolean {
  const wanted = flag.toLowerCase()
  for (const value of box.flags) {
    if (value.toLowerCase() === wanted) return true
  }
  return false
}

/**
 * Every folder worth reading, INBOX first and the rest in name order.
 *
 * A server that advertises an `\All` mailbox (Gmail) is a special case: All Mail already
 * holds every message that is not spam or trash, and every label is a view over it, so the
 * labels are dropped and INBOX, All Mail, Junk and Trash cover the account exactly once.
 */
export function selectSyncFolders(boxes: MailboxInfo[]): string[] {
  const selectable = boxes.filter(
    (box) => !hasFlag(box, '\\Noselect') && !hasFlag(box, '\\NonExistent')
  )
  const keep = selectable.some((box) => box.specialUse === '\\All')
    ? selectable.filter((box) => ['\\All', '\\Junk', '\\Trash'].includes(box.specialUse ?? ''))
    : selectable.filter((box) => !VIRTUAL_SPECIAL_USE.has(box.specialUse ?? ''))

  const rest = keep
    .map((box) => box.path)
    .filter((path) => path.toUpperCase() !== INBOX)
    .sort((a, b) => a.localeCompare(b))

  return [INBOX, ...rest]
}

/* ────────────────────────────────────────────────────────────────────────────
 * MailSync
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * One long-lived IMAP session for one account. Main holds a Map<accountId, MailSync>.
 *
 *   const sync = new MailSync({ account, credentials, onMessage: store })
 *   sync.on('status', (s) => broadcast('syncStatus', s))
 *   await sync.start()
 */
export class MailSync extends EventEmitter<MailSyncEvents> {
  private readonly account: Account
  private readonly credentials: ImapCredentials
  private readonly folderOverride: string[] | null
  private readonly backfillDays: number
  private readonly pollIntervalMs: number
  private readonly debug: boolean
  private readonly onMessage: MailSyncOptions['onMessage']

  private client: ImapFlow | null = null
  private connecting: Promise<ImapFlow> | null = null
  private running: Promise<void> | null = null

  private pollTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempts = 0

  private stopped = false
  private cancelRequested = false
  /**
   * Latched once the server rejects the credentials. A failed login also closes the socket,
   * and the 'close' handler would otherwise schedule a reconnect that fails the same way —
   * an endless login loop that gets the account rate-limited or locked by the provider.
   * Cleared only by an explicit start(), i.e. after the user has fixed the password.
   */
  private authFailed = false

  /** Per folder, updated as we learn the server's state. */
  private readonly cursors = new Map<string, { uidValidity: number; lastUid: number }>()
  /** New messages and new candidates so far in the current pass, across every folder. */
  private passNew = 0
  private passCandidates = 0
  private lastSyncAt: string | null = null

  private status: SyncStatus

  constructor(options: MailSyncOptions) {
    super()
    this.account = options.account
    this.credentials = options.credentials
    this.folderOverride = options.folders ?? null
    this.backfillDays = options.backfillDays ?? DEFAULT_BACKFILL_DAYS
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.debug = options.debug ?? false
    this.onMessage = options.onMessage

    for (const cursor of options.cursors ?? []) {
      this.cursors.set(cursor.folder, {
        uidValidity: cursor.uidValidity,
        lastUid: cursor.lastUid
      })
    }

    this.status = {
      phase: 'idle',
      accountId: options.account.id,
      folder: null,
      processed: 0,
      total: 0,
      newMessages: 0,
      newCandidates: 0,
      lastSyncAt: null,
      error: null
    }
  }

  get accountId(): number {
    return this.account.id
  }

  getStatus(): SyncStatus {
    return { ...this.status }
  }

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch, lastSyncAt: patch.lastSyncAt ?? this.lastSyncAt }
    this.emit('status', this.getStatus())
  }

  private reportError(error: unknown, phase: SyncStatus['phase'] = 'error'): void {
    const payload: MailSyncError = {
      accountId: this.account.id,
      isAuthError: isAuthFailure(error),
      message: errorMessage(error),
      cause: error
    }
    if (payload.isAuthError) this.authFailed = true
    this.emit('error', payload)
    this.setStatus({ phase, error: payload.message })
  }

  /* ── connection ─────────────────────────────────────────────────────────── */

  private buildOptions(): ImapFlowOptions {
    return {
      host: this.account.imapHost,
      port: this.account.imapPort,
      secure: this.account.imapSecure,
      auth: {
        user: this.credentials.user ?? this.account.imapUser,
        pass: this.credentials.password
      },
      clientInfo: { name: 'Recruit', vendor: 'Recruit' },
      logger: false,
      emitLogs: this.debug,
      // Auto-IDLE is imapflow's push mechanism; we want it. maxIdleTime restarts IDLE
      // periodically so middleboxes don't silently drop a long-lived connection.
      disableAutoIdle: false,
      maxIdleTime: 4 * 60 * 1000
    }
  }

  private async getClient(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client
    if (this.connecting) return this.connecting

    this.setStatus({ phase: 'connecting', error: null })

    this.connecting = (async () => {
      const client = new ImapFlow(this.buildOptions())

      client.on('error', (error) => {
        this.reportError(error)
        this.scheduleReconnect(error)
      })
      client.on('close', () => {
        if (!this.stopped) this.scheduleReconnect(null)
      })
      // Push: new mail arrived while we were idling.
      client.on('exists', () => this.scheduleIdleSync())

      await client.connect()
      this.client = client
      this.reconnectAttempts = 0
      return client
    })()

    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  private scheduleReconnect(error: unknown): void {
    if (this.stopped || this.reconnectTimer) return
    // An auth failure will not fix itself by retrying — surface it and stay down. The latch
    // matters because the socket close that follows a rejected login arrives with no error.
    if (this.authFailed || (error && isAuthFailure(error))) return

    this.client = null
    this.reconnectAttempts += 1
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1), RECONNECT_MAX_MS)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      void this.syncOnce().catch(() => {
        /* reportError already fired */
      })
    }, delay)
  }

  /** IDLE fires for the selected mailbox, which is INBOX; the poll sweeps the rest. */
  private scheduleIdleSync(): void {
    if (this.stopped || this.idleTimer) return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      void this.syncOnce([INBOX]).catch(() => {
        /* reportError already fired */
      })
    }, IDLE_DEBOUNCE_MS)
  }

  /* ── lifecycle ──────────────────────────────────────────────────────────── */

  /** Connect, run the first sync, then keep the connection live (IDLE + poll). */
  async start(): Promise<void> {
    this.stopped = false
    // Re-arm after a credential fix; start() is the only way back from an auth failure.
    this.authFailed = false
    await this.syncOnce()

    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      void this.syncOnce().catch(() => {
        /* reportError already fired */
      })
    }, this.pollIntervalMs)
    // Don't hold the process open for a poll.
    this.pollTimer.unref?.()
  }

  /** Ask the in-flight sync to stop after the current message. */
  cancel(): void {
    this.cancelRequested = true
  }

  /** Tear down: stop timers, wait for the in-flight sync, log out. */
  async stop(): Promise<void> {
    this.stopped = true
    this.cancelRequested = true

    for (const timer of [this.pollTimer, this.idleTimer, this.reconnectTimer]) {
      if (timer) clearTimeout(timer as NodeJS.Timeout)
    }
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    this.idleTimer = null
    this.reconnectTimer = null

    try {
      await this.running
    } catch {
      /* already reported */
    }

    const client = this.client
    this.client = null
    if (client) {
      try {
        await client.logout()
      } catch {
        client.close()
      }
    }
    this.setStatus({ phase: 'idle' })
  }

  /* ── the sync itself ────────────────────────────────────────────────────── */

  /**
   * Run one incremental (or, first time, backfill) pass over `scope`, or over every folder
   * when it is omitted. Serialized: concurrent calls await the in-flight one.
   */
  async syncOnce(scope?: string[]): Promise<void> {
    if (this.running) return this.running
    this.cancelRequested = false
    this.running = this.runSync(scope).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async runSync(scope?: string[]): Promise<void> {
    // The 5-minute poll must not become a slow brute-force loop against a rejected login.
    if (this.authFailed || this.stopped) return

    try {
      const client = await this.getClient()

      this.passNew = 0
      this.passCandidates = 0
      this.setStatus({
        phase: 'listing',
        folder: null,
        processed: 0,
        total: 0,
        newMessages: 0,
        newCandidates: 0,
        error: null
      })

      const folders = scope ?? (await this.resolveFolders(client))
      for (const folder of folders) {
        if (this.cancelRequested || this.stopped) break
        await this.syncFolder(client, folder)
      }

      // Auto-IDLE watches whichever mailbox is selected, and that is the folder read last.
      if (!this.stopped && folders[folders.length - 1] !== INBOX) {
        const lock = await client.getMailboxLock(INBOX)
        lock.release()
      }

      this.lastSyncAt = new Date().toISOString()
      this.setStatus({ phase: 'done', folder: null, lastSyncAt: this.lastSyncAt })
    } catch (error) {
      this.reportError(error)
      throw error
    }
  }

  private async resolveFolders(client: ImapFlow): Promise<string[]> {
    return this.folderOverride ?? selectSyncFolders(await client.list())
  }

  /** One folder's pass. A folder that cannot be read is reported and skipped. */
  private async syncFolder(client: ImapFlow, folder: string): Promise<void> {
    let lock: MailboxLockObject | null = null
    try {
      lock = await client.getMailboxLock(folder)
      const mailbox = client.mailbox
      if (!mailbox) throw new Error(`Could not open ${folder}`)

      // imapflow reports UIDVALIDITY as a bigint; the DB column is an INTEGER.
      const uidValidity = Number(mailbox.uidValidity)
      const cursor = this.cursors.get(folder)
      let lastUid = 0

      if (cursor && cursor.uidValidity === uidValidity) {
        lastUid = cursor.lastUid
      } else if (cursor) {
        // Every UID we stored for this folder now refers to a different message.
        this.emit('resync', {
          accountId: this.account.id,
          folder,
          previousUidValidity: cursor.uidValidity,
          uidValidity
        })
      }

      const uids = await this.selectUids(client, lastUid)
      this.setStatus({ phase: 'fetching', folder, total: uids.length, processed: 0 })
      if (uids.length > 0) {
        lastUid = await this.fetchAndDeliver(client, folder, uids, uidValidity, lastUid)
      }

      this.cursors.set(folder, { uidValidity, lastUid })
      this.emit('uidState', { accountId: this.account.id, folder, uidValidity, lastUid })
    } catch (error) {
      if (isAuthFailure(error) || !client.usable) throw error
      this.emit('error', {
        accountId: this.account.id,
        isAuthError: false,
        message: `Skipped ${folder}: ${errorMessage(error)}`,
        cause: error
      })
    } finally {
      lock?.release()
    }
  }

  /**
   * Which UIDs to fetch from the folder that is open.
   *  - first run for this folder: everything with an INTERNALDATE inside the backfill window
   *  - afterwards: everything above the highest UID we have seen
   *
   * The `N:*` range is filtered client-side because IMAP guarantees a non-empty response for
   * it — a server with no new mail answers with the LAST message, which would otherwise be
   * re-delivered on every poll.
   */
  private async selectUids(client: ImapFlow, lastUid: number): Promise<number[]> {
    if (lastUid > 0) {
      const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
      const uids = Array.isArray(found) ? found : []
      return uids.filter((uid) => uid > lastUid).sort((a, b) => a - b)
    }

    const cutoff = new Date(Date.now() - this.backfillDays * 24 * 60 * 60 * 1000)
    const found = await client.search({ since: cutoff }, { uid: true })
    const uids = Array.isArray(found) ? found : []
    return uids.sort((a, b) => a - b)
  }

  /** Returns the highest UID seen, which becomes the folder's cursor. */
  private async fetchAndDeliver(
    client: ImapFlow,
    folder: string,
    uids: number[],
    uidValidity: number,
    lastUid: number
  ): Promise<number> {
    let processed = 0
    let maxUid = lastUid

    for (const batch of chunk(uids, FETCH_BATCH_SIZE)) {
      if (this.cancelRequested || this.stopped) break

      const iterator = client.fetch(
        batch,
        { uid: true, flags: true, internalDate: true, source: true },
        { uid: true }
      )

      for await (const raw of iterator) {
        if (this.cancelRequested || this.stopped) break

        processed += 1
        try {
          const delivered = await this.deliver(raw, folder, uidValidity)
          if (delivered?.stored) this.passNew += 1
          if (delivered?.isCandidate) this.passCandidates += 1
        } catch (error) {
          // One malformed message must not abort a 90-day backfill.
          this.emit('error', {
            accountId: this.account.id,
            isAuthError: false,
            message: `Skipped UID ${raw.uid} in ${folder}: ${errorMessage(error)}`,
            cause: error
          })
        }

        if (raw.uid > maxUid) maxUid = raw.uid

        // Cheap progress ticks; the renderer just moves a bar.
        if (processed % 10 === 0 || processed === uids.length) {
          this.setStatus({
            phase: 'fetching',
            folder,
            processed,
            newMessages: this.passNew,
            newCandidates: this.passCandidates
          })
        }
      }
    }

    this.setStatus({
      phase: 'prefiltering',
      folder,
      processed,
      newMessages: this.passNew,
      newCandidates: this.passCandidates
    })
    return maxUid
  }

  private async deliver(
    raw: FetchMessageObject,
    folder: string,
    uidValidity: number
  ): Promise<MessageStoreResult | null> {
    if (!raw.source) return null

    const internalDate = toIso(raw.internalDate)
    const parsed = await parseMessageSource(raw.source, internalDate)

    const message: SyncedMessage = {
      accountId: this.account.id,
      folder,
      uid: raw.uid,
      uidValidity,
      flags: raw.flags ? [...raw.flags] : [],
      internalDate,
      source: raw.source,
      parsed
    }

    // Observers first (never awaited), then the one consumer that persists.
    this.emit('message', message)
    if (!this.onMessage) return null
    return await this.onMessage(message)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * connection test
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Verify IMAP credentials without starting a sync. `verifyOnly` makes imapflow authenticate
 * and log straight back out. Never throws — the Settings form renders the result.
 *
 * (SMTP's half of `testConnection` lives with the accounts module; this covers protocol 'imap'.)
 */
export async function testImapConnection(input: ConnectionTestInput): Promise<ConnectionTestResult> {
  const startedAt = Date.now()
  const client = new ImapFlow({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.user, pass: input.password },
    clientInfo: { name: 'Recruit', vendor: 'Recruit' },
    logger: false,
    verifyOnly: true,
    disableAutoIdle: true
  })

  try {
    await client.connect()
    const capabilities = [...client.capabilities.keys()]
    return {
      ok: true,
      protocol: 'imap',
      greeting: client.serverInfo?.name ?? null,
      capabilities,
      error: null,
      durationMs: Date.now() - startedAt
    }
  } catch (error) {
    return {
      ok: false,
      protocol: 'imap',
      greeting: null,
      capabilities: [],
      error: errorMessage(error),
      durationMs: Date.now() - startedAt
    }
  } finally {
    try {
      client.close()
    } catch {
      /* already down */
    }
  }
}

export { DEFAULT_BACKFILL_DAYS, DEFAULT_POLL_INTERVAL_MS, sleep }
