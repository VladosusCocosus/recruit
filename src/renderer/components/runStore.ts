/**
 * The agent run, as the whole renderer sees it.
 *
 * One subscription to `runUpdate`, one seed from `getActiveRun`, one clock, one snapshot.
 * Every screen reads that snapshot, so the synthetic 'starting' update a click produces is
 * visible to the toolbar as well as to the screen that started it.
 *
 * A run started through `begin` is *claimed*. The returned promise settles once that run
 * reaches a terminal state, or the `startRun` call throws. It settles exactly once and it
 * never rejects, so a caller that awaits it cannot be stranded.
 *
 * `createRunStore` takes the bridge as a thunk, so a test can drive the machine with a
 * fake one and no window.
 */
import type {
  AgentErrorKind,
  AgentRunKind,
  AgentRunSummary,
  AgentRunUpdate,
  StartRunInput
} from '@shared/types'
import { errorMessage } from './format'

/** The subset of the preload bridge the run lifecycle needs. */
export interface RunBridge {
  startRun: (input: StartRunInput) => Promise<AgentRunSummary>
  stopRun: (runId: number) => Promise<void>
  getActiveRun: () => Promise<AgentRunUpdate | null>
  on: (event: 'runUpdate', handler: (update: AgentRunUpdate) => void) => () => void
}

/**
 * How a claimed run ended. 'unstarted' means nothing was ever spawned — a rejected
 * `startRun`, or another run already holding the claim.
 */
export type RunOutcome =
  | { state: 'finished'; runId: number }
  | { state: 'stopped' }
  | { state: 'failed'; runId: number; message: string; errorKind: AgentErrorKind | null }
  | { state: 'unstarted'; message: string }

export interface RunSnapshot {
  /** The newest update whatever its state, so an error banner outlives its run. */
  last: AgentRunUpdate | null
  /** `last` while it is starting or running, else null. */
  active: AgentRunUpdate | null
  /** Elapsed on `active`, ticked locally between pushes. 0 when nothing is active. */
  elapsedMs: number
  /** The `begin` caller whose run is in flight, or null. */
  owner: symbol | null
}

export interface RunStore {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => RunSnapshot
  /**
   * Starts a run on `owner`'s behalf and resolves when it is over. Resolves with an
   * error outcome, without spawning anything, when another run is already claimed.
   */
  begin: (owner: symbol, input: Partial<StartRunInput>) => Promise<RunOutcome>
  /** Asks main to stop the run in flight. A run that never got a real id is left alone. */
  stop: () => Promise<void>
  /** Drops `last` unless it is still active. */
  clear: () => void
}

const BLOCKED = 'Another run is in progress.'
const FAILED = 'The run failed.'
const NO_BRIDGE = 'The preload bridge is unavailable — window.recruit was never exposed.'

const IDLE: RunSnapshot = { last: null, active: null, elapsedMs: 0, owner: null }

function isActive(update: AgentRunUpdate | null): boolean {
  return update !== null && (update.state === 'starting' || update.state === 'running')
}

function elapsedOf(active: AgentRunUpdate | null): number {
  if (!active) return 0
  const startedAt = Date.parse(active.startedAt)
  if (!Number.isFinite(startedAt)) return active.elapsedMs
  return Math.max(active.elapsedMs, Date.now() - startedAt)
}

function syntheticStart(input: Partial<StartRunInput>, kind: AgentRunKind): AgentRunUpdate {
  return {
    runId: -1,
    kind,
    state: 'starting',
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    currentTool: null,
    toolCalls: 0,
    messagesTotal: input.messageIds?.length ?? 0,
    messagesRead: 0,
    proposalCount: 0,
    errorKind: null,
    errorText: null
  }
}

interface Claim {
  owner: symbol
  kind: AgentRunKind
  /** The row id, once `startRun` or a matching update names it. */
  runId: number | null
  /** The run already known when the claim was made. Never adopted as the claim's own. */
  priorRunId: number | null
  settle: (outcome: RunOutcome) => void
}

