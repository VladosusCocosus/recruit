import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentRunKind, AgentRunSummary, AgentRunUpdate, StartRunInput } from '@shared/types'
import { createRunStore, type RunBridge, type RunStore } from '../src/renderer/components/runStore'

function update(over: Partial<AgentRunUpdate> = {}): AgentRunUpdate {
  return {
    runId: 7,
    kind: 'triage',
    state: 'running',
    startedAt: '2026-09-13T10:00:00.000Z',
    elapsedMs: 1000,
    currentTool: null,
    toolCalls: 0,
    proposalCount: 0,
    messagesTotal: 0,
    messagesRead: 0,
    errorKind: null,
    errorText: null,
    ...over
  }
}

function summary(id: number, kind: AgentRunKind = 'triage'): AgentRunSummary {
  return {
    id,
    kind,
    startedAt: '2026-09-13T10:00:00.000Z',
    finishedAt: null,
    command: null,
    model: null,
    sessionId: null,
    exitCode: null,
    isError: false,
    errorText: null,
    errorKind: null,
    durationMs: null,
    costUsd: null,
    proposalCount: 0
  }
}

interface Harness {
  store: RunStore
  starts: StartRunInput[]
  stops: number[]
  /** Delivers a `runUpdate` push, as main would. */
  push: (u: AgentRunUpdate) => void
  /** Resolves the outstanding `startRun`, as a spawned process would. */
  spawned: (id: number, kind?: AgentRunKind) => Promise<void>
  /** Rejects the outstanding `startRun`. */
  refused: (message: string) => Promise<void>
}

function harness(): Harness {
  const starts: StartRunInput[] = []
  const stops: number[] = []
  let handler: ((u: AgentRunUpdate) => void) | null = null
  let resolve: ((s: AgentRunSummary) => void) | null = null
  let reject: ((e: unknown) => void) | null = null

  const bridge: RunBridge = {
    startRun: (input) => {
      starts.push(input)
      return new Promise<AgentRunSummary>((res, rej) => {
        resolve = res
        reject = rej
      })
    },
    stopRun: async (runId) => {
      stops.push(runId)
    },
    getActiveRun: async () => null,
    on: (_event, h) => {
      handler = h
      return () => {
        handler = null
      }
    }
  }

  const settled = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
  }

  return {
    store: createRunStore(() => bridge),
    starts,
    stops,
    push: (u) => handler?.(u),
    spawned: async (id, kind) => {
      resolve?.(summary(id, kind))
      await settled()
    },
    refused: async (message) => {
      reject?.(new Error(message))
      await settled()
    }
  }
}

const OWNER = Symbol('test')

let h: Harness

beforeEach(() => {
  h = harness()
})

describe('a run that never starts', () => {
  it('settles the promise instead of leaving the caller waiting', async () => {
    const outcome = h.store.begin(OWNER, { kind: 'enrich' })
    await h.refused('claude is not installed')

    expect(await outcome).toEqual({ state: 'unstarted', message: 'claude is not installed' })
  })

  it('leaves nothing running behind, so no spinner can stick', async () => {
    const outcome = h.store.begin(OWNER, { kind: 'enrich' })
    expect(h.store.getSnapshot().active?.state).toBe('starting')

    await h.refused('claude is not installed')
    await outcome

    expect(h.store.getSnapshot().active).toBeNull()
    expect(h.store.getSnapshot().owner).toBeNull()
  })

  it('spawns nothing at all when a run is already claimed', async () => {
    void h.store.begin(OWNER, { kind: 'triage' })
    const second = h.store.begin(Symbol('other'), { kind: 'enrich' })

    expect(await second).toEqual({ state: 'unstarted', message: 'Another run is in progress.' })
    expect(h.starts).toHaveLength(1)
  })
})

