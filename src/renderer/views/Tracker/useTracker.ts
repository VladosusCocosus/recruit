/**
 * Tracker data hooks. Everything goes through `window.recruit` — the renderer never
 * touches the db, and main stays the only writer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { errorMessage } from '@renderer/components/format'
import type {
  CloseReason,
  Item,
  ItemDetail,
  ItemPatch,
  ItemQuery,
  ItemSummary,
  Status,
  TimelineEventInput
} from '@shared/types'

/** Merge an `Item` returned by a write back into the `ItemSummary` the board renders. */
function mergeItem(summary: ItemSummary, item: Item): ItemSummary {
  return { ...summary, ...item }
}

/** A `Date.now()` that re-renders on an interval, so relative times don't go stale on screen. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export interface StatusIndex {
  statuses: Status[]
  open: Status[]
  closed: Status[]
  byId: Map<number, Status>
  byKey: Map<string, Status>
  kindOf: (item: Pick<ItemSummary, 'statusKey'>) => 'open' | 'closed'
}

function indexStatuses(statuses: Status[]): StatusIndex {
  const sorted = [...statuses].sort((a, b) => a.sortOrder - b.sortOrder)
  const byId = new Map(sorted.map((s) => [s.id, s]))
  const byKey = new Map(sorted.map((s) => [s.key, s]))
  return {
    statuses: sorted,
    open: sorted.filter((s) => s.kind === 'open'),
    closed: sorted.filter((s) => s.kind === 'closed'),
    byId,
    byKey,
    kindOf: (item) => byKey.get(item.statusKey)?.kind ?? 'open'
  }
}

export interface TrackerStore {
  statusIndex: StatusIndex
  items: ItemSummary[]
  loading: boolean
  error: string | null
  clearError: () => void
  refresh: () => Promise<void>
  /** Optimistic: moves the card immediately, reverts if main rejects. */
  moveItem: (itemId: number, statusKey: string, closeReason?: CloseReason | null) => Promise<void>
  patchItem: (itemId: number, patch: ItemPatch) => Promise<void>
  archiveItem: (itemId: number, archived: boolean) => Promise<void>
  deleteItem: (itemId: number) => Promise<void>
  /** `statusKey` is which column it lands in — the board's per-column + passes its own. */
  createItem: (company: string, statusKey?: string) => Promise<Item | null>
}

