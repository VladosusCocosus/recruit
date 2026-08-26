import type { ReactNode } from 'react'
import { CLAUDE_NOT_SIGNED_IN_MESSAGE, type AgentErrorKind, type UpdateStatus } from '@shared/types'
import { Icon, type IconName } from './Icon'
import { Button, IconButton } from './Button'

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

/* ── the Claude Code sign-in state ───────────────────────────────────────────
   The brief calls this out explicitly: it WILL happen, it is not an edge case,
   and it must never degrade into a generic failure message. Title and remedy are
   derived from the shared CLAUDE_NOT_SIGNED_IN_MESSAGE constant so the wording
   here can never drift from what main reports.                                */

const [SIGNED_OUT_TITLE, SIGNED_OUT_REMEDY] = ((): [string, string] => {
  const parts = CLAUDE_NOT_SIGNED_IN_MESSAGE.split(' — ')
  return [parts[0] ?? CLAUDE_NOT_SIGNED_IN_MESSAGE, parts[1] ?? '']
})()

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

export interface ClaudeNotSignedInBannerProps {
  /** Optional retry — usually re-runs the last triage run. */
  onRetry?: () => void
  onDismiss?: () => void
}

export function ClaudeNotSignedInBanner({
  onRetry,
  onDismiss
}: ClaudeNotSignedInBannerProps): JSX.Element {
  const remedy = SIGNED_OUT_REMEDY
  return (
    <Banner
      tone="warning"
      icon="terminal"
      title={SIGNED_OUT_TITLE}
      actions={
        onRetry ? (
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
      onDismiss={onDismiss}
    >
      {remedy
        ? withInlineCode(remedy.charAt(0).toUpperCase() + remedy.slice(1))
        : withInlineCode(CLAUDE_NOT_SIGNED_IN_MESSAGE)}
      . Recruit will pick up the session automatically once you have.
    </Banner>
  )
}

export interface ClaudeMissingBannerProps {
  onOpenSettings?: () => void
  onDismiss?: () => void
}

/** `claude` was never found on PATH — a different problem with a different fix. */
export function ClaudeMissingBanner({
  onOpenSettings,
  onDismiss
}: ClaudeMissingBannerProps): JSX.Element {
  return (
    <Banner
      tone="warning"
      icon="terminal"
      title="Claude Code isn't installed"
      actions={
        onOpenSettings ? (
          <Button size="sm" onClick={onOpenSettings}>
            Settings
          </Button>
        ) : undefined
      }
      onDismiss={onDismiss}
    >
      Recruit couldn&apos;t find the <code>claude</code> binary. Install Claude Code, or set its
      path in Settings. Triage runs are unavailable until then.
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
        ? "Couldn't start Claude Code"
        : kind === 'bad_output'
          ? "Claude Code returned something Recruit couldn't read"
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
