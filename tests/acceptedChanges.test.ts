import { describe, expect, it } from 'vitest'
import { applyTailorChanges } from '@shared/resumePatch'
import type { TailorChange } from '@shared/types'

const MASTER = [
  '# Jane Doe',
  '',
  '## Summary',
  '',
  'Backend engineer.',
  '',
  '## Skills',
  '',
  'Python, Go, SQL',
  '',
  '## Experience',
  '',
  '### Senior Engineer — Northwind',
  '',
  '- Led the billing rewrite',
  ''
].join('\n')

const CHANGES: TailorChange[] = [
  {
    section: 'Summary',
    before: 'Backend engineer.',
    after: 'Backend engineer with distributed systems experience.',
    reason: 'The posting asks for distributed systems.'
  },
  {
    section: 'Skills',
    before: 'Python, Go, SQL',
    after: 'Python, Go, SQL, Kubernetes',
    reason: 'The posting names Kubernetes.'
  },
  {
    section: 'Experience',
    before: 'Led the billing rewrite',
    after: 'Led the billing rewrite, cutting invoice errors 40%',
    reason: 'The posting asks for measurable impact.'
  },
  {
    section: 'Summary',
    before: 'Jane Doe',
    after: 'Jane Doe, Staff Engineer',
    reason: 'The posting is for a staff role.'
  }
]

/** What the review screen hands the patch engine: every change the user did not reject. */
function accept(rejected: Set<number>): TailorChange[] {
  return CHANGES.filter((_, i) => !rejected.has(i))
}

describe('the document assembled from the accepted set', () => {
  it('carries every change when nothing is rejected', () => {
    const result = applyTailorChanges(MASTER, accept(new Set()))
    expect(result.applied).toHaveLength(4)
    for (const change of CHANGES) expect(result.markdown).toContain(change.after)
  })

  it('omits exactly the rejected change and keeps the rest', () => {
    const result = applyTailorChanges(MASTER, accept(new Set([1])))

    expect(result.applied).toHaveLength(3)
    expect(result.markdown).not.toContain('Kubernetes')
    expect(result.markdown).toContain('distributed systems experience')
    expect(result.markdown).toContain('cutting invoice errors 40%')
    expect(result.markdown).toContain('Jane Doe, Staff Engineer')
  })

  it('returns the master untouched when everything is rejected', () => {
    const result = applyTailorChanges(MASTER, accept(new Set([0, 1, 2, 3])))

    expect(result.applied).toHaveLength(0)
    expect(result.markdown.trimEnd()).toBe(MASTER.trimEnd())
    for (const change of CHANGES) expect(result.markdown).not.toContain(change.after)
  })

  it('rejects each change on its own without disturbing the others', () => {
    for (let i = 0; i < CHANGES.length; i += 1) {
      const result = applyTailorChanges(MASTER, accept(new Set([i])))
      expect(result.applied).toHaveLength(3)
      expect(result.markdown).not.toContain(CHANGES[i]!.after)
    }
  })

  it('does not depend on the order the user ticked the boxes', () => {
    const clickedLowFirst = new Set([0, 3])
    const clickedHighFirst = new Set([3, 0])

    const a = applyTailorChanges(MASTER, accept(clickedLowFirst))
    const b = applyTailorChanges(MASTER, accept(clickedHighFirst))

    expect(b.markdown).toBe(a.markdown)
    expect(b.applied).toHaveLength(2)
  })

  it('indexes changes positionally, so a reordered result means different rejections', () => {
    const reordered = [...CHANGES].reverse()
    const keptUnderSameIndices = reordered.filter((_, i) => !new Set([1]).has(i))

    // Index 1 named the Kubernetes change in the original order and names another here.
    expect(keptUnderSameIndices).toContain(CHANGES[1])
    expect(keptUnderSameIndices).not.toContain(reordered[1])
  })
})
