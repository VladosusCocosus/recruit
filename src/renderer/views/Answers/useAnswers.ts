/**
 * The questions an application form asked, and the runs that draft answers to them.
 *
 * The context says where they live. `{ kind: 'item' }` writes every change through
 * `saveItemAnswer` / `deleteItemAnswer`; `{ kind: 'draft' }` holds them in this store
 * until `applyDraft` files them with the application.
 *
 * `run.start` resolves when the process is spawned, so a drafting run is watched to a
 * terminal state and read out of `getRun`. The whole envelope result is the answer: an
 * `answer` run returns prose, not JSON.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage, useRun } from '@renderer/components'
import type { ApplyQuestion, ItemAnswer, StartRunInput } from '@shared/types'

/** Where the questions live, and what a drafting run is given. */
export type AnswersContext =
  | { kind: 'item'; itemId: number }
  | { kind: 'draft'; jdMd: string; resumeId: number | null }

/** One question card. */
export interface AnswerCard {
  /** Stable identity: the stored row where there is one, a local id before that. */
  key: string
  question: string
  answerMd: string
  /** True while this card's drafting run is in flight. */
  drafting: boolean
  /** Why the last run on this card returned no answer. */
  error: string | null
}

export interface AnswersStore {
  cards: AnswerCard[]
  loading: boolean
  /** A load or a write that failed. */
  error: string | null
  clearError: () => void

  add: (question: string) => void
  setAnswer: (key: string, answerMd: string) => void
  remove: (key: string) => void
  /** Drops every question. The apply flow calls it when the modal closes. */
  reset: () => void

  draft: (key: string) => void
  /** Non-null when no card can be drafted, and says why. */
  draftDisabledReason: string | null
  /** Elapsed on the drafting run. 0 when nothing is drafting. */
  elapsedMs: number
  stopping: boolean
  stop: () => void

  /** What `ApplyDraftInput.questions` is filed with. */
  questions: ApplyQuestion[]
}

const BLOCKED_BY_OTHER_RUN = 'Another run is in progress.'
const ALREADY_DRAFTING = 'A draft is already running.'
const NO_ENVELOPE = 'The run finished but its result was never recorded.'
const EMPTY = 'The run finished without writing anything.'
const STOPPED = 'You stopped the run before it wrote anything.'
const FAILED = 'The run failed.'

interface CardState {
  key: string
  /** The stored row. Null while the question exists only in this screen. */
  id: number | null
  question: string
  answerMd: string
  error: string | null
}

let localKeys = 0

function toCard(row: ItemAnswer): CardState {
  return {
    key: `row:${row.id}`,
    id: row.id,
    question: row.question,
    answerMd: row.answerMd ?? '',
    error: null
  }
}

