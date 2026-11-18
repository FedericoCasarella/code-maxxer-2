/** Auto-learning: after each run the agent reviews how it went and proposes lessons for the project. */

export type LessonStatus = 'proposed' | 'active' | 'rejected' | 'retired'
export type Lesson = {
  id: string
  projectId: string
  cycleId: string | null
  title: string
  body: string
  status: LessonStatus
  /** Runs where following it went well / where it was ignored or proved wrong */
  confirmations: number
  violations: number
  at: number
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
  status: CycleStatus
  outcome: 'success' | 'partial' | 'failed' | null
  title: string
  /** One or two sentences for the user: how the run went and what was learned */
  conclusion: string
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
  retire(lessonId: string): Promise<void>
}
