/**
 * A modal dialog: header with a close button, a scrolling body, and an optional footer.
 *
 * Built on native `<dialog showModal>`, so it carries a focus trap, an inert backdrop,
 * top-layer stacking and Escape-to-close. `locked` suppresses Escape and backdrop
 * dismissal; `width` picks one of three measures.
 */
import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { IconButton } from './Button'

/**
 * 'default' 440px — a question and a couple of fields.
 * 'wide' 620px — a form with two columns.
 * 'document' 880px — a document under review: prose, a diff and a preview of the result.
 */
export type ModalWidth = 'default' | 'wide' | 'document'

const WIDTH_CLASS: Record<ModalWidth, string> = {
  default: '',
  wide: ' is-wide',
  document: ' is-document'
}

export interface ModalProps {
  open: boolean
  /** Escape, the backdrop and the close button all land here. */
  onClose: () => void
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: ModalWidth
  /** Escape and backdrop clicks stop closing — for a form mid-submit. */
  locked?: boolean
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'default',
  locked
}: ModalProps): JSX.Element | null {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  // `cancel` fires on Escape. The default is prevented so React stays the only thing
  // that opens and closes the dialog.
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const cancel = (e: Event): void => {
      e.preventDefault()
      if (!locked) onClose()
    }
    dialog.addEventListener('cancel', cancel)
    return () => dialog.removeEventListener('cancel', cancel)
  }, [onClose, locked])

  return (
    <dialog
      ref={ref}
      className={'modal' + WIDTH_CLASS[width]}
      aria-label={title}
      /* A backdrop click reports the dialog element itself as the target; a click on
         any content inside reports a descendant. */
      onClick={(e) => {
        if (!locked && e.target === ref.current) onClose()
      }}
    >
      <div className="modal-head">
        <div className="modal-titles">
          <h2 className="modal-title">{title}</h2>
          {subtitle ? <div className="modal-subtitle">{subtitle}</div> : null}
        </div>
        <IconButton icon="x" label="Close" onClick={onClose} disabled={locked} />
      </div>

      <div className="modal-body">{children}</div>

      {footer ? <div className="modal-foot">{footer}</div> : null}
    </dialog>
  )
}
