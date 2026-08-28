/**
 * Mail — the two-pane view (list + reader) behind the rail's Inbox and Candidates entries.
 *
 * Owns the data hooks and every window.recruit call the Mail views make; MessageList and
 * MessageReader below it are presentational apart from the reader's own body fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TriageState } from '@shared/types'
import { Banner, Button, ClaudeNotSignedInBanner, SplitView } from '@renderer/components'
import { MessageList } from './MessageList'
import { MessageReader } from './MessageReader'
import { useActiveRun, useBlockRemoteImages, useDebounced } from './hooks'
import { useMessages, type MailMode } from './useMessages'
import './mail.css'

/** How long a message has to stay open before it counts as read. */
const READ_DWELL_MS = 600

/** How long the undo offer stays on screen after a delete. */
const UNDO_WINDOW_MS = 8_000

export interface MailViewProps {
  /** Controlled by the left rail (NavKey 'inbox' | 'candidates'). Omit for uncontrolled. */
  mode?: MailMode
  onModeChange?: (mode: MailMode) => void
  /** Scope to one account. Omit for all accounts. */
  accountId?: number
  /** Navigate to a tracker item from a linked-message badge. */
  onOpenItem?: (itemId: number) => void
  /**
   * Open this message on arrival — a cross-view link landed here. The id need not be in
   * `rows`: the reader loads by id, so a message on a later page or filtered out by the
   * current mode still opens.
   */
  focusMessageId?: number | null
  /** Bumped by the router per navigation, so following the same link twice still opens it. */
  focusNonce?: number
  /** Refresh the rail badges after a triage change or a finished run. */
  onCountsChanged?: () => void
}

