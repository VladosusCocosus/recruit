/**
 * Password storage for Recruit.
 *
 * Primary backend: macOS Keychain via keytar, service "Recruit", account
 * "<email>:imap" / "<email>:smtp" (that string is also the `keychain_ref_*`
 * value stored in the accounts table).
 *
 * Fallback: if keytar's native binding will not load, secrets are encrypted
 * with Electron `safeStorage` into <userData>/secrets.enc.json. Plaintext is
 * never written to disk; if safeStorage is also unavailable we fail loudly
 * instead of degrading.
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'

export const KEYCHAIN_SERVICE = 'Recruit'

export type SecretKind = 'imap' | 'smtp'
export type SecretBackend = 'keytar' | 'safeStorage' | 'none'

export interface KeychainStatus {
  available: boolean
  backend: SecretBackend
  /** Why keytar was rejected, if it was. Useful in Settings diagnostics. */
  error: string | null
}

/* ── ref helpers ─────────────────────────────────────────────────────────── */

/** The value that goes into accounts.keychain_ref_imap / keychain_ref_smtp. */
export function keychainRef(email: string, kind: SecretKind): string {
  return `${email.trim().toLowerCase()}:${kind}`
}

export function parseKeychainRef(ref: string): { email: string; kind: SecretKind } | null {
  const at = ref.lastIndexOf(':')
  if (at <= 0) return null
  const email = ref.slice(0, at)
  const kind = ref.slice(at + 1)
  if (kind !== 'imap' && kind !== 'smtp') return null
  return { email, kind }
}

/* ── keytar (lazy, guarded) ──────────────────────────────────────────────── */

interface Keytar {
  setPassword(service: string, account: string, password: string): Promise<void>
  getPassword(service: string, account: string): Promise<string | null>
  deletePassword(service: string, account: string): Promise<boolean>
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>
}

// createRequire keeps this out of the bundler's static graph, so a broken
// native binding surfaces here as a caught error instead of crashing at import.
const nodeRequire = createRequire(__filename)

let keytarModule: Keytar | null = null
let keytarError: string | null = null
let keytarProbed = false

function loadKeytar(): Keytar | null {
  if (keytarProbed) return keytarModule
  keytarProbed = true
  try {
    const mod = nodeRequire('keytar') as Keytar & { default?: Keytar }
    const resolved = typeof mod.getPassword === 'function' ? mod : mod.default
    if (!resolved || typeof resolved.getPassword !== 'function') {
      keytarError = 'keytar loaded but exposes no getPassword()'
      return null
    }
    keytarModule = resolved
  } catch (err) {
    keytarError = err instanceof Error ? err.message : String(err)
    keytarModule = null
  }
  return keytarModule
}

/* ── safeStorage fallback file ───────────────────────────────────────────── */

interface SecretFile {
  version: 1
  entries: Record<string, string> // ref -> base64 of safeStorage ciphertext
}

let fallbackPathOverride: string | null = null

/** Test/embedding hook: point the fallback store somewhere other than userData. */
export function setFallbackStorePath(path: string | null): void {
  fallbackPathOverride = path
}

function fallbackPath(): string {
  if (fallbackPathOverride) return fallbackPathOverride
  return join(app.getPath('userData'), 'secrets.enc.json')
}

function readFallback(): SecretFile {
  const path = fallbackPath()
  if (!existsSync(path)) return { version: 1, entries: {} }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SecretFile>
    return { version: 1, entries: parsed.entries ?? {} }
  } catch {
    return { version: 1, entries: {} }
  }
}

function writeFallback(file: SecretFile): void {
  const path = fallbackPath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(file, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(tmp, path)
}

function requireSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      `Cannot store the password: keytar is unavailable (${keytarError ?? 'not loaded'}) ` +
        'and Electron safeStorage reports no OS encryption backend.'
    )
  }
}

/* ── public API ──────────────────────────────────────────────────────────── */

export async function isAvailable(): Promise<KeychainStatus> {
  const keytar = loadKeytar()
  if (keytar) {
    // Loading is not proof it works — a sandboxed/entitlement-less build throws
    // on the first real call. Probe with a harmless read.
    try {
      await keytar.getPassword(KEYCHAIN_SERVICE, '__probe__')
      return { available: true, backend: 'keytar', error: null }
    } catch (err) {
      keytarError = err instanceof Error ? err.message : String(err)
      keytarModule = null
    }
  }
  if (safeStorage.isEncryptionAvailable()) {
    return { available: true, backend: 'safeStorage', error: keytarError }
  }
  return {
    available: false,
    backend: 'none',
    error: keytarError ?? 'No OS encryption backend available.'
  }
}

/** Stores the password and returns the ref to persist on the account row. */
export async function setPassword(
  email: string,
  kind: SecretKind,
  password: string
): Promise<string> {
  const ref = keychainRef(email, kind)
  const keytar = loadKeytar()
  if (keytar) {
    try {
      await keytar.setPassword(KEYCHAIN_SERVICE, ref, password)
      return ref
    } catch (err) {
      keytarError = err instanceof Error ? err.message : String(err)
      keytarModule = null
    }
  }
  requireSafeStorage()
  const file = readFallback()
  file.entries[ref] = safeStorage.encryptString(password).toString('base64')
  writeFallback(file)
  return ref
}

export async function getPassword(email: string, kind: SecretKind): Promise<string | null> {
  return getPasswordByRef(keychainRef(email, kind))
}

/** For callers that only have the account row's keychain_ref_* value. */
export async function getPasswordByRef(ref: string): Promise<string | null> {
  const keytar = loadKeytar()
  if (keytar) {
    try {
      const found = await keytar.getPassword(KEYCHAIN_SERVICE, ref)
      if (found !== null) return found
    } catch (err) {
      keytarError = err instanceof Error ? err.message : String(err)
      keytarModule = null
    }
  }
  const encoded = readFallback().entries[ref]
  if (!encoded) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'))
  } catch {
    return null
  }
}

/** True if something was actually removed (from either backend). */
export async function deletePassword(email: string, kind: SecretKind): Promise<boolean> {
  return deletePasswordByRef(keychainRef(email, kind))
}

export async function deletePasswordByRef(ref: string): Promise<boolean> {
  let removed = false
  const keytar = loadKeytar()
  if (keytar) {
    try {
      removed = await keytar.deletePassword(KEYCHAIN_SERVICE, ref)
    } catch (err) {
      keytarError = err instanceof Error ? err.message : String(err)
      keytarModule = null
    }
  }
  const file = readFallback()
  if (file.entries[ref]) {
    delete file.entries[ref]
    writeFallback(file)
    removed = true
  }
  return removed
}

/** Call from deleteAccount() so no orphaned secrets are left behind. */
export async function deleteAccountPasswords(email: string): Promise<void> {
  await deletePassword(email, 'imap')
  await deletePassword(email, 'smtp')
}
