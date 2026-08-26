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
  Field,
  FormSection,
  KeyValue,
  KeyValueRow,
  LoadingState,
  NumberInput,
  Pane,
  PaneBody,
  PaneHeader,
  Segmented,
  Select,
  Slider,
  Toggle,
  errorMessage,
  pluralize,
  useAccounts,
  useAppInfo
} from '@renderer/components'
import { AccountForm } from './AccountForm'

export interface SettingsViewProps {
  settings: AppSettings | null
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>
  /** Lets the shell refresh counts / setup state after an account is added. */
  onAccountsChanged?: () => void
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const MODEL_OPTIONS = AGENT_MODELS.map((m) => ({
  value: m as string,
  label: m.charAt(0).toUpperCase() + m.slice(1)
}))

export default function SettingsView({
  settings,
  onUpdateSettings,
  onAccountsChanged
}: SettingsViewProps): JSX.Element {
  const accounts = useAccounts()
  const appInfo = useAppInfo()
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [rescore, setRescore] = useState<string | null>(null)
  const [rescoring, setRescoring] = useState(false)

  const rows = accounts.data ?? []
  const selected: number | 'new' = editing ?? (rows[0]?.id ?? 'new')
  const account = selected === 'new' ? null : rows.find((a) => a.id === selected) ?? null

  const afterAccountChange = useCallback(() => {
    accounts.reload()
    onAccountsChanged?.()
  }, [accounts, onAccountsChanged])

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
    <Pane kind="detail">
      <PaneHeader title="Settings" />
      <PaneBody padded>
        {accounts.loading || !settings ? (
          <LoadingState />
        ) : (
          <>
            {/* ── accounts ─────────────────────────────────────────────── */}
            {rows.length > 0 ? (
              <FormSection>
                <div className="row" style={{ marginBottom: 14 }}>
                  {rows.length > 1 || selected === 'new' ? (
                    <Select
                      value={String(selected)}
                      options={[
                        ...rows.map((a) => ({ value: String(a.id), label: a.email })),
                        { value: 'new', label: 'Add an account…' }
                      ]}
                      onValueChange={(v) => setEditing(v === 'new' ? 'new' : Number(v))}
                      style={{ maxWidth: 280 }}
                    />
                  ) : null}
                  {selected !== 'new' ? (
                    <Button size="sm" icon="plus" onClick={() => setEditing('new')}>
                      Add account
                    </Button>
                  ) : null}
                </div>
              </FormSection>
            ) : null}

            <AccountForm
              key={selected}
              account={account}
              onSaved={() => {
                afterAccountChange()
                setEditing(null)
              }}
              onDeleted={() => {
                afterAccountChange()
                setEditing(null)
              }}
              onCancel={selected === 'new' && rows.length > 0 ? () => setEditing(null) : undefined}
            />

            <hr className="rule" />

            {/* ── triage ───────────────────────────────────────────────── */}
            <FormSection
              title="Triage"
              hint="The prefilter scores every message locally before Claude sees anything. Only messages at or above the threshold become candidates."
            >
              <Field
                label="Candidate threshold"
                hint="Lower catches more mail and costs more per run. 0.50 is the default."
              >
                <Slider
                  value={settings.prefilterThreshold}
                  min={0.1}
                  max={1.5}
                  step={0.05}
                  aria-label="Candidate threshold"
                  display={settings.prefilterThreshold.toFixed(2)}
                  onValueChange={(v) => void onUpdateSettings({ prefilterThreshold: v })}
                />
              </Field>
              <Field
                label="Maximum candidates per run"
                hint="Caps how many messages a single triage run is allowed to read."
              >
                <NumberInput
                  value={settings.maxCandidatesPerRun}
                  min={1}
                  max={500}
                  onValueChange={(v) =>
                    v !== null && void onUpdateSettings({ maxCandidatesPerRun: v })
                  }
                  style={{ maxWidth: 110 }}
                />
              </Field>
              <div className="row">
                <Button size="sm" icon="refresh" busy={rescoring} onClick={() => void runRescore()}>
                  Rescore stored mail
                </Button>
                {rescore ? <span className="field-hint">{rescore}</span> : null}
              </div>
            </FormSection>

            <hr className="rule" />

            {/* ── agent ────────────────────────────────────────────────── */}
            <FormSection
              title="Agent"
              hint="Claude never writes to the tracker directly. Every change it wants to make lands in the Review queue for you to accept or reject."
            >
              <Field label="Model">
                <Select
                  value={settings.model}
                  options={MODEL_OPTIONS}
                  onValueChange={(v) => void onUpdateSettings({ model: v })}
                  style={{ maxWidth: 200 }}
                />
              </Field>
              <Toggle
                checked={settings.enrichmentEnabled}
                onCheckedChange={(v) => void onUpdateSettings({ enrichmentEnabled: v })}
                label="Look up company descriptions on the web"
                hint="Runs a separate, isolated agent that receives only a company name — no message data and no access to your tracker. Off by default."
              />
              {appInfo.data && !appInfo.data.claudeCliAvailable ? (
                <Banner tone="warning" icon="terminal" title="Claude Code isn't installed">
                  Recruit couldn&apos;t find the <code>claude</code> binary on this machine. Triage
                  runs are unavailable until it is installed.
                </Banner>
              ) : null}
            </FormSection>

            <hr className="rule" />

            {/* ── mail ─────────────────────────────────────────────────── */}
            <FormSection title="Mail">
              <Toggle
                checked={settings.blockRemoteImages}
                onCheckedChange={(v) => void onUpdateSettings({ blockRemoteImages: v })}
                label="Block remote images"
                hint="Stops senders using image loads to confirm you opened a message. You can load them per message."
              />
              <Field label="Check for new mail every" hint="Minutes between background syncs.">
                <NumberInput
                  value={settings.syncIntervalMinutes}
                  min={1}
                  max={240}
                  onValueChange={(v) =>
                    v !== null && void onUpdateSettings({ syncIntervalMinutes: v })
                  }
                  style={{ maxWidth: 110 }}
                />
              </Field>
            </FormSection>

            <hr className="rule" />

            {/* ── appearance ───────────────────────────────────────────── */}
            <FormSection title="Appearance">
              <Field label="Theme">
                <div>
                  <Segmented
                    value={settings.theme}
                    options={THEME_OPTIONS}
                    aria-label="Theme"
                    onValueChange={(v) => void onUpdateSettings({ theme: v })}
                  />
                </div>
              </Field>
            </FormSection>

            <hr className="rule" />

            {/* ── about ────────────────────────────────────────────────── */}
            <FormSection title="About">
              {appInfo.data ? (
                <KeyValue>
                  <KeyValueRow label="Version">{appInfo.data.version}</KeyValueRow>
                  <KeyValueRow label="Electron">{appInfo.data.electronVersion}</KeyValueRow>
                  <KeyValueRow label="Claude Code">
                    {appInfo.data.claudeCliAvailable ? (
                      <Badge tone="success">Available</Badge>
                    ) : (
                      <Badge tone="warning">Not found</Badge>
                    )}
                  </KeyValueRow>
                  <KeyValueRow label="Database">
                    <span className="mono" style={{ fontSize: 'var(--fs-xs)' }}>
                      {appInfo.data.dbPath}
                    </span>
                  </KeyValueRow>
                </KeyValue>
              ) : (
                <div className="field-hint">{appInfo.error ?? 'Loading…'}</div>
              )}
            </FormSection>
          </>
        )}
      </PaneBody>
    </Pane>
  )
}
