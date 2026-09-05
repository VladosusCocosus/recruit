import { describe, expect, it } from 'vitest'
import { STATUS_SEED, type Status } from '@shared/types'
import { isAppliedOrLater, resumeAnswer, shouldAskForResume, type ResumeAskable } from '@shared/resume'

const STATUSES: Status[] = STATUS_SEED.map((s, i) => ({
  id: i + 1,
  key: s.key,
  label: s.label,
  kind: s.kind,
  sortOrder: s.sortOrder,
  color: s.color
}))

function item(patch: Partial<ResumeAskable> = {}): ResumeAskable {
  return {
    statusKey: 'applied',
    resumeId: null,
    resumeSkippedAt: null,
    archivedAt: null,
    ...patch
  }
}

describe('resumeAnswer', () => {
  it('reports answered when a resume is attached', () => {
    expect(resumeAnswer({ resumeId: 7, resumeSkippedAt: null })).toBe('answered')
  })

  it('reports skipped when only a skip timestamp is set', () => {
    expect(resumeAnswer({ resumeId: null, resumeSkippedAt: '2026-09-05T10:00:00.000Z' })).toBe('skipped')
  })

  it('reports unanswered when neither is set', () => {
    expect(resumeAnswer({ resumeId: null, resumeSkippedAt: null })).toBe('unanswered')
  })

  it('prefers the attached resume over a stale skip', () => {
    expect(resumeAnswer({ resumeId: 7, resumeSkippedAt: '2026-09-05T10:00:00.000Z' })).toBe('answered')
  })
})

describe('isAppliedOrLater', () => {
  it('excludes saved', () => {
    expect(isAppliedOrLater('saved', STATUSES)).toBe(false)
  })

  it('includes applied and every status after it', () => {
    for (const key of ['applied', 'screening', 'interviewing', 'offer', 'closed']) {
      expect(isAppliedOrLater(key, STATUSES)).toBe(true)
    }
  })

  it('returns false for an unknown status key', () => {
    expect(isAppliedOrLater('nonsense', STATUSES)).toBe(false)
  })

  it('returns false when applied is missing from the status set', () => {
    expect(isAppliedOrLater('screening', STATUSES.filter((s) => s.key !== 'applied'))).toBe(false)
  })
})

describe('shouldAskForResume', () => {
  it('asks on an unanswered applied item', () => {
    expect(shouldAskForResume(item(), STATUSES)).toBe(true)
  })

  it('asks on a closed item — it was applied to before it closed', () => {
    expect(shouldAskForResume(item({ statusKey: 'closed' }), STATUSES)).toBe(true)
  })

  it('stays quiet on a saved item', () => {
    expect(shouldAskForResume(item({ statusKey: 'saved' }), STATUSES)).toBe(false)
  })

  it('stays quiet once a resume is attached', () => {
    expect(shouldAskForResume(item({ resumeId: 3 }), STATUSES)).toBe(false)
  })

  it('stays quiet once the question was skipped', () => {
    expect(shouldAskForResume(item({ resumeSkippedAt: '2026-09-05T10:00:00.000Z' }), STATUSES)).toBe(false)
  })

  it('stays quiet on an archived item', () => {
    expect(shouldAskForResume(item({ archivedAt: '2026-09-05T10:00:00.000Z' }), STATUSES)).toBe(false)
  })
})
