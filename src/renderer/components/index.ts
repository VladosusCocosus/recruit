/**
 * Shared renderer components. Every view imports from here:
 *
 *   import { Button, ListRow, EmptyState, useAsync } from '@renderer/components'
 *
 * Nothing in this folder talks to IPC directly except the hooks in `hooks.ts`,
 * and those only ever go through `window.recruit`.
 */

export { Icon, Spinner } from './Icon'
export type { IconName, IconProps, SpinnerProps } from './Icon'

export { Button, IconButton, ButtonGroup } from './Button'
export type { ButtonProps, ButtonVariant, ButtonSize, IconButtonProps } from './Button'

export { Badge, CountBadge, StatusBadge, Dot, Chip } from './Badge'
export type { BadgeProps, BadgeTone, CountBadgeProps, StatusBadgeProps } from './Badge'

export {
  Banner,
  ClaudeNotSignedInBanner,
  ClaudeMissingBanner,
  AgentErrorBanner,
  ErrorBanner,
  UpdateBanner
} from './Banner'
export type { BannerProps, BannerTone, AgentErrorBannerProps } from './Banner'

export { EmptyState, LoadingState } from './EmptyState'
export type { EmptyStateProps } from './EmptyState'

export { ListRow, List } from './ListRow'
export type { ListRowProps } from './ListRow'

export { SplitView, Pane, PaneHeader, PaneBody, Toolbar, ToolbarSpacer } from './Pane'
export type { PaneProps, PaneHeaderProps } from './Pane'

export { Card, CardHeader, CardBody, CardFooter, KeyValue, KeyValueRow } from './Card'

export {
  FormSection,
  FieldRow,
  Field,
  TextInput,
  NumberInput,
  Select,
  Toggle,
  Slider,
  Segmented
} from './Field'
export type {
  FieldProps,
  TextInputProps,
  NumberInputProps,
  SelectProps,
  SelectOption,
  ToggleProps,
  SliderProps,
  SegmentedProps
} from './Field'

export { RunButton } from './RunButton'
export type { RunButtonProps } from './RunButton'

export { Rail, RAIL_SECTIONS } from './Rail'
export type { RailProps } from './Rail'

export * from './format'
export * from './hooks'