export function useTracker(query?: ItemQuery): TrackerStore {
  const [statuses, setStatuses] = useState<Status[]>([])
  const [items, setItems] = useState<ItemSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // `query` is normally an inline object literal; keying the effect on its contents
  // keeps it from re-firing on every render.
  const queryKey = JSON.stringify(query ?? {})
  const queryRef = useRef<ItemQuery | undefined>(query)
  queryRef.current = query

  const refresh = useCallback(async () => {
    try {
      const [nextStatuses, nextItems] = await Promise.all([
        window.recruit.listStatuses(),
        window.recruit.listItems(queryRef.current)
      ])
      setStatuses(nextStatuses)
      setItems(nextItems)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [queryKey, refresh])

  useEffect(() => {
    return window.recruit.on('itemsChanged', () => {
      void refresh()
    })
  }, [refresh])

  const statusIndex = useMemo(() => indexStatuses(statuses), [statuses])

  const moveItem = useCallback<TrackerStore['moveItem']>(
    async (itemId, statusKey, closeReason) => {
      const target = statusIndex.byKey.get(statusKey)
      let previous: ItemSummary | undefined
      setItems((current) =>
        current.map((it) => {
          if (it.id !== itemId) return it
          previous = it
          return {
            ...it,
            statusKey,
            statusId: target?.id ?? it.statusId,
            closeReason: target?.kind === 'closed' ? (closeReason ?? it.closeReason) : null
          }
        })
      )
      try {
        const updated = await window.recruit.setItemStatus(itemId, statusKey, closeReason ?? null)
        setItems((current) => current.map((it) => (it.id === itemId ? mergeItem(it, updated) : it)))
        setError(null)
      } catch (e) {
        if (previous) {
          const revert = previous
          setItems((current) => current.map((it) => (it.id === itemId ? revert : it)))
        }
        setError(errorMessage(e))
      }
    },
    [statusIndex]
  )

  const patchItem = useCallback<TrackerStore['patchItem']>(async (itemId, patch) => {
    try {
      const updated = await window.recruit.updateItem(itemId, patch)
      setItems((current) => current.map((it) => (it.id === itemId ? mergeItem(it, updated) : it)))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  const archiveItem = useCallback<TrackerStore['archiveItem']>(
    async (itemId, archived) => {
      try {
        await window.recruit.archiveItem(itemId, archived)
        await refresh()
      } catch (e) {
        setError(errorMessage(e))
      }
    },
    [refresh]
  )

  const deleteItem = useCallback<TrackerStore['deleteItem']>(async (itemId) => {
    try {
      await window.recruit.deleteItem(itemId)
      setItems((current) => current.filter((it) => it.id !== itemId))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  const createItem = useCallback<TrackerStore['createItem']>(
    async (company, statusKey = 'saved') => {
      try {
        const created = await window.recruit.createItem({ company, statusKey })
        await refresh()
        return created
      } catch (e) {
        setError(errorMessage(e))
        return null
      }
    },
    [refresh]
  )

  return {
    statusIndex,
    items,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    refresh,
    moveItem,
    patchItem,
    archiveItem,
    deleteItem,
    createItem
  }
}

export interface ItemDetailStore {
  detail: ItemDetail | null
  loading: boolean
  error: string | null
  clearError: () => void
  refresh: () => Promise<void>
  saveDescription: (markdown: string) => Promise<void>
  patch: (patch: ItemPatch) => Promise<void>
  setStatus: (statusKey: string, closeReason?: CloseReason | null) => Promise<void>
  setArchived: (archived: boolean) => Promise<void>
  remove: () => Promise<void>
  addEvent: (input: Omit<TimelineEventInput, 'itemId'>) => Promise<void>
  updateEvent: (eventId: number, patch: Partial<TimelineEventInput>) => Promise<void>
  deleteEvent: (eventId: number) => Promise<void>
  unlinkMessage: (messageId: number) => Promise<void>
}

export function useItemDetail(itemId: number | null): ItemDetailStore {
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [loading, setLoading] = useState(itemId !== null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (itemId === null) {
      setDetail(null)
      setLoading(false)
      return
    }
    try {
      setDetail(await window.recruit.getItem(itemId))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    setLoading(itemId !== null)
    void refresh()
  }, [itemId, refresh])

  useEffect(() => {
    if (itemId === null) return
    return window.recruit.on('itemsChanged', (payload) => {
      if (payload.itemIds.length === 0 || payload.itemIds.includes(itemId)) void refresh()
    })
  }, [itemId, refresh])

  /** Run a write, then re-read. Errors surface as a banner instead of throwing. */
  const guard = useCallback(
    async (fn: () => Promise<unknown>, reload = true) => {
      try {
        await fn()
        setError(null)
        if (reload) await refresh()
      } catch (e) {
        setError(errorMessage(e))
      }
    },
    [refresh]
  )

  return {
    detail,
    loading,
    error,
    clearError: useCallback(() => setError(null), []),
    refresh,
    saveDescription: useCallback(
      async (markdown: string) => {
        if (itemId === null) return
        // Editing an agent-written description transfers ownership to the user. The db
        // flips description_source on its own; sending it makes the intent explicit.
        await guard(() =>
          window.recruit.updateItem(itemId, { descriptionMd: markdown, descriptionSource: 'user' })
        )
      },
      [guard, itemId]
    ),
    patch: useCallback(
      async (patch: ItemPatch) => {
        if (itemId === null) return
        await guard(() => window.recruit.updateItem(itemId, patch))
      },
      [guard, itemId]
    ),
    setStatus: useCallback(
      async (statusKey: string, closeReason?: CloseReason | null) => {
        if (itemId === null) return
        await guard(() => window.recruit.setItemStatus(itemId, statusKey, closeReason ?? null))
      },
      [guard, itemId]
    ),
    setArchived: useCallback(
      async (archived: boolean) => {
        if (itemId === null) return
        await guard(() => window.recruit.archiveItem(itemId, archived))
      },
      [guard, itemId]
    ),
    remove: useCallback(async () => {
      if (itemId === null) return
      // No reload: the row is gone, and re-reading it would only 404.
      await guard(() => window.recruit.deleteItem(itemId), false)
    }, [guard, itemId]),
    addEvent: useCallback(
      async (input: Omit<TimelineEventInput, 'itemId'>) => {
        if (itemId === null) return
        await guard(() => window.recruit.addEvent({ ...input, itemId, source: 'user' }))
      },
      [guard, itemId]
    ),
    updateEvent: useCallback(
      async (eventId: number, patch: Partial<TimelineEventInput>) => {
        await guard(() => window.recruit.updateEvent(eventId, patch))
      },
      [guard]
    ),
    deleteEvent: useCallback(
      async (eventId: number) => {
        await guard(() => window.recruit.deleteEvent(eventId))
      },
      [guard]
    ),
    unlinkMessage: useCallback(
      async (messageId: number) => {
        if (itemId === null) return
        await guard(() => window.recruit.unlinkMessage(itemId, messageId))
      },
      [guard, itemId]
    )
  }
}
