/**
 * The rule behind the board's "Resume?" chip: which items still need someone to say
 * which resume was sent.
 *
 * Pure — statuses are a parameter, so nothing here reads the database or the clock.
 */

import { type ItemSummary, type Status } from './types'

/** Items at this status or later, by sortOrder, count as applied to. */
export const RESUME_ASK_FROM_STATUS = 'applied'

export type ResumeAnswer = 'unanswered' | 'answered' | 'skipped'

/** The fields the rule reads. */
export type ResumeAskable = Pick<
  ItemSummary,
  'statusKey' | 'resumeId' | 'resumeSkippedAt' | 'archivedAt'
>

/** Which of the three resume states an item is in. */
export function resumeAnswer(item: Pick<ResumeAskable, 'resumeId' | 'resumeSkippedAt'>): ResumeAnswer {
  if (item.resumeId != null) return 'answered'
  if (item.resumeSkippedAt) return 'skipped'
  return 'unanswered'
}

/**
 * True when `statusKey` sorts at or after `applied`. False when either key is absent from
 * `statuses`.
 */
export function isAppliedOrLater(statusKey: string, statuses: readonly Status[]): boolean {
  const threshold = statuses.find((s) => s.key === RESUME_ASK_FROM_STATUS)?.sortOrder
  const current = statuses.find((s) => s.key === statusKey)?.sortOrder
  if (threshold === undefined || current === undefined) return false
  return current >= threshold
}

/** True when the item has been applied to, is not archived, and has no resume answer. */
export function shouldAskForResume(item: ResumeAskable, statuses: readonly Status[]): boolean {
  if (item.archivedAt) return false
  if (resumeAnswer(item) !== 'unanswered') return false
  return isAppliedOrLater(item.statusKey, statuses)
}
