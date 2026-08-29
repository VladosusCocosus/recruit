/**
 * Tracker container: board / list toggle, filters, and the detail pane.
 *
 * Owns the one `useTracker()` fetch so board and list share state — switching views is
 * instant, and a status change made in one is already applied in the other.
 *
 * The strip below the window toolbar is a filter bar, not a second toolbar: controls
 * that decide *what you are looking at*, ordered leading-to-trailing the way macOS
 * orders them — the view switch, then the search field, then the scope checkbox, then
 * the count, and the one action that creates something pinned to the trailing edge.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  ErrorBanner,
  Icon,
  LoadingState,
  Pane,
  PaneBody,
  Segmented,
  SplitView,
  TextInput,
  pluralize,
  useDebounced
} from '@renderer/components'
import type { JSX } from 'react'
import type { ItemQuery } from '@shared/types'
import { Board } from './Board'
import { ItemDetail } from './ItemDetail'
import { ItemList } from './ItemList'
import { useNow, useTracker } from './useTracker'

export type TrackerMode = 'board' | 'list'

const MODES = [
  { value: 'board' as const, label: 'Board' },
  { value: 'list' as const, label: 'List' }
]

export function TrackerView({
  initialItemId = null,
  initialMode = 'board',
  focusItemId = null,
  focusNonce = 0,
  onOpenMessage
}: {
  initialItemId?: number | null
  initialMode?: TrackerMode
  /**
   * Open this item on arrival — a cross-view link landed here. The id need not be on the
   * board: ItemDetail reads by id, so an item hidden by the search box or the archived
   * filter still opens.
   */
  focusItemId?: number | null
  /** Bumped by the router per navigation, so following the same link twice still opens it. */
  focusNonce?: number
  onOpenMessage?: (messageId: number) => void
} = {}): JSX.Element {
  const [mode, setMode] = useState<TrackerMode>(initialMode)
  const [search, setSearch] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(initialItemId)

  // Every distinct query is a round trip to main and a LIKE scan over items. Typing
  // "engineer" unthrottled is eight of them, and the board flickers through eight
  // intermediate result sets on the way.
  const debouncedSearch = useDebounced(search, 200)

  // A deep link opens its item and then gets out of the way. Keyed on the nonce alone, or
  // every re-render would drag the detail pane back off whatever card the user clicked next.
  const focusRef = useRef(focusItemId)
  focusRef.current = focusItemId
  useEffect(() => {
    if (focusRef.current != null) setSelectedItemId(focusRef.current)
  }, [focusNonce])

  const query = useMemo<ItemQuery>(
    () => ({
      query: debouncedSearch.trim() || undefined,
      includeArchived: includeArchived || undefined
    }),
    [debouncedSearch, includeArchived]
  )

  const store = useTracker(query)
  const now = useNow(60_000)

  const handleCreate = useCallback(
    async (statusKey: string) => {
      const created = await store.createItem('New application', statusKey)
      if (created) setSelectedItemId(created.id)
    },
    [store]
  )

  const changeStatus = useCallback(
    (id: number, key: string, reason: Parameters<typeof store.moveItem>[2]) =>
      void store.moveItem(id, key, reason),
    [store]
  )

  // Archiving is how an application leaves the board reversibly, so it belongs on the
  // card's own menu rather than only in the inspector. Deleting stays in the inspector:
  // it cannot be undone, and a menu row has nowhere to say so.
  const archiveItem = useCallback(
    (id: number, archived: boolean) => void store.archiveItem(id, archived),
    [store]
  )

  const showBoard = mode === 'board'
  const empty = store.loading && store.items.length === 0
  const firstOpen = store.statusIndex.open[0]?.key ?? 'saved'

  return (
    <div className="tracker">
      <header className="tracker-bar">
        <Segmented aria-label="Tracker view" value={mode} options={MODES} onValueChange={setMode} />

        <div className="tracker-search">
          <Icon name="search" size={12} className="tracker-search-icon" />
          <TextInput
            className="tracker-search-input"
            type="search"
            value={search}
            onValueChange={setSearch}
            aria-label="Filter applications"
            placeholder="Company or role"
          />
        </div>

        <label className="tracker-archived">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.currentTarget.checked)}
          />
          Archived
        </label>

        <span className="tracker-bar-spacer" />

        <span className="tracker-count tabular">{pluralize(store.items.length, 'item')}</span>
        <Button size="sm" variant="outline" icon="plus" onClick={() => void handleCreate(firstOpen)}>
          Add
        </Button>
      </header>

      {store.error ? <ErrorBanner error={store.error} onDismiss={store.clearError} /> : null}

      <SplitView>
        <Pane kind="detail">
          {empty ? (
            <LoadingState />
          ) : showBoard ? (
            <Board
              items={store.items}
              statusIndex={store.statusIndex}
              now={now}
              selectedItemId={selectedItemId}
              onOpenItem={setSelectedItemId}
              onChangeStatus={changeStatus}
              onArchiveItem={archiveItem}
              onCreateItem={(statusKey) => void handleCreate(statusKey)}
            />
          ) : (
            <PaneBody>
              <ItemList
                items={store.items}
                statusIndex={store.statusIndex}
                now={now}
                selectedItemId={selectedItemId}
                onOpenItem={setSelectedItemId}
                onChangeStatus={changeStatus}
                onArchiveItem={archiveItem}
                onCreateItem={(statusKey) => void handleCreate(statusKey)}
              />
            </PaneBody>
          )}
        </Pane>

        {selectedItemId !== null ? (
          <Pane kind="plain" width={420}>
            <div className="tracker-detail">
              <ItemDetail
                itemId={selectedItemId}
                statusIndex={store.statusIndex}
                now={now}
                onBack={() => setSelectedItemId(null)}
                onOpenMessage={onOpenMessage}
              />
            </div>
          </Pane>
        ) : null}
      </SplitView>
    </div>
  )
}
