// Shared contracts between main (engine) and renderer (UI).

export type Project = {
  id: string
  name: string
  path: string
  color: string
  createdAt: string
  /** Owner of the git remote (e.g. GitHub user/org), when there is one. */
  owner: string | null
  /** Owner avatar (GitHub), shown before the name. */
  avatarUrl: string | null
  folderId: string | null
  spaceId: string | null
  sort: number
}

export type ProjectFolder = { id: string; name: string; sort: number; collapsed: boolean; spaceId: string | null }

/** User-facing "Workspace": the top-level set of projects you work on (e.g. Personal, Agency). */
export type Space = { id: string; name: string; color: string; sort: number }

/** A Claude Code session found on disk for a workspace's directory. */
export type AgentSession = {
  id: string
  workspaceId: string
  projectId: string
  title: string
  provider: 'claude'
  model: string | null
  messages: number
  updatedAt: number
  firstPrompt: string
  latest: { role: 'user' | 'agent'; text: string }[]
  file: string
  cwd: string
}

export type Workspace = {
  id: string
  projectId: string
  name: string
  branch: string
  worktreePath: string
  status: 'idle' | 'running' | 'done' | 'error'
  sessionId: string | null
  updatedAt: string
}

/** Node roles a pipeline can contain. The single agent plays each role in turn. */
export type NodeRole = 'plan' | 'spec' | 'build' | 'qa' | 'review' | 'security' | 'ship'

/** A persona the orchestrator plays while running a node: who it is and how it works. */
export type Agent = {
  id: string
  name: string
  role: NodeRole
  description: string
  /** Standing instructions merged into every node this agent plays. */
  instructions: string
  builtIn: boolean
  /** Custom agents refined in a chat: called with @handle, they bring their skills */
  custom?: boolean
  handle?: string | null
  skills?: string[]
  skillNames?: string[]
  sourceWorkspaceId?: string | null
  /** Model it was trained with (its icon in the UI) */
  model?: string | null
  createdAt?: number
}

/** A file the user attached to a prompt, saved where the agent can read it. */
export type Attachment = { path: string; name: string; kind: 'image' | 'file'; size: number }

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'wontfix'

/** A plan the agent proposes for a big request: ordered tasks it then works through, one commit each. */
export type PlanStatus = 'proposed' | 'running' | 'done' | 'cancelled'
export type PlanTaskStatus = 'todo' | 'in_progress' | 'done' | 'skipped' | 'failed'
/** One thing the agent did while on a task (edit, command, commit…): the task's checkpoints. */
export type PlanStep = {
  id: string
  title: string
  kind: NodeTask['kind']
  status: 'running' | 'done' | 'error'
  startedAt: number
  ms?: number
  count?: number
  file?: string
}
export type PlanTask = {
  id: string
  planId: string
  position: number
  title: string
  detail: string
  files: string[]
  status: PlanTaskStatus
  startedAt: number | null
  finishedAt: number | null
  note: string | null
  steps: PlanStep[]
  commits: { sha: string; subject: string }[]
}
export type Plan = {
  id: string
  workspaceId: string
  title: string
  summary: string
  status: PlanStatus
  /** The assistant message that proposed it (link back to the chat) */
  messageId: string | null
  createdAt: number
  tasks: PlanTask[]
}
/** A plan task on the project board, with where it lives. */
export type BoardTask = PlanTask & { planTitle: string; workspaceId: string; branch: string; projectId: string; projectName: string }

export type Issue = {
  id: string
  workspaceId: string
  workspaceName: string
  branch: string
  projectId: string
  projectName: string
  title: string
  body: string
  nodeId: string | null
  status: IssueStatus
  createdAt: string
  githubUrl: string | null
}

/** Per-project mirror of issues to GitHub Issues + a GitHub Project board. */
export type GithubMirror = {
  enabled: boolean
  repo: string | null
  boardUrl: string | null
  boardNumber: number | null
  lastSync: number | null
  error: string | null
  /** gh is logged in without the "project" scope: issues sync, the board doesn't. */
  needsScope: boolean
}

export type PipelineNode = {
  id: string
  role: NodeRole
  /** Agent persona playing this node (falls back to the role's built-in agent). */
  agentId?: string
  label: string
  /** What the agent must do while playing this node. */
  instructions: string
  /** On a failed verdict, jump back to this node id (the loop). */
  onFail?: string
  /** Model for this node only; nodes with another model than the pipeline's run as a separate agent with a handoff. */
  model?: string
  /** Position on the editor canvas. */
  x?: number
  y?: number
}

