/**
 * The reading pane.
 *
 * Body HTML is rendered into the app's own DOM rather than an iframe: main's sanitizer has
 * already dropped <style>, scripts and every event handler, and stripped url() out of inline
 * styles, so what an iframe would still buy us is layout isolation, not safety — and it would
 * cost the "load images" bar its ability to swap the body in place.
 *
 * Two things the renderer must never do are handled here:
 *  - navigation: links are intercepted and handed to openExternal (the OS browser).
 *  - remote image loads: gated in main; the bar below only re-asks for a body with them on.
 */

import { useState, type MouseEvent } from 'react'
import type { TriageState } from '@shared/types'
import {
  Badge,
  Banner,
  Button,
  ButtonGroup,
  EmptyState,
  Icon,
  KeyValue,
  KeyValueRow,
  LoadingState,
  Pane
} from '@renderer/components'
import { AttachmentChips } from './AttachmentChips'
import { WhyFlagged } from './WhyFlagged'
import { ChevronIcon, EyeOffIcon } from './icons'
import {
  addressListLabel,
  formatFullDate,
  senderLabel,
  subjectLabel,
  triageLabel
} from './format'
import { useMessageBody } from './useMessageBody'

export interface MessageReaderProps {
  messageId: number | null
  blockRemoteImages: boolean
  onRun: (messageId: number) => void
  runDisabled: boolean
  running: boolean
  onTriage: (messageId: number, state: TriageState) => void
  onOpenItem?: (itemId: number) => void
}

const LINK_SCHEMES = /^(https?|mailto|tel):/i

