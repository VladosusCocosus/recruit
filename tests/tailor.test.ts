import { describe, expect, it } from 'vitest'
import { parseTailorResult } from '@shared/tailor'

const CHANGE = {
  section: 'Skills',
  before: 'Python, Go, Terraform',
  after: 'Terraform, Go, Python',
  reason: 'JD names Terraform four times; promoted to the front of the skills line.'
}

const RESULT = {
  company: 'Acme',
  role: 'Staff Platform Engineer',
  location: 'Berlin',
  work_mode: 'hybrid',
  jd_md: '# Staff Platform Engineer\n\nWe run Terraform.',
  changes: [CHANGE],
  gaps: [{ requirement: 'Kafka in production', note: 'Resume shows RabbitMQ only.' }]
}

const fenced = (body: unknown): string => '```json\n' + JSON.stringify(body, null, 2) + '\n```'

describe('parseTailorResult', () => {
  it('reads a clean fenced block into the camelCase shape', () => {
    const result = parseTailorResult(fenced(RESULT))
    expect(result).toEqual({
      company: 'Acme',
      role: 'Staff Platform Engineer',
      location: 'Berlin',
      workMode: 'hybrid',
      jdMd: '# Staff Platform Engineer\n\nWe run Terraform.',
      changes: [CHANGE],
      gaps: [{ requirement: 'Kafka in production', note: 'Resume shows RabbitMQ only.' }],
      coverLetterMd: null
    })
  })

  it('finds the block with prose on both sides of it', () => {
    const raw = `The URL was behind a login wall, so I worked from the snippet.\n\n${fenced(RESULT)}\n\nHappy to redo it with the full text.`
    expect(parseTailorResult(raw)?.company).toBe('Acme')
  })

  it('takes the last fenced block when there are two', () => {
    const raw = `${fenced({ ...RESULT, company: 'Draft Corp' })}\n\nOn reflection:\n\n${fenced(RESULT)}`
    expect(parseTailorResult(raw)?.company).toBe('Acme')
  })

  it('falls back to a bare object when the model skipped the fence', () => {
    expect(parseTailorResult(`Here it is:\n${JSON.stringify(RESULT)}`)?.role).toBe(
      'Staff Platform Engineer'
    )
  })

  it('returns null when there is no block at all', () => {
    expect(parseTailorResult('I could not fetch the posting and have nothing to return.')).toBeNull()
    expect(parseTailorResult('')).toBeNull()
  })

  it('returns null on malformed JSON', () => {
    expect(parseTailorResult('```json\n{ "company": "Acme", "role": }\n```')).toBeNull()
  })

  it('returns null for a fenced array', () => {
    expect(parseTailorResult('```json\n[1, 2, 3]\n```')).toBeNull()
  })

  it('nulls missing fields and empties missing lists', () => {
    const result = parseTailorResult(fenced({ jd_md: 'Just the posting.' }))
    expect(result).toEqual({
      company: null,
      role: null,
      location: null,
      workMode: null,
      jdMd: 'Just the posting.',
      changes: [],
      gaps: [],
      coverLetterMd: null
    })
  })

  it('nulls wrong-typed scalars rather than passing them through', () => {
    const result = parseTailorResult(
      fenced({ ...RESULT, company: 42, role: null, location: '   ', jd_md: { md: 'nope' } })
    )
    expect(result?.company).toBeNull()
    expect(result?.role).toBeNull()
    expect(result?.location).toBeNull()
    expect(result?.jdMd).toBe('')
  })

  it('rejects a work_mode outside the union and accepts one in any case', () => {
    expect(parseTailorResult(fenced({ ...RESULT, work_mode: 'flexible' }))?.workMode).toBeNull()
    expect(parseTailorResult(fenced({ ...RESULT, work_mode: '' }))?.workMode).toBeNull()
    expect(parseTailorResult(fenced({ ...RESULT, work_mode: 7 }))?.workMode).toBeNull()
    expect(parseTailorResult(fenced({ ...RESULT, work_mode: 'Remote' }))?.workMode).toBe('remote')
  })

  it('drops malformed changes and keeps the rest', () => {
    const result = parseTailorResult(
      fenced({
        ...RESULT,
        changes: ['a string', null, { section: 'Summary' }, 7, CHANGE]
      })
    )
    expect(result?.changes).toEqual([CHANGE])
  })

  it('drops a change whose before and after are both empty', () => {
    const result = parseTailorResult(
      fenced({
        ...RESULT,
        changes: [
          { section: 'Skills', before: '', after: '', reason: 'no-op' },
          { section: 'Skills', before: '  ', after: '', reason: 'whitespace no-op' },
          CHANGE
        ]
      })
    )
    expect(result?.changes).toEqual([CHANGE])
  })

  it('keeps an insertion and a deletion, and keeps before verbatim', () => {
    const result = parseTailorResult(
      fenced({
        ...RESULT,
        changes: [
          { section: 'Skills', before: '', after: 'Kubernetes', reason: 'Helm charts.' },
          { section: 'Summary', before: '  Full-stack generalist. ', after: '', reason: 'Off-target.' }
        ]
      })
    )
    expect(result?.changes[0].before).toBe('')
    expect(result?.changes[1].before).toBe('  Full-stack generalist. ')
    expect(result?.changes[1].after).toBe('')
  })

  it('fills a change’s missing section and reason with empty strings', () => {
    const result = parseTailorResult(
      fenced({ ...RESULT, changes: [{ before: 'Go', after: 'Go, Rust' }] })
    )
    expect(result?.changes).toEqual([{ section: '', before: 'Go', after: 'Go, Rust', reason: '' }])
  })

  it('drops malformed gaps and a gap with no requirement', () => {
    const result = parseTailorResult(
      fenced({
        ...RESULT,
        gaps: [
          { note: 'orphan note' },
          'a string',
          { requirement: '   ', note: 'blank' },
          { requirement: 'Kafka in production' }
        ]
      })
    )
    expect(result?.gaps).toEqual([{ requirement: 'Kafka in production', note: '' }])
  })

  it('empties changes and gaps that are not arrays', () => {
    const result = parseTailorResult(fenced({ ...RESULT, changes: 'lots', gaps: { one: 1 } }))
    expect(result?.changes).toEqual([])
    expect(result?.gaps).toEqual([])
  })

  it('always reports coverLetterMd as null', () => {
    expect(parseTailorResult(fenced({ ...RESULT, cover_letter_md: 'Dear hiring manager' }))?.coverLetterMd).toBeNull()
  })
})
