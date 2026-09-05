import { describe, expect, it } from 'vitest'
import { applyTailorChanges } from '@shared/resumePatch'
import type { TailorChange } from '@shared/types'

const MASTER = [
  '# Ada Lovelace',
  '',
  'Staff Engineer — distributed systems.',
  '',
  '## Experience',
  '',
  '### Northwind — Senior Engineer',
  '',
  '- Built the billing pipeline in Go.',
  '- Led the payments team through a',
  '  replatform.',
  '',
  '### Contoso — Engineer',
  '',
  '- Shipped an internal design system.',
  '',
  '## Skills',
  '',
  'Go, TypeScript, PostgreSQL',
  '',
  '## Education',
  '',
  'BSc Computer Science',
  ''
].join('\n')

function change(patch: Partial<TailorChange> = {}): TailorChange {
  return {
    section: 'Experience',
    before: '',
    after: '',
    reason: 'The posting asks for it.',
    ...patch
  }
}

describe('applyTailorChanges — matching', () => {
  it('replaces text that occurs exactly once', () => {
    const c = change({
      before: '- Built the billing pipeline in Go.',
      after: '- Built the billing pipeline in Go, cutting invoice latency 40%.'
    })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.applied).toEqual([c])
    expect(result.unapplied).toEqual([])
    expect(result.markdown).toContain('- Built the billing pipeline in Go, cutting invoice latency 40%.')
    expect(result.markdown).not.toContain('- Built the billing pipeline in Go.\n')
  })

  it('matches quoted text the model reflowed onto one line', () => {
    const c = change({
      before: '- Led the payments team through a replatform.',
      after: '- Led the payments team through a replatform onto Kubernetes.'
    })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.applied).toEqual([c])
    expect(result.markdown).toContain('- Led the payments team through a replatform onto Kubernetes.')
    expect(result.markdown).not.toContain('replatform.\n')
  })

  it('matches quoted text whose spacing differs from the master', () => {
    const master = '## Skills\n\nGo,  TypeScript,\t\tPostgreSQL\n'
    const c = change({
      section: 'Skills',
      before: 'Go, TypeScript, PostgreSQL',
      after: 'Go, TypeScript, PostgreSQL, Kafka'
    })
    const result = applyTailorChanges(master, [c])

    expect(result.applied).toEqual([c])
    expect(result.markdown).toBe('## Skills\n\nGo, TypeScript, PostgreSQL, Kafka\n')
  })

  it('reports absent text as not_found and leaves the document alone', () => {
    const c = change({ before: '- Ran the Mars lander programme.', after: '- Ran it twice.' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.applied).toEqual([])
    expect(result.unapplied).toEqual([{ change: c, reason: 'not_found' }])
    expect(result.markdown).toBe(MASTER)
  })

  it('reports text that occurs twice as ambiguous rather than guessing', () => {
    const master = [
      '## Experience',
      '',
      '- Owned the on-call rotation.',
      '',
      '## Volunteering',
      '',
      '- Owned the on-call rotation.',
      ''
    ].join('\n')
    const c = change({ before: '- Owned the on-call rotation.', after: '- Owned on-call for 12 services.' })
    const result = applyTailorChanges(master, [c])

    expect(result.applied).toEqual([])
    expect(result.unapplied).toEqual([{ change: c, reason: 'ambiguous' }])
    expect(result.markdown).toBe(master)
  })

  it('reports text that repeats only once whitespace is normalised as ambiguous', () => {
    const master = 'a\n\nGo,  TypeScript\n\nb\n\nGo,\tTypeScript\n'
    const c = change({ before: 'Go, TypeScript', after: 'Go' })
    const result = applyTailorChanges(master, [c])

    expect(result.unapplied).toEqual([{ change: c, reason: 'ambiguous' }])
    expect(result.markdown).toBe(master)
  })
})

