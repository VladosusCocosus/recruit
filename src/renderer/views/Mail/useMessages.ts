/**
 * Mail list data. Owns paging, search debouncing at the caller's discretion, and the
 * live refresh when main pushes `mailChanged`.
 *
 * Stale-response guard: every first-page fetch takes a ticket; a response whose ticket is no
 * longer current is dropped. Without it, switching Inbox -> Candidates fast enough leaves the
 * slower Inbox response painting over the Candidates list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MessageQuery, MessageSummary, TriageState } from '@shared/types'

export type MailMode = 'inbox' | 'candidates'

export const PAGE_SIZE = 100

export interface UseMessagesOptions {
  mode: MailMode
  search: string
  accountId?: number
}

export interface UseMessagesResult {
  rows: MessageSummary[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  loadMore: () => void
  refresh: () => void
  /** Optimistic local update after a setTriageState round-trip. */
  applyTriage: (messageIds: number[], state: TriageState) => void
  /** Optimistic local update after a markMessagesRead round-trip. */
  applyRead: (messageIds: number[], read: boolean) => void
  /** Optimistic local update after a deleteMessages round-trip. */
  applyDeleted: (messageIds: number[], deleted: boolean) => void
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useMessages({ mode, search, accountId }: UseMessagesOptions): UseMessagesResult {
  const [rows, setRows] = useState<MessageSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const ticketRef = useRef(0)
  const rowsRef = useRef<MessageSummary[]>([])
  const totalRef = useRef(0)
  const moreInFlight = useRef(false)

  rowsRef.current = rows
  totalRef.current = total

  const baseQuery = useMemo<MessageQuery>(() => {
    const query: MessageQuery = { limit: PAGE_SIZE, offset: 0 }
    if (accountId != null) query.accountId = accountId
    const trimmed = search.trim()
    if (trimmed.length > 0) query.search = trimmed
    // Inbox intentionally leaves triageState unset: v1 syncs INBOX only, and hiding
    // dismissed mail from the Inbox would make "why is this gone?" unanswerable.
    if (mode === 'candidates') query.triageState = 'candidate'
    return query
  }, [mode, search, accountId])

  useEffect(() => {
    const ticket = ticketRef.current + 1
    ticketRef.current = ticket
    setLoading(true)
    setError(null)

    window.recruit
      .listMessages(baseQuery)
      .then((page) => {
        if (ticketRef.current !== ticket) return
        setRows(page.rows)
        setTotal(page.total)
      })
      .catch((e: unknown) => {
        if (ticketRef.current !== ticket) return
        setError(errText(e))
        setRows([])
        setTotal(0)
      })
      .finally(() => {
        if (ticketRef.current !== ticket) return
        setLoading(false)
      })
  }, [baseQuery, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  // Main pushes mailChanged after every sync pass that produced new mail.
  useEffect(() => window.recruit.on('mailChanged', () => refresh()), [refresh])

  const loadMore = useCallback(() => {
    if (moreInFlight.current) return
    const offset = rowsRef.current.length
    if (offset === 0 || offset >= totalRef.current) return

    const ticket = ticketRef.current
    moreInFlight.current = true
    setLoadingMore(true)

    window.recruit
      .listMessages({ ...baseQuery, offset })
      .then((page) => {
        if (ticketRef.current !== ticket) return
        setRows((prev) => {
          const seen = new Set(prev.map((row) => row.id))
          return prev.concat(page.rows.filter((row) => !seen.has(row.id)))
        })
        setTotal(page.total)
      })
      .catch((e: unknown) => {
        if (ticketRef.current === ticket) setError(errText(e))
      })
      .finally(() => {
        moreInFlight.current = false
        if (ticketRef.current === ticket) setLoadingMore(false)
      })
  }, [baseQuery])

  const applyTriage = useCallback(
    (messageIds: number[], state: TriageState) => {
      const ids = new Set(messageIds)

      // In the Candidates list a row that stops being a candidate leaves the list.
      if (mode === 'candidates' && state !== 'candidate') {
        // `removed` is counted OUT HERE on purpose. Calling setTotal from inside the setRows
        // updater would double-count under StrictMode, which double-invokes updaters to catch
        // exactly this — dismissing one candidate would drop the header count by two.
        const removed = rowsRef.current.filter((row) => ids.has(row.id)).length
        if (removed === 0) return
        setRows((prev) => prev.filter((row) => !ids.has(row.id)))
        setTotal((t) => Math.max(0, t - removed))
        return
      }

      setRows((prev) =>
        prev.map((row) => (ids.has(row.id) ? { ...row, triageState: state } : row))
      )
    },
    [mode]
  )

  // Read state never moves a row between the two lists, so unlike applyTriage this is only
  // ever a patch — no row leaves, and the header count does not change.
  const applyRead = useCallback((messageIds: number[], read: boolean) => {
    const ids = new Set(messageIds)
    setRows((prev) => prev.map((row) => (ids.has(row.id) ? { ...row, isUnread: !read } : row)))
  }, [])

  /**
   * A deleted message leaves BOTH lists — main filters deleted_at out of every read — so this
   * is applyTriage's removal branch without the mode check, `removed` counted out here for the
   * same StrictMode reason.
   *
   * Undo goes the other way and cannot patch: the list is date-ordered and may be several pages
   * deep, so there is no index to put the row back at. Refetch instead — the round-trip that
   * cleared deleted_at has already landed, so the row is there to be found.
   */
  const applyDeleted = useCallback(
    (messageIds: number[], deleted: boolean) => {
      if (!deleted) {
        refresh()
        return
      }
      const ids = new Set(messageIds)
      const removed = rowsRef.current.filter((row) => ids.has(row.id)).length
      if (removed === 0) return
      setRows((prev) => prev.filter((row) => !ids.has(row.id)))
      setTotal((t) => Math.max(0, t - removed))
    },
    [refresh]
  )

  return {
    rows,
    total,
    loading,
    loadingMore,
    error,
    hasMore: rows.length < total,
    loadMore,
    refresh,
    applyTriage,
    applyRead,
    applyDeleted
  }
}
