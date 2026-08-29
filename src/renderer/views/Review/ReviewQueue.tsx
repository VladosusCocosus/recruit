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
import type { JSX } from 'react'
import type { AgentRunSummary, Status } from '@shared/types'
import { buildGroups, type ProposalGroup } from './format'
import { ProposalGroupCard, type PendingAction } from './ProposalGroupCard'
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
 * One card per application per run (see `buildGroups`), grouped under the run that
 * produced them. The run history strip that used to sit above all this is gone: it printed
 * the same six facts the run heading below it already printed, forty pixels apart, and its
 * one unique job — filtering to a single run — was scrolling with extra steps once the
 * list was already ordered by run.
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

  const groups = useMemo(() => buildGroups(proposals.data ?? []), [proposals.data])
  const pendingTotal = proposals.data?.length ?? 0

  /**
   * Bucket the flat list back into one section per run.
   *
   * Not just cosmetic grouping: the run heading is `position: sticky`, and a sticky
   * element only travels as far as its own containing block. With each heading sitting in
   * a wrapper alongside a single card, it would unstick the moment that first card
   * scrolled away — so the section that owns all of a run's cards has to be the parent.
   */
  const sections = useMemo(() => {
    const out: { runId: number; run: ProposalGroup['run']; groups: ProposalGroup[] }[] = []
    for (const group of groups) {
      const last = out[out.length - 1]
      if (last && last.runId === group.runId) last.groups.push(group)
      else out.push({ runId: group.runId, run: group.run, groups: [group] })
    }
    return out
  }, [groups])

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
    (g: ProposalGroup, ids: number[]) => void decide([g.key], ids, true),
    [decide]
  )
  const rejectGroup = useCallback(
    (g: ProposalGroup, ids: number[]) => void decide([g.key], ids, false),
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
  } else if (groups.length === 0) {
    body = (
      <EmptyState
        icon={lastRunFailed ? 'alert' : runs.data?.length ? 'checkCircle' : 'review'}
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
      <div className="rq-col">
        {sections.map((section) => (
          <section className="rq-run" key={section.runId}>
            <RunHeading
              run={section.run}
              count={section.groups.length}
              busy={section.groups.some((g) => busyKeys.has(g.key))}
              onAcceptAll={() =>
                void decide(
                  section.groups.map((g) => g.key),
                  section.groups.flatMap((g) => g.proposalIds),
                  true
                )
              }
            />

            {section.groups.map((group) => (
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
        ))}
      </div>
    )
  }

  return (
    <Pane kind="detail">
      <ErrorBanner error={proposals.error} onRetry={reloadProposals} />

      {/* No Refresh button: the queue reloads on proposalsChanged and on every run that
          ends, and the error banner owns the one case where a manual retry is the answer. */}
      <PaneHeader title="Review">
        {pendingTotal > 0 ? <Badge tone="accent">{pendingTotal}</Badge> : null}
      </PaneHeader>

      <PaneBody>{body}</PaneBody>
    </Pane>
  )
}

/**
 * Which scan produced the cards below, and the one bulk action worth having.
 *
 * The run id is deliberately not shown. It is a database key the user cannot act on; when
 * it mattered it was for telling two runs apart, and the time does that better.
 */
function RunHeading({
  run,
  count,
  busy,
  onAcceptAll
}: {
  run: AgentRunSummary
  count: number
  busy: boolean
  onAcceptAll: () => void
}): JSX.Element {
  // A run with no finish stamp is still working, and the set below it is still growing.
  // "Accept all" over a set that is not final is a blanket yes to proposals that have not
  // been written yet, so the bulk action waits for the run to land. The per-card Accept
  // stays available throughout: that one is a decision about a specific application the
  // user has actually read.
  const running = run.finishedAt === null

  const facts = [
    running ? 'running' : formatRelative(run.startedAt),
    run.model,
    formatDuration(run.durationMs),
    formatCost(run.costUsd)
  ].filter(Boolean)

  return (
    <div className="rq-run-head">
      <h2 className="rq-run-title">{run.kind === 'enrich' ? 'Enrich run' : 'Triage run'}</h2>
      <span className="rq-run-facts tertiary tabular">{facts.join(' · ')}</span>
      <span className="rq-spacer" />
      <Button
        variant="outline"
        size="sm"
        icon="check"
        busy={busy}
        disabled={running}
        onClick={onAcceptAll}
        title={
          running
            ? 'This run is still going — wait for it to finish before accepting everything'
            : `Accept every change from this run — ${pluralize(count, 'application')}`
        }
      >
        Accept all
      </Button>
    </div>
  )
}

export default ReviewQueue
