/** Composed reads that span repos: the rail badges and the first-run checklist. */
import type { AppCounts, SetupState } from '@shared/types'
import { count } from '../connection'
import { countAccounts } from './accounts'
import { countCandidates, countMessages, countUnread } from './messages'
import { countItems } from './items'
import { countPendingProposals } from './proposals'
import { countRuns } from './runs'
import { countEventsSoon, countPendingDebriefs } from './timeline'

export function getAppCounts(): AppCounts {
  return {
    candidates: countCandidates(),
    pendingProposals: countPendingProposals(),
    unreadInbox: countUnread(),
    eventsSoon: countEventsSoon(),
    pendingDebriefs: countPendingDebriefs(),
    items: countItems()
  }
}

/**
 * add account -> sync -> first scan -> review. The checklist's fifth step, the
 * notifications question, is a settings key rather than a table, so the IPC layer merges
 * it in — this repo only reports what the database can answer.
 */
export function getSetupState(): Omit<SetupState, 'notificationsAsked'> {
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
