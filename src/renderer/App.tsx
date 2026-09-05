// FIRST import, deliberately. ESM evaluates imports in declaration order, so this
// puts the design-system stylesheet ahead of every view stylesheet pulled in below.
// Base classes (.input, .btn, .list-row…) and view overrides (.mail-search-input…)
// have equal specificity, so the cascade is decided purely by source order — and a
// view must be able to override the base, not the other way round. main.tsx also
// imports this file; that import is a no-op once this one has run.
import './index.css'

import { useCallback } from 'react'
import {
  AGENT_ENGINE_LABEL,
  type AppCounts,
  type NavKey,
  type PendingDebrief,
  type SyncStatus
} from '@shared/types'
import type { Navigate, RouteTarget } from '@renderer/components'
import {
  AgentErrorBanner,
  EmptyState,
  ErrorBanner,
  UpdateBanner,
  IconButton,
  LoadingState,
  Rail,
  RunButton,
  Spinner,
  Toolbar,
  ToolbarSpacer,
  formatRelative,
  hasBridge,
  useAccounts,
  useAppInfo,
  useCounts,
  useHashRoute,
  useRun,
  useSetupState,
  useSettings,
  useUpdate,
  useSync,
  useTheme
} from '@renderer/components'
import SettingsView from './views/Settings'
import OnboardingView, { SetupChecklist } from './views/Onboarding/OnboardingView'
import InboxView from './views/Mail/InboxView'
import CandidatesView from './views/Mail/CandidatesView'
import BoardView from './views/Tracker/BoardView'
import ReviewView from './views/Review/ReviewView'
import UpNextView from './views/UpNext/UpNextView'
import { DebriefModal, useDebriefs } from './views/Debrief'

/* ════════════════════════════════════════════════════════════════════════════
   VIEW REGISTRY

   One component per rail destination. Each receives `ViewProps` and renders its
   own <SplitView>/<Pane> tree, and each imports its own stylesheet, so adding a
   destination means adding a NavKey and one line below — nothing else.

   Views import `ViewProps` from this file as a *type-only* import, so the cycle
   is erased at compile time and there is no runtime import loop.
   ════════════════════════════════════════════════════════════════════════════ */

export interface ViewProps {
  /**
   * Switch top-level views, optionally deep-linking one row:
   * `navigate('inbox', { message: 12 })`. Updates the hash, so back/forward keep working.
   */
  navigate: Navigate
  /**
   * What the hash points at, if anything. A view honours a target of its own kind and
   * ignores the rest — `focusNonce` says when, so re-following the same link still lands.
   */
  focus: RouteTarget | null
  focusNonce: number
  counts: AppCounts
  /** Force a badge refresh. Counts also self-refresh on main's change events. */
  refreshCounts: () => void
  /** Calls that have finished and still owe a debrief. Only Up next renders them. */
  pendingDebriefs: PendingDebrief[]
  openDebrief: (eventId: number) => void
}

type ViewComponent = (props: ViewProps) => JSX.Element

const VIEWS: Record<Exclude<NavKey, 'settings'>, ViewComponent> = {
  inbox: InboxView,
  candidates: CandidatesView,
  board: BoardView,
  review: ReviewView,
  upnext: UpNextView
}

/* ════════════════════════════════════════════════════════════════════════════ */

export default function App(): JSX.Element {
  if (!hasBridge()) {
    return (
      <div className="app-shell">
        <div className="app-main">
          <EmptyState
            icon="alert"
            title="Recruit couldn't start"
            message="The preload bridge was never exposed, so the interface has no way to reach the main process. Quit and reopen the app."
          />
        </div>
      </div>
    )
  }
  return <Shell />
}