export type Pipeline = {
  /** Model the whole pipeline runs with in one session (default: the composer's). */
  model?: string
  builtIn?: boolean
  id: string
  name: string
  description: string
  nodes: PipelineNode[]
  maxLoops: number
}

export type NodeStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export type PipelineRunState = {
  runId: string
  pipelineId: string
  name: string
  nodes: (PipelineNode & {
    status: NodeStatus
    note?: string
    visits: number
    /** Time spent running (closed passes) and the start of the open one. */
    ms?: number
    since?: number
    /** Output tokens written while playing this node (Claude only). */
    tokens?: number
    /** What the agent did while it was this node: edits, commands, browser, issues. */
    tasks?: NodeTask[]
  })[]
  current: string | null
  loops: number
  maxLoops: number
  issues: { id: string; title: string; nodeId: string; resolved: boolean }[]
  status: 'running' | 'completed' | 'failed' | 'stopped'
  /** The user's request, shown as the task travelling down the relay. */
  task?: string
  model?: string
  /** What each node passed on to the next (UI mirror, built in main). */
  handoffs?: Handoff[]
}

export type NodeTask = {
  id: string
  title: string
  kind: 'edit' | 'create' | 'run' | 'commit' | 'browse' | 'issue' | 'agent' | 'web'
  status: 'running' | 'done' | 'error'
  startedAt: number
  ms?: number
  /** Same edit repeated on one file: shown once with a count. */
  count?: number
}

export type HandoffItem = {
  id: string
  label: string
  kind: 'file' | 'issue' | 'note'
  /** Didn't make it: e.g. an issue still open when the work moved on. */
  lost?: boolean
  why?: string
}

export type Handoff = {
  id: string
  from: string
  to: string
  /** Loop-back after a failed node. */
  back: boolean
  title: string
  items: HandoffItem[]
  status: 'working' | 'done' | 'warning'
  at: number
}

export type ExecMode = { kind: 'direct' } | { kind: 'pipeline'; pipelineId: string } | { kind: 'sentient' }

export type AgentId = 'claude' | 'codex'
export type Provider = 'claude' | 'codex' | 'opencode'
export type McpInfo = { url: string; token: string; enabled: boolean; auth: boolean; running: boolean }
export type ModelInfo = { id: string; label: string; provider: Provider; description: string }

export type SendOptions = {
  workspaceId: string
  text: string
  model: string
  effort: 'low' | 'medium' | 'high'
  mode: ExecMode
  fullAccess: boolean
  attachments?: Attachment[]
  /** Internal: start by forking this Claude session (branch fork). */
  forkFrom?: string
  /** Internal: continue a pipeline run with the next segment (different model), after a handoff. */
  segment?: { runId: string; handoff: string }
  /** Internal: the id the user message gets (a scheduled run uses its own id, so the panel can link to it). */
  userMessageId?: string
}

export type ScheduledRun = {
  id: string
  workspaceId: string
  text: string
  at: number
  status: 'pending' | 'sent' | 'failed' | 'cancelled'
  /** Who scheduled it: you from the composer, or the orchestrator through its tool. */
  source: 'user' | 'agent'
  error?: string | null
  sentAt?: number | null
}

/** One pipeline run, for the Runs table. */
export type RunRow = {
  runId: string
  pipelineId: string
  pipelineName: string
  task: string | null
  status: PipelineRunState['status']
  loops: number
  workspaceId: string
  branch: string
  projectName: string
  createdAt: number
}

export type LicenseStatus = {
  /** free: no license (the app works); active: Pro unlocked */
  state: 'free' | 'active' | 'expired' | 'invalid'
  license: { id: string; name: string; email: string; plan: string; expiresAt: number | null; daysLeft: number | null } | null
  device: string
  server: string
  lastCheck: number | null
  detail: string | null
}

/** A prompt sent while the agent was busy: it runs when the current turn ends (or now, with Steer). */
export type QueueItem = { id: string; workspaceId: string; text: string; at: number }

export type BranchInfo = { name: string; updatedAt: number; workspaceId: string | null; current: boolean }

