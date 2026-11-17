/**
 * cm2 MCP server (stdio, JSON-RPC 2.0). Spawned by Claude Code via --mcp-config.
 * Exposes the pipeline protocol and the workspace brain as tools, so the orchestrator
 * queries memory on demand instead of carrying it in context.
 */
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import pg from 'pg'
import type { Pipeline, PipelineRunState } from '@shared/types'
import { applyStep, newRunState } from '../engine/pipelines'

const WS = process.env.CM2_WORKSPACE_ID ?? ''
const RUN = process.env.CM2_RUN_ID ?? ''
const pipeline: Pipeline | null = process.env.CM2_PIPELINE ? JSON.parse(process.env.CM2_PIPELINE) : null
const pool = new pg.Pool({ connectionString: process.env.CM2_DATABASE_URL, max: 2 })
let state: PipelineRunState | null = pipeline ? newRunState(pipeline, RUN) : null

// Built-in browser (visible to the user in the right drawer). Use it to check UI changes on the dev server.
const BROWSER_TOOLS = [
  { name: 'browser_navigate', description: 'Open a URL in the built-in browser the user watches (e.g. the dev server http://localhost:5173).', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'browser_read', description: 'Read the current page: title, URL, numbered interactive elements with coordinates, visible text.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_click', description: 'Click an element by index (from browser_read), CSS selector, or x/y.', inputSchema: { type: 'object', properties: { index: { type: 'number' }, selector: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'browser_type', description: 'Type text, optionally into an element first (index/selector), clear it, and submit with Enter.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, index: { type: 'number' }, selector: { type: 'string' }, clear: { type: 'boolean' }, submit: { type: 'boolean' } }, required: ['text'] } },
  { name: 'browser_key', description: 'Press a key (Enter, Escape, Tab, ArrowDown…).', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'browser_scroll', description: 'Scroll the page by dy pixels (negative = up).', inputSchema: { type: 'object', properties: { dy: { type: 'number' } } } },
  { name: 'browser_screenshot', description: 'Screenshot of the page (you get the image; the user sees it briefly in the chat). Use it to verify what you changed.', inputSchema: { type: 'object', properties: { caption: { type: 'string', description: 'What this shows' } } } }
]

async function browser(action: string, args: unknown): Promise<{ text: string; image?: string; error?: boolean }> {
  const url = process.env.CM2_BRIDGE_URL
  if (!url) return { text: 'Browser not available', error: true }
  const res = await fetch(`${url}/browser`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cm2-token': process.env.CM2_BRIDGE_TOKEN ?? '' },
    body: JSON.stringify({ ws: WS, action, args })
  })
  return res.json()
}

const TOOLS = [
  ...(pipeline
    ? [
        {
          name: 'pipeline_step',
          description: 'Report entering or finishing a pipeline node. Returns the next node to run.',
          inputSchema: {
            type: 'object',
            properties: {
              node: { type: 'string', enum: pipeline.nodes.map((n) => n.id) },
              status: { type: 'string', enum: ['running', 'passed', 'failed'] },
              note: { type: 'string', description: 'One-line outcome' }
            },
            required: ['node', 'status']
          }
        }
      ]
    : []),
  ...BROWSER_TOOLS,
  {
    name: 'fork_branch',
    description:
      'Continue this conversation in a NEW git branch. Use when the user asks to do something "in a new branch". ' +
      'code-maxxer creates the branch from the current state (uncommitted changes carry over), opens a new chat that inherits ' +
      'this one and runs `prompt` there. After calling it, stop: reply with one short line, do not do the work here.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name, e.g. feat/dark-mode' },
        prompt: { type: 'string', description: 'What to do in the new branch' }
      },
      required: ['name', 'prompt']
    }
  },
  {
    name: 'schedule_run',
    description:
      'Schedule a prompt to run later in this same branch chat. Use when the user asks to do something at a given time ' +
      '("tonight at 23", "tomorrow morning"). `at` is an ISO 8601 date-time WITH timezone offset. The current local time is in the reply ' +
      'of every call; if unsure, call with at omitted to read it.',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string' }, at: { type: 'string', description: 'e.g. 2026-11-18T09:00:00+01:00' } },
      required: ['prompt']
    }
  },
  {
    name: 'brain_record',
    description: 'Save an issue, lesson or decision into the workspace brain.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['issue', 'lesson', 'decision'] },
        title: { type: 'string' },
        body: { type: 'string' },
        node: { type: 'string' }
      },
      required: ['kind', 'title']
    }
  },
  {
    name: 'brain_search',
    description: 'Search the workspace brain. Returns short matches (id, kind, title, first line).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kind: { type: 'string', enum: ['issue', 'lesson', 'decision'] },
        open: { type: 'boolean', description: 'Only unresolved' }
      }
    }
  },
  {
    name: 'brain_read',
    description: 'Read one brain entry in full.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'brain_resolve',
    description: 'Mark an issue as resolved.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  }
]

