/**
 * Registry view for NavKey 'candidates'. App.tsx's VIEWS map expects exactly this shape:
 *   candidates -> src/renderer/views/Mail/CandidatesView.tsx
 */

import type { ViewProps } from '@renderer/App'
import { MailView } from './MailView'

export default function CandidatesView({
  navigate,
  focus,
  focusNonce,
  refreshCounts
}: ViewProps): JSX.Element {
  return (
    <MailView
      mode="candidates"
      onModeChange={navigate}
      onCountsChanged={refreshCounts}
      onOpenItem={(itemId) => navigate('board', { item: itemId })}
      focusMessageId={focus?.kind === 'message' ? focus.id : null}
      focusNonce={focusNonce}
    />
  )
}
