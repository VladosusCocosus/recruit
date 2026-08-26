/**
 * The four glyphs the shared icon set does not carry. Everything else in the Mail views
 * uses `Icon` from '@renderer/components'.
 *
 * If these land in components/Icon.tsx later, delete this file and switch the call sites to
 * <Icon name="bolt" /> etc. — the props are deliberately the same shape.
 */

export interface MailIconProps {
  size?: number
  className?: string
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

function svg(size: number, className: string | undefined, children: JSX.Element): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** The prefilter's mark. Every "why was this flagged?" line carries it. */
export function BoltIcon({ size = 12, className }: MailIconProps): JSX.Element {
  return svg(size, className, <path d="M9 1.5 3.5 9.2h3.2L7 14.5l5.5-7.7H9.3L9 1.5Z" fill="currentColor" />)
}

export function PaperclipIcon({ size = 12, className }: MailIconProps): JSX.Element {
  return svg(
    size,
    className,
    <path
      d="M12.5 7.4 7.8 12a2.9 2.9 0 0 1-4.1-4.1l5-5a1.9 1.9 0 0 1 2.7 2.7l-5 5a.9.9 0 0 1-1.3-1.3l4.6-4.6"
      {...STROKE}
    />
  )
}

export function ChevronIcon({ size = 10, className }: MailIconProps): JSX.Element {
  return svg(size, className, <path d="m6 4 4 4-4 4" {...STROKE} />)
}

/** Remote images are blocked — the read-receipt the sender does not get. */
export function EyeOffIcon({ size = 14, className }: MailIconProps): JSX.Element {
  return svg(
    size,
    className,
    <g {...STROKE}>
      <path d="M6.3 3.5a6.6 6.6 0 0 1 1.7-.2c3.6 0 6 3.2 6.6 4.4a.7.7 0 0 1 0 .6 11 11 0 0 1-1.9 2.4M4.4 4.6A10.6 10.6 0 0 0 1.4 7.7a.7.7 0 0 0 0 .6c.6 1.2 3 4.4 6.6 4.4 1.3 0 2.5-.4 3.5-1" />
      <path d="M6.6 6.7a2 2 0 0 0 2.8 2.8M1.8 1.8l12.4 12.4" />
    </g>
  )
}
