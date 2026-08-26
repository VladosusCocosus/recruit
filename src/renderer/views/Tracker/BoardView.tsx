/**
 * Registry entry for the shell's `board` route (see the VIEW REGISTRY note in App.tsx).
 *
 *   import BoardView from './views/Tracker/BoardView'
 *   const VIEWS = { ..., board: BoardView }
 */

import type { JSX } from 'react'
import type { ViewProps } from '../../App'
import { TrackerView } from './TrackerView'
import './tracker.css'

export default function BoardView({ navigate }: ViewProps): JSX.Element {
  // Opening a linked message hands off to the mail view; the shell owns that route.
  return <TrackerView onOpenMessage={() => navigate('inbox')} />
}
