import { describe, expect, it } from 'vitest'
import { isAuthFailure } from '@main/mail/sync'

/** How imapflow reports a rejected login: an error subclass carrying the flag. */
class AuthenticationFailure extends Error {
  authenticationFailed = true
}

describe('isAuthFailure', () => {
  it('accepts imapflow’s structured signals', () => {
    expect(isAuthFailure(new AuthenticationFailure('Invalid credentials'))).toBe(true)
    expect(isAuthFailure({ code: 'AUTHENTICATIONFAILED' })).toBe(true)
  })

  it('accepts a server response that names the failure', () => {
    expect(isAuthFailure({ responseText: 'NO [AUTHENTICATIONFAILED] Invalid credentials' })).toBe(
      true
    )
    expect(isAuthFailure({ responseText: 'Application-specific password required' })).toBe(true)
  })

  it('does not read a folder name as a rejected login', () => {
    for (const folder of ['Passwords', 'Logins', 'Auth notices', 'Credentials', 'password resets']) {
      expect(isAuthFailure(new Error(`Could not open ${folder}`))).toBe(false)
      expect(isAuthFailure(new Error(`Mailbox does not exist: ${folder}`))).toBe(false)
      // A server that echoes the mailbox back in its NO response must not latch either.
      expect(isAuthFailure({ responseText: `Mailbox doesn't exist: ${folder}` })).toBe(false)
    }
  })

  it('is false for the ordinary failures a folder walk produces', () => {
    expect(isAuthFailure(new Error('Mailbox does not exist: Archive/2019'))).toBe(false)
    expect(isAuthFailure(new Error('Command failed'))).toBe(false)
    expect(isAuthFailure(null)).toBe(false)
    expect(isAuthFailure(undefined)).toBe(false)
  })
})
