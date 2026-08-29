/**
 * The mail list pane: Inbox / Candidates filter, search, and the rows.
 *
 * Paging instead of virtualization. Rows have two possible heights (candidate rows carry the
 * extra "why flagged" line) so a fixed-height windowing pass would be wrong; appending a page
 * at a time on scroll keeps the DOM bounded without needing to know row heights.
 * Presentational — MailView owns the data hook.
 */

import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import type { MessageSummary } from '@shared/types'
import {
  CountBadge,
  EmptyState,
  Icon,
  List,
  LoadingState,
  Pane,
  PaneHeader,
  Segmented,
  Spinner,
  TextInput
} from '@renderer/components'
import { MessageRow } from './MessageRow'
import {
  MessageMenu,
  messageMenuTargetFromEvent,
  type MessageMenuActions,
  type MessageMenuTarget
} from './MessageMenu'
import type { MailMode } from './useMessages'

/** Fetch the next page once the viewport is within this many px of the bottom. */
const LOAD_MORE_SLACK_PX = 320

export interface MessageListProps {
  mode: MailMode
  onModeChange: (mode: MailMode) => void

  search: string
  onSearchChange: (search: string) => void

  rows: MessageSummary[]
  total: number
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
  onLoadMore: () => void

  selectedId: number | null
  onSelect: (messageId: number) => void
  onRun: (messageId: number) => void
  runDisabled: boolean
  runningMessageId: number | null

  /** Everything the row's contextual menu can do. MailView owns all of it. */
  menuActions: Omit<MessageMenuActions, 'onOpen' | 'onRun' | 'runDisabled'>
}

export function MessageList({
  mode,
  onModeChange,
  search,
  onSearchChange,
  rows,
  total,
  loading,
  loadingMore,
  error,
  hasMore,
  onLoadMore,
  selectedId,
  onSelect,
  onRun,
  runDisabled,
  runningMessageId,
  menuActions
}: MessageListProps): JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrolledFor = useRef<number | null>(null)
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null)

  // Stable, because MessageRow is memoized and a fresh closure here would re-render
  // every row in a list that pages into the hundreds.
  const openMenu = useCallback(
    (row: MessageSummary, e: { clientX: number; clientY: number }) =>
      setMenu(messageMenuTargetFromEvent(row, e)),
    []
  )

  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    if (!hasMore || loadingMore || loading) return
    const el = event.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_SLACK_PX) onLoadMore()
  }

  /**
   * Keep the selected row on screen. Rows come from a deep link as often as from a click
   * now, and a linked message can sit hundreds of rows down. `nearest` makes the click case
   * a no-op — the row is already visible — and `scrolledFor` keeps a later page append from
   * yanking the viewport back to a selection the user has since scrolled away from.
   *
   * Positional lookup rather than a ref per row: MessageRow is memoized and the rows render
   * in `rows` order, so the nth [role=option] is the nth row.
   */
  useEffect(() => {
    if (selectedId == null || scrolledFor.current === selectedId) return
    const index = rows.findIndex((row) => row.id === selectedId)
    if (index < 0) return
    scrolledFor.current = selectedId
    bodyRef.current?.querySelectorAll('[role="option"]')[index]?.scrollIntoView({
      block: 'nearest'
    })
  }, [selectedId, rows])

  const searching = search.trim().length > 0

  return (
    <Pane kind="list">
      <PaneHeader>
        <Segmented
          value={mode}
          onValueChange={onModeChange}
          aria-label="Mail filter"
          options={[
            { value: 'inbox', label: 'Inbox' },
            { value: 'candidates', label: 'Candidates' }
          ]}
        />
        <span className="mail-head-spacer" />
        <CountBadge count={total} title={`${total} message${total === 1 ? '' : 's'}`} />
      </PaneHeader>

      <div className="mail-search">
        <Icon name="search" size={12} className="mail-search-icon" />
        <TextInput
          type="search"
          value={search}
          onValueChange={onSearchChange}
          className="mail-search-input"
          placeholder={mode === 'candidates' ? 'Search candidates' : 'Search mail'}
          aria-label="Search messages"
        />
      </div>

      {/* Not <PaneBody>: infinite paging needs the scroll event, which that primitive does
          not forward. Same class, same styling. */}
      <div
        className="pane-body mail-list-body"
        ref={bodyRef}
        onScroll={onScroll}
        role="listbox"
      >
        {error ? (
          <EmptyState
            icon="alert"
            compact
            title="Could not load mail"
            message={<span className="danger selectable">{error}</span>}
          />
        ) : loading ? (
          <LoadingState label="Loading mail…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={mode === 'candidates' ? 'target' : 'inbox'}
            compact
            title={searching ? 'No matches' : mode === 'candidates' ? 'No candidates' : 'No mail yet'}
            message={
              searching
                ? 'Nothing in this list matches that search.'
                : mode === 'candidates'
                  ? 'Nothing scored above the prefilter threshold. Sync more mail, or lower the threshold in Settings.'
                  : 'Add an account in Settings, then sync to fetch your inbox.'
            }
          />
        ) : (
          <List>
            {rows.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                selected={message.id === selectedId}
                menuOpen={menu?.message.id === message.id}
                onSelect={onSelect}
                onContextMenu={openMenu}
                onRun={onRun}
                runDisabled={runDisabled}
                running={runningMessageId === message.id}
                showWhy={mode === 'candidates' || message.triageState === 'candidate'}
              />
            ))}

            {loadingMore ? (
              <div className="mail-more">
                <Spinner size={12} />
                <span>Loading more…</span>
              </div>
            ) : hasMore ? (
              <button type="button" className="mail-more mail-more-btn" onClick={onLoadMore}>
                Load {Math.min(100, total - rows.length)} more
              </button>
            ) : null}
          </List>
        )}
      </div>

      {menu ? (
        <MessageMenu
          /* Remounted per row, so the highlighted item never carries over from the
             message you right-clicked before this one. */
          key={menu.message.id}
          target={menu}
          actions={{ ...menuActions, onOpen: onSelect, onRun, runDisabled }}
          onClose={() => setMenu(null)}
        />
      ) : null}
    </Pane>
  )
}
