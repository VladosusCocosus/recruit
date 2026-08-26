/**
 * Connection tests for the Settings account form.
 *
 * IMAP: a real imapflow connect + authenticate + logout.
 * SMTP: nodemailer's verify() ONLY — v1 stores and tests SMTP credentials but
 *       never sends mail. Nothing in here calls sendMail().
 *
 * Both return the shared ConnectionTestResult so `handle('testConnection', ...)`
 * can pass this straight through.
 */
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import type {
  Account,
  ConnectionProtocol,
  ConnectionTestInput,
  ConnectionTestResult
} from '@shared/types'

const CONNECTION_TIMEOUT_MS = 15_000
const GREETING_TIMEOUT_MS = 12_000
const SOCKET_TIMEOUT_MS = 20_000

/** The minimum a test needs. An Account or a ConnectionTestInput both satisfy it. */
export interface ConnectionTarget {
  host: string
  port: number
  secure: boolean
  user: string
}

export function imapTargetFromAccount(account: Account): ConnectionTarget {
  return {
    host: account.imapHost,
    port: account.imapPort,
    secure: account.imapSecure,
    user: account.imapUser || account.email
  }
}

/** null when the account has no SMTP half configured. */
export function smtpTargetFromAccount(account: Account): ConnectionTarget | null {
  if (!account.smtpHost || !account.smtpPort) return null
  return {
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSecure ?? account.smtpPort === 465,
    user: account.smtpUser || account.email
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * error text
 * ──────────────────────────────────────────────────────────────────────────── */

const CERT_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID'
])

function describeError(err: unknown, target: ConnectionTarget): string {
  const e = err as { code?: string; message?: string; authenticationFailed?: boolean }
  const code = e?.code ?? ''
  const message = e?.message ?? String(err)
  const where = `${target.host}:${target.port}`
  // nodemailer overwrites .code with ESOCKET/ECONNECTION but leaves the real
  // errno in the text ("connect ECONNREFUSED 127.0.0.1:9"), so match on both.
  const hay = `${code} ${message}`

  if (
    e?.authenticationFailed ||
    code === 'EAUTH' ||
    /AUTHENTICATIONFAILED|invalid cred|bad cred|auth\w* fail|LOGIN failed/i.test(message)
  ) {
    return 'Authentication failed — check the username and password. Gmail/iCloud need an app-specific password, not your account password.'
  }
  if (/\bENOTFOUND\b|\bEAI_AGAIN\b/.test(hay)) return `Host not found: ${target.host}`
  if (/\bECONNREFUSED\b/.test(hay)) {
    return `Connection refused by ${where} — nothing is listening on that port.`
  }
  if (/\bETIMEDOUT\b|\bETIMEOUT\b/.test(hay) || /timed? ?out/i.test(message)) {
    return `Timed out connecting to ${where} — wrong port, or a firewall is in the way.`
  }
  if (/\bECONNRESET\b/.test(hay)) return `The server reset the connection at ${where}.`
  if (CERT_CODES.has(code) || /\bERR_TLS|certificate/i.test(hay)) {
    return `TLS certificate rejected for ${target.host}${code ? ` (${code})` : ''}`
  }
  if (
    /\bESOCKET\b|\bECONNECTION\b|\bEPROTOCOL\b/.test(hay) ||
    /closed unexpectedly|wrong version number|packet length too long|Invalid greeting/i.test(message)
  ) {
    return `The connection failed during the handshake at ${where} — the TLS setting probably does not match the port (465/993 = TLS on, 587/143 = TLS off + STARTTLS).`
  }
  return message || 'Connection failed.'
}

function fail(
  protocol: ConnectionProtocol,
  err: unknown,
  target: ConnectionTarget,
  startedAt: number
): ConnectionTestResult {
  return {
    ok: false,
    protocol,
    greeting: null,
    capabilities: [],
    error: describeError(err, target),
    durationMs: Date.now() - startedAt
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * IMAP
 * ──────────────────────────────────────────────────────────────────────────── */

export async function testImapConnection(
  target: ConnectionTarget,
  password: string
): Promise<ConnectionTestResult> {
  const startedAt = Date.now()
  const client = new ImapFlow({
    host: target.host,
    port: target.port,
    secure: target.secure,
    auth: { user: target.user, pass: password },
    clientInfo: { name: 'Recruit', vendor: 'Recruit' },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS
  })

  try {
    await client.connect()
    const capabilities = [...client.capabilities.keys()].sort()
    const info = client.serverInfo
    const greeting = info
      ? [info.name, info.version, info.vendor].filter(Boolean).join(' ') || null
      : null

    try {
      await client.logout()
    } catch {
      client.close() // logout is a courtesy; the test already passed
    }

    return {
      ok: true,
      protocol: 'imap',
      greeting,
      capabilities,
      error: null,
      durationMs: Date.now() - startedAt
    }
  } catch (err) {
    try {
      client.close()
    } catch {
      /* already gone */
    }
    return fail('imap', err, target, startedAt)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * SMTP  (verify() only — never sendMail)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * A bunyan-shaped logger that keeps only the raw server lines, so we can report
 * the 220 greeting and the EHLO capability block. Nodemailer emits those at
 * debug level with `{ tnx: 'server' }` whenever `debug: true` is set.
 */
function serverLineCollector(sink: string[]) {
  const noop = (): void => {}
  return {
    level: noop,
    trace: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    debug: (entry: unknown, message?: unknown): void => {
      const tnx = (entry as { tnx?: string } | undefined)?.tnx
      if (tnx === 'server' && typeof message === 'string') sink.push(message)
    }
  }
}

function parseSmtpLines(lines: string[]): { greeting: string | null; capabilities: string[] } {
  const flat = lines.flatMap((l) => l.split(/\r?\n/)).map((l) => l.trim()).filter(Boolean)
  const greeting = flat.find((l) => l.startsWith('220'))?.slice(3).trim() || null

  const caps: string[] = []
  const ehlo = flat.filter((l) => /^250[ -]/.test(l))
  // The first 250 line is the server's own hostname banner, not a capability.
  for (const line of ehlo.slice(1)) {
    const token = line.slice(4).trim().split(/\s+/)[0]
    if (token) caps.push(token.toUpperCase())
  }
  return { greeting, capabilities: [...new Set(caps)].sort() }
}

export async function testSmtpConnection(
  target: ConnectionTarget,
  password: string
): Promise<ConnectionTestResult> {
  const startedAt = Date.now()
  const lines: string[] = []

  const transporter = nodemailer.createTransport({
    host: target.host,
    port: target.port,
    secure: target.secure,
    auth: { user: target.user, pass: password },
    name: 'recruit.local',
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    debug: true,
    logger: serverLineCollector(lines)
  })

  try {
    await transporter.verify()
    const { greeting, capabilities } = parseSmtpLines(lines)
    return {
      ok: true,
      protocol: 'smtp',
      greeting,
      capabilities,
      error: null,
      durationMs: Date.now() - startedAt
    }
  } catch (err) {
    return fail('smtp', err, target, startedAt)
  } finally {
    transporter.close()
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * dispatcher — matches RecruitApi.testConnection exactly
 * ──────────────────────────────────────────────────────────────────────────── */

export async function testConnection(input: ConnectionTestInput): Promise<ConnectionTestResult> {
  const target: ConnectionTarget = {
    host: input.host,
    port: input.port,
    secure: input.secure,
    user: input.user
  }
  return input.protocol === 'imap'
    ? testImapConnection(target, input.password)
    : testSmtpConnection(target, input.password)
}
