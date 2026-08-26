/**
 * Tracker container: board / list toggle, search, and the detail pane.
 *
 * Owns the one `useTracker()` fetch so board and list share state — switching views is
 * instant, and a status change made in one is already applied in the other.
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  ErrorBanner,
  LoadingState,
  Pane,
  PaneBody,
  Segmented,
  SplitView,
  TextInput,
  pluralize
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
  onOpenMessage
}: {
  initialItemId?: number | null
  initialMode?: TrackerMode
  onOpenMessage?: (messageId: number) => void
} = {}): JSX.Element {
  const [mode, setMode] = useState<TrackerMode>(initialMode)
  const [search, setSearch] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState<number | null>(initialItemId)

  const query = useMemo<ItemQuery>(
    () => ({
      query: search.trim() || undefined,
      includeArchived: includeArchived || undefined
    }),
    [search, includeArchived]
  )

  const store = useTracker(query)
  const now = useNow(60_000)

  const handleCreate = useCallback(async () => {
    const created = await store.createItem('New application')
    if (created) setSelectedItemId(created.id)
  }, [store])

  const changeStatus = useCallback(
    (id: number, key: string, reason: Parameters<typeof store.moveItem>[2]) =>
      void store.moveItem(id, key, reason),
    [store]
  )

  const showBoard = mode === 'board'
  const empty = store.loading && store.items.length === 0

  return (
    <div className="tracker">
      <header className="tracker-bar">
        <Segmented aria-label="Tracker view" value={mode} options={MODES} onValueChange={setMode} />
        <TextInput
          className="tracker-search"
          type="search"
          value={search}
          onValueChange={setSearch}
          placeholder="Filter by company or role"
        />
        <label className="tracker-archived tertiary">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.currentTarget.checked)}
          />
          Archived
        </label>
        <span className="tracker-bar-spacer" />
        <span className="tertiary tabular tracker-count">
          {pluralize(store.items.length, 'item')}
        </span>
        <Button size="sm" variant="outline" icon="plus" onClick={() => void handleCreate()}>
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
              onCreateItem={() => void handleCreate()}
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
                onCreateItem={() => void handleCreate()}
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
