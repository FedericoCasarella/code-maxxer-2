import pg from 'pg'
import { app } from 'electron'
import { LOCAL_DB_PORT } from './localdb'
import type { Agent, ProjectFolder, RunRow, ScheduledRun, Space, BrainEntry, Issue, IssueStatus, Message, Pipeline, PipelineRunState, Project, Workspace } from '@shared/types'
import { DEFAULT_AGENTS, DEFAULT_PIPELINES } from './engine/pipelines'

// Dev: the docker-compose service cm2-postgres on 127.0.0.1:5477. The installed app: its own Postgres (localdb.ts).
export const DATABASE_URL =
  process.env.CM2_DATABASE_URL ??
  (app.isPackaged ? `postgres://cm2:cm2@127.0.0.1:${LOCAL_DB_PORT}/codemaxxer2` : 'postgres://cm2:cm2@127.0.0.1:5477/codemaxxer2')

export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 6 })

import { RECON_SCHEMA } from './recon/schema'

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
-- Flash pipelines: put together by the orchestrator for one task, never in the library; dropped after a month
alter table pipelines add column if not exists flash boolean not null default false;
alter table pipelines add column if not exists created_at timestamptz not null default now();
delete from pipelines where flash and created_at < now() - interval '30 days';
alter table brain_entries add column if not exists status text not null default 'open';
update brain_entries set status='resolved' where resolved and status='open';
create table if not exists project_folders (
  id text primary key, name text not null, sort int not null default 0, collapsed boolean not null default false
);
alter table projects add column if not exists owner text;
alter table projects add column if not exists avatar_url text;
alter table projects add column if not exists folder_id text references project_folders(id) on delete set null;
alter table projects add column if not exists sort int not null default 0;
create table if not exists spaces (
  id text primary key, name text not null, color text not null default '#d97757', sort int not null default 0
);
insert into spaces(id,name,sort) values('personal','Personal',0) on conflict do nothing;
alter table projects add column if not exists space_id text references spaces(id) on delete cascade;
alter table project_folders add column if not exists space_id text references spaces(id) on delete cascade;
update projects set space_id='personal' where space_id is null;
update project_folders set space_id='personal' where space_id is null;
create table if not exists scheduled_runs (
  id text primary key, workspace_id text not null references workspaces(id) on delete cascade,
  text text not null, at timestamptz not null, opts jsonb, status text not null default 'pending',
  source text not null default 'user', error text, sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists scheduled_due on scheduled_runs(status, at);
alter table brain_entries add column if not exists gh_number int;
alter table brain_entries add column if not exists severity text not null default 'blocking';
alter table workspaces add column if not exists linked_to text;
alter table projects add column if not exists linked text[] not null default '{}';
alter table brain_entries add column if not exists gh_url text;
alter table brain_entries add column if not exists gh_synced text;
create table if not exists plans (
  id text primary key, workspace_id text not null references workspaces(id) on delete cascade,
  title text not null, summary text not null default '', status text not null default 'proposed',
  message_id text, created_at timestamptz not null default now()
);
create table if not exists plan_tasks (
  id text primary key, plan_id text not null references plans(id) on delete cascade, position int not null,
  title text not null, detail text not null default '', files text[] not null default '{}', status text not null default 'todo',
  started_at timestamptz, finished_at timestamptz, note text,
  steps jsonb not null default '[]', commits jsonb not null default '[]'
);
`

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA)
  await pool.query(RECON_SCHEMA)
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
  id: r.id, name: r.name, path: r.path, color: r.color, createdAt: r.created_at.toISOString(),
  owner: r.owner, avatarUrl: r.avatar_url, folderId: r.folder_id, spaceId: r.space_id, sort: r.sort, linked: r.linked ?? []
})
const toWorkspace = (r: any): Workspace => ({
  id: r.id, projectId: r.project_id, name: r.name, branch: r.branch, worktreePath: r.worktree_path,
  status: r.status, sessionId: r.session_id, updatedAt: r.updated_at.toISOString(), linkedTo: r.linked_to ?? null
})

export const db = {
  async projects(): Promise<Project[]> {
    return (await pool.query('select * from projects order by sort, created_at')).rows.map(toProject)
  },
  async project(id: string): Promise<Project | null> {
    const r = (await pool.query('select * from projects where id=$1', [id])).rows[0]
    return r ? toProject(r) : null
  },
  async insertProject(p: Pick<Project, 'id' | 'name' | 'path' | 'color' | 'owner' | 'avatarUrl' | 'spaceId'>): Promise<Project> {
    // A repo lives in one workspace: adding it again moves it to the given one.
    const r = await pool.query(
      `insert into projects(id,name,path,color,owner,avatar_url,space_id,sort)
       values($1,$2,$3,$4,$5,$6,coalesce($7,'personal'),(select coalesce(max(sort),0)+1 from projects))
       on conflict (path) do update set name=excluded.name, owner=excluded.owner, avatar_url=excluded.avatar_url,
         space_id=coalesce($7, projects.space_id)
       returning *`,
      [p.id, p.name, p.path, p.color, p.owner, p.avatarUrl, p.spaceId]
    )
    return toProject(r.rows[0])
  },
  async spaces(): Promise<Space[]> {
    const r = await pool.query('select * from spaces order by sort, name')
    return r.rows.map((x) => ({ id: x.id, name: x.name, color: x.color, sort: x.sort }))
  },
  async saveSpace(s: Space): Promise<void> {
    await pool.query(
      `insert into spaces(id,name,color,sort) values($1,$2,$3,$4)
       on conflict (id) do update set name=excluded.name, color=excluded.color, sort=excluded.sort`,
      [s.id, s.name, s.color, s.sort]
    )
  },
  /** Only empty workspaces can go; the last one always stays. */
  async deleteSpace(id: string): Promise<void> {
    const n = (await pool.query('select count(*)::int as n from projects where space_id=$1', [id])).rows[0].n
    if (n > 0) throw new Error('Move or remove its projects first')
    const total = (await pool.query('select count(*)::int as n from spaces')).rows[0].n
    if (total <= 1) throw new Error('At least one workspace must exist')
    await pool.query('delete from spaces where id=$1', [id])
  },
  async updateProject(id: string, patch: { name?: string; folderId?: string | null; sort?: number; color?: string; avatarUrl?: string | null }): Promise<void> {
    await pool.query(
      `update projects set
         name = case when $2::boolean then $3 else name end,
         folder_id = case when $4::boolean then $5 else folder_id end,
         sort = case when $6::boolean then $7 else sort end,
         color = case when $8::boolean then $9 else color end,
         avatar_url = case when $10::boolean then $11 else avatar_url end
       where id=$1`,
      [
        id, patch.name !== undefined, patch.name ?? null, patch.folderId !== undefined, patch.folderId ?? null, patch.sort !== undefined, patch.sort ?? 0,
        patch.color !== undefined, patch.color ?? null, patch.avatarUrl !== undefined, patch.avatarUrl ?? null
      ]
    )
  },
  async deleteProject(id: string): Promise<void> {
    await pool.query('delete from projects where id=$1', [id])
  },
  async folders(): Promise<ProjectFolder[]> {
    const r = await pool.query('select * from project_folders order by sort, name')
    return r.rows.map((x) => ({ id: x.id, name: x.name, sort: x.sort, collapsed: x.collapsed, spaceId: x.space_id }))
  },
  async saveFolder(f: ProjectFolder): Promise<void> {
    await pool.query(
      `insert into project_folders(id,name,sort,collapsed,space_id) values($1,$2,$3,$4,coalesce($5,'personal'))
       on conflict (id) do update set name=excluded.name, sort=excluded.sort, collapsed=excluded.collapsed`,
      [f.id, f.name, f.sort, f.collapsed, f.spaceId]
    )
  },
  async deleteFolder(id: string): Promise<void> {
    await pool.query('delete from project_folders where id=$1', [id])
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
      `insert into workspaces(id,project_id,name,branch,worktree_path,status,session_id,linked_to)
       values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [w.id, w.projectId, w.name, w.branch, w.worktreePath, w.status, w.sessionId, w.linkedTo ?? null]
    )
    return toWorkspace(r.rows[0])
  },
  /** Projects that work together (a frontend and its backend): the link goes both ways. */
  async linkProjects(id: string, other: string, on: boolean): Promise<void> {
    const q = on
      ? 'update projects set linked = array(select distinct unnest(linked || $2::text)) where id=$1'
      : 'update projects set linked = array_remove(linked, $2) where id=$1'
    await pool.query(q, [id, other])
    await pool.query(q, [other, id])
  },
  /** A twin branch now works for the chat leadId (or for nobody, with null). */
  async linkWorkspace(id: string, leadId: string | null): Promise<Workspace> {
    return toWorkspace((await pool.query('update workspaces set linked_to=$2, updated_at=now() where id=$1 returning *', [id, leadId])).rows[0])
  },
  async linkedWorkspaces(leadId: string): Promise<Workspace[]> {
    return (await pool.query('select * from workspaces where linked_to=$1 order by updated_at', [leadId])).rows.map(toWorkspace)
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
  /** A window of the conversation (oldest first): the latest page, the page before a seq, or around one. */
  async messagesPage(
    workspaceId: string,
    o: { before?: number; around?: number; after?: number; limit?: number }
  ): Promise<{ messages: Message[]; hasOlder: boolean; hasNewer: boolean }> {
    const limit = Math.min(o.limit ?? 40, 200)
    const pick = (rows: any[]) => rows.map((x) => ({ ...x.body, seq: Number(x.seq) }))
    let rows: any[]
    if (o.around !== undefined) {
      const before = (await pool.query('select seq, body from messages where workspace_id=$1 and seq < $2 order by seq desc limit $3', [workspaceId, o.around, Math.floor(limit / 3)])).rows.reverse()
      const after = (await pool.query('select seq, body from messages where workspace_id=$1 and seq >= $2 order by seq limit $3', [workspaceId, o.around, limit])).rows
      rows = [...before, ...after]
    } else if (o.after !== undefined) {
      rows = (await pool.query('select seq, body from messages where workspace_id=$1 and seq > $2 order by seq limit $3', [workspaceId, o.after, limit])).rows
    } else {
      rows = (
        await pool.query(
          `select seq, body from messages where workspace_id=$1 ${o.before !== undefined ? 'and seq < $3' : ''} order by seq desc limit $2`,
          o.before !== undefined ? [workspaceId, limit, o.before] : [workspaceId, limit]
        )
      ).rows.reverse()
    }
    if (!rows.length) return { messages: [], hasOlder: false, hasNewer: false }
    const first = Number(rows[0].seq)
    const last = Number(rows[rows.length - 1].seq)
    const [older, newer] = await Promise.all([
      pool.query('select 1 from messages where workspace_id=$1 and seq < $2 limit 1', [workspaceId, first]),
      pool.query('select 1 from messages where workspace_id=$1 and seq > $2 limit 1', [workspaceId, last])
    ])
    return { messages: pick(rows), hasOlder: older.rowCount! > 0, hasNewer: newer.rowCount! > 0 }
  },
  /** Every user prompt of a branch, short: the chat index. */
  async messageIndex(workspaceId: string): Promise<{ id: string; seq: number; text: string; at: number }[]> {
    const r = await pool.query(
      `select seq, body->>'id' as id, left(body->>'text', 140) as text, round((body->>'at')::numeric)::bigint as at
       from messages where workspace_id=$1 and body->>'role'='user' order by seq`,
      [workspaceId]
    )
    return r.rows.map((x) => ({ id: x.id, seq: Number(x.seq), text: x.text ?? '', at: Number(x.at) }))
  },
  async saveMessage(workspaceId: string, m: Message): Promise<void> {
    await pool.query(
      `insert into messages(id,workspace_id,body) values($1,$2,$3)
       on conflict (id) do update set body=excluded.body`,
      [m.id, workspaceId, JSON.stringify({ ...m, seq: undefined })]
    )
  },
  /** The library: flash pipelines (one task's, made by the orchestrator) are not in it. */
  async pipelines(): Promise<Pipeline[]> {
    const r = await pool.query('select * from pipelines where not flash order by name')
    return r.rows.map((x) => ({ id: x.id, name: x.name, description: x.description, nodes: x.nodes, maxLoops: x.max_loops, builtIn: x.built_in }))
  },
  /** One pipeline by id, flash ones included. */
  async pipeline(id: string): Promise<Pipeline | null> {
    const x = (await pool.query('select * from pipelines where id=$1', [id])).rows[0]
    return x ? { id: x.id, name: x.name, description: x.description, nodes: x.nodes, maxLoops: x.max_loops, builtIn: x.built_in, flash: x.flash } : null
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
    const r = await pool.query(
      `select a.*, coalesce((select array_agg(s.name order by s.name) from skills s where s.id = any(a.skills)), '{}') as skill_names
       from agents a order by a.built_in desc, a.name`
    )
    return r.rows.map((x) => ({
      id: x.id, name: x.name, role: x.role, description: x.description, instructions: x.instructions, builtIn: x.built_in,
      custom: !!x.custom, handle: x.handle ?? null, skills: x.skills ?? [], skillNames: x.skill_names ?? [], sourceWorkspaceId: x.source_workspace_id ?? null, model: x.model ?? null,
      createdAt: x.created_at ? x.created_at.getTime() : undefined
    }))
  },
  async saveAgent(a: Agent): Promise<Agent> {
    await pool.query(
      `insert into agents(id,name,role,description,instructions,handle,skills,model) values($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (id) do update set name=excluded.name, role=excluded.role,
       description=excluded.description, instructions=excluded.instructions, handle=excluded.handle, skills=excluded.skills, model=excluded.model`,
      [a.id, a.name, a.role, a.description, a.instructions, a.handle ?? null, a.skills ?? [], a.model ?? null]
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
      createdAt: x.created_at.toISOString(), githubUrl: x.gh_url
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
  async allRuns(): Promise<RunRow[]> {
    const r = await pool.query(
      `select r.id, r.state, r.created_at, w.id as ws_id, w.branch, p.name as project_name
       from pipeline_runs r join workspaces w on w.id=r.workspace_id join projects p on p.id=w.project_id
       order by r.created_at desc limit 500`
    )
    return r.rows.map((x) => ({
      runId: x.id, pipelineId: x.state.pipelineId, pipelineName: x.state.name, task: x.state.task ?? null, status: x.state.status,
      loops: x.state.loops, workspaceId: x.ws_id, branch: x.branch, projectName: x.project_name, createdAt: x.created_at.getTime(),
      ...(x.state.status === 'waiting' && x.state.wait
        ? { wait: { kind: x.state.wait.kind, at: x.state.wait.at, label: x.state.nodes.find((n: any) => n.id === x.state.wait.node)?.label ?? x.state.wait.node } }
        : {})
    }))
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
  async scheduled(): Promise<ScheduledRun[]> {
    const r = await pool.query(
      `select * from scheduled_runs where status='pending' or created_at > now() - interval '3 days' order by at`
    )
    return r.rows.map((x) => ({
      id: x.id, workspaceId: x.workspace_id, text: x.text, at: x.at.getTime(), status: x.status, source: x.source,
      error: x.error, sentAt: x.sent_at?.getTime() ?? null
    }))
  },
  async scheduledOpts(id: string): Promise<any> {
    return (await pool.query('select opts from scheduled_runs where id=$1', [id])).rows[0]?.opts ?? null
  },
  async addScheduled(r: { id: string; workspaceId: string; text: string; at: number; opts: unknown; source: 'user' | 'agent' }) {
    await pool.query(
      'insert into scheduled_runs(id,workspace_id,text,at,opts,source) values($1,$2,$3,to_timestamp($4/1000.0),$5,$6)',
      [r.id, r.workspaceId, r.text, r.at, r.opts ? JSON.stringify(r.opts) : null, r.source]
    )
  },
  async updateScheduled(id: string, patch: { at?: number; status?: string; error?: string | null; sent?: boolean }) {
    await pool.query(
      `update scheduled_runs set
         at = case when $2::double precision is null then at else to_timestamp($2/1000.0) end,
         status = coalesce($3, status), error = coalesce($4, error),
         sent_at = case when $5 then now() else sent_at end
       where id=$1`,
      [id, patch.at ?? null, patch.status ?? null, patch.error ?? null, !!patch.sent]
    )
  },
  async projectBrain(projectId: string) {
    const r = await pool.query(
      `select b.*, w.branch from brain_entries b join workspaces w on w.id=b.workspace_id
       where w.project_id=$1 order by b.created_at desc limit 1000`,
      [projectId]
    )
    return r.rows.map((x) => ({
      id: x.id, workspaceId: x.workspace_id, kind: x.kind, title: x.title, body: x.body, nodeId: x.node_id,
      resolved: x.resolved, createdAt: x.created_at.toISOString(), branch: x.branch
    }))
  },
  async saveBrainEntry(projectId: string, e: { id?: string; kind: string; title: string; body: string }) {
    if (e.id) {
      await pool.query('update brain_entries set kind=$2, title=$3, body=$4 where id=$1', [e.id, e.kind, e.title, e.body])
      return
    }
    // New entries from the UI live on the project's main checkout.
    const ws = (await pool.query(
      `select id from workspaces where project_id=$1 order by (worktree_path = (select path from projects where id=$1)) desc, updated_at desc limit 1`,
      [projectId]
    )).rows[0]
    if (!ws) throw new Error('This project has no branch yet')
    await pool.query('insert into brain_entries(id,workspace_id,kind,title,body) values($1,$2,$3,$4,$5)', [
      'b_' + Math.random().toString(36).slice(2, 10), ws.id, e.kind, e.title, e.body
    ])
  },
  async deleteBrainEntry(id: string) {
    await pool.query('delete from brain_entries where id=$1', [id])
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
