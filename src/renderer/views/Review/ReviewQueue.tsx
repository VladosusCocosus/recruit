import { useCallback, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  EmptyState,
  ErrorBanner,
  LoadingState,
  Pane,
  PaneBody,
  PaneHeader,
  errorMessage,
  formatCost,
  formatDuration,
  formatRelative,
  pluralize,
  useAsync,
  useRecruitEvent,
  useStatuses
} from '@renderer/components'
import type { Status } from '@shared/types'
import { buildRunGroups, type ProposalGroup } from './format'
import { ProposalGroupCard, type PendingAction } from './ProposalGroupCard'
import { RunHistoryStrip } from './RunHistoryStrip'
import './review.css'

export interface ReviewQueueProps {
  /** Navigate to the mail reader for a source message. */
  onOpenMessage?: (messageId: number) => void
  /** Navigate to an item's detail view. */
  onOpenItem?: (itemId: number) => void
  /** Ask the shell to start a triage run — the RUN button itself lives in the toolbar. */
  onRequestRun?: () => void
}

const RUN_HISTORY_LIMIT = 24

/**
 * The review queue — where everything the agent wants to do waits for a human yes.
 *
 * Nothing here mutates the tracker directly: Accept hands proposal ids to the applier in
 * main, which resolves refs and writes in one transaction. This view's whole job is to make
 * the decision cheap and honest — what changes, why the agent thinks so, and which email it
 * read to get there.
 *
 * The agent-failure banner is deliberately NOT rendered here; the shell already shows
 * AgentErrorBanner above every view. An empty queue explains itself in its empty state
 * instead, so a failed run never reads as "no news".
 */
