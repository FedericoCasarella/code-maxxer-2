// Shared contracts between main (engine) and renderer (UI).

export type Project = {
  id: string
  name: string
  path: string
  color: string
  createdAt: string
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

export type PipelineNode = {
  id: string
  role: NodeRole
  label: string
  /** What the agent must do while playing this node. */
  instructions: string
  /** On a failed verdict, jump back to this node id (the loop). */
  onFail?: string
}

export type Pipeline = {
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
  listWorkspaces(): Promise<Workspace[]>
  createWorkspace(projectId: string, name: string): Promise<Workspace>
  listPipelines(): Promise<Pipeline[]>
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