/** Blocks of one assistant turn, in arrival order (Claude-style transcript). */
export type Block =
  | { kind: 'thinking'; id: string; text: string; done: boolean; startedAt: number; endedAt?: number }
  /** A pipeline segment taken over by another model, with what the previous agent handed on. */
  | { kind: 'handoff'; id: string; model: string; toNode: string; text: string }
  /** The conversation continued in a new branch (shown as an alert in the old chat). */
  | { kind: 'fork'; id: string; branch: string; prompt: string; workspaceId: string | null; error?: string }
  | { kind: 'text'; id: string; text: string }
  | {
      kind: 'tool'
      id: string
      name: string
      input: unknown
      status: 'running' | 'success' | 'error'
      result?: unknown
      startedAt: number
      duration?: number
      file?: { path: string; added: number; removed: number }
    }
  | { kind: 'pipeline'; id: string; runId: string }
  /** Questions for the user (Decision Inbox: two answers each, plus a free reply). */
  | { kind: 'ask'; id: string; questions: { id: string; title: string; detail?: string; primary: string; secondary: string }[] }
  /** A plan proposed in this turn (card with approve). */
  | { kind: 'plan'; id: string; planId: string }

export type Message =
  | { id: string; role: 'user'; text: string; at: number; seq?: number; attachments?: Attachment[] }
  | {
      id: string
      role: 'assistant'
      blocks: Block[]
      at: number
      done: boolean
      /** Stopped on purpose to steer with a newer prompt. */
      interrupted?: boolean
      seq?: number
      error?: string
      cost?: number
      tokens?: { input: number; output: number; cacheRead: number }
      /** When the turn ended (for reports) */
      endedAt?: number
    }

/** Engine → renderer events, scoped to a workspace. */
export type EngineEvent =
  | import('./recon').ReconEvent
  | { type: 'message'; workspaceId: string; message: Message }
  | { type: 'pipeline'; workspaceId: string; state: PipelineRunState }
  | { type: 'workspace'; workspace: Workspace }
  | { type: 'files'; workspaceId: string; event: FileEvent }
  | { type: 'plan'; plan: Plan }
  | { type: 'learning'; projectId: string }
  /** Custom agents or a chat's skills changed (installed, saved, loaded by a mention). */
  | { type: 'agents' }
  | { type: 'security'; projectId: string }
  | { type: 'skills'; workspaceId: string }
  | { type: 'devserver'; state: import('./design').DevServerState }
  | { type: 'dictation'; event: 'ready' | 'status' | 'partial' | 'final' | 'level' | 'error' | 'end'; text?: string; message?: string; level?: number }
  | { type: 'usage'; usage: UsageSnapshot }
  /** Ask the UI to switch to a branch chat (e.g. after a fork). */
  | { type: 'select'; workspaceId: string }
  | { type: 'scheduled'; runs: ScheduledRun[] }
  | { type: 'license'; status: LicenseStatus }
  | { type: 'queue'; workspaceId: string; items: QueueItem[] }
  /** Built-in browser: show the tab, move the agent's cursor, a temporary screenshot for the chat. */
  | { type: 'browser-open' }
  | { type: 'cursor'; workspaceId: string; x: number; y: number; click: boolean; label: string }
  | { type: 'shot'; workspaceId: string; dataUrl: string; caption: string; at: number }
  /** From the app menu: open the activation dialog. */
  | { type: 'license-dialog' }
  | { type: 'mcp-dialog' }

export type FileEntry = { path: string; dir: boolean }
export type FileEvent =
  | { kind: 'snapshot'; root: string; entries: FileEntry[] }
  | { kind: 'add' | 'change' | 'unlink'; path: string; dir: boolean }
  | { kind: 'active'; path: string; active: boolean }

export type UsageWindow = { label: string; usedPercent: number; resetsAt: number | null }
export type UsageSnapshot = {
  claude: { windows: UsageWindow[]; updatedAt: number | null }
  codex: { windows: UsageWindow[]; updatedAt: number | null }
}

export type BrainEntry = {
  id: string
  workspaceId: string
  kind: 'issue' | 'lesson' | 'decision'
  title: string
  body: string
  nodeId: string | null
  resolved: boolean
  createdAt: string
}

