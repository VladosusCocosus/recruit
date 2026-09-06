/**
 * The files an application was sent — the one place to get the PDF back.
 *
 * A document filed by the apply flow has its rendered PDF stored, and Open / Save PDF /
 * Reveal in Finder reach that exact copy. An application from before that, or one whose
 * resume was attached by hand, has no stored copy: the resume row then renders a fresh
 * one from the markdown and carries no Reveal in Finder.
 *
 * Which resume this application was sent with is <ItemResume>, above.
 */

import { useState, type JSX, type ReactNode } from 'react'
import { isEditableResume, type ApplicationDocumentKind, type ItemSummary } from '@shared/types'
import { Button, Icon, errorMessage, useResumes } from '@renderer/components'

const NO_STORED_COPY =
  'The PDF this application was sent was not kept — these render a fresh copy from the markdown.'
const GONE = 'The file this application was sent is no longer stored.'

interface DocumentRow {
  kind: ApplicationDocumentKind
  label: string
  /** Second line: which document this is. */
  name: string | null
  /** True when the PDF that was sent is on disk. */
  stored: boolean
  /** The resume a fresh copy is rendered from when nothing is stored. */
  renderFrom: number | null
  note: string | null
}

export function ItemDocuments({ item }: { item: ItemSummary }): JSX.Element | null {
  const resumes = useResumes()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resume =
    item.resumeId === null
      ? null
      : ((resumes.data ?? []).find((r) => r.id === item.resumeId) ?? null)

  const rows: DocumentRow[] = []

  if (resume) {
    const renderable = isEditableResume(resume)
    rows.push({
      kind: 'resume',
      label: 'Resume',
      name: renderable ? resume.label : (resume.filename ?? resume.label),
      stored: resume.hasPdf,
      renderFrom: !resume.hasPdf && renderable ? resume.id : null,
      note: resume.hasPdf ? null : renderable ? NO_STORED_COPY : GONE
    })
  }

  if (item.hasCoverLetterPdf) {
    rows.push({
      kind: 'cover_letter',
      label: 'Cover letter',
      name: `Written for ${item.company}`,
      stored: true,
      renderFrom: null,
      note: null
    })
  }

  if (rows.length === 0) return null

  const perform = (work: () => Promise<unknown>): void => {
    setBusy(true)
    setError(null)
    void work()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <section className="detail-section">
      <div className="detail-section-head">
        <h2 className="detail-section-title">Documents</h2>
        <span className="tertiary">What this application was sent</span>
      </div>

      {error ? (
        <p className="detail-doc-error selectable" role="alert">
          <Icon name="alert" size={11} />
          {error}
        </p>
      ) : null}

      <div className="detail-docs">
        {rows.map((row) => {
          let actions: ReactNode
          if (row.stored) {
            actions = (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => perform(() => window.recruit.openItemDocument(item.id, row.kind))}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => perform(() => window.recruit.saveItemDocument(item.id, row.kind))}
                >
                  Save PDF…
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() =>
                    perform(() => window.recruit.revealItemDocument(item.id, row.kind))
                  }
                >
                  Reveal in Finder
                </Button>
              </>
            )
          } else if (row.renderFrom !== null) {
            const resumeId = row.renderFrom
            actions = (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => perform(() => window.recruit.openResumePdf(resumeId))}
                >
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => perform(() => window.recruit.saveResumePdf(resumeId))}
                >
                  Save PDF…
                </Button>
              </>
            )
          } else {
            actions = <span className="detail-doc-flag tertiary">no longer stored</span>
          }

          return (
            <div className="detail-doc" key={row.kind}>
              <span className="detail-doc-lead">
                <Icon name="doc" size={12} />
                <span className="detail-doc-label">{row.label}</span>
                {row.name ? (
                  <span className="detail-doc-name truncate" title={row.name}>
                    {row.name}
                  </span>
                ) : null}
              </span>
              <span className="detail-doc-actions">{actions}</span>
              {row.note ? <p className="detail-doc-note tertiary">{row.note}</p> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}