export function ReviewQueue({
  onOpenMessage,
  onOpenItem,
  onRequestRun
}: ReviewQueueProps): JSX.Element {
  const proposals = useAsync(() => window.recruit.listProposals({ state: 'pending' }), [])
  const runs = useAsync(() => window.recruit.listRuns(RUN_HISTORY_LIMIT), [])
  const statuses = useStatuses()

  const [selectedRunId, setSelectedRunId] = useState<number | null>(null)
  const [busyKeys, setBusyKeys] = useState<ReadonlyMap<string, Exclude<PendingAction, null>>>(
    () => new Map()
  )
  const [groupErrors, setGroupErrors] = useState<ReadonlyMap<string, string>>(() => new Map())

  const reloadProposals = proposals.reload
  const reloadRuns = runs.reload

  useRecruitEvent('proposalsChanged', () => reloadProposals())
  useRecruitEvent('runUpdate', (update) => {
    if (update.state === 'finished' || update.state === 'error' || update.state === 'stopped') {
      reloadRuns()
      reloadProposals()
    }
  })

  const statusMap = useMemo(
    () => new Map<string, Status>((statuses.data ?? []).map((s) => [s.key, s])),
    [statuses.data]
  )

  const runGroups = useMemo(() => {
    const cards = proposals.data
    if (!cards) return []
    const visible =
      selectedRunId == null ? cards : cards.filter((c) => c.proposal.runId === selectedRunId)
    return buildRunGroups(visible)
  }, [proposals.data, selectedRunId])

  const pendingTotal = proposals.data?.length ?? 0

  const setBusy = useCallback((keys: string[], action: PendingAction): void => {
    setBusyKeys((prev) => {
      const next = new Map(prev)
      for (const k of keys) {
        if (action) next.set(k, action)
        else next.delete(k)
      }
      return next
    })
  }, [])

  const decide = useCallback(
    async (keys: string[], proposalIds: number[], accept: boolean): Promise<void> => {
      if (proposalIds.length === 0) return
      setBusy(keys, accept ? 'accept' : 'reject')
      try {
        const results = accept
          ? await window.recruit.acceptProposals(proposalIds)
          : await window.recruit.rejectProposals(proposalIds)

        // The applier runs each proposal in its own savepoint, so a batch can partly fail.
        const failures = results.map((r) => r.error).filter((e): e is string => Boolean(e))
        setGroupErrors((prev) => {
          const next = new Map(prev)
          for (const k of keys) {
            if (failures.length) next.set(k, failures.join(' · '))
            else next.delete(k)
          }
          return next
        })
      } catch (e) {
        setGroupErrors((prev) => {
          const next = new Map(prev)
          for (const k of keys) next.set(k, errorMessage(e))
          return next
        })
      } finally {
        setBusy(keys, null)
        // Main is the authority on what is still pending once refs and supersedes resolve.
        reloadProposals()
        reloadRuns()
      }
    },
    [reloadProposals, reloadRuns, setBusy]
  )

  const acceptGroup = useCallback(
    (g: ProposalGroup) => void decide([g.key], g.proposalIds, true),
    [decide]
  )
  const rejectGroup = useCallback(
    (g: ProposalGroup) => void decide([g.key], g.proposalIds, false),
    [decide]
  )
  const openUrl = useCallback((url: string) => {
    void window.recruit.openExternal(url).catch(() => undefined)
  }, [])

  /* ── body ──────────────────────────────────────────────────────────────── */

  const lastRun = runs.data?.[0] ?? null
  const lastRunFailed = Boolean(lastRun?.isError) && lastRun?.errorKind !== 'stopped'

  let body: JSX.Element
  if (proposals.loading && proposals.data === null) {
    body = <LoadingState label="Loading proposals…" />
  } else if (runGroups.length === 0 && selectedRunId != null) {
    body = (
      <EmptyState
        icon="review"
        title="Nothing pending from that run"
        message="Its proposals have all been decided."
        actions={
          <Button variant="outline" size="sm" onClick={() => setSelectedRunId(null)}>
            Show all runs
          </Button>
        }
      />
    )
  } else if (runGroups.length === 0) {
    body = (
      <EmptyState
        icon={lastRunFailed ? 'alert' : pendingTotal === 0 && runs.data?.length ? 'checkCircle' : 'review'}
        title={
          lastRunFailed
            ? 'The last run didn’t finish'
            : runs.data?.length
              ? 'Review queue is clear'
              : 'Nothing to review yet'
        }
        message={
          lastRunFailed
            ? 'That’s why there’s nothing here — fix the problem above, then run another scan.'
            : runs.data?.length
              ? 'Every proposal has been decided. New ones appear here after the next run.'
              : 'Run a scan and the agent’s proposed changes queue up here for your approval.'
        }
        actions={
          onRequestRun ? (
            <Button variant="outline" size="sm" icon="play" onClick={onRequestRun}>
              Run a scan
            </Button>
          ) : undefined
        }
      />
    )
  } else {
    body = (
      <div className="rq-list">
        {runGroups.map((run) => {
          const runKeys = run.groups.map((g) => g.key)
          const runBusy = runKeys.some((k) => busyKeys.get(k) === 'accept')
          const duration = formatDuration(run.run.durationMs)
          const cost = formatCost(run.run.costUsd)
          return (
            <section className="rq-run-section" key={run.runId}>
              <header className="rq-run-head">
                <h2 className="rq-run-title">
                  {run.run.kind === 'enrich' ? 'Enrich run' : 'Triage run'}
                  <span className="rq-run-id tertiary"> #{run.runId}</span>
                </h2>
                <span className="rq-run-facts tertiary tabular">
                  {formatRelative(run.run.startedAt)}
                  {run.run.model ? ` · ${run.run.model}` : ''}
                  {duration ? ` · ${duration}` : ''}
                  {cost ? ` · ${cost}` : ''}
                </span>
                <span className="rq-spacer" />
                <Badge>{run.groups.length}</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  icon="check"
                  busy={runBusy}
                  onClick={() => void decide(runKeys, run.proposalIds, true)}
                  title={`Accept all ${pluralize(run.proposalIds.length, 'proposal')} from this run`}
                >
                  Accept all
                </Button>
              </header>

              {run.groups.map((group) => (
                <ProposalGroupCard
                  key={group.key}
                  group={group}
                  statuses={statusMap}
                  busy={busyKeys.get(group.key) ?? null}
                  error={groupErrors.get(group.key) ?? null}
                  onAccept={acceptGroup}
                  onReject={rejectGroup}
                  onOpenMessage={onOpenMessage}
                  onOpenItem={onOpenItem}
                  onOpenUrl={openUrl}
                />
              ))}
            </section>
          )
        })}
      </div>
    )
  }

  return (
    <Pane kind="detail">
      <ErrorBanner error={proposals.error} onRetry={reloadProposals} />

      <PaneHeader
        title="Review"
        actions={
          <Button
            variant="subtle"
            size="sm"
            icon="refresh"
            busy={proposals.loading && proposals.data !== null}
            onClick={() => {
              reloadProposals()
              reloadRuns()
            }}
          >
            Refresh
          </Button>
        }
      >
        {pendingTotal > 0 ? <Badge tone="accent">{pendingTotal}</Badge> : null}
      </PaneHeader>

      <RunHistoryStrip
        runs={runs.data ?? []}
        selectedRunId={selectedRunId}
        onSelect={setSelectedRunId}
      />

      <PaneBody padded>{body}</PaneBody>
    </Pane>
  )
}

export default ReviewQueue