export function useAnswers(context: AnswersContext): AnswersStore {
  const [cards, setCards] = useState<CardState[]>([])
  const [loading, setLoading] = useState(context.kind === 'item')
  const [error, setError] = useState<string | null>(null)
  const [draftingKey, setDraftingKey] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)

  const run = useRun()

  const ctx = useRef(context)
  ctx.current = context
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const itemId = context.kind === 'item' ? context.itemId : null
  const itemIdRef = useRef(itemId)
  itemIdRef.current = itemId

  // Per-card write chain: each save awaits the previous one and reuses the row id it
  // created.
  const writes = useRef(new Map<string, Promise<number | null>>())

  useEffect(() => {
    writes.current.clear()
    setDraftingKey(null)
    setStopping(false)
    setError(null)
    if (itemId === null) {
      setCards([])
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    window.recruit
      .listItemAnswers(itemId)
      .then((rows) => {
        if (!live) return
        setCards(rows.map(toCard))
      })
      .catch((e: unknown) => {
        if (live) setError(errorMessage(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [itemId])

  /* ── writes ──────────────────────────────────────────────────────────────── */

  const patch = useCallback((key: string, fields: Partial<CardState>): void => {
    setCards((prev) => prev.map((c) => (c.key === key ? { ...c, ...fields } : c)))
  }, [])

  const store = useCallback(
    (key: string, question: string, answerMd: string): void => {
      const id = itemIdRef.current
      if (id === null) return
      const known = cardsRef.current.find((c) => c.key === key)?.id ?? null
      const next = (writes.current.get(key) ?? Promise.resolve(known))
        .then((existing) =>
          window.recruit.saveItemAnswer({
            id: existing ?? undefined,
            itemId: id,
            question,
            answerMd: answerMd.trim() === '' ? null : answerMd
          })
        )
        .then((row) => {
          patch(key, { id: row.id })
          return row.id
        })
        .catch((e: unknown) => {
          setError(errorMessage(e))
          return null
        })
      writes.current.set(key, next)
    },
    [patch]
  )

  const add = useCallback(
    (question: string): void => {
      const text = question.trim()
      if (text === '') return
      const key = `local:${++localKeys}`
      setCards((prev) => [...prev, { key, id: null, question: text, answerMd: '', error: null }])
      store(key, text, '')
    },
    [store]
  )

  const setAnswer = useCallback(
    (key: string, answerMd: string): void => {
      const card = cardsRef.current.find((c) => c.key === key)
      if (!card) return
      patch(key, { answerMd, error: null })
      store(key, card.question, answerMd)
    },
    [patch, store]
  )

  const remove = useCallback((key: string): void => {
    const known = cardsRef.current.find((c) => c.key === key)?.id ?? null
    setCards((prev) => prev.filter((c) => c.key !== key))
    setDraftingKey((current) => (current === key ? null : current))
    const pending = writes.current.get(key) ?? Promise.resolve(known)
    writes.current.delete(key)
    if (itemIdRef.current === null) return
    void pending
      .then((id) => (id === null ? undefined : window.recruit.deleteItemAnswer(id)))
      .catch((e: unknown) => setError(errorMessage(e)))
  }, [])

  const reset = useCallback((): void => {
    writes.current.clear()
    setCards([])
    setDraftingKey(null)
    setStopping(false)
    setError(null)
  }, [])

  /* ── the drafting run ────────────────────────────────────────────────────── */

  const fail = useCallback(
    (key: string, message: string): void => patch(key, { error: message }),
    [patch]
  )

  const readAnswer = useCallback(
    async (key: string, runId: number): Promise<void> => {
      if (runId < 0) {
        fail(key, NO_ENVELOPE)
        return
      }
      try {
        const record = await window.recruit.getRun(runId)
        const raw = record?.rawEnvelope?.result
        const text = typeof raw === 'string' ? raw.trim() : ''
        if (text === '') {
          fail(key, typeof raw === 'string' ? EMPTY : NO_ENVELOPE)
          return
        }
        const card = cardsRef.current.find((c) => c.key === key)
        if (!card) return
        patch(key, { answerMd: text, error: null })
        store(key, card.question, text)
      } catch (e) {
        fail(key, errorMessage(e))
      }
    },
    [fail, patch, store]
  )

  const runKind = run.last?.kind
  const runState = run.last?.state
  const runId = run.last?.runId
  const runErrorText = run.last?.errorText
  useEffect(() => {
    if (draftingKey === null || runKind !== 'answer') return
    if (runState === 'finished') {
      setDraftingKey(null)
      setStopping(false)
      void readAnswer(draftingKey, runId ?? -1)
    } else if (runState === 'error' || runState === 'stopped') {
      setDraftingKey(null)
      setStopping(false)
      fail(draftingKey, runErrorText ?? (runState === 'stopped' ? STOPPED : FAILED))
    }
  }, [draftingKey, runKind, runState, runId, runErrorText, readAnswer, fail])

  // A run that never started pushes no update at all; `useRun` reports it as an error.
  const startError = run.error
  useEffect(() => {
    if (draftingKey === null || !startError) return
    setDraftingKey(null)
    setStopping(false)
    fail(draftingKey, startError)
  }, [draftingKey, startError, fail])

  const busy = draftingKey !== null || run.starting
  // One run at a time is enforced in main.
  const blockedByOtherRun = !busy && run.active !== null

  const draftDisabledReason = busy
    ? ALREADY_DRAFTING
    : blockedByOtherRun
      ? BLOCKED_BY_OTHER_RUN
      : null

  const draft = useCallback(
    (key: string): void => {
      const card = cardsRef.current.find((c) => c.key === key)
      if (!card) return
      const current = ctx.current
      const input: Partial<StartRunInput> =
        current.kind === 'item'
          ? { kind: 'answer', question: card.question, itemId: current.itemId }
          : {
              kind: 'answer',
              question: card.question,
              jdMd: current.jdMd,
              resumeId: current.resumeId ?? undefined
            }
      patch(key, { error: null })
      setStopping(false)
      setDraftingKey(key)
      void run.start(input)
    },
    [patch, run]
  )

  const stop = useCallback((): void => {
    setStopping(true)
    void run.stop()
  }, [run])

  const view = useMemo<AnswerCard[]>(
    () =>
      cards.map((c) => ({
        key: c.key,
        question: c.question,
        answerMd: c.answerMd,
        drafting: c.key === draftingKey,
        error: c.error
      })),
    [cards, draftingKey]
  )

  const questions = useMemo<ApplyQuestion[]>(
    () =>
      cards.map((c) => ({
        question: c.question,
        answerMd: c.answerMd.trim() === '' ? null : c.answerMd
      })),
    [cards]
  )

  return {
    cards: view,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    add,
    setAnswer,
    remove,
    reset,
    draft,
    draftDisabledReason,
    elapsedMs: draftingKey === null ? 0 : run.elapsedMs,
    stopping,
    stop,
    questions
  }
}
