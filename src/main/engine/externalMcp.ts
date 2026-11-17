import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import type { EngineEvent, IssueStatus, SendOptions } from '@shared/types'
import { db, pool } from '../db'
import * as orch from './orchestrator'
import { listModels } from './models'
import { createWorktree } from './git'

/*
 * code-maxxer as an MCP server for outside agents (e.g. Hermes): Streamable HTTP on 127.0.0.1,
 * stateless, bearer token. Everything a person does in the app's chat, an agent can do here.
 */
export const PORT = Number(process.env.CM2_MCP_PORT) || 3727
export const mcpInfo = { url: '', token: '' }

type Ctx = { emit: (e: EngineEvent) => void; script: string }
const DEFAULTS = { model: 'claude-opus-5-5', effort: 'medium' as const, fullAccess: true }
const json = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] })
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] })

function build(ctx: Ctx): McpServer {
  const s = new McpServer({ name: 'code-maxxer', version: '2.0.0' })

  s.registerTool('projects_list', { description: 'Workspaces, their projects and each project\'s branches (id, branch, status).' }, async () => {
    const [spaces, projects, branches] = await Promise.all([db.spaces(), db.projects(), db.workspaces()])
    return json(
      spaces.map((sp) => ({
        workspace: sp.name,
        projects: projects
          .filter((p) => p.spaceId === sp.id)
          .map((p) => ({
            id: p.id, name: p.owner ? `${p.owner}/${p.name}` : p.name, path: p.path,
            branches: branches.filter((b) => b.projectId === p.id).map((b) => ({ id: b.id, branch: b.branch, status: b.status }))
          }))
      }))
    )
  })

  s.registerTool(
    'branch_create',
    { description: 'Create a new branch (git worktree + chat) in a project.', inputSchema: { project_id: z.string(), name: z.string() } },
    async ({ project_id, name }) => {
      const p = await db.project(project_id)
      if (!p) return text('Project not found')
      const wt = await createWorktree(p.path, name, { exact: true })
      const ws = await db.insertWorkspace({ id: randomUUID(), projectId: p.id, name, branch: wt.branch, worktreePath: wt.path, status: 'idle', sessionId: null })
      ctx.emit({ type: 'workspace', workspace: ws })
      return json({ id: ws.id, branch: ws.branch })
    }
  )

  s.registerTool(
    'chat_send',
    {
      description:
        'Send a prompt to a branch\'s orchestrator (queued if it is busy). Optionally pick a model (see models_list) and a pipeline to run it through. Returns immediately; poll branch_status / chat_messages.',
      inputSchema: {
        branch_id: z.string(),
        text: z.string(),
        model: z.string().optional(),
        effort: z.enum(['low', 'medium', 'high']).optional(),
        pipeline_id: z.string().optional()
      }
    },
    async ({ branch_id, text: t, model, effort, pipeline_id }) => {
      if (!(await db.workspace(branch_id))) return text('Branch not found')
      const last = (await db.getSetting<Partial<SendOptions>>(`opts:${branch_id}`)) ?? {}
      const opts: SendOptions = {
        ...DEFAULTS, ...last, workspaceId: branch_id, text: t,
        ...(model ? { model } : {}), ...(effort ? { effort } : {}),
        mode: pipeline_id ? { kind: 'pipeline', pipelineId: pipeline_id } : (last.mode ?? { kind: 'direct' })
      } as SendOptions
      const busy = orch.isRunning(branch_id)
      void orch.send(opts, ctx.emit, ctx.script).catch(() => {})
      return text(busy ? 'Queued: the agent is busy, it runs when the current turn ends.' : 'Sent. The agent is working on it.')
    }
  )

  s.registerTool(
    'branch_status',
    { description: 'Is the agent working on this branch, what is queued, and the last reply.', inputSchema: { branch_id: z.string() } },
    async ({ branch_id }) => {
      const ws = await db.workspace(branch_id)
      if (!ws) return text('Branch not found')
      const last = (await db.messages(branch_id)).filter((m) => m.role === 'assistant').pop() as any
      return json({
        status: orch.isRunning(branch_id) ? 'running' : ws.status,
        queued: orch.listQueue(branch_id).map((q) => q.text),
        last_reply: last ? last.blocks.filter((b: any) => b.kind === 'text').map((b: any) => b.text).join('\n').slice(-3000) : null,
        last_error: last?.error ?? null
      })
    }
  )

  s.registerTool(
    'chat_messages',
    { description: 'Recent conversation of a branch: user prompts, replies, tools used, commits.', inputSchema: { branch_id: z.string(), limit: z.number().int().min(1).max(50).optional() } },
    async ({ branch_id, limit }) => {
      const msgs = (await db.messages(branch_id)).slice(-(limit ?? 10))
      return json(
        msgs.map((m: any) =>
          m.role === 'user'
            ? { role: 'user', text: m.text }
            : {
                role: 'assistant',
                text: m.blocks.filter((b: any) => b.kind === 'text').map((b: any) => b.text).join('\n'),
                tools: m.blocks.filter((b: any) => b.kind === 'tool').map((b: any) => b.name),
                error: m.error ?? undefined
              }
        )
      )
    }
  )

  s.registerTool('stop', { description: 'Stop the agent working on a branch.', inputSchema: { branch_id: z.string() } }, async ({ branch_id }) => {
    orch.stop(branch_id)
    return text('Stopping.')
  })

  s.registerTool('models_list', { description: 'Models you can pass to chat_send (Claude, Codex, OpenCode).' }, async () =>
    json((await listModels()).map((m) => ({ id: m.id, label: m.label, provider: m.provider })))
  )

  s.registerTool('pipelines_list', { description: 'Pipelines and their nodes.' }, async () =>
    json((await db.pipelines()).map((p) => ({ id: p.id, name: p.name, description: p.description, model: p.model ?? null, nodes: p.nodes.map((n) => `${n.label}${n.model ? ` (${n.model})` : ''}${n.onFail ? ` ↩ ${n.onFail}` : ''}`) })))
  )

  s.registerTool('runs_list', { description: 'Recent pipeline runs with result and loops.', inputSchema: { limit: z.number().int().min(1).max(100).optional() } }, async ({ limit }) =>
    json((await db.allRuns()).slice(0, limit ?? 20))
  )

  s.registerTool(
    'issues_list',
    { description: 'Issues found by QA/reviews.', inputSchema: { status: z.enum(['open', 'in_progress', 'resolved', 'wontfix']).optional(), project_id: z.string().optional() } },
    async ({ status, project_id }) =>
      json((await db.issues()).filter((i) => (!status || i.status === status) && (!project_id || i.projectId === project_id)))
  )

  s.registerTool(
    'issue_update',
    { description: 'Change an issue\'s status.', inputSchema: { id: z.string(), status: z.enum(['open', 'in_progress', 'resolved', 'wontfix']) } },
    async ({ id, status }) => {
      await db.updateIssue(id, { status: status as IssueStatus })
      return text('Updated.')
    }
  )

  s.registerTool(
    'brain_search',
    { description: 'Search a project\'s brain (lessons, decisions, issues).', inputSchema: { project_id: z.string(), query: z.string() } },
    async ({ project_id, query }) => {
      const q = query.toLowerCase()
      return json((await db.projectBrain(project_id)).filter((e) => `${e.title} ${e.body}`.toLowerCase().includes(q)).slice(0, 20))
    }
  )

  s.registerTool(
    'brain_record',
    { description: 'Add a lesson, decision or issue to a project\'s brain.', inputSchema: { project_id: z.string(), kind: z.enum(['lesson', 'decision', 'issue']), title: z.string(), body: z.string().optional() } },
    async ({ project_id, kind, title, body }) => {
      await db.saveBrainEntry(project_id, { kind, title, body: body ?? '' })
      return text('Recorded.')
    }
  )

  s.registerTool(
    'schedule_run',
    { description: 'Schedule a prompt on a branch at a given time (ISO 8601 with offset).', inputSchema: { branch_id: z.string(), text: z.string(), at: z.string() } },
    async ({ branch_id, text: t, at }) => {
      const when = new Date(at).getTime()
      if (!Number.isFinite(when) || when < Date.now()) return text('Give a future ISO 8601 time with offset.')
      await pool.query("insert into scheduled_runs(id,workspace_id,text,at,source) values($1,$2,$3,$4,'agent')", ['sr_' + randomUUID().slice(0, 8), branch_id, t, new Date(when).toISOString()])
      return text(`Scheduled for ${new Date(when).toString()}.`)
    }
  )

  return s
}

