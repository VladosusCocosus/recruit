import type { ReactNode } from 'react'

/** Hairline container. Proposal cards, board cards, settings groups. */
export function Card({
  children,
  className
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return <div className={'card' + (className ? ` ${className}` : '')}>{children}</div>
}

export function CardHeader({
  title,
  actions,
  children
}: {
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="card-header">
      {title ? <div className="card-title">{title}</div> : null}
      {children}
      {actions}
    </div>
  )
}

export function CardBody({
  children,
  flush = false
}: {
  children: ReactNode
  flush?: boolean
}): JSX.Element {
  return <div className={'card-body' + (flush ? ' is-flush' : '')}>{children}</div>
}

/** Tinted strip at the bottom — Accept / Reject lives here. */
export function CardFooter({ children }: { children: ReactNode }): JSX.Element {
  return <div className="card-footer">{children}</div>
}

/** Definition list for read-only detail (item fields, About). */
export function KeyValue({ children }: { children: ReactNode }): JSX.Element {
  return <dl className="kv">{children}</dl>
}

export function KeyValueRow({ label, children }: { label: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}
