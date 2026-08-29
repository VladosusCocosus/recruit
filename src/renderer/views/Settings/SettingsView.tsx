import { useCallback, useState } from 'react'
import {
  AGENT_MODELS,
  type AppSettings,
  type ThemePreference
} from '@shared/types'
import {
  Badge,
  Banner,
  Button,
  Icon,
  type IconName,
  LoadingState,
  Pane,
  PaneBody,
  PaneHeader,
  Segmented,
  Select,
  Slider,
  SplitView,
  Toggle,
  errorMessage,
  formatRelative,
  pluralize,
  useAccounts,
  useAppInfo,
  useUpdate
} from '@renderer/components'
import {
  CommittedNumber,
  CommittedText,
  SettingsBlock,
  SettingsRow,
  SettingsValue
} from './SettingsGroup'
import { AccountsSection } from './AccountForm'

/* ════════════════════════════════════════════════════════════════════════════
   SETTINGS

   The macOS System Settings shape: a section list beside a scrolling detail
   column of grouped inset boxes. Three columns in total, because the app rail
   stays put — rail → section list → detail is the same progression Mail and the
   Tracker already use, so Settings is not a special case.

   Every control here applies immediately. There is no Save button, and adding
   one would be wrong: a settings pane on macOS is modeless. The one exception
   is the account form, where credentials have to be validated as a set before
   they are worth storing — see AccountForm.
   ════════════════════════════════════════════════════════════════════════════ */

const SECTIONS = [
  { key: 'general', label: 'General', icon: 'gear' },
  { key: 'accounts', label: 'Accounts', icon: 'mail' },
  { key: 'triage', label: 'Triage', icon: 'target' },
  { key: 'agent', label: 'Agent', icon: 'sparkle' },
  { key: 'privacy', label: 'Privacy', icon: 'image' },
  { key: 'about', label: 'About', icon: 'info' }
] as const satisfies ReadonlyArray<{ key: string; label: string; icon: IconName }>

type SectionKey = (typeof SECTIONS)[number]['key']

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const MODEL_OPTIONS = AGENT_MODELS.map((m) => ({
  value: m as string,
  label: m.charAt(0).toUpperCase() + m.slice(1)
}))

/** Just the unit word — `pluralize` prefixes the count, which the field already shows. */
const unit = (n: number, one: string): string => (n === 1 ? one : `${one}s`)

export interface SettingsViewProps {
  settings: AppSettings | null
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>
  /** Lets the shell refresh counts / setup state after an account is added. */
  onAccountsChanged?: () => void
}

export default function SettingsView({
  settings,
  onUpdateSettings,
  onAccountsChanged
}: SettingsViewProps): JSX.Element {
  const [section, setSection] = useState<SectionKey>('general')
  const accounts = useAccounts()

  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0]

  return (
    <SplitView>
      <Pane kind="list" width={184}>
        <PaneBody>
          <nav className="set-nav" aria-label="Settings sections">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={'set-nav-item' + (s.key === section ? ' is-active' : '')}
                aria-current={s.key === section ? 'page' : undefined}
                onClick={() => setSection(s.key)}
              >
                <Icon name={s.icon} size={14} className="set-nav-icon" />
                {s.label}
              </button>
            ))}
          </nav>
        </PaneBody>
      </Pane>

      <Pane kind="detail">
        <PaneHeader title={active.label} />
        <PaneBody>
          {!settings || accounts.loading ? (
            <LoadingState />
          ) : section === 'accounts' ? (
            <AccountsSection accounts={accounts} onAccountsChanged={onAccountsChanged} />
          ) : (
            <div className="set-col">
              {section === 'general' ? (
                <GeneralSection settings={settings} onUpdate={onUpdateSettings} />
              ) : section === 'triage' ? (
                <TriageSection settings={settings} onUpdate={onUpdateSettings} />
              ) : section === 'agent' ? (
                <AgentSection settings={settings} onUpdate={onUpdateSettings} />
              ) : section === 'privacy' ? (
                <PrivacySection settings={settings} onUpdate={onUpdateSettings} />
              ) : (
                <AboutSection />
              )}
            </div>
          )}
        </PaneBody>
      </Pane>
    </SplitView>
  )
}

interface SectionProps {
  settings: AppSettings
  onUpdate: (patch: Partial<AppSettings>) => Promise<void>
}

/* ── general ─────────────────────────────────────────────────────────────── */

