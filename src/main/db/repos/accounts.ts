import type { Account } from '@shared/types'
import { execute, queryAll, queryOne, transact } from '../connection'
import { nowIso, rowToAccount, toInt, type AccountRow } from '../rows'

/**
 * Everything the Settings form submits EXCEPT the passwords — those go straight to the
 * Keychain and only their refs land here. SQLite never stores a password.
 */
export interface AccountWriteInput {
  email: string
  displayName?: string | null
  imapHost: string
  imapPort: number
  imapSecure: boolean
  imapUser: string
  smtpHost?: string | null
  smtpPort?: number | null
  smtpSecure?: boolean | null
  smtpUser?: string | null
  keychainRefImap?: string | null
  keychainRefSmtp?: string | null
}

const SELECT = 'SELECT * FROM accounts'

export function listAccounts(): Account[] {
  return queryAll<AccountRow>(`${SELECT} ORDER BY id`).map(rowToAccount)
}

export function getAccount(accountId: number): Account | null {
  const row = queryOne<AccountRow>(`${SELECT} WHERE id = ?`, accountId)
  return row ? rowToAccount(row) : null
}

export function getAccountByEmail(email: string): Account | null {
  const row = queryOne<AccountRow>(`${SELECT} WHERE email = ?`, email)
  return row ? rowToAccount(row) : null
}

export function countAccounts(): number {
  return queryAll<{ id: number }>('SELECT id FROM accounts').length
}

export function createAccount(input: AccountWriteInput): Account {
  const info = execute(
    `INSERT INTO accounts (
       email, display_name, imap_host, imap_port, imap_secure, imap_user,
       smtp_host, smtp_port, smtp_secure, smtp_user,
       keychain_ref_imap, keychain_ref_smtp, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    input.email,
    input.displayName ?? null,
    input.imapHost,
    input.imapPort,
    toInt(input.imapSecure) ?? 1,
    input.imapUser,
    input.smtpHost ?? null,
    input.smtpPort ?? null,
    toInt(input.smtpSecure),
    input.smtpUser ?? null,
    input.keychainRefImap ?? null,
    input.keychainRefSmtp ?? null,
    nowIso()
  )
  return getAccount(Number(info.lastInsertRowid)) as Account
}

/** Undefined fields are left alone; explicit nulls clear the column. */
export function updateAccount(accountId: number, patch: Partial<AccountWriteInput>): Account {
  const sets: string[] = []
  const params: unknown[] = []
  const put = (column: string, value: unknown): void => {
    sets.push(`${column} = ?`)
    params.push(value)
  }

  if (patch.email !== undefined) put('email', patch.email)
  if (patch.displayName !== undefined) put('display_name', patch.displayName)
  if (patch.imapHost !== undefined) put('imap_host', patch.imapHost)
  if (patch.imapPort !== undefined) put('imap_port', patch.imapPort)
  if (patch.imapSecure !== undefined) put('imap_secure', toInt(patch.imapSecure))
  if (patch.imapUser !== undefined) put('imap_user', patch.imapUser)
  if (patch.smtpHost !== undefined) put('smtp_host', patch.smtpHost)
  if (patch.smtpPort !== undefined) put('smtp_port', patch.smtpPort)
  if (patch.smtpSecure !== undefined) put('smtp_secure', toInt(patch.smtpSecure))
  if (patch.smtpUser !== undefined) put('smtp_user', patch.smtpUser)
  if (patch.keychainRefImap !== undefined) put('keychain_ref_imap', patch.keychainRefImap)
  if (patch.keychainRefSmtp !== undefined) put('keychain_ref_smtp', patch.keychainRefSmtp)

  if (sets.length) {
    params.push(accountId)
    execute(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, ...params)
  }
  const account = getAccount(accountId)
  if (!account) throw new Error(`Account ${accountId} not found`)
  return account
}

/** Create-or-update, matching the `saveAccount` IPC shape (id present => update). */
export function saveAccount(input: AccountWriteInput & { id?: number }): Account {
  return transact(() =>
    input.id ? updateAccount(input.id, input) : createAccount(input)
  )
}

export function deleteAccount(accountId: number): void {
  execute('DELETE FROM accounts WHERE id = ?', accountId)
}

/** Remembers where the last IMAP sync stopped. */
export function setAccountCursor(
  accountId: number,
  uidValidity: number | null,
  lastUid: number | null
): void {
  execute(
    'UPDATE accounts SET last_uid_validity = ?, last_uid = ? WHERE id = ?',
    uidValidity,
    lastUid,
    accountId
  )
}
