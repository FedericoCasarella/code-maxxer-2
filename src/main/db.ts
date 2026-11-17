import pg from 'pg'
import type { Agent, BrainEntry, Issue, IssueStatus, Message, Pipeline, PipelineRunState, Project, Workspace } from '@shared/types'
import { DEFAULT_AGENTS, DEFAULT_PIPELINES } from './engine/pipelines'

// New, dedicated database (docker-compose service cm2-postgres on 127.0.0.1:5477).
export const DATABASE_URL = process.env.CM2_DATABASE_URL ?? 'postgres://cm2:cm2@127.0.0.1:5477/codemaxxer2'

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 })

const SCHEMA = `
create table if not exists projects (
  id text primary key, name text not null, path text not null unique,
  color text not null, created_at timestamptz not null default now()
);
create table if not exists workspaces (
  id text primary key, project_id text not null references projects(id) on delete cascade,
  name text not null, branch text not null, worktree_path text not null,
  status text not null default 'idle', session_id text,
  updated_at timestamptz not null default now()
);
create table if not exists messages (
  id text primary key, workspace_id text not null references workspaces(id) on delete cascade,
  seq bigserial, body jsonb not null
);
create index if not exists messages_ws on messages(workspace_id, seq);
create table if not exists pipelines (
  id text primary key, name text not null, description text not null default '',
  nodes jsonb not null, max_loops int not null default 4
);
create table if not exists pipeline_runs (
  id text primary key, workspace_id text not null references workspaces(id) on delete cascade,
  state jsonb not null, created_at timestamptz not null default now()
);
create table if not exists brain_entries (
  id text primary key, workspace_id text not null references workspaces(id) on delete cascade,
  kind text not null, title text not null, body text not null default '',
  node_id text, resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists brain_ws on brain_entries(workspace_id, created_at desc);
create table if not exists settings (key text primary key, value jsonb not null);
create table if not exists agents (
  id text primary key, name text not null, role text not null, description text not null default '',
  instructions text not null default '', built_in boolean not null default false
);
alter table pipelines add column if not exists built_in boolean not null default false;
alter table brain_entries add column if not exists status text not null default 'open';
update brain_entries set status='resolved' where resolved and status='open';
`

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA)
  // Seed once; afterwards the user owns them (edits survive restarts).
  for (const p of DEFAULT_PIPELINES) {
    await pool.query(
      `insert into pipelines(id,name,description,nodes,max_loops,built_in) values($1,$2,$3,$4,$5,true)
       on conflict (id) do nothing`,
      [p.id, p.name, p.description, JSON.stringify(p.nodes), p.maxLoops]
    )
  }
  for (const a of DEFAULT_AGENTS) {
    await pool.query(
      `insert into agents(id,name,role,description,instructions,built_in) values($1,$2,$3,$4,$5,true)
       on conflict (id) do nothing`,
      [a.id, a.name, a.role, a.description, a.instructions]
    )
  }
  await pool.query('update pipelines set built_in=true where id = any($1)', [DEFAULT_PIPELINES.map((p) => p.id)])
  // Older seeded nodes had no agent: attach the role's built-in one.
  for (const p of await db.pipelines()) {
    if (p.nodes.every((n) => n.agentId)) continue
    const nodes = p.nodes.map((n) => ({ ...n, agentId: n.agentId ?? DEFAULT_AGENTS.find((a) => a.role === n.role)?.id }))
    await pool.query('update pipelines set nodes=$2 where id=$1', [p.id, JSON.stringify(nodes)])
  }
}

const toProject = (r: any): Project => ({
  id: r.id, name: r.name, path: r.path, color: r.color, createdAt: r.created_at.toISOString()
})
const toWorkspace = (r: any): Workspace => ({
  id: r.id, projectId: r.project_id, name: r.name, branch: r.branch, worktreePath: r.worktree_path,
  status: r.status, sessionId: r.session_id, updatedAt: r.updated_at.toISOString()
})

