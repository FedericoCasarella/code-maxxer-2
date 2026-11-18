/** Project report: what the agents did, how long it took them, how long it would have taken you. */

export type ReportPeriod = 7 | 30 | 90 | 0 // 0 = all time

/** Human-minutes per unit of work (the old code-maxxer's constants). */
export const HUMAN_MINUTES = {
  lineAdded: 1,
  lineRemoved: 0.2,
  file: 5,
  qaPass: 20,
  bug: 15,
  spec: 40,
  review: 60,
  ship: 15,
  other: 15,
  /** Your own time */
  yourAnswer: 3,
  yourReview: 8
} as const

export type ReportAgent = { name: string; role: string; ms: number; tokens: number; savedMin: number }
export type ReportDay = { day: string; label: string; byAgent: Record<string, number>; opened: number; resolved: number }
export type ReportItem = { key: string; label: string; count: number; min: number }

export type ProjectReport = {
  projectId: string
  period: ReportPeriod
  /** Wall-clock time the agents worked */
  agentMs: number
  /** Estimated time it would have taken you, and what it took you (answers, reviews) */
  humanMin: number
  yourMin: number
  savedMin: number
  items: ReportItem[]
  agents: ReportAgent[]
  /** Daily (or weekly, for long periods) buckets */
  days: ReportDay[]
  bucket: 'day' | 'week'
  kpis: {
    runs: number
    runsFailed: number
    issuesResolved: number
    issuesOpen: number
    files: number
    linesAdded: number
    linesRemoved: number
    commits: number
    plansDone: number
    plans: number
    questions: number
    tokens: number
    costUsd: number
  }
}

export type ReportApi = { project(projectId: string, period: ReportPeriod): Promise<ProjectReport> }
