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
         and ($3::text is null or kind=$3) and ($4::boolean is not true or resolved=false)
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
      await pool.query('update brain_entries set resolved=true where id=$1 and workspace_id=$2', [a.id, WS])
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
