/**
 * Attachment chips for the reader. Calendar parts are visually distinct because a .ics is
 * both a prefilter signal (+0.3) and the thing that becomes a timeline event once the agent
 * proposes it — the user should spot one without opening the message.
 *
 * Chips are display-only: RecruitApi has no openAttachment / revealAttachment method in v1,
 * and openExternal is for http(s) URLs, not local file paths.
 */

import type { Attachment } from '@shared/types'
import { Icon } from '@renderer/components'
import { PaperclipIcon } from './icons'
import { attachmentLabel, formatBytes, isCalendarAttachment } from './format'

export interface AttachmentChipsProps {
  attachments: Attachment[]
}

export function AttachmentChips({ attachments }: AttachmentChipsProps): JSX.Element | null {
  // Anything with a Content-ID was inlined into the body as a data: URI by mailparser —
  // showing it again as a chip would list the sender's logo as an attachment.
  const visible = attachments.filter((a) => !a.contentId || isCalendarAttachment(a))
  if (visible.length === 0) return null

  return (
    <div className="mail-attachments">
      {visible.map((attachment) => {
        const calendar = isCalendarAttachment(attachment)
        const size = formatBytes(attachment.size)
        return (
          <span
            key={attachment.id}
            className={calendar ? 'mail-attach is-calendar' : 'mail-attach'}
            title={[attachmentLabel(attachment), attachment.mimeType, size]
              .filter(Boolean)
              .join(' · ')}
          >
            {calendar ? <Icon name="calendar" size={11} /> : <PaperclipIcon size={11} />}
            <span className="mail-attach-name truncate">{attachmentLabel(attachment)}</span>
            {size ? <span className="mail-attach-size tabular">{size}</span> : null}
          </span>
        )
      })}
    </div>
  )
}
