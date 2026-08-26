import { useCallback, useMemo, useState } from 'react'
import type {
  Account,
  AccountInput,
  ConnectionProtocol,
  ConnectionTestResult
} from '@shared/types'
import {
  Button,
  ButtonGroup,
  Field,
  FieldRow,
  FormSection,
  Icon,
  NumberInput,
  Select,
  TextInput,
  Toggle,
  errorMessage
} from '@renderer/components'

/* ── provider presets ────────────────────────────────────────────────────── */

interface Preset {
  label: string
  imapHost: string
  imapPort: number
  imapSecure: boolean
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  note?: string
}

const PRESETS: Record<string, Preset | null> = {
  custom: null,
  gmail: {
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    note: 'Gmail requires an app-specific password, not your account password.'
  },
  icloud: {
    label: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
    note: 'iCloud requires an app-specific password generated at appleid.apple.com.'
  },
  fastmail: {
    label: 'Fastmail',
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    smtpSecure: true
  },
  outlook: {
    label: 'Outlook / Microsoft 365',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false
  }
}

const PRESET_OPTIONS = [
  { value: 'custom', label: 'Custom…' },
  ...Object.entries(PRESETS)
    .filter((entry): entry is [string, Preset] => entry[1] !== null)
    .map(([value, preset]) => ({ value, label: preset.label }))
]

/* ── form state ──────────────────────────────────────────────────────────── */

interface FormState {
  email: string
  displayName: string
  imapHost: string
  imapPort: number | null
  imapSecure: boolean
  imapUser: string
  imapPassword: string
  smtpHost: string
  smtpPort: number | null
  smtpSecure: boolean
  smtpUser: string
  smtpPassword: string
}

const BLANK: FormState = {
  email: '',
  displayName: '',
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  imapUser: '',
  imapPassword: '',
  smtpHost: '',
  smtpPort: 465,
  smtpSecure: true,
  smtpUser: '',
  smtpPassword: ''
}

function fromAccount(account: Account | null): FormState {
  if (!account) return { ...BLANK }
  return {
    email: account.email,
    displayName: account.displayName ?? '',
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    imapSecure: account.imapSecure,
    imapUser: account.imapUser,
    imapPassword: '',
    smtpHost: account.smtpHost ?? '',
    smtpPort: account.smtpPort ?? 465,
    smtpSecure: account.smtpSecure ?? true,
    smtpUser: account.smtpUser ?? '',
    smtpPassword: ''
  }
}

type TestState = Partial<Record<ConnectionProtocol, ConnectionTestResult | 'busy'>>

export interface AccountFormProps {
  /** null = the "add an account" form. */
  account: Account | null
  onSaved: (account: Account) => void
  onDeleted?: (accountId: number) => void
  onCancel?: () => void
}