export function MessageReader({
  messageId,
  blockRemoteImages,
  onRun,
  runDisabled,
  running,
  onTriage,
  onOpenItem
}: MessageReaderProps): JSX.Element {
  const { message, body, loading, error, allowRemoteImages, loadRemoteImages } = useMessageBody(
    messageId,
    blockRemoteImages
  )
  const [showDetails, setShowDetails] = useState(false)
  const [pendingTriage, setPendingTriage] = useState<{ id: number; state: TriageState } | null>(
    null
  )

  /**
   * One delegated handler for the whole body: anchors leave the app via the OS browser, and
   * clicking a blocked image placeholder is the same gesture as hitting the bar above it.
   */
  const onBodyClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement | null
    if (!target) return

    const anchor = target.closest('a')
    if (anchor) {
      event.preventDefault()
      const href = anchor.getAttribute('href')
      if (href && LINK_SCHEMES.test(href)) void window.recruit.openExternal(href)
      return
    }

    if (target.closest('.blocked-remote-image')) {
      event.preventDefault()
      loadRemoteImages()
    }
  }

  const triage = (state: TriageState): void => {
    if (messageId == null) return
    setPendingTriage({ id: messageId, state })
    onTriage(messageId, state)
  }

  if (messageId == null) {
    return (
      <Pane kind="detail">
        <EmptyState
          icon="mail"
          title="No message selected"
          message="Pick a message on the left to read it."
        />
      </Pane>
    )
  }

  if (error) {
    return (
      <Pane kind="detail">
        <EmptyState
          icon="alert"
          title="Could not open this message"
          message={<span className="danger selectable">{error}</span>}
        />
      </Pane>
    )
  }

  if (!message) {
    return (
      <Pane kind="detail">
        <LoadingState label="Opening message…" />
      </Pane>
    )
  }

  const triageState: TriageState =
    pendingTriage?.id === message.id ? pendingTriage.state : message.triageState
  const isCandidate = triageState === 'candidate'
  const blockedCount = body?.blockedImageCount ?? 0
  const showImageBar = Boolean(body?.hadRemoteImages) && !allowRemoteImages
  const isHtmlBody = Boolean(message.bodyHtml && message.bodyHtml.trim().length > 0)

  return (
    <Pane kind="detail">
      <header className="mail-reader-head">
        <h1 className="mail-subject selectable">{subjectLabel(message.subject)}</h1>

        <div className="mail-from-row">
          <span className="mail-from truncate selectable">
            <strong>{senderLabel(message)}</strong>
            {message.fromAddr && message.fromName ? (
              <span className="secondary"> &lt;{message.fromAddr}&gt;</span>
            ) : null}
          </span>
          <span className="mail-date secondary tabular">{formatFullDate(message.dateUtc)}</span>
        </div>

        <div className="mail-meta-row">
          <button
            type="button"
            className="btn is-subtle is-sm mail-details-toggle"
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
          >
            <ChevronIcon className={showDetails ? 'mail-chevron is-open' : 'mail-chevron'} />
            Details
          </button>

          <span className={`status-badge mail-triage is-${triageState}`}>
            {triageLabel(triageState)}
          </span>

          {message.linkedItemIds.map((itemId) =>
            onOpenItem ? (
              <button
                key={itemId}
                type="button"
                className="badge is-success mail-linked"
                title="Open the linked tracker item"
                onClick={() => onOpenItem(itemId)}
              >
                <Icon name="link" size={9} /> In tracker
              </button>
            ) : (
              <Badge key={itemId} tone="success" title="Linked to a tracker item">
                <Icon name="link" size={9} /> In tracker
              </Badge>
            )
          )}

          <span className="mail-head-spacer" />

          <ButtonGroup>
            {isCandidate ? (
              <Button
                size="sm"
                variant="outline"
                icon="play"
                busy={running}
                disabled={runDisabled}
                title={
                  runDisabled && !running
                    ? 'A run is already in progress'
                    : 'Run triage on this message only'
                }
                onClick={() => onRun(message.id)}
              >
                Run on this message
              </Button>
            ) : (
              <Button
                size="sm"
                variant="subtle"
                icon="target"
                onClick={() => triage('candidate')}
                title="Force this message into the candidate queue"
              >
                Flag as candidate
              </Button>
            )}
            {triageState === 'dismissed' ? (
              <Button size="sm" variant="subtle" icon="refresh" onClick={() => triage('unseen')}>
                Undismiss
              </Button>
            ) : (
              <Button
                size="sm"
                variant="subtle"
                icon="x"
                onClick={() => triage('dismissed')}
                title="Exclude this message from agent runs"
              >
                Dismiss
              </Button>
            )}
          </ButtonGroup>
        </div>

        {showDetails ? (
          <div className="mail-details">
            <KeyValue>
              <KeyValueRow label="From">{message.fromAddr ?? '—'}</KeyValueRow>
              {message.to.length > 0 ? (
                <KeyValueRow label="To">{addressListLabel(message.to)}</KeyValueRow>
              ) : null}
              {message.cc.length > 0 ? (
                <KeyValueRow label="Cc">{addressListLabel(message.cc)}</KeyValueRow>
              ) : null}
              <KeyValueRow label="Folder">
                {message.folder} · uid {message.uid}
              </KeyValueRow>
              {message.messageId ? (
                <KeyValueRow label="Message-ID">
                  <span className="mono">{message.messageId}</span>
                </KeyValueRow>
              ) : null}
              {message.listUnsubscribe ? (
                <KeyValueRow label="List-Unsubscribe">
                  <span className="mono">{message.listUnsubscribe}</span>
                </KeyValueRow>
              ) : null}
            </KeyValue>
          </div>
        ) : null}

        {message.prefilterReasons.length > 0 ? (
          <WhyFlagged
            reasons={message.prefilterReasons}
            score={message.prefilterScore}
            variant="reader"
          />
        ) : null}

        <AttachmentChips attachments={message.attachments} />
      </header>

      {showImageBar ? (
        <Banner
          tone="neutral"
          icon="image"
          title="Remote images blocked"
          actions={
            <Button size="sm" onClick={loadRemoteImages}>
              Load remote images
            </Button>
          }
        >
          <span className="mail-image-note">
            <EyeOffIcon size={12} />
            {blockedCount > 0
              ? `${blockedCount} image${blockedCount === 1 ? '' : 's'} would tell the sender you opened this.`
              : 'Loading them would tell the sender you opened this.'}
          </span>
        </Banner>
      ) : null}

      <div className="pane-body mail-reader-body">
        {loading && !body ? (
          <LoadingState label="Loading body…" />
        ) : body && body.html.length > 0 ? (
          <div
            /* HTML mail hardcodes its own colors, so it gets a light "sheet" in dark mode.
               Plaintext keeps the app palette — a white card around three lines looks broken. */
            className={
              isHtmlBody ? 'mail-body is-html selectable' : 'mail-body is-text selectable'
            }
            onClick={onBodyClick}
            /* Sanitized in MAIN by sanitizeMessageBody(): no script/style/iframe/handlers, no
               url() in inline styles, remote <img> src parked on data-blocked-src. */
            dangerouslySetInnerHTML={{ __html: body.html }}
          />
        ) : (
          <EmptyState compact title="This message has no readable content." />
        )}
      </div>
    </Pane>
  )
}