async function call(name: string, a: any): Promise<string> {
  switch (name) {
    case 'schedule_run': {
      const now = new Date()
      const local = `${now.toString()}`
      if (!a.at) return `Current local time: ${local}. Call again with "at".`
      const at = new Date(a.at)
      if (isNaN(at.getTime())) return `Could not read "${a.at}". Use ISO 8601 with offset. Current local time: ${local}.`
      if (at.getTime() < now.getTime() - 60_000) return `That time is in the past. Current local time: ${local}.`
      await pool.query(
        "insert into scheduled_runs(id,workspace_id,text,at,source) values($1,$2,$3,$4,'agent')",
        ['sr_' + randomUUID().slice(0, 8), WS, String(a.prompt), at.toISOString()]
      )
      return `Scheduled for ${at.toString()}. It will run in this chat with the same settings. Tell the user in one line.`
    }
    case 'fork_branch':
      return `OK: branch "${a.name}" will be created when this turn ends and the new chat will run the prompt. Stop now with one short line.`
    case 'pipeline_step': {
      if (!state) return 'No pipeline active.'
      const r = applyStep(state, a)
      state = r.state
      return r.reply
    }
    case 'brain_record': {
      const id = 'b_' + randomUUID().slice(0, 8)
      await pool.query(
        'insert into brain_entries(id,workspace_id,kind,title,body,node_id) values($1,$2,$3,$4,$5,$6)',
        [id, WS, a.kind, a.title, a.body ?? '', a.node ?? null]
      )
      return JSON.stringify({ id })
    }
    case 'brain_search': {
      const q = `%${(a.query ?? '').toLowerCase()}%`
      const r = await pool.query(
        `select id, kind, title, resolved, split_part(body, E'\\n', 1) as head from brain_entries
         where workspace_id=$1 and (lower(title) like $2 or lower(body) like $2)
         and ($3::text is null or kind=$3) and ($4::boolean is not true or status in ('open','in_progress'))
         order by created_at desc limit 12`,
        [WS, q, a.kind ?? null, a.open ?? null]
      )
      if (!r.rows.length) return 'No matches.'
      return r.rows.map((x) => `${x.id} [${x.kind}${x.resolved ? ', resolved' : ''}] ${x.title} — ${x.head}`).join('\n')
    }
    case 'brain_read': {
      const r = await pool.query('select * from brain_entries where id=$1 and workspace_id=$2', [a.id, WS])
      const x = r.rows[0]
      return x ? `${x.title}\n[${x.kind}${x.resolved ? ', resolved' : ''}]\n\n${x.body}` : 'Not found.'
    }
    case 'brain_resolve': {
      await pool.query("update brain_entries set resolved=true, status='resolved' where id=$1 and workspace_id=$2", [a.id, WS])
      return 'Resolved.'
    }
  }
  throw new Error(`Unknown tool ${name}`)
}

const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n')

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  if (id === undefined) return // notification
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'cm2', version: '0.0.1' }
        }
      })
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    } else if (method === 'tools/call' && String(params.name).startsWith('browser_')) {
      const r = await browser(String(params.name).slice(8), params.arguments ?? {})
      const content: any[] = [{ type: 'text', text: r.text }]
      if (r.image) content.push({ type: 'image', data: r.image, mimeType: 'image/png' })
      send({ jsonrpc: '2.0', id, result: { content, isError: !!r.error } })
    } else if (method === 'tools/call') {
      const text = await call(params.name, params.arguments ?? {})
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} })
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  } catch (e: any) {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } })
  }
})
