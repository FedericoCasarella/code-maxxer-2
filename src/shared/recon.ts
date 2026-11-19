// Recon (Pro): environments, connection scan, uptime monitor, incidents, CI/CD.

export type EnvKind = 'production' | 'staging'
export type ConnStatus = 'unverified' | 'verified' | 'profiled'
export type MonitorState = 'up' | 'retrying' | 'down' | 'unknown' | 'disabled'

export type ReconEnv = {
  id: string
  project_id: string
  kind: EnvKind
  name: string
  protocol: 'ssh' | 'sftp' | 'ftp' | 'ftps'
  host: string
  port: number
  username: string
  auth_method: 'agent' | 'key_path' | 'key' | 'password'
  key_path: string | null
  workdir: string
  rules: string
  health_url: string | null
  monitor_enabled: boolean
  interval_sec: number
  expected_status: number | null
  monitor_state: MonitorState
  last_check_at: string | null
  last_ok_at: string | null
  last_error: string | null
  connection_status: ConnStatus
  verified_at: string | null
  profile_md: string | null
  profile_summary: string | null
  has_key: boolean
  has_password: boolean
}

export type EnvInput = Partial<Omit<ReconEnv, 'id' | 'has_key' | 'has_password' | 'monitor_state' | 'last_check_at' | 'last_ok_at' | 'last_error' | 'connection_status' | 'verified_at' | 'profile_md' | 'profile_summary'>> & {
  project_id: string
  kind: EnvKind
  /** New private key (stored encrypted); empty string removes it. */
  private_key?: string
  /** New SSH password (stored encrypted, AES-256-GCM); empty string removes it. */
  password?: string
}

export type SessionKind = 'connection' | 'agent_test' | 'recon' | 'health_check' | 'diagnose'
export type ReconSession = {
  id: string
  env_id: string
  kind: SessionKind
  status: 'running' | 'done' | 'failed' | 'cancelled'
  ok: boolean | null
  summary: string | null
  result_md: string | null
  cost_usd: number | null
  started_at: string
  finished_at: string | null
}
export type SessionLog = { at: number; type: 'info' | 'cmd' | 'out' | 'err' | 'text' | 'tool'; content: string }

export type IncidentStatus = 'open' | 'diagnosing' | 'needs_info' | 'resolved' | 'failed' | 'cancelled'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type Incident = {
  id: string
  project_id: string
  env_id: string | null
  number: number
  title: string
  details: string
  severity: Severity
  source: 'manual' | 'monitor'
  status: IncidentStatus
  summary: string | null
  diagnosis: string | null
  created_at: string
  resolved_at: string | null
}

export type DeployStatus = 'queued' | 'running' | 'success' | 'failed' | 'rolled_back' | 'cancelled'
export type Deploy = {
  id: string
  env_id: string
  number: number
  trigger: 'manual' | 'push'
  ref: string
  commit_sha: string | null
  commit_message: string | null
  status: DeployStatus
  release_id: string | null
  error: string | null
  started_at: string
  finished_at: string | null
  steps: { idx: number; name: string; status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'; ms: number | null }[]
}
export type CicdConfig = { env_id: string; enabled: boolean; yaml: string; valid: boolean; errors: string[]; secrets: string[] }

export type Overview = {
  envs: { id: string; kind: EnvKind; name: string; monitor_state: MonitorState; connection_status: ConnStatus; last_check_at: string | null }[]
  uptime: { pct24h: number | null; pct7d: number | null; pctRange: number | null }
  latency24h: { t: number; ms: number | null }[]
  latencyNow: number | null
  daily: UptimeHour[]
  downtimes: { id: string; env_id: string; started_at: string; ended_at: string | null; incident_id: string | null }[]
  lastIncidentAt: string | null
  downSince: string | null
  incidents: Incident[]
  heat: { day: string; count: number }[]
}

export type ReconEvent =
  | { type: 'recon:changed'; projectId: string }
  | { type: 'recon:session-log'; sessionId: string; log: SessionLog }
  | { type: 'recon:deploy-log'; deployId: string; step: number; line: string }

export type StepState = Record<SessionKind, boolean>
/** Uptime of one hour (pct of ok checks, null: no checks that hour), oldest first. */
export type UptimeHour = { t: number; pct: number | null; ms: number | null; checks: number; fails: number }
export type EnvDetail = { env: ReconEnv; steps: StepState; sessions: (ReconSession & { logs: SessionLog[] })[]; uptime24h: UptimeHour[] | null }

/** Renderer → main calls (all refused without Pro). */
export type ReconApi = {
  envs(projectId: string): Promise<EnvDetail[]>
  saveEnv(input: EnvInput): Promise<ReconEnv>
  /** Try to log in with these settings (stored secrets fill in what the form leaves empty), without saving. */
  testAccess(input: EnvInput): Promise<{ ok: boolean; output: string; ms: number }>
  deleteEnv(id: string): Promise<void>
  scan(envId: string, kind: SessionKind): Promise<string>
  overview(projectId: string, days: number, envId: string | null): Promise<Overview>
  incidents(projectId: string): Promise<Incident[]>
  createIncident(i: { project_id: string; env_id: string | null; title: string; details: string; severity: Severity }): Promise<Incident>
  updateIncident(id: string, p: { status?: IncidentStatus }): Promise<void>
  diagnose(incidentId: string): Promise<string>
  cicd(envId: string): Promise<CicdConfig & { doc: string }>
  saveCicd(envId: string, p: { enabled?: boolean; yaml?: string }): Promise<CicdConfig & { doc: string }>
  setSecret(envId: string, name: string, value: string | null): Promise<string[]>
  deploy(envId: string): Promise<string>
  cancelDeploy(id: string): Promise<boolean>
  deploys(envId: string): Promise<Deploy[]>
  deployLogs(id: string): Promise<{ step: number; line: string }[]>
  deployById(id: string): Promise<(Deploy & { env_name: string }) | null>
}
