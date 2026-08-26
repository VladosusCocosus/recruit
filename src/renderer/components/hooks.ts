import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import type {
  Account,
  AgentRunUpdate,
  AppCounts,
  AppInfo,
  AppSettings,
  NavKey,
  RecruitEventName,
  RecruitEvents,
  SetupState,
  StartRunInput,
  Status,
  SyncStatus,
  ThemePreference,
  UpdateStatus
} from '@shared/types'
import { errorMessage } from './format'

/** The preload bridge is the renderer's only door out. Nothing else touches node. */
export function hasBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.recruit)
}

const NO_BRIDGE =
  'The preload bridge is unavailable — window.recruit was never exposed. Restart the app.'

/* ── async loading ───────────────────────────────────────────────────────── */

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
  /** Optimistic local write, e.g. after a mutation returns the new row. */
  set: (value: T | null) => void
}

/**
 * One IPC read, with loading + error + manual reload. Stale responses from a
 * superseded call are discarded, so rapid dependency changes can't race.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!hasBridge()) {
      setError(NO_BRIDGE)
      setLoading(false)
      return
    }
    let live = true
    setLoading(true)
    fnRef
      .current()
      .then((value) => {
        if (!live) return
        setData(value)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!live) return
        setError(errorMessage(e))
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { data, loading, error, reload, set: setData }
}

/* ── routing ─────────────────────────────────────────────────────────────── */

const NAV_KEYS: readonly NavKey[] = [
  'inbox',
  'candidates',
  'board',
  'review',
  'upnext',
  'settings'
]

function readHash(fallback: NavKey): NavKey {
  const raw = window.location.hash.replace(/^#\/?/, '')
  return (NAV_KEYS as readonly string[]).includes(raw) ? (raw as NavKey) : fallback
}

/**
 * Hash routing, deliberately not react-router. The hash is the single source of
 * truth, so back/forward work and a reload lands on the same view.
 */
export function useHashRoute(fallback: NavKey = 'inbox'): [NavKey, (key: NavKey) => void] {
  const [nav, setNav] = useState<NavKey>(() => readHash(fallback))

  useEffect(() => {
    const onChange = (): void => setNav(readHash(fallback))
    window.addEventListener('hashchange', onChange)
    if (!window.location.hash) window.location.hash = `#/${fallback}`
    return () => window.removeEventListener('hashchange', onChange)
  }, [fallback])

  const navigate = useCallback((key: NavKey) => {
    window.location.hash = `#/${key}`
    setNav(key)
  }, [])

  return [nav, navigate]
}

/* ── main -> renderer events ─────────────────────────────────────────────── */

/**
 * Subscribe to one push channel. The handler is held in a ref, so passing an
 * inline arrow function does not resubscribe on every render.
 */
export function useRecruitEvent<K extends RecruitEventName>(
  event: K,
  handler: (payload: RecruitEvents[K]) => void
): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!hasBridge()) return
    return window.recruit.on(event, (payload) => ref.current(payload))
  }, [event])
}

/* ── app-level reads ─────────────────────────────────────────────────────── */

export function useAppInfo(): AsyncState<AppInfo> {
  return useAsync(() => window.recruit.getAppInfo(), [])
}

export function useAccounts(): AsyncState<Account[]> {
  return useAsync(() => window.recruit.listAccounts(), [])
}

export function useStatuses(): AsyncState<Status[]> {
  return useAsync(() => window.recruit.listStatuses(), [])
}

const EMPTY_COUNTS: AppCounts = {
  candidates: 0,
  pendingProposals: 0,
  unreadInbox: 0,
  upcomingEvents: 0,
  items: 0
}

/**
 * Badge counts for the rail and the RUN button pill. Self-refreshing: any event
 * that could move a number triggers a reload, so no view has to remember to.
 */
export function useCounts(): { counts: AppCounts; reload: () => void } {
  const state = useAsync(() => window.recruit.getCounts(), [])
  useRecruitEvent('proposalsChanged', () => state.reload())
  useRecruitEvent('mailChanged', () => state.reload())
  useRecruitEvent('itemsChanged', () => state.reload())
  return { counts: state.data ?? EMPTY_COUNTS, reload: state.reload }
}

export function useSetupState(): AsyncState<SetupState> {
  const state = useAsync(() => window.recruit.getSetupState(), [])
  useRecruitEvent('mailChanged', () => state.reload())
  useRecruitEvent('proposalsChanged', () => state.reload())
  return state
}

/* ── settings ────────────────────────────────────────────────────────────── */

export interface SettingsState {
  settings: AppSettings | null
  loading: boolean
  error: string | null
  saving: boolean
  /** Applies a patch and adopts whatever main echoes back. */
  update: (patch: Partial<AppSettings>) => Promise<void>
  reload: () => void
}

export function useSettings(): SettingsState {
  const state = useAsync(() => window.recruit.getSettings(), [])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // `set` is a useState setter — stable, so `update` below stays referentially stable.
  const { set } = state

  // Another window (or main itself) may change settings out from under us.
  useRecruitEvent('settingsChanged', (next) => set(next))

  const update = useCallback(
    async (patch: Partial<AppSettings>): Promise<void> => {
      setSaving(true)
      setSaveError(null)
      try {
        set(await window.recruit.updateSettings(patch))
      } catch (e) {
        setSaveError(errorMessage(e))
      } finally {
        setSaving(false)
      }
    },
    [set]
  )

  return {
    settings: state.data,
    loading: state.loading,
    error: saveError ?? state.error,
    saving,
    update,
    reload: state.reload
  }
}

