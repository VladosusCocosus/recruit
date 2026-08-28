/**
 * Tracker views — public surface for the app shell.
 *
 *   BoardView   default export, rail key 'board' — Board / List + the detail pane.
 *
 * "Up next" is a separate view, owned by src/renderer/views/UpNext.
 * Importing this barrel pulls in the Tracker stylesheet, so the shell needs no CSS import.
 */

import './tracker.css'

export { default as BoardView } from './BoardView'

export { TrackerView, type TrackerMode } from './TrackerView'
export { Board } from './Board'
export { ItemList } from './ItemList'
export { ItemDetail } from './ItemDetail'
export { ItemCard, ITEM_DRAG_TYPE } from './ItemCard'
export { Timeline } from './Timeline'
export { Description } from './Description'
export { Markdown } from './Markdown'
export { StatusSelect, closeReasonLabel, CLOSE_REASONS } from './StatusSelect'
export { AddEntry, type NewEntry } from './AddEntry'

export {
  useTracker,
  useItemDetail,
  useNow,
  type StatusIndex,
  type TrackerStore,
  type ItemDetailStore
} from './useTracker'

export {
  STALE_AFTER_DAYS,
  eventWhen,
  eventTime,
  isFutureEvent,
  isAllDay,
  formatAllDayRange,
  staleness,
  lastContactAt,
  lastMessageAt,
  toLocalInputValue,
  fromLocalInputValue
} from './format'