export function MailView({
  mode: controlledMode,
  onModeChange,
  accountId,
  onOpenItem,
  onCountsChanged,
  focusMessageId = null,
  focusNonce = 0
}: MailViewProps): JSX.Element {
  const [uncontrolledMode, setUncontrolledMode] = useState<MailMode>('inbox')
  const mode = controlledMode ?? uncontrolledMode

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [readOverride, setReadOverride] = useState<{ id: number; read: boolean } | null>(null)
  const [deletedIds, setDeletedIds] = useState<number[] | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [runningMessageId, setRunningMessageId] = useState<number | null>(null)
  const startedRunId = useRef<number | null>(null)

  const blockRemoteImages = useBlockRemoteImages()
  const { run, isRunning } = useActiveRun()
  const {
    rows,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
    applyTriage,
    applyRead,
    applyDeleted
  } = useMessages({ mode, search: debouncedSearch, accountId })

  const setMode = useCallback(
    (next: MailMode) => {
      if (onModeChange) onModeChange(next)
      else setUncontrolledMode(next)
    },
    [onModeChange]
  )

  /* ── selection ──────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (selectedId == null && rows.length > 0) setSelectedId(rows[0].id)
  }, [rows, selectedId])

  // A deep link selects its message and then gets out of the way. Keyed on the nonce alone:
  // re-running because `rows` arrived, or because the hash still names that id, would drag
  // the selection back off whatever the user clicked next.
  const focusRef = useRef(focusMessageId)
  focusRef.current = focusMessageId
  useEffect(() => {
    if (focusRef.current != null) setSelectedId(focusRef.current)
  }, [focusNonce])

  /* ── the inline per-message run ─────────────────────────────────────────── */

  const runOnMessage = useCallback(
    (messageId: number) => {
      if (isRunning) return
      setActionError(null)
      setRunningMessageId(messageId)
      window.recruit
        .startRun({ kind: 'triage', messageIds: [messageId] })
        .then((summary) => {
          startedRunId.current = summary.id
        })
        .catch((e: unknown) => {
          setRunningMessageId(null)
          setActionError(e instanceof Error ? e.message : String(e))
        })
    },
    [isRunning]
  )

  // The run ended (or was never really ours) — release the row spinner.
  useEffect(() => {
    if (!isRunning) setRunningMessageId(null)
  }, [isRunning])

  // A finished triage run rescores and relinks messages; pull the list back in sync.
  const prevRunState = useRef<string | null>(null)
  useEffect(() => {
    const state = run?.state ?? null
    if (prevRunState.current === 'running' && state !== 'running') {
      refresh()
      onCountsChanged?.()
    }
    prevRunState.current = state
  }, [run?.state, refresh, onCountsChanged])

  /* ── local triage (never touches IMAP flags — v1 mail is read-only) ─────── */

  const onTriage = useCallback(
    (messageId: number, state: TriageState) => {
      setActionError(null)
      window.recruit
        .setTriageState([messageId], state)
        .then(() => {
          applyTriage([messageId], state)
          onCountsChanged?.()
        })
        .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
    },
    [applyTriage, onCountsChanged]
  )

  /* ── local read state (also local-only: no \Seen ever goes back to IMAP) ── */

  // The list row is the authority on read state, not the body the reader fetched — that copy
  // is a snapshot from before the dwell timer below ran. `readOverride` covers the gap while
  // a round-trip is in flight, and covers a deep-linked message that is not in `rows` at all.
  const selectedRow = rows.find((row) => row.id === selectedId) ?? null
  const selectedUnread =
    readOverride?.id === selectedId ? !readOverride.read : (selectedRow?.isUnread ?? true)

  const setRead = useCallback(
    (messageId: number, read: boolean) => {
      setActionError(null)
      setReadOverride({ id: messageId, read })
      window.recruit
        .markMessagesRead([messageId], read)
        .then(() => {
          applyRead([messageId], read)
          onCountsChanged?.()
        })
        .catch((e: unknown) => {
          setReadOverride(null)
          setActionError(e instanceof Error ? e.message : String(e))
        })
    },
    [applyRead, onCountsChanged]
  )

  /**
   * Opening a message marks it read — after a dwell, which is the whole point. rows[0] is
   * auto-selected on load and the list is scrubbable a row at a time, and neither of those is
   * someone reading their mail. Any decision already made about THIS message (the timer that
   * fired, or a manual toggle) leaves an override behind, which stops the timer from arming
   * again and undoing a "Mark as unread" a beat later.
   */
  useEffect(() => {
    if (selectedId == null || !selectedUnread || readOverride?.id === selectedId) return
    const timer = setTimeout(() => setRead(selectedId, true), READ_DWELL_MS)
    return () => clearTimeout(timer)
  }, [selectedId, selectedUnread, readOverride, setRead])

  /* ── local delete (soft, and undoable — see deleteMessages in main) ─────── */

  /**
   * Where the selection lands once `messageId` is gone. The row after it, because that is the
   * direction the list reads; the row before it when there is none, because the alternative is
   * null and the auto-select effect above would answer that by jumping to the top of the list.
   * Only an emptied list actually clears the selection.
   */
  const nextSelectionAfter = useCallback(
    (messageId: number): number | null => {
      const index = rows.findIndex((row) => row.id === messageId)
      if (index === -1) return selectedId === messageId ? null : selectedId
      return rows[index + 1]?.id ?? rows[index - 1]?.id ?? null
    },
    [rows, selectedId]
  )

  const onDelete = useCallback(
    (messageId: number) => {
      setActionError(null)
      const nextId = nextSelectionAfter(messageId)
      window.recruit
        .deleteMessages([messageId], true)
        .then(() => {
          applyDeleted([messageId], true)
          if (selectedId === messageId) setSelectedId(nextId)
          setDeletedIds([messageId])
          onCountsChanged?.()
        })
        .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
    },
    [applyDeleted, nextSelectionAfter, onCountsChanged, selectedId]
  )

  const undoDelete = useCallback(() => {
    const ids = deletedIds
    if (!ids?.length) return
    setDeletedIds(null)
    setActionError(null)
    window.recruit
      .deleteMessages(ids, false)
      .then(() => {
        applyDeleted(ids, false)
        setSelectedId(ids[0])
        onCountsChanged?.()
      })
      .catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)))
  }, [applyDeleted, deletedIds, onCountsChanged])

  // The offer expires; the delete does not. Letting it lapse is the same as dismissing it.
  useEffect(() => {
    if (!deletedIds) return
    const timer = setTimeout(() => setDeletedIds(null), UNDO_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [deletedIds])

  /* ── run failure, surfaced where the user pressed the button ────────────── */

  const ourRunFailed =
    run != null && run.runId === startedRunId.current && run.state === 'error' ? run : null
  const notSignedIn = ourRunFailed?.errorKind === 'not_signed_in'

  const clearRunError = useCallback(() => {
    startedRunId.current = null
    setActionError(null)
  }, [])

  return (
    <div className="mail-view">
      {/* The sign-in state is first-class and has its own component in the shared kit —
          never let it collapse into a generic failure banner. */}
      {notSignedIn ? (
        <ClaudeNotSignedInBanner onDismiss={clearRunError} />
      ) : ourRunFailed ? (
        <Banner tone="danger" title="The triage run failed" onDismiss={clearRunError}>
          {ourRunFailed.errorText ?? 'No detail was reported.'}
        </Banner>
      ) : null}

      {actionError ? (
        <Banner tone="danger" title="Something went wrong" onDismiss={() => setActionError(null)}>
          {actionError}
        </Banner>
      ) : null}

      {/* Undo instead of a confirmation dialog: the delete is local and reversible, so the
          cheap gesture belongs on the way out rather than in front of every delete. */}
      {deletedIds ? (
        <Banner
          tone="neutral"
          icon="trash"
          title="Message deleted"
          actions={
            <Button size="sm" onClick={undoDelete}>
              Undo
            </Button>
          }
          onDismiss={() => setDeletedIds(null)}
        >
          It is hidden here only — the copy on the server is untouched.
        </Banner>
      ) : null}

      <SplitView>
        <MessageList
          mode={mode}
          onModeChange={setMode}
          search={search}
          onSearchChange={setSearch}
          rows={rows}
          total={total}
          loading={loading}
          loadingMore={loadingMore}
          error={error}
          hasMore={hasMore}
          onLoadMore={loadMore}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRun={runOnMessage}
          runDisabled={isRunning}
          runningMessageId={runningMessageId}
        />

        <MessageReader
          messageId={selectedId}
          blockRemoteImages={blockRemoteImages}
          onRun={runOnMessage}
          runDisabled={isRunning}
          running={runningMessageId === selectedId}
          onTriage={onTriage}
          unread={selectedUnread}
          onMarkRead={setRead}
          onDelete={onDelete}
          onOpenItem={onOpenItem}
        />
      </SplitView>
    </div>
  )
}

export default MailView
