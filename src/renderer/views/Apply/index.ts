/**
 * The apply flow — public surface for the app shell.
 *
 *   useApply()    the store: job input, resume, the tailor run, the review.
 *   <ApplyModal>  the two screens. Mount it beside <DebriefModal>, outside .app-body,
 *                 so switching views cannot unmount a run in flight.
 *
 * There is no rail destination and no NavKey: applying is an action, not a place.
 * Importing this barrel pulls in the Apply stylesheet.
 */

export { ApplyModal } from './ApplyModal'
export { ChangeList } from './ChangeList'
export { ReviewScreen } from './ReviewScreen'
export { useApply, isJobUrl } from './useApply'
export type { ApplyFields, ApplyPhase, ApplyScreen, ApplyStore } from './useApply'
