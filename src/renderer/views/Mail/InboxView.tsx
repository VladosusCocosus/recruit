/**
 * Registry view for NavKey 'inbox'. App.tsx's VIEWS map expects exactly this shape:
 *   inbox -> src/renderer/views/Mail/InboxView.tsx
 */

import type { ViewProps } from '@renderer/App'
import { MailView } from './MailView'

export default function InboxView({
  navigate,
  focus,
  focusNonce,
  refreshCounts
}: ViewProps): JSX.Element {
  return (
    <MailView
      mode="inbox"
      // The list's own segmented control drives the rail, so the two never disagree.
      onModeChange={navigate}
      onCountsChanged={refreshCounts}
      onOpenItem={(itemId) => navigate('board', { item: itemId })}
      focusMessageId={focus?.kind === 'message' ? focus.id : null}
      focusNonce={focusNonce}
    />
  )
}
