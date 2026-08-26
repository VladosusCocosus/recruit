import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, Spinner, type IconName } from './Icon'

export type ButtonVariant = 'default' | 'primary' | 'outline' | 'subtle' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Leading glyph. */
  icon?: IconName
  /** Swaps the icon for a spinner and disables the button. */
  busy?: boolean
  children?: ReactNode
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: '',
  primary: ' is-primary',
  outline: ' is-outline',
  subtle: ' is-subtle',
  danger: ' is-danger'
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: ' is-sm',
  md: '',
  lg: ' is-lg'
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  busy = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps): JSX.Element {
  const classes =
    'btn' + VARIANT_CLASS[variant] + SIZE_CLASS[size] + (className ? ` ${className}` : '')
  return (
    <button type="button" className={classes} disabled={disabled || busy} {...rest}>
      {busy ? <Spinner size={size === 'sm' ? 11 : 12} /> : icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: IconName
  /** Required — this button has no visible text. */
  label: string
  size?: number
}

export function IconButton({
  icon,
  label,
  size = 14,
  className,
  ...rest
}: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={'icon-btn' + (className ? ` ${className}` : '')}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={size} />
    </button>
  )
}

/** Horizontal cluster with consistent spacing. */
export function ButtonGroup({ children }: { children: ReactNode }): JSX.Element {
  return <div className="btn-group">{children}</div>
}
