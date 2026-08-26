/**
 * Mail — the two-pane view (list + reader) behind the rail's Inbox and Candidates entries.
 *
 * Owns the data hooks and every window.recruit call the Mail views make; MessageList and
 * MessageReader below it are presentational apart from the reader's own body fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TriageState } from '@shared/types'
import { Banner, ClaudeNotSignedInBanner, SplitView } from '@renderer/components'
import { MessageList } from './MessageList'
import { MessageReader } from './MessageReader'
import { useActiveRun, useBlockRemoteImages, useDebounced } from './hooks'
import { useMessages, type MailMode } from './useMessages'
import './mail.css'

export interface MailViewProps {
  /** Controlled by the left rail (NavKey 'inbox' | 'candidates'). Omit for uncontrolled. */
  mode?: MailMode
  onModeChange?: (mode: MailMode) => void
  /** Scope to one account. Omit for all accounts. */
  accountId?: number
  /** Navigate to a tracker item from a linked-message badge. */
  onOpenItem?: (itemId: number) => void
  /** Refresh the rail badges after a triage change or a finished run. */
  onCountsChanged?: () => void
}

export function MailView({
  mode: controlledMode,
  onModeChange,
  accountId,
  onOpenItem,
  onCountsChanged
}: MailViewProps): JSX.Element {
  const [uncontrolledMode, setUncontrolledMode] = useState<MailMode>('inbox')
  const mode = controlledMode ?? uncontrolledMode

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounced(search, 200)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [runningMessageId, setRunningMessageId] = useState<number | null>(null)
  const startedRunId = useRef<number | null>(null)

  const blockRemoteImages = useBlockRemoteImages()
  const { run, isRunning } = useActiveRun()
  const { rows, total, loading, loadingMore, error, hasMore, loadMore, refresh, applyTriage } =
    useMessages({ mode, search: debouncedSearch, accountId })

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
          onOpenItem={onOpenItem}
        />
      </SplitView>
    </div>
  )
}

export default MailView