export const db = {
  async projects(): Promise<Project[]> {
    return (await pool.query('select * from projects order by created_at')).rows.map(toProject)
  },
  async project(id: string): Promise<Project | null> {
    const r = (await pool.query('select * from projects where id=$1', [id])).rows[0]
    return r ? toProject(r) : null
  },
  async insertProject(p: Omit<Project, 'createdAt'>): Promise<Project> {
    const r = await pool.query(
      `insert into projects(id,name,path,color) values($1,$2,$3,$4)
       on conflict (path) do update set name=excluded.name returning *`,
      [p.id, p.name, p.path, p.color]
    )
    return toProject(r.rows[0])
  },
  async workspaces(): Promise<Workspace[]> {
    return (await pool.query('select * from workspaces order by updated_at desc')).rows.map(toWorkspace)
  },
  async workspace(id: string): Promise<Workspace | null> {
    const r = (await pool.query('select * from workspaces where id=$1', [id])).rows[0]
    return r ? toWorkspace(r) : null
  },
  async insertWorkspace(w: Omit<Workspace, 'updatedAt'>): Promise<Workspace> {
    const r = await pool.query(
      `insert into workspaces(id,project_id,name,branch,worktree_path,status,session_id)
       values($1,$2,$3,$4,$5,$6,$7) returning *`,
      [w.id, w.projectId, w.name, w.branch, w.worktreePath, w.status, w.sessionId]
    )
    return toWorkspace(r.rows[0])
  },
  async updateWorkspace(id: string, patch: Partial<Pick<Workspace, 'status' | 'sessionId'>>): Promise<Workspace> {
    const r = await pool.query(
      `update workspaces set status=coalesce($2,status), session_id=coalesce($3,session_id),
       updated_at=now() where id=$1 returning *`,
      [id, patch.status ?? null, patch.sessionId ?? null]
    )
    return toWorkspace(r.rows[0])
  },
  async messages(workspaceId: string): Promise<Message[]> {
    const r = await pool.query('select body from messages where workspace_id=$1 order by seq', [workspaceId])
    return r.rows.map((x) => x.body)
  },
  async saveMessage(workspaceId: string, m: Message): Promise<void> {
    await pool.query(
      `insert into messages(id,workspace_id,body) values($1,$2,$3)
       on conflict (id) do update set body=excluded.body`,
      [m.id, workspaceId, JSON.stringify(m)]
    )
  },
  async pipelines(): Promise<Pipeline[]> {
    const r = await pool.query('select * from pipelines order by name')
    return r.rows.map((x) => ({ id: x.id, name: x.name, description: x.description, nodes: x.nodes, maxLoops: x.max_loops, builtIn: x.built_in }))
  },
  async savePipeline(p: Pipeline): Promise<Pipeline> {
    await pool.query(
      `insert into pipelines(id,name,description,nodes,max_loops) values($1,$2,$3,$4,$5)
       on conflict (id) do update set name=excluded.name, description=excluded.description,
       nodes=excluded.nodes, max_loops=excluded.max_loops`,
      [p.id, p.name, p.description, JSON.stringify(p.nodes), p.maxLoops]
    )
    return (await db.pipelines()).find((x) => x.id === p.id)!
  },
  async deletePipeline(id: string): Promise<void> {
    await pool.query('delete from pipelines where id=$1', [id])
  },
  async agents(): Promise<Agent[]> {
    const r = await pool.query('select * from agents order by built_in desc, name')
    return r.rows.map((x) => ({ id: x.id, name: x.name, role: x.role, description: x.description, instructions: x.instructions, builtIn: x.built_in }))
  },
  async saveAgent(a: Agent): Promise<Agent> {
    await pool.query(
      `insert into agents(id,name,role,description,instructions) values($1,$2,$3,$4,$5)
       on conflict (id) do update set name=excluded.name, role=excluded.role,
       description=excluded.description, instructions=excluded.instructions`,
      [a.id, a.name, a.role, a.description, a.instructions]
    )
    return (await db.agents()).find((x) => x.id === a.id)!
  },
  async deleteAgent(id: string): Promise<void> {
    await pool.query('delete from agents where id=$1 and not built_in', [id])
  },
  async issues(): Promise<Issue[]> {
    const r = await pool.query(
      `select b.*, w.name as ws_name, w.branch, p.id as project_id, p.name as project_name
       from brain_entries b join workspaces w on w.id=b.workspace_id join projects p on p.id=w.project_id
       where b.kind='issue' order by b.created_at desc limit 500`
    )
    return r.rows.map((x) => ({
      id: x.id, workspaceId: x.workspace_id, workspaceName: x.ws_name, branch: x.branch, projectId: x.project_id,
      projectName: x.project_name, title: x.title, body: x.body, nodeId: x.node_id, status: x.status,
      createdAt: x.created_at.toISOString()
    }))
  },
  async updateIssue(id: string, patch: { status?: IssueStatus; title?: string; body?: string }): Promise<void> {
    await pool.query(
      `update brain_entries set status=coalesce($2,status), title=coalesce($3,title), body=coalesce($4,body),
       resolved = coalesce($2,status) in ('resolved','wontfix') where id=$1`,
      [id, patch.status ?? null, patch.title ?? null, patch.body ?? null]
    )
  },
  async saveRun(workspaceId: string, s: PipelineRunState): Promise<void> {
    await pool.query(
      `insert into pipeline_runs(id,workspace_id,state) values($1,$2,$3)
       on conflict (id) do update set state=excluded.state`,
      [s.runId, workspaceId, JSON.stringify(s)]
    )
  },
  async runs(workspaceId: string): Promise<PipelineRunState[]> {
    const r = await pool.query('select state from pipeline_runs where workspace_id=$1 order by created_at', [workspaceId])
    return r.rows.map((x) => x.state)
  },
  async brain(workspaceId: string): Promise<BrainEntry[]> {
    const r = await pool.query('select * from brain_entries where workspace_id=$1 order by created_at desc limit 200', [workspaceId])
    return r.rows.map((x) => ({
      id: x.id, workspaceId: x.workspace_id, kind: x.kind, title: x.title, body: x.body,
      nodeId: x.node_id, resolved: x.resolved, createdAt: x.created_at.toISOString()
    }))
  },
  async getSetting<T>(key: string): Promise<T | null> {
    const r = await pool.query('select value from settings where key=$1', [key])
    return r.rows[0]?.value ?? null
  },
  async setSetting(key: string, value: unknown): Promise<void> {
    await pool.query(
      'insert into settings(key,value) values($1,$2) on conflict (key) do update set value=excluded.value',
      [key, JSON.stringify(value)]
    )
  }
}
