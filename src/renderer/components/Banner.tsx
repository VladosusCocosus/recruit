import type { ReactNode } from 'react'
import {
  AGENT_ENGINE_BINARY,
  AGENT_ENGINE_LABEL,
  agentNotSignedInMessage,
  type AgentEngine,
  type AgentErrorKind,
  type UpdateStatus
} from '@shared/types'
import { Icon, type IconName } from './Icon'
import { Button, IconButton } from './Button'
import { useAppInfo } from './hooks'

export type BannerTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral'

const TONE_CLASS: Record<BannerTone, string> = {
  info: ' is-info',
  warning: ' is-warning',
  danger: ' is-danger',
  success: ' is-success',
  neutral: ''
}

const TONE_ICON: Record<BannerTone, IconName> = {
  info: 'info',
  warning: 'alert',
  danger: 'alert',
  success: 'checkCircle',
  neutral: 'info'
}

export interface BannerProps {
  tone?: BannerTone
  icon?: IconName
  title?: ReactNode
  children?: ReactNode
  /** Right-aligned actions. Usually one Button. */
  actions?: ReactNode
  onDismiss?: () => void
}

/**
 * A first-class inline state, pinned under the toolbar. Never a toast: these
 * describe conditions that persist until the user does something about them.
 */
export function Banner({
  tone = 'neutral',
  icon,
  title,
  children,
  actions,
  onDismiss
}: BannerProps): JSX.Element {
  return (
    <div className={'banner' + TONE_CLASS[tone]} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="banner-icon">
        <Icon name={icon ?? TONE_ICON[tone]} size={15} />
      </span>
      <div className="banner-body">
        {title ? <div className="banner-title">{title}</div> : null}
        {children ? <div className="banner-message selectable">{children}</div> : null}
      </div>
      {actions || onDismiss ? (
        <div className="banner-actions">
          {actions}
          {onDismiss ? <IconButton icon="x" label="Dismiss" onClick={onDismiss} size={12} /> : null}
        </div>
      ) : null}
    </div>
  )
}

/* ── the agent sign-in state ─────────────────────────────────────────────────
   The brief calls this out explicitly: it WILL happen, it is not an edge case,
   and it must never degrade into a generic failure message. Title and remedy are
   derived from the shared agentNotSignedInMessage() so the wording here can never
   drift from what main reports — and so a signed-out Codex says `codex`, not
   `claude`. The component keeps its original name deliberately: it is imported in
   several views, and only the copy needed to become engine-aware.               */

function signedOutParts(engine: AgentEngine): [string, string] {
  const message = agentNotSignedInMessage(engine)
  const parts = message.split(' — ')
  return [parts[0] ?? message, parts[1] ?? '']
}

/** Splits "run `claude` in a terminal to log in" so the command renders as code. */
function withInlineCode(text: string): ReactNode {
  const segments = text.split('`')
  if (segments.length < 3) return text
  return segments.map((segment, i) =>
    i % 2 === 1 ? (
      <code key={i}>{segment}</code>
    ) : (
      <span key={i}>{segment}</span>
    )
  )
}

/**
 * Which CLI the banners are talking about. Every one of them is rendered deep in a
 * view that has no reason to thread the engine down by hand, and AppInfo is already
 * cached, so they read it themselves. Claude Code until it loads — the default.
 */
function useAgentEngine(): AgentEngine {
  return useAppInfo().data?.agentEngine ?? 'claude'
}

export interface ClaudeNotSignedInBannerProps {
  /** Optional retry — usually re-runs the last triage run. */
  onRetry?: () => void
  onDismiss?: () => void
}

