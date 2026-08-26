import type { ReactNode } from 'react'

/**
 * Three-pane scaffolding. `SplitView` holds a fixed-width list pane plus a
 * flexible detail pane; each `Pane` owns its own header and scroll region so
 * headers stay pinned while the body scrolls.
 */

export function SplitView({ children }: { children: ReactNode }): JSX.Element {
  return <div className="split">{children}</div>
}

export interface PaneProps {
  /** 'list' is the fixed 320px column; 'detail' flexes to fill. */
  kind?: 'list' | 'detail' | 'plain'
  children: ReactNode
  /** Inline width override for the list pane (e.g. a wider candidates column). */
  width?: number
}

export function Pane({ kind = 'plain', children, width }: PaneProps): JSX.Element {
  const cls =
    'pane' + (kind === 'list' ? ' is-list' : kind === 'detail' ? ' is-detail' : '')
  const style = width !== undefined ? { flexBasis: width, width } : undefined
  return (
    <section className={cls} style={style}>
      {children}
    </section>
  )
}

export interface PaneHeaderProps {
  title?: ReactNode
  /** Right-aligned controls. */
  actions?: ReactNode
  children?: ReactNode
}

export function PaneHeader({ title, actions, children }: PaneHeaderProps): JSX.Element {
  return (
    <header className="pane-header">
      {title ? <div className="pane-header-title">{title}</div> : null}
      {children}
      {actions}
    </header>
  )
}

export function PaneBody({
  children,
  padded = false
}: {
  children: ReactNode
  padded?: boolean
}): JSX.Element {
  return <div className={'pane-body' + (padded ? ' is-padded' : '')}>{children}</div>
}

/* ── toolbar pieces ─────────────────────────────────────────────────────── */

export function Toolbar({ children }: { children: ReactNode }): JSX.Element {
  return <header className="toolbar">{children}</header>
}

/** Draggable gap. Put it between the left toolbar cluster and the RUN button. */
export function ToolbarSpacer(): JSX.Element {
  return <div className="toolbar-spacer" />
}
