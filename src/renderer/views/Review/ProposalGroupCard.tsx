import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Icon,
  StatusBadge,
  pluralize
} from '@renderer/components'
import type { Item, MessageSummary, Status } from '@shared/types'
import type { DescribeContext, ProposalGroup } from './format'
import { ProposalDiff } from './ProposalDiff'
import { SourceMessages } from './SourceMessages'
import { ConfidenceMeter } from './ConfidenceMeter'

/** Which decision is in flight, so the spinner lands on the button the user pressed. */
export type PendingAction = 'accept' | 'reject' | null

interface Props {
  group: ProposalGroup
  statuses: Map<string, Status>
  busy: PendingAction
  error: string | null
  onAccept: (group: ProposalGroup) => void
  onReject: (group: ProposalGroup) => void
  onOpenMessage?: (messageId: number) => void
  onOpenItem?: (itemId: number) => void
  onOpenUrl?: (url: string) => void
}

function itemLabel(item: Item): string {
  return item.role ? `${item.company} · ${item.role}` : item.company
}

/**
 * One decide-together unit.
 *
 * Proposals sharing a `ref` are one intent — "there is a new application here, it is at
 * Applied, and the first interview is on Thursday". The applier resolves the ref at accept
 * time, so accepting the event without the item that anchors it is not a thing the user
 * should be able to express. Hence one Accept and one Reject per group, not per proposal.
 */
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
  const messageMap = new Map<number, MessageSummary>(group.messages.map((m) => [m.id, m]))
  const total = group.proposalIds.length
  const missingSiblings = total - group.cards.length
  const targetItem = group.item
  const isBusy = busy !== null

  const header = group.creation ? (
    <span className="rq-target is-new">
      <span className="rq-target-icon">
        <Icon name="plus" size={12} />
      </span>
      <span className="rq-target-name truncate selectable">
        {group.creation.role
          ? `${group.creation.company} · ${group.creation.role}`
          : group.creation.company}
      </span>
      <span className="rq-new-tag">new</span>
    </span>
  ) : targetItem ? (
    onOpenItem ? (
      <button
        type="button"
        className="rq-target is-clickable"
        onClick={() => onOpenItem(targetItem.id)}
        title="Open in Tracker"
      >
        <span className="rq-target-name truncate">{itemLabel(targetItem)}</span>
      </button>
    ) : (
      <span className="rq-target">
        <span className="rq-target-name truncate selectable">{itemLabel(targetItem)}</span>
      </span>
    )
  ) : null

  return (
    <Card className={`rq-card${isBusy ? ' is-busy' : ''}`}>
      <CardHeader>
        {header}
        {targetItem ? (
          <StatusBadge status={statuses.get(targetItem.statusKey) ?? null} statusKey={targetItem.statusKey} />
        ) : null}
        <span className="rq-spacer" />
        {group.isBundle ? (
          <span className="rq-bundle-tag" title={`Proposal group ${group.ref ?? ''}`}>
            bundle · {pluralize(total, 'change')}
          </span>
        ) : null}
        <ConfidenceMeter value={group.confidence} label={group.isBundle ? 'Lowest' : 'Confidence'} />
      </CardHeader>

      <CardBody>
        <div className="rq-card-stack">
          {group.isBundle ? (
            <p className="rq-bundle-note">
              These {pluralize(total, 'change')} describe one application and are accepted together —
              the new item has to exist before anything can attach to it.
            </p>
          ) : null}

          <div className="rq-diffs">
            {group.cards.map((card) => {
              const ctx: DescribeContext = {
                item: card.item,
                statuses,
                refCreate: group.creation,
                messages: messageMap
              }
              return (
                <ProposalDiff
                  key={card.proposal.id}
                  proposal={card.proposal}
                  ctx={ctx}
                  showConfidence={group.cards.length > 1}
                  onOpenUrl={onOpenUrl}
                />
              )
            })}
            {missingSiblings > 0 ? (
              <p className="rq-more-siblings">
                + {pluralize(missingSiblings, 'more change')} in this group, applied with it.
              </p>
            ) : null}
          </div>

          <SourceMessages messages={group.messages} onOpenMessage={onOpenMessage} />
        </div>
      </CardBody>

      {error ? (
        <div className="rq-card-error" role="alert">
          <Icon name="alert" size={13} />
          <span className="selectable">{error}</span>
        </div>
      ) : null}

      <CardFooter>
        <Button
          variant="primary"
          size="sm"
          icon="check"
          busy={busy === 'accept'}
          disabled={isBusy}
          onClick={() => onAccept(group)}
        >
          Accept
        </Button>
        <Button
          variant="subtle"
          size="sm"
          icon="x"
          busy={busy === 'reject'}
          disabled={isBusy}
          onClick={() => onReject(group)}
        >
          Reject
        </Button>
        <span className="rq-spacer" />
        <span className="rq-card-meta tertiary">
          {group.isBundle
            ? pluralize(total, 'proposal')
            : group.cards[0]
              ? `proposal #${group.cards[0].proposal.id}`
              : null}
        </span>
      </CardFooter>
    </Card>
  )
}
