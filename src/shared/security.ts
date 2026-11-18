/** Cyber Security (Pro): integrity of the software and of the production / staging servers, findings and scans. */

export type SecTarget = 'software' | 'production' | 'staging'
export type SecSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'
export type FindingStatus = 'open' | 'resolved' | 'accepted' | 'false_positive'

/**
 * Points open findings take off their target's 100: the first of a severity costs `first`, each more `next`
 * (ten copies of one problem should not weigh like ten different problems).
 */
export const SEVERITY_PENALTY: Record<SecSeverity, { first: number; next: number }> = {
  critical: { first: 40, next: 10 },
  high: { first: 15, next: 5 },
  medium: { first: 6, next: 2 },
  low: { first: 2, next: 1 },
  info: { first: 0, next: 0 }
}
export const penalty = (counts: Partial<Record<SecSeverity, number>>) =>
  (Object.entries(counts) as [SecSeverity, number][]).reduce((a, [s, n]) => a + (n > 0 ? SEVERITY_PENALTY[s].first + (n - 1) * SEVERITY_PENALTY[s].next : 0), 0)

export type SecFinding = {
  id: string
  projectId: string
  target: SecTarget
  severity: SecSeverity
  category: string
  title: string
  detail: string
  location: string
  remediation: string
  status: FindingStatus
  firstSeen: number
  lastSeen: number
  resolvedAt: number | null
  scanId: string | null
}

export type SecScan = {
  id: string
  target: SecTarget
  status: 'running' | 'done' | 'failed'
  trigger: 'manual' | 'scheduled'
  summary: string
  /** The agent's own estimate, kept next to the score we compute */
  agentIntegrity: number | null
  error: string | null
  costUsd: number | null
  startedAt: number
  finishedAt: number | null
}

export type TargetState = {
  target: SecTarget
  /** null: never scanned, or no environment connected */
  score: number | null
  /** The score after the previous scan, for the delta */
  previous: number | null
  connected: boolean
  lastScan: SecScan | null
  running: boolean
  open: number
}

/** Repeat scans on these weekdays (0 = Sunday) at this local time. */
export type SecSchedule = { enabled: boolean; days: number[]; time: string; targets: SecTarget[] }

export type SecDashboard = {
  projectId: string
  targets: TargetState[]
  /** New findings per day, by severity */
  days: { day: string; label: string; total: number; critical: number; high: number; medium: number; low: number }[]
  byCategory: { name: string; count: number }[]
  byTarget: { name: string; count: number }[]
  findings: SecFinding[]
  schedule: SecSchedule
}

export type SecurityApi = {
  dashboard(projectId: string, days: number): Promise<SecDashboard>
  scan(projectId: string, targets: SecTarget[]): Promise<void>
  setStatus(findingId: string, status: FindingStatus): Promise<void>
  setSchedule(projectId: string, s: SecSchedule): Promise<void>
  /** Send a finding to the project's chat for the agent to fix. */
  fix(findingId: string): Promise<string>
}