export function ClaudeNotSignedInBanner({
  onRetry,
  onDismiss
}: ClaudeNotSignedInBannerProps): JSX.Element {
  const [title, remedy] = signedOutParts(useAgentEngine())
  return (
    <Banner
      tone="warning"
      icon="terminal"
      title={title}
      actions={
        onRetry ? (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
      onDismiss={onDismiss}
    >
      {withInlineCode(remedy ? remedy.charAt(0).toUpperCase() + remedy.slice(1) : title)}
      . Recruit will pick up the session automatically once you have.
    </Banner>
  )
}

export interface ClaudeMissingBannerProps {
  onOpenSettings?: () => void
  onDismiss?: () => void
}

/** The CLI was never found on PATH — a different problem with a different fix. */
export function ClaudeMissingBanner({
  onOpenSettings,
  onDismiss
}: ClaudeMissingBannerProps): JSX.Element {
  const engine = useAgentEngine()
  return (
    <Banner
      tone="warning"
      icon="terminal"
      title={`${AGENT_ENGINE_LABEL[engine]} isn't installed`}
      actions={
        onOpenSettings ? (
          <Button size="sm" onClick={onOpenSettings}>
            Settings
          </Button>
        ) : undefined
      }
      onDismiss={onDismiss}
    >
      Recruit couldn&apos;t find the <code>{AGENT_ENGINE_BINARY[engine]}</code> binary. Install{' '}
      {AGENT_ENGINE_LABEL[engine]}, or set its path in Settings. Triage runs are unavailable
      until then.
    </Banner>
  )
}

export interface AgentErrorBannerProps {
  kind: AgentErrorKind | null
  message?: string | null
  onRetry?: () => void
  onOpenSettings?: () => void
  onDismiss?: () => void
}

/**
 * Maps an AgentRun's errorKind onto the right first-class state. Returns null for
 * `stopped` (the user did that on purpose) and for no error at all.
 */
export function AgentErrorBanner({
  kind,
  message,
  onRetry,
  onOpenSettings,
  onDismiss
}: AgentErrorBannerProps): JSX.Element | null {
  const label = AGENT_ENGINE_LABEL[useAgentEngine()]
  if (!kind || kind === 'stopped') return null
  if (kind === 'not_signed_in') {
    return <ClaudeNotSignedInBanner onRetry={onRetry} onDismiss={onDismiss} />
  }
  if (kind === 'cli_missing') {
    return <ClaudeMissingBanner onOpenSettings={onOpenSettings} onDismiss={onDismiss} />
  }
  const title =
    kind === 'timeout'
      ? 'The run timed out'
      : kind === 'spawn_failed'
        ? `Couldn't start ${label}`
        : kind === 'bad_output'
          ? `${label} returned something Recruit couldn't read`
          : 'The run failed'
  return (
    <Banner
      tone="danger"
      title={title}
      actions={
        onRetry ? (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
      onDismiss={onDismiss}
    >
      {message || 'No further detail was reported.'}
    </Banner>
  )
}

/** Generic failure strip for IPC rejections in any view. */
export function ErrorBanner({
  error,
  onRetry,
  onDismiss
}: {
  error: string | null
  onRetry?: () => void
  onDismiss?: () => void
}): JSX.Element | null {
  if (!error) return null
  return (
    <Banner
      tone="danger"
      title="Something went wrong"
      actions={
        onRetry ? (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
      onDismiss={onDismiss}
    >
      {error}
    </Banner>
  )
}

export interface UpdateBannerProps {
  status: UpdateStatus
  onDownload: () => void
  onDismiss: () => void
}

/**
 * Shown only when a newer version exists. Deliberately says "Download" rather than
 * "Install" or "Restart to update": Recruit is unsigned, so the user replaces the app in
 * Applications by hand. Promising an automatic install we cannot perform would be a lie.
 */
export function UpdateBanner({ status, onDownload, onDismiss }: UpdateBannerProps): ReactNode {
  if (status.state !== 'available' || !status.latestVersion) return null
  return (
    <Banner
      tone="info"
      title={`Recruit ${status.latestVersion} is available`}
      actions={<Button onClick={onDownload}>Download</Button>}
      onDismiss={onDismiss}
    >
      You are on {status.currentVersion}. Download the new version and drag it to
      Applications.
    </Banner>
  )
}
