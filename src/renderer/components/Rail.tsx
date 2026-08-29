import type { AppCounts, NavKey } from '@shared/types'
import { Icon, type IconName } from './Icon'
import { CountBadge } from './Badge'

/**
 * Left rail: the app's only permanent surface, so it answers two questions at once —
 * where you are, and what is waiting.
 *
 * Those two answers get different voices. A number that means "N decisions are queued for
 * you" is a filled pill; a number that is merely informational is a plain tally, the way
 * Mail sets unread counts in its sidebar. Making every count a pill would let the inbox
 * shout as loudly as the review queue, which is the one thing here that actually blocks.
 *
 * Full height — the traffic lights sit over its top strip, so `.rail-titlebar` reserves
 * that space and is the window's drag handle.
 */

interface RailItemSpec {
  key: NavKey
  label: string
  icon: IconName
  /** Which AppCounts field feeds the number, if any. */
  count?: keyof AppCounts
  /** 'queue' — things waiting on you, rendered as a filled pill. Default is a plain tally. */
  emphasis?: 'queue'
}

interface RailSectionSpec {
  label: string
  items: RailItemSpec[]
}

export const RAIL_SECTIONS: readonly RailSectionSpec[] = [
  {
    label: 'Mail',
    items: [
      { key: 'inbox', label: 'Inbox', icon: 'inbox', count: 'unreadInbox' },
      { key: 'candidates', label: 'Candidates', icon: 'target', count: 'candidates' }
    ]
  },
  {
    label: 'Tracker',
    items: [
      { key: 'board', label: 'Board', icon: 'board' },
      { key: 'review', label: 'Review', icon: 'review', count: 'pendingProposals', emphasis: 'queue' },
      { key: 'upnext', label: 'Up next', icon: 'calendar', count: 'eventsSoon' }
    ]
  }
]

export interface RailProps {
  active: NavKey
  counts: AppCounts
  onNavigate: (key: NavKey) => void
}

export function Rail({ active, counts, onNavigate }: RailProps): JSX.Element {
  const renderItem = (item: RailItemSpec): JSX.Element => (
    <RailItem
      key={item.key}
      spec={item}
      active={active === item.key}
      count={item.count ? counts[item.count] : 0}
      onNavigate={onNavigate}
    />
  )

  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-titlebar" />
      <div className="rail-scroll">
        {RAIL_SECTIONS.map((section) => (
          <div className="rail-section" key={section.label}>
            <div className="rail-section-label">{section.label}</div>
            {section.items.map(renderItem)}
          </div>
        ))}
      </div>
      <div className="rail-footer">
        {renderItem({ key: 'settings', label: 'Settings', icon: 'gear' })}
      </div>
    </nav>
  )
}

/** What the number means, spelled out for screen readers and for the tooltip. */
const COUNT_LABEL: Partial<Record<keyof AppCounts, (n: number) => string>> = {
  unreadInbox: (n) => `${n} unread`,
  candidates: (n) => `${n} to scan`,
  pendingProposals: (n) => `${n} waiting for review`,
  eventsSoon: (n) => `${n} in the next 24 hours`
}

function RailItem({
  spec,
  active,
  count,
  onNavigate
}: {
  spec: RailItemSpec
  active: boolean
  count: number
  onNavigate: (key: NavKey) => void
}): JSX.Element {
  const hint = spec.count && count > 0 ? COUNT_LABEL[spec.count]?.(count) : undefined

  return (
    <button
      type="button"
      className={'rail-item' + (active ? ' is-active' : '')}
      aria-current={active ? 'page' : undefined}
      /* The bare number is meaningless read aloud, so the label spells out what it counts.
         It replaces the visible text rather than adding to it — appending would announce
         the figure twice, once as a digit and once inside the phrase. */
      aria-label={hint ? `${spec.label}, ${hint}` : undefined}
      title={hint}
      onClick={() => onNavigate(spec.key)}
    >
      <span className="rail-item-icon">
        <Icon name={spec.icon} size={15} />
      </span>
      <span className="rail-item-label">{spec.label}</span>
      {spec.emphasis === 'queue' ? (
        <CountBadge count={count} tone="accent" max={99} />
      ) : count > 0 ? (
        <span className="rail-item-tally tabular">{count > 999 ? '999+' : count}</span>
      ) : null}
    </button>
  )
}
