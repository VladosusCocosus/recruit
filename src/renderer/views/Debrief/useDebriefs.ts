/**
 * The pending-debrief queue and the modal's open state.
 *
 * The list refreshes on mount, on `itemsChanged`, and on window focus. The modal opens
 * automatically for the oldest call not yet prompted for in this session; each call is
 * auto-opened at most once, and a snooze makes it eligible again.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAsync, useRecruitEvent } from '@renderer/components'
import { DEBRIEF_SNOOZE_MS } from '@shared/debrief'
import type { CallDebriefInput, PendingDebrief } from '@shared/types'

export interface DebriefStore {
  pending: PendingDebrief[]
  /** The call the modal is showing, or null when it is closed. */
  active: PendingDebrief | null
  open: (eventId: number) => void
  close: () => void
  save: (input: CallDebriefInput) => Promise<void>
  snooze: (eventId: number) => Promise<void>
  skip: (eventId: number) => Promise<void>
  error: string | null
}

export function useDebriefs(): DebriefStore {
  const debriefs = useAsync(() => window.recruit.listPendingDebriefs(), [])
  const [activeId, setActiveId] = useState<number | null>(null)
  const promptedFor = useRef(new Set<number>())

  const reload = debriefs.reload
  const pending = debriefs.data ?? []

  useRecruitEvent('itemsChanged', () => reload())

  useEffect(() => {
    const onFocus = (): void => reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  useEffect(() => {
    if (activeId !== null || pending.length === 0) return
    const next = pending.find((d) => !promptedFor.current.has(d.id))
    if (!next) return
    promptedFor.current.add(next.id)
    setActiveId(next.id)
  }, [pending, activeId])

  const open = useCallback((eventId: number) => {
    promptedFor.current.add(eventId)
    setActiveId(eventId)
  }, [])

  const close = useCallback(() => setActiveId(null), [])

  const after = useCallback((): void => {
    setActiveId(null)
    reload()
  }, [reload])

  const save = useCallback(
    async (input: CallDebriefInput) => {
      await window.recruit.saveDebrief(input)
      after()
    },
    [after]
  )

  const snooze = useCallback(
    async (eventId: number) => {
      await window.recruit.snoozeDebrief(
        eventId,
        new Date(Date.now() + DEBRIEF_SNOOZE_MS).toISOString()
      )
      promptedFor.current.delete(eventId)
      after()
    },
    [after]
  )

  const skip = useCallback(
    async (eventId: number) => {
      await window.recruit.skipDebrief(eventId)
      after()
    },
    [after]
  )

  return {
    pending,
    active: pending.find((d) => d.id === activeId) ?? null,
    open,
    close,
    save,
    snooze,
    skip,
    error: debriefs.error
  }
}
