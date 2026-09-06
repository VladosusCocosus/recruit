/**
 * Reads a tailor run's reply into a TailorResult.
 *
 * The input is AgentEnvelope.result — the model's whole text reply, which is prose with
 * one fenced json block at the end. Pure, and total: nothing here throws, a field that is
 * missing or the wrong type becomes null or an empty array, and a malformed entry in
 * `changes` or `gaps` is dropped rather than costing the whole result. null means there
 * was no parsable object at all.
 */
import type { TailorChange, TailorGap, TailorResult, WorkMode } from './types'

const WORK_MODES: readonly WorkMode[] = ['onsite', 'hybrid', 'remote']

const FENCED_JSON = /```[ \t]*json[ \t]*\r?\n([\s\S]*?)```/gi

/** A JSON object, or null for anything else — an array, a scalar, a parse failure. */
function parseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    /* not an object */
  }
  return null
}

/**
 * The last fenced ```json block that parses as an object. Falls back to the last `{...}`
 * span for a model that answered without the fence.
 */
function extractObject(raw: string): Record<string, unknown> | null {
  const fenced = [...raw.matchAll(FENCED_JSON)]
  for (let i = fenced.length - 1; i >= 0; i--) {
    const found = parseObject(fenced[i][1].trim())
    if (found) return found
  }

  const end = raw.lastIndexOf('}')
  if (end < 0) return null
  let start = raw.lastIndexOf('{', end)
  while (start >= 0) {
    const found = parseObject(raw.slice(start, end + 1))
    if (found) return found
    if (start === 0) break
    start = raw.lastIndexOf('{', start - 1)
  }
  return null
}

/** A trimmed non-empty string, or null. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** One of the WorkMode values, matched case-insensitively. Anything else is null. */
function workMode(value: unknown): WorkMode | null {
  if (typeof value !== 'string') return null
  const candidate = value.trim().toLowerCase()
  return WORK_MODES.find((mode) => mode === candidate) ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * One replacement. `before` and `after` are kept verbatim — `before` has to match the
 * master byte for byte to be locatable. A change with neither side is dropped.
 */
function toChange(value: unknown): TailorChange | null {
  if (!isRecord(value)) return null
  const before = typeof value['before'] === 'string' ? value['before'] : ''
  const after = typeof value['after'] === 'string' ? value['after'] : ''
  if (before.trim() === '' && after.trim() === '') return null
  return {
    section: text(value['section']) ?? '',
    before,
    after,
    reason: text(value['reason']) ?? ''
  }
}

/** One gap. A gap that names no requirement says nothing, so it is dropped. */
function toGap(value: unknown): TailorGap | null {
  if (!isRecord(value)) return null
  const requirement = text(value['requirement'])
  if (!requirement) return null
  return { requirement, note: text(value['note']) ?? '' }
}

function rows<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return []
  const out: T[] = []
  for (const entry of value) {
    const parsed = parse(entry)
    if (parsed) out.push(parsed)
  }
  return out
}

/** The tailor run's result, or null when the reply held no parsable object. */
export function parseTailorResult(raw: string): TailorResult | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const object = extractObject(raw)
  if (!object) return null

  return {
    company: text(object['company']),
    role: text(object['role']),
    location: text(object['location']),
    workMode: workMode(object['work_mode']),
    jdMd: typeof object['jd_md'] === 'string' ? object['jd_md'] : '',
    changes: rows(object['changes'], toChange),
    gaps: rows(object['gaps'], toGap),
    coverLetterMd: text(object['cover_letter_md'])
  }
}