let server: Server | null = null

export async function startExternalMcp(ctx: Ctx): Promise<void> {
  mcpInfo.token = (await db.getSetting<string>('mcp:token')) ?? randomBytes(24).toString('base64url')
  await db.setSetting('mcp:token', mcpInfo.token)
  server = createServer(async (req, res) => {
    if (!req.url?.startsWith('/mcp')) return void res.writeHead(404).end()
    if (req.headers.authorization !== `Bearer ${mcpInfo.token}`) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Missing or wrong bearer token' }))
      return
    }
    if (req.method !== 'POST') return void res.writeHead(405).end()
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', async () => {
      try {
        // Stateless: a fresh server + transport per request.
        const mcp = build(ctx)
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
        res.on('close', () => {
          void transport.close()
          void mcp.close()
        })
        await mcp.connect(transport)
        await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined)
      } catch (e: any) {
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }))
      }
    })
  })
  await new Promise<void>((resolve) => {
    server!.once('error', () => server!.listen(0, '127.0.0.1', resolve)) // port taken: any free one
    server!.listen(PORT, '127.0.0.1', resolve)
  })
  mcpInfo.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
}

export async function rotateMcpToken(): Promise<string> {
  mcpInfo.token = randomBytes(24).toString('base64url')
  await db.setSetting('mcp:token', mcpInfo.token)
  return mcpInfo.token
}