describe('a claimed run reaching a terminal state', () => {
  it('resolves with the id of the finished run', async () => {
    const outcome = h.store.begin(OWNER, { kind: 'tailor' })
    await h.spawned(42, 'tailor')
    h.push(update({ runId: 42, kind: 'tailor', state: 'finished' }))

    expect(await outcome).toEqual({ state: 'finished', runId: 42 })
  })

  it('resolves even when the run ends before startRun has returned', async () => {
    const outcome = h.store.begin(OWNER, { kind: 'tailor' })
    h.push(update({ runId: 42, kind: 'tailor', state: 'finished' }))

    expect(await outcome).toEqual({ state: 'finished', runId: 42 })
  })

  it('carries the error text and kind a failure reported', async () => {
    const outcome = h.store.begin(OWNER, { kind: 'triage' })
    await h.spawned(9)
    h.push(
      update({
        runId: 9,
        state: 'error',
        errorText: 'Claude Code is not signed in',
        errorKind: 'not_signed_in'
      })
    )

    expect(await outcome).toEqual({
      state: 'failed',
      runId: 9,
      message: 'Claude Code is not signed in',
      errorKind: 'not_signed_in'
    })
  })

  it('reports a stop as a stop, not as a failure', async () => {
    const outcome = h.store.begin(OWNER, { kind: 'answer' })
    await h.spawned(3, 'answer')
    h.push(update({ runId: 3, kind: 'answer', state: 'stopped' }))

    expect(await outcome).toEqual({ state: 'stopped' })
  })

  it('releases the claim, so the next run can be started', async () => {
    const first = h.store.begin(OWNER, { kind: 'triage' })
    await h.spawned(1)
    h.push(update({ runId: 1, state: 'finished' }))
    await first

    expect(h.store.getSnapshot().owner).toBeNull()
    void h.store.begin(OWNER, { kind: 'triage' })
    expect(h.starts).toHaveLength(2)
  })
})

describe('a run this store did not start', () => {
  it('is watched but never settles the claim', async () => {
    let settled = false
    const outcome = h.store.begin(OWNER, { kind: 'tailor' })
    void outcome.then(() => {
      settled = true
    })
    await h.spawned(42, 'tailor')

    h.push(update({ runId: 99, kind: 'triage', state: 'finished' }))
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(h.store.getSnapshot().owner).toBe(OWNER)
  })

  it('is not adopted when it was already in flight as the claim was made', async () => {
    let settled = false
    h.store.subscribe(() => undefined)
    h.push(update({ runId: 5, kind: 'triage', state: 'running' }))

    const outcome = h.store.begin(OWNER, { kind: 'triage' })
    void outcome.then(() => {
      settled = true
    })
    h.push(update({ runId: 5, kind: 'triage', state: 'finished' }))
    await Promise.resolve()

    expect(settled).toBe(false)
  })
})

describe('the snapshot every screen reads', () => {
  it('shows the run as starting on the click, before main has pushed anything', () => {
    const seen: number[] = []
    h.store.subscribe(() => seen.push(1))

    void h.store.begin(OWNER, { kind: 'tailor' })

    expect(seen.length).toBeGreaterThan(0)
    expect(h.store.getSnapshot().active).toMatchObject({ kind: 'tailor', state: 'starting' })
    expect(h.store.getSnapshot().owner).toBe(OWNER)
  })

  it('keeps the last update after the run ends, and drops it on clear', async () => {
    const outcome = h.store.begin(OWNER, { kind: 'triage' })
    await h.spawned(1)
    h.push(update({ runId: 1, state: 'error', errorText: 'it broke' }))
    await outcome

    expect(h.store.getSnapshot().last?.errorText).toBe('it broke')
    expect(h.store.getSnapshot().active).toBeNull()

    h.store.clear()
    expect(h.store.getSnapshot().last).toBeNull()
  })

  it('keeps a live run on clear, so a dismissed banner cannot hide it', async () => {
    void h.store.begin(OWNER, { kind: 'triage' })
    await h.spawned(1)
    h.push(update({ runId: 1, state: 'running' }))

    h.store.clear()
    expect(h.store.getSnapshot().active?.runId).toBe(1)
  })
})

describe('stopping', () => {
  it('asks main to stop the run that is in flight', async () => {
    void h.store.begin(OWNER, { kind: 'triage' })
    await h.spawned(11)
    h.push(update({ runId: 11, state: 'running' }))

    await h.store.stop()
    expect(h.stops).toEqual([11])
  })

  it('asks nothing while the run has no id of its own yet', async () => {
    void h.store.begin(OWNER, { kind: 'triage' })

    await h.store.stop()
    expect(h.stops).toEqual([])
  })
})
