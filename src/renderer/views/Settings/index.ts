/**
 * Settings' entry point. The stylesheet is imported HERE rather than in App.tsx,
 * so it lands after index.css in source order — base classes and view overrides
 * have equal specificity, so the cascade is decided purely by that order and a
 * view must be able to override the base. See the note at the top of App.tsx.
 */
import './settings.css'

export { default } from './SettingsView'
export type { SettingsViewProps } from './SettingsView'
export { AccountForm, AccountsSection } from './AccountForm'
export { SettingsBlock, SettingsRow, SettingsValue } from './SettingsGroup'
