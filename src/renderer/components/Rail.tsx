import type { AppCounts, NavKey } from '@shared/types'
import { Icon, type IconName } from './Icon'
import { CountBadge, type BadgeTone } from './Badge'

/**
 * Left rail, 132px. Full height — the traffic lights sit over its top strip, so
 * `.rail-titlebar` reserves that space and is the window's drag handle.
 */

interface RailItemSpec {
  key: NavKey
  label: string
  icon: IconName
  /** Which AppCounts field feeds the badge, if any. */
  count?: keyof AppCounts
  tone?: BadgeTone
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
      { key: 'review', label: 'Review', icon: 'review', count: 'pendingProposals', tone: 'accent' },
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
  return (
    <button
      type="button"
      className={'rail-item' + (active ? ' is-active' : '')}
      aria-current={active ? 'page' : undefined}
      onClick={() => onNavigate(spec.key)}
    >
      <span className="rail-item-icon">
        <Icon name={spec.icon} size={14} />
      </span>
      <span className="rail-item-label">{spec.label}</span>
      <CountBadge count={count} tone={spec.tone ?? 'neutral'} max={99} />
    </button>
  )
}
