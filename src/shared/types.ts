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
  sort: number
}

export type ProjectFolder = { id: string; name: string; sort: number; collapsed: boolean }

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
}

export type IssueStatus = 'open' | 'in_progress' | 'resolved' | 'wontfix'

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
}

export type Pipeline = {
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
  nodes: (PipelineNode & { status: NodeStatus; note?: string; visits: number })[]
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

export type ExecMode = { kind: 'direct' } | { kind: 'pipeline'; pipelineId: string }

export type AgentId = 'claude' | 'codex'

export type SendOptions = {
  workspaceId: string
  text: string
  model: string
  effort: 'low' | 'medium' | 'high'
  mode: ExecMode
  fullAccess: boolean
}

/** Blocks of one assistant turn, in arrival order (Claude-style transcript). */
export type Block =
  | { kind: 'thinking'; id: string; text: string; done: boolean; startedAt: number; endedAt?: number }
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

export type Message =
  | { id: string; role: 'user'; text: string; at: number }
  | {
      id: string
      role: 'assistant'
      blocks: Block[]
      at: number
      done: boolean
      error?: string
      cost?: number
      tokens?: { input: number; output: number; cacheRead: number }
    }

/** Engine → renderer events, scoped to a workspace. */
export type EngineEvent =
  | { type: 'message'; workspaceId: string; message: Message }
  | { type: 'pipeline'; workspaceId: string; state: PipelineRunState }
  | { type: 'workspace'; workspace: Workspace }
  | { type: 'files'; workspaceId: string; event: FileEvent }
  | { type: 'usage'; usage: UsageSnapshot }

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
  listProjects(): Promise<Project[]>
  addProject(): Promise<Project | null>
  updateProject(id: string, patch: { name?: string; folderId?: string | null; sort?: number }): Promise<void>
  removeProject(id: string, mode: 'forget' | 'delete'): Promise<void>
  revealPath(path: string): Promise<void>
  listFolders(): Promise<ProjectFolder[]>
  saveFolder(f: ProjectFolder): Promise<void>
  deleteFolder(id: string): Promise<void>
  listSessions(scope: { kind: 'workspace' | 'project' | 'all'; id?: string }): Promise<{ sessions: AgentSession[]; scanned: number }>
  resumeSession(s: AgentSession, how: 'worktree' | 'terminal'): Promise<void>
  openFile(path: string): Promise<void>
  listWorkspaces(): Promise<Workspace[]>
  createWorkspace(projectId: string, name: string): Promise<Workspace>
  listPipelines(): Promise<Pipeline[]>
  savePipeline(p: Pipeline): Promise<Pipeline>
  deletePipeline(id: string): Promise<void>
  listAgents(): Promise<Agent[]>
  saveAgent(a: Agent): Promise<Agent>
  deleteAgent(id: string): Promise<void>
  listIssues(): Promise<Issue[]>
  updateIssue(id: string, patch: { status?: IssueStatus; title?: string; body?: string }): Promise<void>
  getMessages(workspaceId: string): Promise<Message[]>
  getPipelineRuns(workspaceId: string): Promise<PipelineRunState[]>
  send(opts: SendOptions): Promise<void>
  stop(workspaceId: string): Promise<void>
  watchFiles(workspaceId: string): Promise<void>
  getUsage(): Promise<UsageSnapshot>
  refreshUsage(): Promise<UsageSnapshot>
  listBrain(workspaceId: string): Promise<BrainEntry[]>
  onEvent(cb: (e: EngineEvent) => void): () => void
}
