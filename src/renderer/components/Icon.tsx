/**
 * Inline SVG icon set. No icon font, no dependency — every glyph is drawn on a
 * 16×16 grid with `currentColor` so it inherits from whatever it sits in.
 * Stroke icons use a 1.5 weight to sit next to SF Pro Text without shouting.
 */

export type IconName =
  | 'play'
  | 'stop'
  | 'inbox'
  | 'target'
  | 'board'
  | 'review'
  | 'calendar'
  | 'gear'
  | 'check'
  | 'checkCircle'
  | 'x'
  | 'xCircle'
  | 'alert'
  | 'info'
  | 'refresh'
  | 'plus'
  | 'chevronRight'
  | 'chevronLeft'
  | 'ellipsis'
  | 'mail'
  | 'link'
  | 'search'
  | 'trash'
  | 'external'
  | 'terminal'
  | 'sparkle'
  | 'clock'
  | 'pin'
  | 'image'
  | 'doc'

export interface IconProps {
  name: IconName
  size?: number
  className?: string
  /** Decorative by default. Pass a label to expose it to assistive tech. */
  label?: string
}

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

const PATHS: Record<IconName, JSX.Element> = {
  play: <path d="M5.4 3.4 12.3 8l-6.9 4.6z" fill="currentColor" />,
  stop: <rect x="4.75" y="4.75" width="6.5" height="6.5" rx="1.4" fill="currentColor" />,
  inbox: (
    <g {...STROKE}>
      <path d="M2.25 9.5 4 3.4h8L13.75 9.5v3.1H2.25z" />
      <path d="M2.25 9.5h3l.9 1.7h3.7l.9-1.7h3" />
    </g>
  ),
  target: (
    <g {...STROKE}>
      <circle cx="8" cy="8" r="5.4" />
      <circle cx="8" cy="8" r="2.2" />
    </g>
  ),
  board: (
    <g {...STROKE}>
      <rect x="2.4" y="2.9" width="3.4" height="10.2" rx="1" />
      <rect x="7.1" y="2.9" width="3.4" height="6.8" rx="1" />
      <rect x="11.8" y="2.9" width="1.8" height="8.5" rx="0.9" />
    </g>
  ),
  review: (
    <g {...STROKE}>
      <rect x="2.6" y="2.4" width="10.8" height="11.2" rx="1.6" />
      <path d="M5.4 6.2h5.2M5.4 9h3.4" />
    </g>
  ),
  calendar: (
    <g {...STROKE}>
      <rect x="2.4" y="3.4" width="11.2" height="10.2" rx="1.6" />
      <path d="M2.4 6.5h11.2M5.6 2.2v2.3M10.4 2.2v2.3" />
    </g>
  ),
  gear: (
    <g {...STROKE}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.9v1.5M8 12.6v1.5M13 5.2l-1.3.75M4.3 10.05 3 10.8M13 10.8l-1.3-.75M4.3 5.95 3 5.2" />
    </g>
  ),
  check: <path d="m3.4 8.4 3.1 3.1 6.1-7" {...STROKE} />,
  checkCircle: (
    <g {...STROKE}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="m5.4 8.1 1.9 1.9 3.4-3.9" />
    </g>
  ),
  x: <path d="M4 4l8 8M12 4l-8 8" {...STROKE} />,
  xCircle: (
    <g {...STROKE}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="m6 6 4 4M10 6l-4 4" />
    </g>
  ),
  alert: (
    <g {...STROKE}>
      <path d="M8 2.6 14.2 13H1.8z" />
      <path d="M8 6.4v3M8 11.2v.1" />
    </g>
  ),
  info: (
    <g {...STROKE}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M8 7.4v3.2M8 5.2v.1" />
    </g>
  ),
  refresh: (
    <g {...STROKE}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.3 2.3v3.1h-3.1" />
    </g>
  ),
  plus: <path d="M8 3.4v9.2M3.4 8h9.2" {...STROKE} />,
  chevronRight: <path d="m6.2 3.6 4.4 4.4-4.4 4.4" {...STROKE} />,
  chevronLeft: <path d="m9.8 3.6-4.4 4.4 4.4 4.4" {...STROKE} />,
  // The macOS "more" affordance. Filled dots, not stroked: at 13px a stroked ring
  // renders as a smudge on a non-Retina display.
  ellipsis: (
    <g fill="currentColor">
      <circle cx="3.6" cy="8" r="1.25" />
      <circle cx="8" cy="8" r="1.25" />
      <circle cx="12.4" cy="8" r="1.25" />
    </g>
  ),
  mail: (
    <g {...STROKE}>
      <rect x="1.9" y="3.4" width="12.2" height="9.2" rx="1.6" />
      <path d="m2.4 4.6 5.6 4 5.6-4" />
    </g>
  ),
  link: (
    <g {...STROKE}>
      <path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8" />
      <path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8" />
    </g>
  ),
  search: (
    <g {...STROKE}>
      <circle cx="7.1" cy="7.1" r="4.2" />
      <path d="m10.3 10.3 3 3" />
    </g>
  ),
  trash: (
    <g {...STROKE}>
      <path d="M2.9 4.3h10.2M6.1 4.3V2.9h3.8v1.4M4.3 4.3l.7 8.4h6l.7-8.4" />
    </g>
  ),
  external: (
    <g {...STROKE}>
      <path d="M12.6 9v3.1a1.5 1.5 0 0 1-1.5 1.5H3.9a1.5 1.5 0 0 1-1.5-1.5V4.9a1.5 1.5 0 0 1 1.5-1.5H7" />
      <path d="M10.2 2.4h3.4v3.4M13.6 2.4 7.7 8.3" />
    </g>
  ),
  terminal: (
    <g {...STROKE}>
      <rect x="1.9" y="2.9" width="12.2" height="10.2" rx="1.6" />
      <path d="m4.8 6.4 2 1.8-2 1.8M8.6 10.2h2.8" />
    </g>
  ),
  sparkle: (
    <g {...STROKE}>
      <path d="M8 2.2 9.3 6l3.8 1.3L9.3 8.6 8 12.4 6.7 8.6 2.9 7.3 6.7 6z" />
    </g>
  ),
  clock: (
    <g {...STROKE}>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M8 4.7V8l2.3 1.5" />
    </g>
  ),
  // A place, not a target. `target` is the crosshair the rail uses for Candidates, and
  // reusing it for a venue made two unrelated things look like the same idea.
  pin: (
    <g {...STROKE}>
      <path d="M8 14.2s4.7-4.2 4.7-7.5a4.7 4.7 0 1 0-9.4 0c0 3.3 4.7 7.5 4.7 7.5z" />
      <circle cx="8" cy="6.6" r="1.7" />
    </g>
  ),
  image: (
    <g {...STROKE}>
      <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.6" />
      <path d="m2.9 11.3 3.2-3.2 2.3 2.3 1.9-1.9 2.8 2.8" />
      <circle cx="6" cy="6.3" r="1" />
    </g>
  ),
  doc: (
    <g {...STROKE}>
      <path d="M9.2 1.9H4.6a1.4 1.4 0 0 0-1.4 1.4v9.4a1.4 1.4 0 0 0 1.4 1.4h6.8a1.4 1.4 0 0 0 1.4-1.4V5.5z" />
      <path d="M9.1 2v3.4h3.5" />
    </g>
  )
}

export function Icon({ name, size = 14, className, label }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}

export interface SpinnerProps {
  size?: number
  className?: string
  label?: string
}

/** Indeterminate progress ring. Honours prefers-reduced-motion (slower, not still). */
export function Spinner({ size = 13, className, label = 'Working' }: SpinnerProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      role="img"
      aria-label={label}
      focusable="false"
    >
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.22" />
      <circle
        className="spin"
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="9 29"
      />
    </svg>
  )
}