/** Writes settings.theme onto <html data-theme>. 'system' removes the attribute. */
export function useTheme(theme: ThemePreference | undefined): void {
  useEffect(() => {
    const root = document.documentElement
    if (!theme || theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])
}

/* ── sync ────────────────────────────────────────────────────────────────── */

const IDLE_SYNC: SyncStatus = {
  phase: 'idle',
  accountId: null,
  processed: 0,
  total: 0,
  newMessages: 0,
  newCandidates: 0,
  lastSyncAt: null,
  error: null
}

export interface SyncState {
  status: SyncStatus
  busy: boolean
  syncNow: (accountId?: number) => Promise<void>
  cancel: () => Promise<void>
  error: string | null
}

export function useSync(): SyncState {
  const [status, setStatus] = useState<SyncStatus>(IDLE_SYNC)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasBridge()) return
    let live = true
    window.recruit
      .getSyncStatus()
      .then((s) => live && setStatus(s))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  useRecruitEvent('syncStatus', (s) => setStatus(s))

  const syncNow = useCallback(async (accountId?: number): Promise<void> => {
    setError(null)
    try {
      await window.recruit.syncNow(accountId)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  const cancel = useCallback(async (): Promise<void> => {
    try {
      await window.recruit.cancelSync()
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [])

  const busy =
    status.phase !== 'idle' && status.phase !== 'done' && status.phase !== 'error'

  return { status, busy, syncNow, cancel, error: error ?? status.error }
}

/* ── the agent run ───────────────────────────────────────────────────────── */

export interface RunState {
  /** Non-null only while the run is starting or running. Drives the RUN button. */
  active: AgentRunUpdate | null
  /** The most recent update whatever its state — how the error banner survives. */
  last: AgentRunUpdate | null
  /** Ticks locally every second so seconds advance between pushes from main. */
  elapsedMs: number
  starting: boolean
  error: string | null
  start: (input?: Partial<StartRunInput>) => Promise<void>
  stop: () => Promise<void>
  /** Clears `last` — used when the user dismisses the error banner. */
  clearLast: () => void
}

const ACTIVE_STATES = new Set(['starting', 'running'])

function isActiveUpdate(u: AgentRunUpdate | null): boolean {
  return u !== null && ACTIVE_STATES.has(u.state)
}

/**
 * The whole lifecycle behind the RUN button. On click we synthesise a 'starting'
 * update immediately rather than waiting for main's first push, so the control
 * morphs on the same frame as the click.
 */
export function useRun(): RunState {
  const [update, setUpdate] = useState<AgentRunUpdate | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!hasBridge()) return
    let live = true
    window.recruit
      .getActiveRun()
      .then((u) => live && u && setUpdate(u))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  useRecruitEvent('runUpdate', (u) => {
    setUpdate(u)
    if (isActiveUpdate(u)) setStarting(false)
  })

  const active = isActiveUpdate(update) ? update : null

  // Local clock. Only runs while something is in flight.
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick((t) => t + 1), 1000)
    return () => window.clearInterval(id)
  }, [active !== null, active?.runId])

  let elapsedMs = active?.elapsedMs ?? 0
  if (active) {
    const startedAt = Date.parse(active.startedAt)
    if (Number.isFinite(startedAt)) {
      elapsedMs = Math.max(active.elapsedMs, Date.now() - startedAt)
    }
  }
  void tick // the interval exists purely to re-render this value

  const start = useCallback(async (input?: Partial<StartRunInput>): Promise<void> => {
    setError(null)
    setStarting(true)
    const startedAt = new Date().toISOString()
    setUpdate({
      runId: -1,
      kind: input?.kind ?? 'triage',
      state: 'starting',
      startedAt,
      elapsedMs: 0,
      currentTool: null,
      toolCalls: 0,
      proposalCount: 0,
      errorKind: null,
      errorText: null
    })
    try {
      await window.recruit.startRun({ kind: 'triage', ...input })
    } catch (e) {
      setError(errorMessage(e))
      setUpdate(null)
      setStarting(false)
    }
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    const runId = update?.runId
    if (runId === undefined || runId < 0) return
    try {
      await window.recruit.stopRun(runId)
    } catch (e) {
      setError(errorMessage(e))
    }
  }, [update?.runId])

  const clearLast = useCallback(() => {
    setUpdate((u) => (isActiveUpdate(u) ? u : null))
    setError(null)
  }, [])

  return { active, last: update, elapsedMs, starting, error, start, stop, clearLast }
}

/**
 * Update availability. Seeded from main on mount, then kept live by the
 * `updateAvailable` push — the check runs on a 6h timer in the main process, so the
 * renderer never polls.
 */
export function useUpdate(): {
  status: UpdateStatus | null
  dismissed: boolean
  download: () => void
  dismiss: () => void
} {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!hasBridge()) return
    void window.recruit.getUpdateStatus().then(setStatus).catch(() => undefined)
    return window.recruit.on('updateAvailable', setStatus)
  }, [])

  const download = useCallback(() => {
    void window.recruit.openDownload().catch(() => undefined)
  }, [])

  const dismiss = useCallback(() => {
    setDismissedVersion(status?.latestVersion ?? null)
  }, [status?.latestVersion])

  return {
    status,
    // Dismissal is per-version: a newer release surfaces the banner again.
    dismissed: Boolean(status?.latestVersion && status.latestVersion === dismissedVersion),
    download,
    dismiss
  }
}
