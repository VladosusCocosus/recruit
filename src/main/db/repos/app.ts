/** Composed reads that span repos: the rail badges and the first-run checklist. */
import type { AppCounts, SetupState } from '@shared/types'
import { count } from '../connection'
import { countAccounts } from './accounts'
import { countCandidates, countMessages, countUnread } from './messages'
import { countItems } from './items'
import { countPendingProposals } from './proposals'
import { countRuns } from './runs'
import { countUpcomingEvents } from './timeline'

export function getAppCounts(): AppCounts {
  return {
    candidates: countCandidates(),
    pendingProposals: countPendingProposals(),
    unreadInbox: countUnread(),
    upcomingEvents: countUpcomingEvents(),
    items: countItems()
  }
}

/** add account -> sync -> first scan -> review. */
export function getSetupState(): SetupState {
  const hasAccount = countAccounts() > 0
  const hasSynced = countMessages() > 0
  const hasRun = countRuns() > 0
  const hasReviewed = count("SELECT count(*) FROM proposals WHERE state <> 'pending'") > 0
  return {
    hasAccount,
    hasSynced,
    hasRun,
    hasReviewed,
    complete: hasAccount && hasSynced && hasRun && hasReviewed
  }
}