function Shell(): JSX.Element {
  const [route, navigate] = useHashRoute('inbox')
  const nav = route.nav
  const settings = useSettings()
  const update = useUpdate()
  const { counts, reload: refreshCounts } = useCounts()
  const setup = useSetupState()
  const sync = useSync()
  const run = useRun()
  const accounts = useAccounts()
  const appInfo = useAppInfo()
  const debriefs = useDebriefs()

  useTheme(settings.settings?.theme)

  const account = accounts.data?.[0] ?? null
  const agentCliMissing = appInfo.data ? !appInfo.data.agentCliAvailable : false
  const agentCliMissingReason = appInfo.data
    ? `${AGENT_ENGINE_LABEL[appInfo.data.agentEngine]} isn't installed`
    : null

  const startRun = useCallback(() => void run.start({ kind: 'triage' }), [run])
  const syncNow = useCallback(() => void sync.syncNow(), [sync])

  const setupActions = {
    onNavigate: navigate,
    onSync: syncNow,
    onRun: startRun,
    syncing: sync.busy,
    running: run.active !== null,
    runDisabledReason: agentCliMissing
      ? agentCliMissingReason
      : counts.candidates === 0
        ? 'No candidate messages yet'
        : null
  }

  // No account at all: setup IS the app, everything except Settings gives way.
  const showOnboarding =
    setup.data !== null && !setup.data.hasAccount && nav !== 'settings'

  const showChecklist =
    setup.data !== null &&
    !setup.data.complete &&
    setup.data.hasAccount &&
    settings.settings?.setupDismissed !== true &&
    nav !== 'settings'

  const View = nav === 'settings' ? null : VIEWS[nav]

  return (
    <div className="app-shell">
      <Rail active={nav} counts={counts} onNavigate={navigate} />

      <div className="app-main">
        <Toolbar>
          <AccountStatus
            email={account?.email ?? null}
            sync={sync.status}
            busy={sync.busy}
            onAdd={() => navigate('settings')}
          />
          {account ? (
            sync.busy ? (
              <IconButton icon="x" label="Stop syncing" onClick={() => void sync.cancel()} />
            ) : (
              <IconButton icon="refresh" label="Sync now" onClick={syncNow} />
            )
          ) : null}

          <ToolbarSpacer />

          {/* The signature control. Idle and live are the same element. */}
          <RunButton
            active={run.active}
            candidateCount={counts.candidates}
            elapsedMs={run.elapsedMs}
            onStart={startRun}
            onStop={() => void run.stop()}
            disabledReason={agentCliMissing ? agentCliMissingReason : null}
          />
        </Toolbar>

        <div className="app-body">
          {/* First-class states, in priority order. Never toasts. */}
          <AgentErrorBanner
            kind={run.active ? null : run.last?.errorKind ?? null}
            message={run.last?.errorText ?? null}
            onRetry={startRun}
            onOpenSettings={() => navigate('settings')}
            onDismiss={run.clearLast}
          />
          <ErrorBanner error={run.error} onDismiss={run.clearLast} />
          {update.status && !update.dismissed ? (
            <UpdateBanner
              status={update.status}
              onDownload={update.download}
              onDismiss={update.dismiss}
            />
          ) : null}
          {sync.status.phase === 'error' ? (
            <ErrorBanner error={sync.error} onRetry={syncNow} />
          ) : null}

          {showOnboarding ? (
            <OnboardingView setup={setup.data!} {...setupActions} />
          ) : (
            <>
              {showChecklist ? (
                <SetupChecklist
                  setup={setup.data!}
                  {...setupActions}
                  onDismiss={() => void settings.update({ setupDismissed: true })}
                />
              ) : null}

              {nav === 'settings' ? (
                <SettingsView
                  settings={settings.settings}
                  onUpdateSettings={settings.update}
                  onAccountsChanged={() => {
                    accounts.reload()
                    setup.reload()
                    refreshCounts()
                  }}
                />
              ) : View ? (
                <View
                  navigate={navigate}
                  focus={route.target}
                  focusNonce={route.nonce}
                  counts={counts}
                  refreshCounts={refreshCounts}
                  pendingDebriefs={debriefs.pending}
                  openDebrief={debriefs.open}
                />
              ) : (
                <LoadingState />
              )}
            </>
          )}
        </div>
      </div>

      {/* Outside .app-body, so switching views does not unmount an open debrief. */}
      {debriefs.active ? (
        <DebriefModal
          call={debriefs.active}
          onSave={debriefs.save}
          onSnooze={debriefs.snooze}
          onSkip={debriefs.skip}
          onClose={debriefs.close}
        />
      ) : null}
    </div>
  )
}

/* ── toolbar: account + sync ─────────────────────────────────────────────── */

function syncLabel(status: SyncStatus): string {
  switch (status.phase) {
    case 'connecting':
      return 'Connecting…'
    case 'listing':
      return 'Checking for mail…'
    case 'fetching':
      return status.total > 0
        ? `Fetching ${status.processed} of ${status.total}`
        : 'Fetching…'
    case 'parsing':
      return 'Reading messages…'
    case 'prefiltering':
      return 'Scoring…'
    case 'error':
      return status.error ?? 'Sync failed'
    case 'idle':
    case 'done':
    default:
      return status.lastSyncAt ? `Updated ${formatRelative(status.lastSyncAt)}` : 'Not synced yet'
  }
}

function AccountStatus({
  email,
  sync,
  busy,
  onAdd
}: {
  email: string | null
  sync: SyncStatus
  busy: boolean
  onAdd: () => void
}): JSX.Element {
  if (!email) {
    return (
      <div className="toolbar-account">
        <span className="toolbar-account-email secondary">No account</span>
        <button type="button" className="btn is-subtle is-sm" onClick={onAdd} style={{ padding: 0 }}>
          Add one in Settings
        </button>
      </div>
    )
  }
  return (
    <div className="toolbar-account">
      <span className="toolbar-account-email" title={email}>
        {email}
      </span>
      <span className={'toolbar-sync' + (sync.phase === 'error' ? ' is-error' : '')}>
        {busy ? <Spinner size={9} label="" /> : null}
        <span className="truncate">{syncLabel(sync)}</span>
      </span>
    </div>
  )
}
