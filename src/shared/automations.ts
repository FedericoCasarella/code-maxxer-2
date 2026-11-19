/**
 * Automations: something that starts on its own (a schedule, a push, new commits) and runs a few steps
 * in a chosen workspace: a prompt to the agent, a pipeline, a shell command, a comment on the branch's PR.
 */

export type ScheduleKind = 'hourly' | 'daily' | 'weekdays' | 'weekly'

export type Trigger =
  /** At a time: every hour at :minute, every day / weekday / chosen weekdays at hour:minute (local time). */
  | { kind: 'schedule'; every: ScheduleKind; hour: number; minute: number; days?: number[] }
  /** The branch was pushed (its remote-tracking ref caught up with a new local commit). */
  | { kind: 'push'; branches: string }
  /** New commits on a branch (local commits, or pulled/fetched ones). */
  | { kind: 'commit'; branches: string }

export type Step =
  /** A prompt to the agent. {{branch}}, {{commit}}, {{output}} (the previous step's output) are filled in. */
  | { kind: 'prompt'; text: string; model: string; effort: 'low' | 'medium' | 'high'; fullAccess: boolean }
  | { kind: 'pipeline'; pipelineId: string; text: string; model: string }
  /** A shell command in the workspace folder. A non-zero exit fails the run. */
  | { kind: 'shell'; command: string; timeoutSec: number }
  /** A comment on the open PR of the run's branch (gh). Empty text: the previous step's output. */
  | { kind: 'pr_comment'; text: string }

export type Automation = {
  id: string
  projectId: string
  name: string
  enabled: boolean
  trigger: Trigger
  steps: Step[]
  /** Where it runs: a fixed workspace, or a new branch (worktree) each time. */
  location: { kind: 'workspace'; workspaceId: string } | { kind: 'new' }
  /** Prompt steps: a new conversation each run, or the same one as last time. */
  session: 'fresh' | 'reuse'
  /** A run missed while the app was closed still starts if the app opens within this many hours. 0: skip it. */
  graceHours: number
  /** Runs first in the workspace folder; a non-zero exit or empty output skips the run. Empty: none. */
  precheck: { command: string; timeoutSec: number }
  createdAt: number
  updatedAt: number
  /** Computed */
  nextRun: number | null
  lastRun: { at: number; status: RunStatus } | null
  /** Sum of the model cost of its runs, USD */
  spend: number
}

export type RunStatus = 'running' | 'success' | 'failed' | 'skipped'

export type AutomationRun = {
  id: string
  automationId: string
  /** What started it, in words: "Weekdays at 9:00", "Push to main · 3f2a1c9", "Run now" */
  cause: string
  status: RunStatus
  startedAt: number
  endedAt: number | null
  workspaceId: string | null
  branch: string | null
  /** One line per step, and the last output (trimmed) */
  steps: { kind: Step['kind']; status: RunStatus; output: string }[]
  error: string | null
  cost: number
}

export type AutomationDraft = Pick<Automation, 'projectId' | 'name' | 'enabled' | 'trigger' | 'steps' | 'location' | 'session' | 'graceHours' | 'precheck'>

export type AutomationsApi = {
  list(): Promise<Automation[]>
  runs(automationId?: string, limit?: number): Promise<AutomationRun[]>
  save(draft: AutomationDraft, id?: string): Promise<Automation>
  setEnabled(id: string, enabled: boolean): Promise<void>
  remove(id: string): Promise<void>
  runNow(id: string): Promise<void>
}

/** Starting points, shown in the empty state and under "Use template". Texts are English keys (the UI translates them). */
export type AutomationTemplate = { id: string; name: string; description: string; draft: Omit<AutomationDraft, 'projectId' | 'location'> & { location: 'workspace' | 'new' } }

const AGENT = { model: 'claude-opus-5-5', effort: 'medium' as const, fullAccess: true }

export const TEMPLATES: AutomationTemplate[] = [
  {
    id: 'weekday-audit',
    name: 'Weekday repo audit',
    description: 'Every weekday morning: dependencies, failing tests, lint and risky open changes, with the next action.',
    draft: {
      name: 'Weekday repo audit', enabled: true, session: 'fresh', graceHours: 12, location: 'workspace',
      trigger: { kind: 'schedule', every: 'weekdays', hour: 9, minute: 0 },
      precheck: { command: '', timeoutSec: 60 },
      steps: [{ kind: 'prompt', ...AGENT, text: 'Review the repository health. Check dependency updates, failing tests, lint/typecheck status, and risky open changes. Summarize findings and suggest the next action.' }]
    }
  },
  {
    id: 'test-on-push',
    name: 'Tests on every push',
    description: 'When you push, the tests run and the result goes on the pull request.',
    draft: {
      name: 'Tests on every push', enabled: true, session: 'fresh', graceHours: 0, location: 'workspace',
      trigger: { kind: 'push', branches: '*' },
      precheck: { command: '', timeoutSec: 60 },
      steps: [
        { kind: 'shell', command: 'npm test', timeoutSec: 600 },
        { kind: 'pr_comment', text: '' }
      ]
    }
  },
  {
    id: 'review-commits',
    name: 'Review new commits',
    description: 'When new commits land on a branch, the agent reviews them and comments on the pull request.',
    draft: {
      name: 'Review new commits', enabled: true, session: 'fresh', graceHours: 0, location: 'workspace',
      trigger: { kind: 'commit', branches: '*' },
      precheck: { command: '', timeoutSec: 60 },
      steps: [
        { kind: 'prompt', ...AGENT, fullAccess: false, text: 'Review the commits that just landed on {{branch}} (up to {{commit}}). Look for bugs, risky changes and missing tests. Do not edit files: reply with a short review.' },
        { kind: 'pr_comment', text: '' }
      ]
    }
  },
  {
    id: 'nightly-deps',
    name: 'Nightly dependency updates',
    description: 'Every night, on a new branch: updates the dependencies that are safe to update, checks the build, commits.',
    draft: {
      name: 'Nightly dependency updates', enabled: true, session: 'fresh', graceHours: 6, location: 'new',
      trigger: { kind: 'schedule', every: 'daily', hour: 2, minute: 0 },
      precheck: { command: 'npm outdated --json', timeoutSec: 120 },
      steps: [{ kind: 'prompt', ...AGENT, text: 'Update the dependencies that are safe to update (patch and minor). Run the build and the tests, fix what breaks, and commit. List what you updated and anything you left out.' }]
    }
  }
]