function GeneralSection({ settings, onUpdate }: SectionProps): JSX.Element {
  return (
    <>
      <SettingsBlock title="Appearance">
        <SettingsRow label="Theme">
          <Segmented
            value={settings.theme}
            options={THEME_OPTIONS}
            aria-label="Theme"
            onValueChange={(v) => void onUpdate({ theme: v })}
          />
        </SettingsRow>
      </SettingsBlock>

      <SettingsBlock
        title="Mail"
        footnote="Changing either reconnects every account. The backfill window only applies the first time an account is synced — an account that already has mail keeps reading forward from where it stopped."
      >
        <SettingsRow label="Check for new mail every">
          <CommittedNumber
            value={settings.syncIntervalMinutes}
            min={1}
            max={1440}
            label="Minutes between syncs"
            onCommit={(v) => void onUpdate({ syncIntervalMinutes: v })}
          />
          <SettingsValue>{unit(settings.syncIntervalMinutes, 'minute')}</SettingsValue>
        </SettingsRow>
        <SettingsRow label="Download mail from the last">
          <CommittedNumber
            value={settings.syncBackfillDays}
            min={1}
            max={3650}
            label="Days of mail to download"
            onCommit={(v) => void onUpdate({ syncBackfillDays: v })}
          />
          <SettingsValue>{unit(settings.syncBackfillDays, 'day')}</SettingsValue>
        </SettingsRow>
      </SettingsBlock>

      <SettingsBlock footnote="The four first-run steps: add an account, sync, run the first scan, review what Claude found.">
        <SettingsRow
          label="Show the setup checklist"
          description="Reappears above every view until all four steps are done."
        >
          <Toggle
            checked={!settings.setupDismissed}
            onCheckedChange={(v) => void onUpdate({ setupDismissed: !v })}
            label="Show the setup checklist above every view"
          />
        </SettingsRow>
      </SettingsBlock>
    </>
  )
}

/* ── triage ──────────────────────────────────────────────────────────────── */

function TriageSection({ settings, onUpdate }: SectionProps): JSX.Element {
  const [rescore, setRescore] = useState<string | null>(null)
  const [rescoring, setRescoring] = useState(false)

  const runRescore = useCallback(async () => {
    setRescoring(true)
    setRescore(null)
    try {
      const result = await window.recruit.rescorePrefilter()
      setRescore(
        `Scored ${pluralize(result.scored, 'message')} · ${result.candidates} now flagged as candidates.`
      )
    } catch (e) {
      setRescore(errorMessage(e))
    } finally {
      setRescoring(false)
    }
  }, [])

  return (
    <SettingsBlock
      footnote={
        <>
          The prefilter scores every message locally before Claude sees anything. Only
          messages at or above the threshold become candidates — a lower threshold catches
          more mail and costs more per run. 0.35 is the default.
        </>
      }
    >
      <SettingsRow label="Candidate threshold">
        <Slider
          value={settings.prefilterThreshold}
          min={0.05}
          max={2}
          step={0.05}
          aria-label="Candidate threshold"
          display={settings.prefilterThreshold.toFixed(2)}
          onValueChange={(v) => void onUpdate({ prefilterThreshold: v })}
        />
      </SettingsRow>
      <SettingsRow
        label="Maximum candidates per run"
        description="Caps how many messages one triage run may read."
      >
        <CommittedNumber
          value={settings.maxCandidatesPerRun}
          min={1}
          max={1000}
          label="Maximum candidates per run"
          onCommit={(v) => void onUpdate({ maxCandidatesPerRun: v })}
        />
      </SettingsRow>
      <SettingsRow label="Rescore stored mail" description={rescore ?? undefined}>
        <Button size="sm" icon="refresh" busy={rescoring} onClick={() => void runRescore()}>
          Rescore
        </Button>
      </SettingsRow>
    </SettingsBlock>
  )
}

/* ── agent ───────────────────────────────────────────────────────────────── */

