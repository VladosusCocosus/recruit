/** Small shared hooks for the Mail views. */

import { useEffect, useState } from 'react'
import type { AgentRunUpdate } from '@shared/types'

export interface ActiveRunState {
  run: AgentRunUpdate | null
  /** True while a run is in flight — gates the inline "Run on this message" action. */
  isRunning: boolean
}

/**
 * Mirrors the toolbar RUN button's state so the per-row inline Run action can't start a
 * second concurrent run. The toolbar owns the visible live status; this is read-only.
 */
export function useActiveRun(): ActiveRunState {
  const [run, setRun] = useState<AgentRunUpdate | null>(null)

  useEffect(() => {
    let alive = true
    window.recruit
      .getActiveRun()
      .then((update) => {
        if (alive) setRun(update)
      })
      .catch(() => {
        /* the toolbar surfaces run failures; the row action just stays enabled */
      })
    const off = window.recruit.on('runUpdate', (update) => setRun(update))
    return () => {
      alive = false
      off()
    }
  }, [])

  const isRunning = run != null && (run.state === 'starting' || run.state === 'running')
  return { run, isRunning }
}

/**
 * AppSettings.blockRemoteImages — the *default* for a freshly opened message. The reader
 * still keeps a per-message override behind the "Load remote images" bar.
 */
export function useBlockRemoteImages(): boolean {
  const [block, setBlock] = useState(true)

  useEffect(() => {
    let alive = true
    window.recruit
      .getSettings()
      .then((settings) => {
        if (alive) setBlock(settings.blockRemoteImages)
      })
      .catch(() => {
        /* privacy-preserving default: keep blocking */
      })
    const off = window.recruit.on('settingsChanged', (settings) =>
      setBlock(settings.blockRemoteImages)
    )
    return () => {
      alive = false
      off()
    }
  }, [])

  return block
}

/** Debounces the search box so every keystroke isn't a SQLite LIKE scan. */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
