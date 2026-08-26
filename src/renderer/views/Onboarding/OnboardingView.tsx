import type { NavKey, SetupState } from '@shared/types'
import { Button, Card, CardBody, CardHeader, Icon, IconButton } from '@renderer/components'

/**
 * First-run setup: add account → sync → first scan → review.
 *
 * Two presentations, one definition of the steps:
 *  - <OnboardingView>   full-page, shown when there is no account at all.
 *  - <SetupChecklist>   the same list as a dismissible card above a populated view.
 */

export interface SetupActions {
  onNavigate: (key: NavKey) => void
  onSync: () => void
  onRun: () => void
  syncing?: boolean
  running?: boolean
  /** Disables the "first scan" action and explains why (no candidates, no Claude). */
  runDisabledReason?: string | null
}

interface Step {
  title: string
  description: string
  done: boolean
  actionLabel: string
  onAction: () => void
  busy?: boolean
  disabledReason?: string | null
}

function buildSteps(setup: SetupState, actions: SetupActions): Step[] {
  return [
    {
      title: 'Add your mail account',
      description:
        'IMAP details and an app password. Recruit reads your inbox; it never sends mail.',
      done: setup.hasAccount,
      actionLabel: setup.hasAccount ? 'Edit account' : 'Add account',
      onAction: () => actions.onNavigate('settings')
    },
    {
      title: 'Sync your inbox',
      description: 'Pull recent mail down and score it locally with the prefilter.',
      done: setup.hasSynced,
      actionLabel: 'Sync now',
      onAction: actions.onSync,
      busy: actions.syncing,
      disabledReason: setup.hasAccount ? null : 'Add an account first'
    },
    {
      title: 'Run the first scan',
      description:
        'Claude reads only the flagged candidates and proposes tracker entries. It cannot change anything by itself.',
      done: setup.hasRun,
      actionLabel: 'Run scan',
      onAction: actions.onRun,
      busy: actions.running,
      disabledReason: setup.hasSynced ? actions.runDisabledReason ?? null : 'Sync your inbox first'
    },
    {
      title: 'Review what Claude found',
      description: 'Accept or reject each proposal. Nothing lands in the tracker until you say so.',
      done: setup.hasReviewed,
      actionLabel: 'Open review',
      onAction: () => actions.onNavigate('review'),
      disabledReason: setup.hasRun ? null : 'Run a scan first'
    }
  ]
}

function StepRow({ step, index, isCurrent }: { step: Step; index: number; isCurrent: boolean }): JSX.Element {
  const cls =
    'checklist-step' + (step.done ? ' is-done' : '') + (isCurrent ? ' is-current' : '')
  return (
    <div className={cls}>
      <span className="checklist-marker">
        {step.done ? <Icon name="check" size={11} /> : index + 1}
      </span>
      <div className="checklist-main">
        <div className="checklist-title">{step.title}</div>
        <div className="checklist-desc">{step.description}</div>
      </div>
      <div className="checklist-action">
        {step.done && !isCurrent ? null : (
          <Button
            size="sm"
            variant={isCurrent ? 'primary' : 'default'}
            busy={step.busy}
            disabled={Boolean(step.disabledReason)}
            title={step.disabledReason ?? undefined}
            onClick={step.onAction}
          >
            {step.actionLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

export interface ChecklistProps extends SetupActions {
  setup: SetupState
}

/** Just the four rows. */
export function Checklist({ setup, ...actions }: ChecklistProps): JSX.Element {
  const steps = buildSteps(setup, actions)
  const currentIndex = steps.findIndex((s) => !s.done)
  return (
    <div className="checklist">
      {steps.map((step, i) => (
        <StepRow key={step.title} step={step} index={i} isCurrent={i === currentIndex} />
      ))}
    </div>
  )
}

export interface SetupChecklistProps extends ChecklistProps {
  onDismiss?: () => void
}

/** Dismissible card version, for the top of a view that already has content. */
export function SetupChecklist({
  setup,
  onDismiss,
  ...actions
}: SetupChecklistProps): JSX.Element | null {
  if (setup.complete) return null
  const done = [setup.hasAccount, setup.hasSynced, setup.hasRun, setup.hasReviewed].filter(
    Boolean
  ).length
  return (
    <Card className="setup-card">
      <CardHeader title="Finish setting up Recruit">
        <span className="secondary" style={{ fontSize: 'var(--fs-sm)' }}>
          {done} of 4
        </span>
        {onDismiss ? <IconButton icon="x" label="Hide setup checklist" onClick={onDismiss} size={12} /> : null}
      </CardHeader>
      <CardBody>
        <Checklist setup={setup} {...actions} />
      </CardBody>
    </Card>
  )
}

export interface OnboardingViewProps extends ChecklistProps {
  onDismiss?: () => void
}

/** Full-page first-run state. */
export default function OnboardingView({
  setup,
  onDismiss,
  ...actions
}: OnboardingViewProps): JSX.Element {
  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-eyebrow">Recruit</div>
        <h1 className="onboarding-title">Turn your inbox into a job tracker</h1>
        <p className="onboarding-lede">
          Recruit reads your mail, flags the messages that look like applications and interviews,
          and lets Claude propose tracker entries — which you approve one at a time.
        </p>
        <Checklist setup={setup} {...actions} />
        <div className="onboarding-footer">
          <span className="field-hint" style={{ flex: 1 }}>
            Everything stays on this Mac. Passwords live in your Keychain, mail lives in a local
            SQLite database.
          </span>
          {onDismiss ? (
            <Button variant="subtle" size="sm" onClick={onDismiss}>
              Skip for now
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
