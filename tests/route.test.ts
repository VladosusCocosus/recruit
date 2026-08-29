import { describe, expect, it } from 'vitest'
import { formatHash, parseHash } from '../src/renderer/components/hooks'

describe('parseHash', () => {
  it('reads a plain view', () => {
    expect(parseHash('#/board')).toEqual({ nav: 'board', target: null })
  })

  it('accepts the form with no leading slash, and an empty hash', () => {
    expect(parseHash('#board')).toEqual({ nav: 'board', target: null })
    expect(parseHash('')).toEqual({ nav: 'inbox', target: null })
  })

  it('reads a deep link', () => {
    expect(parseHash('#/inbox/message/123')).toEqual({
      nav: 'inbox',
      target: { kind: 'message', id: 123 }
    })
    expect(parseHash('#/board/item/45')).toEqual({
      nav: 'board',
      target: { kind: 'item', id: 45 }
    })
  })

  it('falls back to the given view for an unknown one', () => {
    expect(parseHash('#/nope', 'candidates')).toEqual({ nav: 'candidates', target: null })
    expect(parseHash('#/nope/message/1', 'candidates')).toEqual({
      nav: 'candidates',
      target: null
    })
  })

  it('keeps the view but drops a target it cannot make sense of', () => {
    // A hash is user-editable; a typo must land on the view, not on an error.
    for (const hash of [
      '#/inbox/thread/12',
      '#/inbox/message',
      '#/inbox/message/',
      '#/inbox/message/abc',
      '#/inbox/message/12abc',
      '#/inbox/message/0',
      '#/inbox/message/-3',
      '#/inbox/message/1.5'
    ]) {
      expect(parseHash(hash), hash).toEqual({ nav: 'inbox', target: null })
    }
  })
})

describe('formatHash', () => {
  it('keeps the short form when there is no target', () => {
    expect(formatHash('inbox')).toBe('#/inbox')
    expect(formatHash('inbox', null)).toBe('#/inbox')
  })

  it('round-trips a deep link', () => {
    for (const hash of ['#/inbox', '#/inbox/message/123', '#/board/item/45']) {
      const route = parseHash(hash)
      expect(formatHash(route.nav, route.target)).toBe(hash)
    }
  })
})
