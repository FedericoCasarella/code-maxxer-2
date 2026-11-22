/** Auto-learning: after each run the agent reviews how it went and proposes lessons for the project. */

export type LessonStatus = 'proposed' | 'active' | 'rejected' | 'retired'
/** always: something to do every time; never: something to stop doing; know: a fact about the project */
export type LessonKind = 'always' | 'never' | 'know'
export type Lesson = {
  id: string
  projectId: string
  cycleId: string | null
  /** The rule, a full sentence */
  title: string
  /** Why: what happened in the run that taught it */
  body: string
  kind: LessonKind
  /** When it applies */
  situation: string
  /** A technical note the agent saved for itself, without asking */
  auto: boolean
  status: LessonStatus
  /** Runs where following it went well / where it was ignored or proved wrong */
  confirmations: number
  violations: number
  at: number
  /** The run it came from */
  origin: { workspaceId: string; branch: string; messageId: string; model: string | null; run: string } | null
}

/** What a run left behind, measured without a model. */
export type RunSignals = {
  tools: number
  toolErrors: number
  failedCommands: string[]
  filesEdited: number
  commits: number
  ms: number
  tokens: number
  cost: number | null
  error: string | null
  interrupted: boolean
  asked: boolean
}

export type CycleStatus = 'running' | 'done' | 'needs_you' | 'failed'
export type LearningCycle = {
  id: string
  projectId: string
  workspaceId: string
  branch: string
  messageId: string
  model: string | null
  status: CycleStatus
  outcome: 'success' | 'partial' | 'failed' | null
  title: string
  /** How the run went (or, when the review failed, why) */
  conclusion: string
  /** What went wrong or cost time in the run */
  problem: string
  /** What changes in the next runs if the lessons are kept */
  fix: string
  signals: RunSignals
  /** Lessons proposed by this cycle */
  lessons: Lesson[]
  /** Active lessons this run confirmed / went against */
  confirmed: string[]
  violated: string[]
  at: number
}

/** How the strategist judged a loop run: worth it, wasted, or it changed nothing. */
export type LoopVerdict = 'good' | 'bad' | 'no_effect'
export type LoopRunStats = {
  ok: boolean
  loops: number
  /** Issues still open at the end */
  open: number
  tokens: number
  ms: number
  nodes: { id: string; label: string; role: string; model: string; skipped: boolean; status: string; visits: number; ms: number; tokens: number; issues: number }[]
}
/** A change the strategist made to a loop: a node's model, or a node skipped. */
export type LoopTweak = {
  id: string
  pipelineId: string
  reviewId: string | null
  nodeId: string
  nodeLabel: string
  kind: 'model' | 'skip'
  value: string
  reason: string
  /** rolled_back: the loop got worse after it, so it was undone on its own */
  status: 'active' | 'undone' | 'rolled_back'
  at: number
}
export type LoopReview = {
  id: string
  workspaceId: string
  branch: string
  messageId: string
  pipelineId: string
  pipelineName: string
  task: string
  verdict: LoopVerdict
  summary: string
  stats: LoopRunStats
  at: number
  tweaks: LoopTweak[]
}

export type LearningState = { projectId: string; enabled: boolean; cycles: LearningCycle[]; lessons: Lesson[]; loops: LoopReview[] }

export type LearningApi = {
  state(projectId: string): Promise<LearningState>
  setEnabled(projectId: string, enabled: boolean): Promise<void>
  /** Keep (active) or discard a proposed lesson. */
  decide(lessonId: string, keep: boolean): Promise<void>
  /** Replace a proposed lesson with the user's own words, in use right away. */
  custom(lessonId: string, text: string): Promise<void>
  /** Stop or start using a lesson. */
  setStatus(lessonId: string, status: 'active' | 'retired'): Promise<void>
  remove(lessonId: string): Promise<void>
  /** Run a failed review again. */
  retry(cycleId: string): Promise<void>
  /** Undo a change the strategist made to a loop. */
  undoTweak(id: string): Promise<void>
}

/*
 * The brain across every project: rules that came up in more than one project, agents for the kind of work
 * that keeps coming back, and how the work goes over time.
 */
export type GlobalRule = {
  id: string
  title: string
  body: string
  kind: LessonKind
  situation: string
  status: LessonStatus
  /** The projects it came up in */
  projects: string[]
  at: number
}
/** An agent the cross-project reviewer proposes for work that keeps coming back. */
export type AgentSuggestion = {
  id: string
  handle: string
  name: string
  description: string
  instructions: string
  /** The rules it would follow, in plain words */
  rules: string[]
  /** The runs that show the need, by their titles */
  evidence: string[]
  projects: string[]
  status: 'proposed' | 'accepted' | 'rejected'
  at: number
}
/** One week of runs, every project together. */
export type ProgressWeek = { week: number; runs: number; success: number; partial: number; failed: number }
export type ProjectProgress = { projectId: string; name: string; runs: number; success: number; lessons: number; last: number | null }
/** A kind of work that came back more than once. */
export type RecurringWork = { label: string; count: number; projects: string[] }
export type GlobalBrain = {
  rules: GlobalRule[]
  agents: AgentSuggestion[]
  weeks: ProgressWeek[]
  projects: ProjectProgress[]
  work: RecurringWork[]
  sweepAt: number | null
  sweeping: boolean
  error: string | null
}
export type GlobalBrainApi = {
  state(): Promise<GlobalBrain>
  /** Keep (in every project's runs) or discard a proposed rule. */
  decideRule(id: string, keep: boolean): Promise<void>
  setRuleStatus(id: string, status: 'active' | 'retired'): Promise<void>
  removeRule(id: string): Promise<void>
  /** Create the proposed agent, or discard it. Returns the new agent's handle. */
  decideAgent(id: string, keep: boolean): Promise<string | null>
  /** Look across the projects now. */
  sweep(): Promise<void>
}
