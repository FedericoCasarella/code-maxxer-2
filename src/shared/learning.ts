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

export type LearningState = { projectId: string; enabled: boolean; cycles: LearningCycle[]; lessons: Lesson[] }

export type LearningApi = {
  state(projectId: string): Promise<LearningState>
  setEnabled(projectId: string, enabled: boolean): Promise<void>
  /** Keep (active) or discard a proposed lesson. */
  decide(lessonId: string, keep: boolean): Promise<void>
  /** Stop or start using a lesson. */
  setStatus(lessonId: string, status: 'active' | 'retired'): Promise<void>
  remove(lessonId: string): Promise<void>
  /** Run a failed review again. */
  retry(cycleId: string): Promise<void>
}