export function AccountForm({
  account,
  onSaved,
  onDeleted,
  onCancel
}: AccountFormProps): JSX.Element {
  const isNew = account === null
  const [form, setForm] = useState<FormState>(() => fromAccount(account))
  const [preset, setPreset] = useState('custom')
  const [tests, setTests] = useState<TestState>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // Validation stays quiet until the first save attempt — an untouched "add
  // account" form covered in red is not a helpful first impression.
  const [submitted, setSubmitted] = useState(false)

  const patch = useCallback(
    (next: Partial<FormState>) => setForm((f) => ({ ...f, ...next })),
    []
  )

  const applyPreset = useCallback(
    (key: string) => {
      setPreset(key)
      const p = PRESETS[key]
      if (!p) return
      patch({
        imapHost: p.imapHost,
        imapPort: p.imapPort,
        imapSecure: p.imapSecure,
        smtpHost: p.smtpHost,
        smtpPort: p.smtpPort,
        smtpSecure: p.smtpSecure
      })
    },
    [patch]
  )

  // Typing an address fills both usernames until the user overrides them.
  const setEmail = useCallback(
    (email: string) => {
      setForm((f) => ({
        ...f,
        email,
        imapUser: f.imapUser === '' || f.imapUser === f.email ? email : f.imapUser,
        smtpUser: f.smtpUser === '' || f.smtpUser === f.email ? email : f.smtpUser
      }))
    },
    []
  )

  const errors = useMemo(() => {
    const e: Partial<Record<keyof FormState, string>> = {}
    if (!form.email.trim()) e.email = 'Required'
    else if (!form.email.includes('@')) e.email = 'Not an email address'
    if (!form.imapHost.trim()) e.imapHost = 'Required'
    if (!form.imapPort) e.imapPort = 'Required'
    if (!form.imapUser.trim()) e.imapUser = 'Required'
    if (isNew && !form.imapPassword) e.imapPassword = 'Required'
    return e
  }, [form, isNew])

  const valid = Object.keys(errors).length === 0
  /** Only surface a field error once the user has tried to save. */
  const shown = (key: keyof FormState): string | undefined =>
    submitted ? errors[key] : undefined

  const runTest = useCallback(
    async (protocol: ConnectionProtocol) => {
      const host = protocol === 'imap' ? form.imapHost : form.smtpHost
      const port = protocol === 'imap' ? form.imapPort : form.smtpPort
      const secure = protocol === 'imap' ? form.imapSecure : form.smtpSecure
      const user = protocol === 'imap' ? form.imapUser : form.smtpUser
      const password = protocol === 'imap' ? form.imapPassword : form.smtpPassword
      if (!host || !port || !user || !password) return
      setTests((t) => ({ ...t, [protocol]: 'busy' }))
      try {
        const result = await window.recruit.testConnection({
          protocol,
          host,
          port,
          secure,
          user,
          password
        })
        setTests((t) => ({ ...t, [protocol]: result }))
      } catch (e) {
        setTests((t) => ({
          ...t,
          [protocol]: {
            ok: false,
            protocol,
            greeting: null,
            capabilities: [],
            error: errorMessage(e),
            durationMs: 0
          }
        }))
      }
    },
    [form]
  )

  const save = useCallback(async () => {
    setSubmitted(true)
    if (!valid) return
    setSaving(true)
    setSaveError(null)
    const input: AccountInput = {
      ...(account ? { id: account.id } : {}),
      email: form.email.trim(),
      displayName: form.displayName.trim() || null,
      imapHost: form.imapHost.trim(),
      imapPort: form.imapPort ?? 993,
      imapSecure: form.imapSecure,
      imapUser: form.imapUser.trim(),
      smtpHost: form.smtpHost.trim() || null,
      smtpPort: form.smtpHost.trim() ? form.smtpPort : null,
      smtpSecure: form.smtpHost.trim() ? form.smtpSecure : null,
      smtpUser: form.smtpUser.trim() || null
    }
    // Write-only: an untouched password field leaves the stored secret alone.
    if (form.imapPassword) input.imapPassword = form.imapPassword
    if (form.smtpPassword) input.smtpPassword = form.smtpPassword
    try {
      const saved = await window.recruit.saveAccount(input)
      setForm((f) => ({ ...f, imapPassword: '', smtpPassword: '' }))
      onSaved(saved)
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }, [account, form, onSaved, valid])

  const remove = useCallback(async () => {
    if (!account) return
    setSaving(true)
    try {
      await window.recruit.deleteAccount(account.id)
      onDeleted?.(account.id)
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      setSaving(false)
      setConfirmDelete(false)
    }
  }, [account, onDeleted])

  const presetNote = PRESETS[preset]?.note

  return (
    <>
      <FormSection
        title={isNew ? 'Add an account' : 'Account'}
        hint={
          isNew
            ? 'Recruit reads your inbox over IMAP. It never sends mail — SMTP details are stored and tested only.'
            : undefined
        }
      >
        {isNew ? (
          <Field label="Provider" hint={presetNote}>
            <Select value={preset} options={PRESET_OPTIONS} onValueChange={applyPreset} />
          </Field>
        ) : null}

        <FieldRow>
          <Field label="Email address" error={shown('email')}>
            <TextInput
              type="email"
              value={form.email}
              onValueChange={setEmail}
              placeholder="you@example.com"
            />
          </Field>
          <Field label="Display name">
            <TextInput
              value={form.displayName}
              onValueChange={(v) => patch({ displayName: v })}
              placeholder="Optional"
            />
          </Field>
        </FieldRow>
      </FormSection>

      <FormSection title="Incoming mail (IMAP)">
        <FieldRow>
          <Field label="Server" error={shown('imapHost')}>
            <TextInput
              value={form.imapHost}
              onValueChange={(v) => patch({ imapHost: v })}
              placeholder="imap.example.com"
            />
          </Field>
          <Field label="Port" narrow error={shown('imapPort')}>
            <NumberInput
              value={form.imapPort}
              onValueChange={(v) => patch({ imapPort: v })}
              min={1}
              max={65535}
            />
          </Field>
        </FieldRow>
        <Field label="Username" error={shown('imapUser')}>
          <TextInput value={form.imapUser} onValueChange={(v) => patch({ imapUser: v })} />
        </Field>
        <Field
          label="Password"
          error={shown('imapPassword')}
          hint={isNew ? undefined : 'Leave blank to keep the password already in your Keychain.'}
        >
          <TextInput
            type="password"
            value={form.imapPassword}
            onValueChange={(v) => patch({ imapPassword: v })}
            placeholder={isNew ? '' : '••••••••'}
            autoComplete="off"
          />
        </Field>
        <Toggle
          checked={form.imapSecure}
          onCheckedChange={(v) => patch({ imapSecure: v })}
          label="Use TLS"
          hint="On for port 993. Turn off for STARTTLS on 143."
        />
        <TestRow
          protocol="imap"
          state={tests.imap}
          canTest={Boolean(form.imapHost && form.imapPort && form.imapUser && form.imapPassword)}
          onTest={() => void runTest('imap')}
        />
      </FormSection>

      <FormSection
        title="Outgoing mail (SMTP)"
        hint="Optional in this version. Recruit stores and tests these details but never sends mail."
      >
        <FieldRow>
          <Field label="Server">
            <TextInput
              value={form.smtpHost}
              onValueChange={(v) => patch({ smtpHost: v })}
              placeholder="smtp.example.com"
            />
          </Field>
          <Field label="Port" narrow>
            <NumberInput
              value={form.smtpPort}
              onValueChange={(v) => patch({ smtpPort: v })}
              min={1}
              max={65535}
            />
          </Field>
        </FieldRow>
        <Field label="Username">
          <TextInput value={form.smtpUser} onValueChange={(v) => patch({ smtpUser: v })} />
        </Field>
        <Field
          label="Password"
          hint={isNew ? undefined : 'Leave blank to keep the stored password.'}
        >
          <TextInput
            type="password"
            value={form.smtpPassword}
            onValueChange={(v) => patch({ smtpPassword: v })}
            placeholder={isNew ? '' : '••••••••'}
            autoComplete="off"
          />
        </Field>
        <Toggle
          checked={form.smtpSecure}
          onCheckedChange={(v) => patch({ smtpSecure: v })}
          label="Use TLS"
          hint="On for port 465. Off for STARTTLS on 587."
        />
        <TestRow
          protocol="smtp"
          state={tests.smtp}
          canTest={Boolean(form.smtpHost && form.smtpPort && form.smtpUser && form.smtpPassword)}
          onTest={() => void runTest('smtp')}
        />
      </FormSection>

      <FormSection>
        {saveError ? <div className="field-error" style={{ marginBottom: 10 }}>{saveError}</div> : null}
        <div className="row">
          <Button variant="primary" onClick={() => void save()} busy={saving}>
            {isNew ? 'Add account' : 'Save changes'}
          </Button>
          {onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
          <div style={{ flex: 1 }} />
          {account && onDeleted ? (
            confirmDelete ? (
              <ButtonGroup>
                <span className="field-hint">Remove this account and its mail?</span>
                <Button variant="danger" size="sm" onClick={() => void remove()}>
                  Remove
                </Button>
                <Button size="sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </ButtonGroup>
            ) : (
              <Button variant="subtle" size="sm" icon="trash" onClick={() => setConfirmDelete(true)}>
                Remove account
              </Button>
            )
          ) : null}
        </div>
      </FormSection>
    </>
  )
}

/* ── connection test row ─────────────────────────────────────────────────── */

function TestRow({
  protocol,
  state,
  canTest,
  onTest
}: {
  protocol: ConnectionProtocol
  state: ConnectionTestResult | 'busy' | undefined
  canTest: boolean
  onTest: () => void
}): JSX.Element {
  const label = protocol === 'imap' ? 'Test IMAP connection' : 'Test SMTP connection'
  return (
    <>
      {state && state !== 'busy' ? (
        <div className={'test-result ' + (state.ok ? 'is-ok' : 'is-fail')}>
          <span className="test-result-icon">
            <Icon name={state.ok ? 'checkCircle' : 'xCircle'} size={14} />
          </span>
          <div className="test-result-body">
            {state.ok ? (
              <>
                <strong>Connected</strong> in {state.durationMs}ms
                {state.greeting ? <> · {state.greeting}</> : null}
                {state.capabilities.length > 0 ? (
                  <div className="tertiary" style={{ marginTop: 2 }}>
                    {state.capabilities.length} capabilities: {state.capabilities.slice(0, 6).join(', ')}
                    {state.capabilities.length > 6 ? '…' : ''}
                  </div>
                ) : null}
              </>
            ) : (
              state.error ?? 'Connection failed'
            )}
          </div>
        </div>
      ) : null}
      <Button
        size="sm"
        icon="refresh"
        busy={state === 'busy'}
        disabled={!canTest}
        onClick={onTest}
        title={canTest ? label : 'Enter the server, username and password first'}
      >
        {label}
      </Button>
    </>
  )
}