function AgentSection({ settings, onUpdate }: SectionProps): JSX.Element {
  const appInfo = useAppInfo()
  const available = appInfo.data?.claudeCliAvailable ?? false

  return (
    <>
      <SettingsBlock footnote="Claude never writes to the tracker directly. Every change it wants to make lands in the Review queue for you to accept or reject.">
        <SettingsRow label="Model">
          <Select
            value={settings.model}
            options={MODEL_OPTIONS}
            aria-label="Model"
            onValueChange={(v) => void onUpdate({ model: v })}
          />
        </SettingsRow>
        <SettingsRow
          label="Look up company descriptions on the web"
          description="A separate, isolated agent that receives only a company name — no message data, no tracker access."
        >
          <Toggle
            checked={settings.enrichmentEnabled}
            onCheckedChange={(v) => void onUpdate({ enrichmentEnabled: v })}
            label="Enable web look-up of company descriptions"
          />
        </SettingsRow>
      </SettingsBlock>

      <SettingsBlock
        title="Claude Code"
        footnote="A GUI-launched app does not inherit your login shell's PATH, so Jobbox also looks in ~/.local/bin, ~/.claude/local, /opt/homebrew/bin and a few more. Set an explicit path if it still can't find the binary; restart for a change to take effect."
      >
        <SettingsRow label="Status">
          {available ? (
            <Badge tone="success">Available</Badge>
          ) : (
            <Badge tone="warning">Not found</Badge>
          )}
        </SettingsRow>
        <SettingsRow label="Binary path">
          <CommittedText
            value={settings.claudeBinaryPath}
            label="Claude binary path"
            placeholder="claude"
            fallback="claude"
            className="set-w-path"
            onCommit={(v) => void onUpdate({ claudeBinaryPath: v })}
          />
        </SettingsRow>
      </SettingsBlock>

      {!available && appInfo.data ? (
        <Banner tone="warning" icon="terminal" title="Claude Code isn't installed">
          Jobbox couldn&apos;t find the <code>claude</code> binary on this machine. Triage runs
          are unavailable until it is installed.
        </Banner>
      ) : null}
    </>
  )
}

/* ── privacy ─────────────────────────────────────────────────────────────── */

function PrivacySection({ settings, onUpdate }: SectionProps): JSX.Element {
  return (
    <SettingsBlock footnote="Remote images let a sender confirm you opened a message. Blocking them is the default; you can still load them on any message you trust.">
      <SettingsRow
        label="Block remote images"
        description="Applies to every message until you load them individually."
      >
        <Toggle
          checked={settings.blockRemoteImages}
          onCheckedChange={(v) => void onUpdate({ blockRemoteImages: v })}
          label="Block remote images in messages"
        />
      </SettingsRow>
    </SettingsBlock>
  )
}

/* ── about ───────────────────────────────────────────────────────────────── */

function updateLabel(state: string | undefined): string {
  switch (state) {
    case 'checking':
      return 'Checking…'
    case 'available':
      return 'Update available'
    case 'current':
      return 'Up to date'
    case 'error':
      return 'Check failed'
    default:
      return 'Not checked yet'
  }
}

function AboutSection(): JSX.Element {
  const appInfo = useAppInfo()
  const update = useUpdate()

  const reveal = useCallback(() => {
    void window.recruit.revealDatabase().catch(() => undefined)
  }, [])

  if (!appInfo.data) {
    return <div className="set-block-foot">{appInfo.error ?? 'Loading…'}</div>
  }

  const info = appInfo.data
  const status = update.status

  return (
    <>
      <SettingsBlock footnote="Jobbox ships unsigned, so an update is downloaded and replaced by hand rather than applied in place.">
        <SettingsRow label="Version">
          <SettingsValue>{info.version}</SettingsValue>
        </SettingsRow>
        <SettingsRow label="Electron">
          <SettingsValue>{info.electronVersion}</SettingsValue>
        </SettingsRow>
        <SettingsRow
          label="Software update"
          description={
            status?.checkedAt ? `Last checked ${formatRelative(status.checkedAt)}.` : undefined
          }
        >
          <SettingsValue>{updateLabel(status?.state)}</SettingsValue>
          {status?.state === 'available' ? (
            <Button size="sm" variant="primary" onClick={update.download}>
              Download
            </Button>
          ) : (
            <Button size="sm" busy={update.checking} onClick={update.check}>
              Check Now
            </Button>
          )}
        </SettingsRow>
      </SettingsBlock>

      <SettingsBlock
        title="Data"
        footnote="Mail, candidates, proposals and every tracker row live in this one file."
      >
        <SettingsRow
          label="Database"
          description={<span className="set-path">{info.dbPath}</span>}
        >
          <Button size="sm" onClick={reveal}>
            Reveal
          </Button>
        </SettingsRow>
      </SettingsBlock>
    </>
  )
}