describe('applyTailorChanges — insertions', () => {
  it('appends an insertion to the end of the named section', () => {
    const c = change({ section: 'Skills', before: '', after: 'Rust, Terraform' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.applied).toEqual([c])
    expect(result.markdown).toContain('Go, TypeScript, PostgreSQL\n\nRust, Terraform\n\n## Education')
  })

  it('matches a section heading ignoring case, hashes and trailing punctuation', () => {
    const c = change({ section: '## skills:', before: '', after: 'Rust' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.markdown).toContain('Go, TypeScript, PostgreSQL\n\nRust\n\n## Education')
  })

  it('appends past a subsection, up to the next heading of the same level', () => {
    const c = change({ section: 'Experience', before: '', after: '- Mentored four engineers.' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.markdown).toContain(
      '- Shipped an internal design system.\n\n- Mentored four engineers.\n\n## Skills'
    )
  })

  it('appends at the end of the document when no heading matches the section', () => {
    const c = change({ section: 'Publications', before: '', after: '- On Analytical Engines (1843)' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.applied).toEqual([c])
    expect(result.markdown.endsWith('BSc Computer Science\n\n- On Analytical Engines (1843)\n')).toBe(true)
  })

  it('appends at the end of the document when the section is empty', () => {
    const c = change({ section: '', before: '', after: '- Speaks Ada' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.markdown.endsWith('- Speaks Ada\n')).toBe(true)
  })

  it('counts an insertion of nothing as applied and changes nothing', () => {
    const c = change({ section: 'Skills', before: '', after: '   ' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.applied).toEqual([c])
    expect(result.markdown).toBe(MASTER)
  })
})

describe('applyTailorChanges — deletions', () => {
  it('deletes the matched line and collapses the gap it leaves', () => {
    const c = change({ before: '- Shipped an internal design system.', after: '' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.applied).toEqual([c])
    expect(result.markdown).not.toContain('design system')
    expect(result.markdown).toContain('### Contoso — Engineer\n\n## Skills')
    expect(result.markdown).not.toContain('\n\n\n')
  })

  it('collapses the doubled space a mid-line deletion leaves', () => {
    const c = change({ section: 'Skills', before: 'TypeScript,', after: '' })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.markdown).toContain('Go, PostgreSQL')
  })

  it('deletes a multi-line block without leaving a double gap', () => {
    const c = change({
      before: '- Led the payments team through a\n  replatform.',
      after: ''
    })
    const result = applyTailorChanges(MASTER, [c])

    expect(result.markdown).not.toContain('replatform')
    expect(result.markdown).toContain('- Built the billing pipeline in Go.\n\n### Contoso')
    expect(result.markdown).not.toContain('\n\n\n')
  })
})

describe('applyTailorChanges — sequencing', () => {
  it('applies each change against the result of the previous one', () => {
    const first = change({ before: 'Go, TypeScript, PostgreSQL', after: 'Go, TypeScript, Kafka' })
    const second = change({ before: 'Go, TypeScript, Kafka', after: 'Go, Kafka, Terraform' })
    const result = applyTailorChanges(MASTER, [first, second])

    expect(result.applied).toEqual([first, second])
    expect(result.unapplied).toEqual([])
    expect(result.markdown).toContain('Go, Kafka, Terraform')
  })

  it('reports a change whose text an earlier change consumed as not_found', () => {
    const first = change({ before: '- Built the billing pipeline in Go.', after: '- Built billing in Rust.' })
    const second = change({ before: '- Built the billing pipeline in Go.', after: '- Built billing twice.' })
    const result = applyTailorChanges(MASTER, [first, second])

    expect(result.applied).toEqual([first])
    expect(result.unapplied).toEqual([{ change: second, reason: 'not_found' }])
    expect(result.markdown).toContain('- Built billing in Rust.')
    expect(result.markdown).not.toContain('- Built billing twice.')
  })

  it('turns a would-be ambiguous match into a single one once an earlier change resolves it', () => {
    const master = 'a\n\n- Owned on-call.\n\nb\n\n- Owned on-call.\n'
    const first = change({ before: 'a\n\n- Owned on-call.', after: 'a\n\n- Owned on-call for 12 services.' })
    const second = change({ before: '- Owned on-call.', after: '- Owned on-call for the data team.' })
    const result = applyTailorChanges(master, [first, second])

    expect(result.applied).toEqual([first, second])
    expect(result.markdown).toContain('- Owned on-call for 12 services.')
    expect(result.markdown).toContain('- Owned on-call for the data team.')
  })
})

describe('applyTailorChanges — output shape', () => {
  it('returns the master unchanged for an empty change list', () => {
    const result = applyTailorChanges(MASTER, [])

    expect(result.markdown).toBe(MASTER)
    expect(result.applied).toEqual([])
    expect(result.unapplied).toEqual([])
  })

  it('collapses runs of blank lines and ends with exactly one newline', () => {
    const result = applyTailorChanges('# Ada\n\n\n\n\nStaff Engineer\n\n\n', [])

    expect(result.markdown).toBe('# Ada\n\nStaff Engineer\n')
  })

  it('normalises CRLF line endings', () => {
    const c = change({ before: 'Staff Engineer', after: 'Principal Engineer' })
    const result = applyTailorChanges('# Ada\r\n\r\nStaff Engineer\r\n', [c])

    expect(result.markdown).toBe('# Ada\n\nPrincipal Engineer\n')
  })

  it('returns an empty document for empty input', () => {
    expect(applyTailorChanges('', []).markdown).toBe('')
  })

  it('accounts for every change exactly once', () => {
    const changes = [
      change({ before: '- Built the billing pipeline in Go.', after: '- Built billing in Rust.' }),
      change({ before: '- Built the billing pipeline in Go.', after: '- Built it again.' }),
      change({ before: 'Engineer', after: 'Staff Engineer' }),
      change({ section: 'Skills', before: '', after: 'Rust' }),
      change({ before: '- Shipped an internal design system.', after: '' }),
      change({ before: 'nothing like this exists', after: 'x' })
    ]
    const result = applyTailorChanges(MASTER, changes)

    expect(result.applied.length + result.unapplied.length).toBe(changes.length)
    const seen = [...result.applied, ...result.unapplied.map((u) => u.change)]
    expect(new Set(seen).size).toBe(changes.length)
    for (const c of changes) expect(seen).toContain(c)
  })

  it('accounts for every change on an empty master too', () => {
    const changes = [
      change({ before: 'anything', after: 'x' }),
      change({ section: 'Skills', before: '', after: 'Rust' })
    ]
    const result = applyTailorChanges('', changes)

    expect(result.applied.length + result.unapplied.length).toBe(changes.length)
    expect(result.markdown).toBe('Rust\n')
  })
})
