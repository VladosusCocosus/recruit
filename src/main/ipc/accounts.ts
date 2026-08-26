/**
 * Account writes that span two stores: SQLite holds everything except the passwords,
 * the Keychain holds only the passwords. The account row keeps a *ref* to the secret,
 * never the secret itself.
 */
import type { Account, AccountInput } from '@shared/types'
import * as db from '@main/db'
import * as keychain from '@main/keychain'

/**
 * Create or update. A password is written to the Keychain only when the form actually
 * supplied one — omitting it on an edit keeps whatever is already stored.
 */
export async function saveAccountWithSecrets(input: AccountInput): Promise<Account> {
  const previous = input.id != null ? db.getAccount(input.id) : null
  const email = input.email.trim()

  let keychainRefImap: string | undefined
  let keychainRefSmtp: string | undefined

  if (input.imapPassword) {
    keychainRefImap = await keychain.setPassword(email, 'imap', input.imapPassword)
  }
  if (input.smtpPassword) {
    // Stored + connection-tested. v1 never sends, so nothing ever reads this back.
    keychainRefSmtp = await keychain.setPassword(email, 'smtp', input.smtpPassword)
  }

  const account = db.saveAccount({
    id: input.id,
    email,
    displayName: input.displayName ?? null,
    imapHost: input.imapHost,
    imapPort: input.imapPort,
    imapSecure: input.imapSecure,
    imapUser: input.imapUser || email,
    smtpHost: input.smtpHost ?? null,
    smtpPort: input.smtpPort ?? null,
    smtpSecure: input.smtpSecure ?? null,
    smtpUser: input.smtpUser ?? null,
    // undefined => leave the stored ref alone (updateAccount skips undefined).
    keychainRefImap,
    keychainRefSmtp
  })

  // Renaming the account would otherwise orphan the old Keychain entries.
  if (previous && previous.email !== email) {
    try {
      await keychain.deleteAccountPasswords(previous.email)
    } catch {
      /* best effort — a stale Keychain entry must not fail the save */
    }
  }

  return account
}

export async function deleteAccountWithSecrets(accountId: number): Promise<void> {
  const account = db.getAccount(accountId)
  db.deleteAccount(accountId)
  if (!account) return
  try {
    await keychain.deleteAccountPasswords(account.email)
  } catch {
    /* the row is gone; a leftover Keychain entry is not worth failing the call */
  }
}