export type Api = {
  recon: import('./recon').ReconApi
  scm: import('./scm').ScmApi
  design: import('./design').DesignApi
  learning: import('./learning').LearningApi
  report: import('./report').ReportApi
  skills: import('./skills').SkillsApi
  security: import('./security').SecurityApi
  listProjects(): Promise<Project[]>
  addProject(spaceId: string | null): Promise<Project | null>
  listSpaces(): Promise<Space[]>
  saveSpace(s: Space): Promise<void>
  deleteSpace(id: string): Promise<void>
  updateProject(id: string, patch: { name?: string; folderId?: string | null; sort?: number }): Promise<void>
  removeProject(id: string, mode: 'forget' | 'delete'): Promise<void>
  revealPath(path: string): Promise<void>
  listFolders(): Promise<ProjectFolder[]>
  saveFolder(f: ProjectFolder): Promise<void>
  deleteFolder(id: string): Promise<void>
  listSessions(scope: { kind: 'workspace' | 'project' | 'space'; id?: string }): Promise<{ sessions: AgentSession[]; scanned: number }>
  resumeSession(s: AgentSession, how: 'worktree' | 'terminal'): Promise<void>
  openFile(path: string): Promise<void>
  listWorkspaces(): Promise<Workspace[]>
  listBranches(workspaceId: string): Promise<BranchInfo[]>
  listScheduled(): Promise<ScheduledRun[]>
  licenseStatus(): Promise<LicenseStatus>
  activateLicense(key: string): Promise<LicenseStatus>
  recheckLicense(): Promise<LicenseStatus>
  deactivateLicense(): Promise<LicenseStatus>
  schedule(opts: SendOptions, at: number): Promise<void>
  updateScheduled(id: string, patch: { at?: number; status?: 'cancelled' }): Promise<void>
  runScheduledNow(id: string): Promise<void>
  openBranch(projectId: string, branch: string): Promise<Workspace>
  createWorkspace(projectId: string, name: string): Promise<Workspace>
  listPipelines(): Promise<Pipeline[]>
  listModels(force?: boolean): Promise<ModelInfo[]>
  mcpInfo(): Promise<McpInfo>
  rotateMcpToken(): Promise<McpInfo>
  configureMcp(patch: { enabled?: boolean; auth?: boolean }): Promise<McpInfo>
  providersStatus(): Promise<{ id: Provider; name: string; path: string; version: string | null }[]>
  ghStatus(): Promise<{ account: string | null; scopes: string | null }>
  listRuns(): Promise<RunRow[]>
  savePipeline(p: Pipeline): Promise<Pipeline>
  deletePipeline(id: string): Promise<void>
  listAgents(): Promise<Agent[]>
  saveAgent(a: Agent): Promise<Agent>
  deleteAgent(id: string): Promise<void>
  listIssues(): Promise<Issue[]>
  githubMirror(projectId: string): Promise<GithubMirror>
  setGithubMirror(projectId: string, enabled: boolean): Promise<GithubMirror>
  syncGithub(projectId: string): Promise<GithubMirror>
  updateIssue(id: string, patch: { status?: IssueStatus; title?: string; body?: string }): Promise<void>
  getMessages(workspaceId: string): Promise<Message[]>
  getMessagesPage(workspaceId: string, o: { before?: number; around?: number; after?: number; limit?: number }): Promise<{ messages: Message[]; hasOlder: boolean; hasNewer: boolean }>
  getMessageIndex(workspaceId: string): Promise<{ id: string; seq: number; text: string; at: number }[]>
  getPipelineRuns(workspaceId: string): Promise<PipelineRunState[]>
  send(opts: SendOptions): Promise<void>
  stop(workspaceId: string): Promise<void>
  browserReady(webContentsId: number | null): Promise<void>
  listQueue(workspaceId: string): Promise<QueueItem[]>
  steer(id: string): Promise<void>
  removeQueued(id: string): Promise<void>
  editQueued(id: string, text: string): Promise<void>
  watchFiles(workspaceId: string): Promise<void>
  listPlans(workspaceId: string): Promise<Plan[]>
  /** Live dictation (Apple on-device): events arrive as { type: 'dictation' }. */
  startDictation(locale: string): Promise<void>
  stopDictation(keep: boolean): Promise<void>
  /** Save a file the user attached; returns where the agent can read it. */
  saveAttachment(workspaceId: string, name: string, data: ArrayBuffer): Promise<Attachment>
  boardTasks(): Promise<BoardTask[]>
  /** Approve (optionally with the list edited: order, titles, removed tasks) and start it. */
  approvePlan(planId: string, tasks?: { id: string; title: string }[]): Promise<void>
  cancelPlan(planId: string): Promise<void>
  updatePlanTask(id: string, patch: { status?: PlanTaskStatus; title?: string }): Promise<void>
  getUsage(): Promise<UsageSnapshot>
  refreshUsage(): Promise<UsageSnapshot>
  listBrain(workspaceId: string): Promise<BrainEntry[]>
  projectBrain(projectId: string): Promise<(BrainEntry & { branch: string })[]>
  saveBrainEntry(projectId: string, e: { id?: string; kind: BrainEntry['kind']; title: string; body: string }): Promise<void>
  deleteBrainEntry(id: string): Promise<void>
  readClaudeMd(projectId: string): Promise<{ path: string; text: string; exists: boolean }>
  writeClaudeMd(projectId: string, text: string): Promise<void>
  onEvent(cb: (e: EngineEvent) => void): () => void
}
