/**
 * The questions an application form asked, and what was written back.
 *
 * A row belongs to one item and dies with it (ON DELETE CASCADE). `answer_md` is nullable:
 * a question can be recorded before there is an answer for it.
 */
import type { ItemAnswer, ItemAnswerInput } from '@shared/types'
import { execute, queryAll, queryOne, transact } from '../connection'
import { nowIso } from '../rows'

interface ItemAnswerRow {
  id: number
  item_id: number
  question: string
  answer_md: string | null
  created_at: string
  updated_at: string
}

function rowToItemAnswer(row: ItemAnswerRow): ItemAnswer {
  return {
    id: row.id,
    itemId: row.item_id,
    question: row.question,
    answerMd: row.answer_md,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const SELECT = 'SELECT * FROM item_answers'

/** Every question on an item, oldest first. */
export function listItemAnswers(itemId: number): ItemAnswer[] {
  return queryAll<ItemAnswerRow>(`${SELECT} WHERE item_id = ? ORDER BY id`, itemId).map(
    rowToItemAnswer
  )
}

export function getItemAnswer(answerId: number): ItemAnswer | null {
  const row = queryOne<ItemAnswerRow>(`${SELECT} WHERE id = ?`, answerId)
  return row ? rowToItemAnswer(row) : null
}

/** Adds one when `id` is absent, replaces that row when it is present. */
export function saveItemAnswer(input: ItemAnswerInput): ItemAnswer {
  return transact(() => {
    const question = input.question.trim()
    if (!question) throw new Error('A question needs text.')

    const now = nowIso()
    let answerId = input.id
    if (answerId === undefined) {
      answerId = execute(
        `INSERT INTO item_answers (item_id, question, answer_md, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        input.itemId,
        question,
        input.answerMd,
        now,
        now
      ).lastInsertRowid as number
    } else {
      execute(
        `UPDATE item_answers SET item_id = ?, question = ?, answer_md = ?, updated_at = ?
         WHERE id = ?`,
        input.itemId,
        question,
        input.answerMd,
        now,
        answerId
      )
    }

    const saved = getItemAnswer(answerId)
    if (!saved) throw new Error(`Answer ${answerId} not found`)
    return saved
  })
}

export function deleteItemAnswer(answerId: number): void {
  execute('DELETE FROM item_answers WHERE id = ?', answerId)
}