export function createRunStore(bridge: () => RunBridge | null): RunStore {
  const listeners = new Set<() => void>()
  let snapshot = IDLE
  let claim: Claim | null = null
  let detach: (() => void) | null = null
  let clock: ReturnType<typeof setInterval> | null = null

  function publish(next: Partial<RunSnapshot>): void {
    snapshot = { ...snapshot, ...next }
    for (const listener of [...listeners]) listener()
  }

  function tick(): void {
    publish({ elapsedMs: elapsedOf(snapshot.active) })
  }

  /** Brings the IPC subscription and the clock in line with what is being watched. */
  function sync(): void {
    const watched = listeners.size > 0 || claim !== null
    if (watched && detach === null) {
      const api = bridge()
      if (api) {
        detach = api.on('runUpdate', receive)
        void api
          .getActiveRun()
          .then((update) => {
            if (update && snapshot.last === null) receive(update)
          })
          .catch(() => undefined)
      }
    } else if (!watched && detach !== null) {
      detach()
      detach = null
    }

    const ticking = snapshot.active !== null && listeners.size > 0
    if (ticking && clock === null) clock = setInterval(tick, 1000)
    else if (!ticking && clock !== null) {
      clearInterval(clock)
      clock = null
    }
  }

  function settle(outcome: RunOutcome): void {
    const held = claim
    if (!held) return
    claim = null
    publish({ owner: null })
    held.settle(outcome)
  }

  function receive(update: AgentRunUpdate): void {
    if (
      claim &&
      claim.runId === null &&
      claim.kind === update.kind &&
      update.runId !== claim.priorRunId
    ) {
      claim.runId = update.runId
    }
    const active = isActive(update) ? update : null
    publish({ last: update, active, elapsedMs: elapsedOf(active) })
    sync()
    if (!claim || claim.runId !== update.runId) return
    if (update.state === 'finished') settle({ state: 'finished', runId: update.runId })
    else if (update.state === 'stopped') settle({ state: 'stopped' })
    else if (update.state === 'error') {
      settle({
        state: 'failed',
        runId: update.runId,
        message: update.errorText ?? FAILED,
        errorKind: update.errorKind
      })
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    sync()
    return () => {
      listeners.delete(listener)
      sync()
    }
  }

  function begin(owner: symbol, input: Partial<StartRunInput>): Promise<RunOutcome> {
    if (claim) return Promise.resolve({ state: 'unstarted', message: BLOCKED })
    const api = bridge()
    if (!api) return Promise.resolve({ state: 'unstarted', message: NO_BRIDGE })

    const kind = input.kind ?? 'triage'
    let settleClaim: (outcome: RunOutcome) => void = () => undefined
    const outcome = new Promise<RunOutcome>((resolve) => {
      settleClaim = resolve
    })
    claim = {
      owner,
      kind,
      runId: null,
      priorRunId: snapshot.last?.runId ?? null,
      settle: settleClaim
    }

    const synthetic = syntheticStart(input, kind)
    publish({ last: synthetic, active: synthetic, elapsedMs: 0, owner })
    sync()

    void api
      .startRun({ ...input, kind })
      .then((summary) => {
        if (claim && claim.owner === owner && claim.runId === null) claim.runId = summary.id
      })
      .catch((error: unknown) => {
        if (snapshot.last === synthetic) publish({ last: null, active: null, elapsedMs: 0 })
        if (claim?.owner === owner) settle({ state: 'unstarted', message: errorMessage(error) })
        sync()
      })

    return outcome
  }

  async function stop(): Promise<void> {
    const runId = snapshot.last?.runId
    const api = bridge()
    if (!api || runId === undefined || runId < 0) return
    await api.stopRun(runId)
  }

  function clear(): void {
    if (snapshot.active !== null) return
    publish({ last: null, elapsedMs: 0 })
  }

  return { subscribe, getSnapshot: () => snapshot, begin, stop, clear }
}

/** The renderer's one store. Every `useAgentRun` reads it. */
export const runStore = createRunStore(() =>
  typeof window === 'undefined' ? null : (window.recruit ?? null)
)
