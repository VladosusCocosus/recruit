/**
 * One application, one card.
 *
 * The card used to be one *proposal*, which meant a run that moved Northwind Labs to
 * Interviewing and booked the interview produced two cards, side by side, carrying the
 * same company, the same role, the same status badge, the same source email and two
 * Accept buttons. The reviewer's question is never "do I accept proposal #1205", it is
 * "what does the agent think happened at Northwind Labs, and is it right" — so that is
 * what a card answers now.
 *
 * Each change is a row you can untick. Accept and Reject act on the ticked rows and say
 * how many they will take, so a card where the status is right and the meeting time is
 * wrong no longer forces an all-or-nothing answer. Rows the agent tied together with a
 * `ref` are the exception and carry no tick: the applier resolves the ref at accept time,
 * so accepting the event without the item that anchors it is not a thing the user should
 * be able to express.
 *
 * What is unticked is not rejected. It stays pending and comes back on the next read,
 * which is why the buttons count rather than just saying Accept.
 */

import { useMemo, useState } from 'react'
import { Button, Icon, StatusBadge, pluralize } from '@renderer/components'
import type { JSX } from 'react'
import type { Item, MessageSummary, Status } from '@shared/types'
import type { DescribeContext, ProposalGroup } from './format'
import { ProposalDiff } from './ProposalDiff'
import { SourceMessages } from './SourceMessages'
import { Confidence } from './Confidence'

/** Which decision is in flight, so the spinner lands on the button the user pressed. */
export type PendingAction = 'accept' | 'reject' | null

interface Props {
  group: ProposalGroup
  statuses: Map<string, Status>
  busy: PendingAction
  error: string | null
  onAccept: (group: ProposalGroup, proposalIds: number[]) => void
  onReject: (group: ProposalGroup, proposalIds: number[]) => void
  onOpenMessage?: (messageId: number) => void
  onOpenItem?: (itemId: number) => void
  onOpenUrl?: (url: string) => void
}

function itemLabel(item: Item): string {
  return item.role ? `${item.company} · ${item.role}` : item.company
}

export function ProposalGroupCard({
  group,
  statuses,
  busy,
  error,
  onAccept,
  onReject,
  onOpenMessage,
  onOpenItem,
  onOpenUrl
}: Props): JSX.Element {
  const messageMap = useMemo(
    () => new Map<number, MessageSummary>(group.messages.map((m) => [m.id, m])),
    [group.messages]
  )

  // Everything starts ticked, so the common answer stays one click. A locked group has no
  // ticks at all and always acts on the whole set, including siblings off this page.
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set())
  const selectedIds = group.locked
    ? group.proposalIds
    : group.proposalIds.filter((id) => !skipped.has(id))

  const toggle = (proposalId: number, checked: boolean): void =>
    setSkipped((prev) => {
      const next = new Set(prev)
      if (checked) next.delete(proposalId)
      else next.add(proposalId)
      return next
    })

  const total = group.proposalIds.length
  const missingSiblings = total - group.cards.length
  const targetItem = group.item
  const isBusy = busy !== null
  const partial = selectedIds.length !== total
  const none = selectedIds.length === 0

  /** "Accept" alone when it takes everything; a count the moment it would not. */
  const verbLabel = (verb: string): string =>
    partial ? `${verb} ${selectedIds.length} of ${total}` : verb

  const name = group.creation
    ? group.creation.role
      ? `${group.creation.company} · ${group.creation.role}`
      : group.creation.company
    : targetItem
      ? itemLabel(targetItem)
      : 'Unknown application'

  return (
    <section className={'rq-card' + (isBusy ? ' is-busy' : '')}>
      <header className="rq-card-head">
        {group.creation ? (
          <span className="rq-target">
            <span className="rq-target-name truncate selectable">{name}</span>
            <span className="rq-new-tag">New</span>
          </span>
        ) : targetItem && onOpenItem ? (
          <button
            type="button"
            className="rq-target is-clickable"
            onClick={() => onOpenItem(targetItem.id)}
            title="Open in Tracker"
          >
            <span className="rq-target-name truncate">{name}</span>
          </button>
        ) : (
          <span className="rq-target">
            <span className="rq-target-name truncate selectable">{name}</span>
          </span>
        )}

        {targetItem ? (
          <StatusBadge
            status={statuses.get(targetItem.statusKey) ?? null}
            statusKey={targetItem.statusKey}
          />
        ) : null}

        <span className="rq-spacer" />
        {/* The weakest link, and only when there is more than one row — on a single-change
            card the row below is already showing the same figure. */}
        {group.cards.length > 1 ? <Confidence value={group.confidence} summary /> : null}
      </header>

      <div className="rq-changes">
        {group.cards.map((card) => (
          <ProposalDiff
            key={card.proposal.id}
            proposal={card.proposal}
            ctx={{
              item: card.item,
              statuses,
              refCreate: group.creation,
              messages: messageMap
            }}
            checked={!skipped.has(card.proposal.id)}
            {...(group.locked ? {} : { onToggle: toggle })}
            disabled={isBusy}
            onOpenUrl={onOpenUrl}
          />
        ))}
        {missingSiblings > 0 ? (
          <p className="rq-more-siblings">
            + {pluralize(missingSiblings, 'more change')} in this group, applied with it.
          </p>
        ) : null}
      </div>

      <SourceMessages messages={group.messages} onOpenMessage={onOpenMessage} />

      {error ? (
        <div className="rq-card-error" role="alert">
          <Icon name="alert" size={13} />
          <span className="selectable">{error}</span>
        </div>
      ) : null}

      <footer className="rq-card-foot">
        <Button
          variant="primary"
          size="sm"
          icon="check"
          busy={busy === 'accept'}
          disabled={isBusy || none}
          onClick={() => onAccept(group, selectedIds)}
        >
          {verbLabel('Accept')}
        </Button>
        <Button
          variant="subtle"
          size="sm"
          icon="x"
          busy={busy === 'reject'}
          disabled={isBusy || none}
          onClick={() => onReject(group, selectedIds)}
        >
          {verbLabel('Reject')}
        </Button>
        <span className="rq-spacer" />
        {/* Provenance, quietly. It replaced "proposal #1205", which is an id the user has
            no way to use and no reason to read. */}
        <span className="rq-card-source tertiary">
          {group.locked ? `${pluralize(total, 'change')} · ` : ''}
          {group.run.kind === 'enrich' ? 'enrich' : 'triage'} run
        </span>
      </footer>
    </section>
  )
}
