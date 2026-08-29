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

/** What a cross-view link points at. A route carries at most one. */
export type RouteTargetKind = 'message' | 'item'

export interface RouteTarget {
  kind: RouteTargetKind
  id: number
}

const TARGET_KINDS: readonly RouteTargetKind[] = ['message', 'item']

/** The object form callers write: `navigate('inbox', { message: 12 })`. */
export type NavTarget = { message: number; item?: never } | { item: number; message?: never }

export type Navigate = (key: NavKey, target?: NavTarget) => void

export interface Route {
  nav: NavKey
  /** The deep-link target the hash carries, or null for a plain `#/inbox`. */
  target: RouteTarget | null
  /**
   * Bumped on every navigation, including one that lands on the hash we are already on.
   * Views honour `target` once per nonce, so clicking the same link twice opens it twice
   * and clicking around afterwards is never yanked back.
   */
  nonce: number
}

/**
 * `#/inbox/message/12` -> inbox, focused on message 12. Anything unrecognised — an unknown
 * view, a kind we don't serve, a non-numeric id — degrades to a plain view rather than an
 * error page, because a hash is user-editable and a typo must not strand the app.
 */
export function parseHash(
  hash: string,
  fallback: NavKey = 'inbox'
): { nav: NavKey; target: RouteTarget | null } {
  const parts = hash.replace(/^#\/?/, '').split('/')
  const rawNav = parts[0] ?? ''
  if (!(NAV_KEYS as readonly string[]).includes(rawNav)) return { nav: fallback, target: null }

  const nav = rawNav as NavKey
  const kind = parts[1] ?? ''
  const id = Number(parts[2] ?? '')
  if (!(TARGET_KINDS as readonly string[]).includes(kind)) return { nav, target: null }
  if (!Number.isSafeInteger(id) || id <= 0) return { nav, target: null }
  return { nav, target: { kind: kind as RouteTargetKind, id } }
}

/** The inverse. A targetless route keeps the short `#/inbox` form it has always had. */
export function formatHash(nav: NavKey, target?: RouteTarget | null): string {
  return target ? `#/${nav}/${target.kind}/${target.id}` : `#/${nav}`
}

function toTarget(target: NavTarget | undefined): RouteTarget | null {
  if (!target) return null
  if (target.message !== undefined) return { kind: 'message', id: target.message }
  if (target.item !== undefined) return { kind: 'item', id: target.item }
  return null
}

/**
 * Hash routing, deliberately not react-router. The hash is the single source of
 * truth, so back/forward work and a reload lands on the same view — and, now that it
 * carries the target too, on the same message or item.
 */
export function useHashRoute(fallback: NavKey = 'inbox'): [Route, Navigate] {
  const [route, setRoute] = useState<Route>(() => ({
    ...parseHash(window.location.hash, fallback),
    nonce: 0
  }))

  // The listener has to read the newest route to tell an outside change from our own echo,
  // but must not be re-registered on every navigation.
  const routeRef = useRef(route)
  routeRef.current = route

  useEffect(() => {
    const onChange = (): void => {
      const next = parseHash(window.location.hash, fallback)
      const current = routeRef.current
      // Assigning window.location.hash fires this event a tick after `navigate` already
      // applied the same route. Swallow that echo, or every deep-link effect runs twice.
      if (formatHash(next.nav, next.target) === formatHash(current.nav, current.target)) return
      setRoute({ ...next, nonce: current.nonce + 1 })
    }
    window.addEventListener('hashchange', onChange)
    if (!window.location.hash) window.location.hash = `#/${fallback}`
    return () => window.removeEventListener('hashchange', onChange)
  }, [fallback])

  const navigate = useCallback<Navigate>((key, target) => {
    const next = toTarget(target)
    window.location.hash = formatHash(key, next)
    // Set state here rather than waiting for `hashchange`: re-following a link you are
    // already on changes nothing in the URL, so no event would ever arrive.
    setRoute((prev) => ({ nav: key, target: next, nonce: prev.nonce + 1 }))
  }, [])

  return [route, navigate]
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

/** Self-refreshing: switching the agent engine changes which CLI this describes. */
export function useAppInfo(): AsyncState<AppInfo> {
  const state = useAsync(() => window.recruit.getAppInfo(), [])
  useRecruitEvent('settingsChanged', () => state.reload())
  return state
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
  eventsSoon: 0,
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
      messagesTotal: input?.messageIds?.length ?? 0,
      messagesRead: 0,
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
  checking: boolean
  download: () => void
  dismiss: () => void
  check: () => void
} {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

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

  // The 6h timer covers the passive case; this is the "check now" Settings offers.
  // checkForUpdate resolves with the new status AND broadcasts it, so the state set
  // here and the one the push delivers are the same object.
  const check = useCallback(() => {
    if (!hasBridge()) return
    setChecking(true)
    void window.recruit
      .checkForUpdate()
      .then(setStatus)
      .catch(() => undefined)
      .finally(() => setChecking(false))
  }, [])

  return {
    status,
    // Dismissal is per-version: a newer release surfaces the banner again.
    dismissed: Boolean(status?.latestVersion && status.latestVersion === dismissedVersion),
    checking,
    download,
    dismiss,
    check
  }
}

/**
 * Debounces a fast-changing value — a search box, a slider — so every keystroke isn't a
 * round trip to main. Lives here rather than beside one view because both Mail's message
 * search and the tracker's filter box need it, and two copies would drift.
 */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
