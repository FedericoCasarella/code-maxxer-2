import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join, relative, isAbsolute } from 'node:path'
import type { Block, EngineEvent, Message, PipelineRunState, SendOptions } from '@shared/types'
import { db, DATABASE_URL } from '../db'
import { applyStep, newRunState, pipelinePrompt } from './pipelines'
import { recordClaudeRateLimit } from './usage'
import { bin, shellEnv } from './bins'

type Emit = (e: EngineEvent) => void

const running = new Map<string, ChildProcess>()

export type ForkRequest = { name: string; prompt: string }
type ForkHandler = (wsId: string, fork: ForkRequest, opts: SendOptions) => Promise<{ workspaceId: string; branch: string }>
let forkHandler: ForkHandler | null = null
/** main wires this: create the branch + worktree, then continue the conversation there. */
export const setForkHandler = (h: ForkHandler) => (forkHandler = h)
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const AGENT_TOOLS = 'Bash,Read,Edit,Write,Glob,Grep'

const lines = (s: unknown) => (typeof s === 'string' && s.length ? s.split('\n').length : 0)

function fileStats(name: string, input: any): { added: number; removed: number } {
  if (name === 'Write') return { added: lines(input?.content), removed: 0 }
  if (name === 'Edit') return { added: lines(input?.new_string), removed: lines(input?.old_string) }
  if (name === 'MultiEdit' && Array.isArray(input?.edits))
    return input.edits.reduce(
      (a: any, e: any) => ({ added: a.added + lines(e.new_string), removed: a.removed + lines(e.old_string) }),
      { added: 0, removed: 0 }
    )
  return { added: 0, removed: 0 }
}

export const anyRunning = () => running.size > 0

export function isRunning(workspaceId: string) {
  return running.has(workspaceId)
}

export function stop(workspaceId: string) {
  const p = running.get(workspaceId)
  if (p?.pid) {
    try {
      process.kill(-p.pid, 'SIGTERM')
    } catch {
      p.kill('SIGTERM')
    }
  }
}

export async function send(opts: SendOptions, emit: Emit, mcpScript: string): Promise<void> {
  const ws = await db.workspace(opts.workspaceId)
  if (!ws) throw new Error('Workspace not found')
  if (running.has(ws.id)) throw new Error('Agent already running in this workspace')

  // Remember this branch's settings: scheduled runs reuse them.
  void db.setSetting(`opts:${ws.id}`, { model: opts.model, effort: opts.effort, mode: opts.mode, fullAccess: opts.fullAccess })

  const user: Message = { id: randomUUID(), role: 'user', text: opts.text, at: Date.now() }
  await db.saveMessage(ws.id, user)
  emit({ type: 'message', workspaceId: ws.id, message: user })

  const msg: Extract<Message, { role: 'assistant' }> = {
    id: randomUUID(), role: 'assistant', blocks: [], at: Date.now(), done: false
  }

  // Pipeline mode: the run state lives here (mirror) and in the MCP server (authority).
  let run: PipelineRunState | null = null
  let appendPrompt = ''
  const runId = randomUUID()
  if (opts.mode.kind === 'pipeline') {
    const mode = opts.mode
    const p = (await db.pipelines()).find((x) => x.id === mode.pipelineId)
    if (!p) throw new Error('Pipeline not found')
    run = { ...newRunState(p, runId), task: opts.text, model: opts.model, handoffs: [] }
    appendPrompt = pipelinePrompt(p, await db.agents())
    msg.blocks.push({ kind: 'pipeline', id: 'pl_' + runId, runId })
    await db.saveRun(ws.id, run)
    emit({ type: 'pipeline', workspaceId: ws.id, state: run })
  } else {
    appendPrompt =
      'You are the code-maxxer orchestrator in direct mode: act on the files yourself. ' +
      'Use mcp__cm2__brain_search before re-investigating known problems and mcp__cm2__brain_record to save issues, lessons and decisions worth keeping.'
  }

  const mcpConfig = {
    mcpServers: {
      cm2: {
        command: process.execPath,
        args: [mcpScript],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          CM2_WORKSPACE_ID: ws.id,
          CM2_RUN_ID: runId,
          CM2_DATABASE_URL: DATABASE_URL,
          ...(run ? { CM2_PIPELINE: JSON.stringify((await db.pipelines()).find((x) => x.id === run!.pipelineId)) } : {})
        }
      }
    }
  }

  const args = [
    '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', opts.model, '--effort', opts.effort,
    '--permission-mode', opts.fullAccess ? 'bypassPermissions' : 'acceptEdits',
    '--append-system-prompt', appendPrompt,
    '--mcp-config', JSON.stringify(mcpConfig),
    // Token diet (measured on a trivial prompt: 41k → 9.3k tokens per request):
    // only the cm2 MCP server, no user-level plugins/skills/hooks, no slash commands,
    // and only the built-in tools a coding agent needs.
    '--strict-mcp-config',
    '--setting-sources', 'project,local',
    '--disable-slash-commands',
    '--no-chrome',
    '--tools', AGENT_TOOLS,
    // Per-machine bits go to the first user message so the system prompt cache is shared across workspaces.
    '--exclude-dynamic-system-prompt-sections',
    '--allowedTools', 'mcp__cm2'
  ]
  if (opts.forkFrom) args.push('--resume', opts.forkFrom, '--fork-session')
  else if (ws.sessionId) args.push('--resume', ws.sessionId)

  const child = spawn(bin('claude'), args, { cwd: ws.worktreePath, env: shellEnv(), detached: true })
  running.set(ws.id, child)
  emit({ type: 'workspace', workspace: await db.updateWorkspace(ws.id, { status: 'running' }) })
  child.stdin.end(opts.text)

  // --- streaming state ---
  const byIndex = new Map<number, Block>()
  const partialJson = new Map<string, string>()
  const toolStart = new Map<string, number>()
  let dirty = false
  const flush = () => {
    if (!dirty) return
    dirty = false
    emit({ type: 'message', workspaceId: ws.id, message: structuredClone(msg) })
  }
  const timer = setInterval(flush, 60)
  const touch = () => (dirty = true)
  const relPath = (p: string) => (isAbsolute(p) ? relative(ws.worktreePath, p) : p)

  const setRun = (next: PipelineRunState) => {
    run = next
    void db.saveRun(ws.id, next)
    emit({ type: 'pipeline', workspaceId: ws.id, state: next })
  }

  let pendingFork: ForkRequest | null = null

  // Files touched while each node was running: what that node hands on.
  const nodeFiles = new Map<string, Set<string>>()

  const stepWithHandoffs = (prev: PipelineRunState, step: { node: string; status: 'running' | 'passed' | 'failed'; note?: string }) => {
    const next = applyStep(prev, step).state
    const hs = (next.handoffs ??= [])
    if (step.status !== 'running') {
      const into = [...hs].reverse().find((h) => h.to === step.node && h.status === 'working')
      if (into) into.status = step.status === 'passed' ? 'done' : 'warning'
    }
    const target = next.current
    if (step.status === 'passed' && target && target !== step.node) {
      const files = [...(nodeFiles.get(step.node) ?? [])]
      const issues = next.issues.filter((i) => i.nodeId === step.node)
      hs.push({
        id: randomUUID(), from: step.node, to: target, back: false, status: 'working', at: Date.now(),
        title: step.note || `${next.nodes.find((n) => n.id === step.node)?.label ?? step.node} done`,
        items: [
          ...files.map((f) => ({ id: 'f:' + f, label: f.split('/').pop() ?? f, kind: 'file' as const })),
          ...issues.map((i) => ({
            id: i.id, label: i.title, kind: 'issue' as const,
            ...(i.resolved ? {} : { lost: true, why: 'Still open when the work moved on' })
          }))
        ]
      })
      nodeFiles.delete(step.node)
    }
    if (step.status === 'failed' && target && target !== step.node) {
      const open = next.issues.filter((i) => !i.resolved)
      hs.push({
        id: randomUUID(), from: step.node, to: target, back: true, status: 'working', at: Date.now(),
        title: step.note || `${open.length} issue${open.length === 1 ? '' : 's'} to fix`,
        items: open.map((i) => ({ id: i.id, label: i.title, kind: 'issue' as const }))
      })
    }
    if (next.status !== 'running') for (const h of hs) if (h.status === 'working') h.status = next.status === 'completed' ? 'done' : 'warning'
    return next
  }

  const finalizeToolInput = (b: Extract<Block, { kind: 'tool' }>) => {
    if (FILE_TOOLS.has(b.name)) {
      const input: any = b.input
      const path = relPath(input?.file_path ?? input?.notebook_path ?? '')
      if (path) {
        b.file = { path, ...fileStats(b.name, input) }
        if (run?.current) {
          const set = nodeFiles.get(run.current) ?? new Set<string>()
          set.add(path)
          nodeFiles.set(run.current, set)
        }
        emit({ type: 'files', workspaceId: ws.id, event: { kind: 'active', path, active: true } })
      }
    }
    if (b.name === 'mcp__cm2__pipeline_step' && run) setRun(stepWithHandoffs(run, b.input as any))
    if (b.name === 'mcp__cm2__fork_branch') {
      const i = b.input as any
      if (i?.name && i?.prompt) pendingFork = { name: String(i.name), prompt: String(i.prompt) }
    }
  }

  const onToolResult = (id: string, content: any, isError: boolean) => {
    const b = msg.blocks.find((x) => x.kind === 'tool' && x.id === id) as Extract<Block, { kind: 'tool' }> | undefined
    if (!b) return
    const text = Array.isArray(content) ? content.map((c: any) => c.text ?? '').join('\n') : String(content ?? '')
    b.status = isError ? 'error' : 'success'
    b.result = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text
    b.duration = Date.now() - (toolStart.get(id) ?? b.startedAt)
    if (b.file) emit({ type: 'files', workspaceId: ws.id, event: { kind: 'active', path: b.file.path, active: false } })
    if (run && b.name === 'mcp__cm2__brain_record' && (b.input as any)?.kind === 'issue') {
      let bid = 'b_?'
      try {
        bid = JSON.parse(text).id
      } catch { /* keep */ }
      setRun({ ...run, issues: [...run.issues, { id: bid, title: (b.input as any).title, nodeId: (b.input as any).node ?? run.current ?? '', resolved: false }] })
    }
    if (run && b.name === 'mcp__cm2__brain_resolve') {
      const rid = (b.input as any)?.id
      setRun({ ...run, issues: run.issues.map((i) => (i.id === rid ? { ...i, resolved: true } : i)) })
    }
    touch()
  }

  let buf = ''
  let stderr = ''
  child.stderr.on('data', (d) => (stderr = (stderr + d).slice(-4000)))
  child.stdout.on('data', (d) => {
    buf += d
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line) continue
      let ev: any
      try {
        ev = JSON.parse(line)
      } catch {
        continue
      }
      handle(ev)
    }
  })

  function handle(ev: any) {
    if (ev.session_id && ev.session_id !== ws!.sessionId) {
      ws!.sessionId = ev.session_id
      void db.updateWorkspace(ws!.id, { sessionId: ev.session_id })
    }
    if (ev.type === 'rate_limit_event') return recordClaudeRateLimit(ev.rate_limit_info)
    if (ev.type === 'stream_event') {
      const e = ev.event
      if (e.type === 'message_start') byIndex.clear()
      else if (e.type === 'content_block_start') {
        const cb = e.content_block
        let b: Block | null = null
        if (cb.type === 'thinking') b = { kind: 'thinking', id: randomUUID(), text: '', done: false, startedAt: Date.now() }
        else if (cb.type === 'text') b = { kind: 'text', id: randomUUID(), text: cb.text ?? '' }
        else if (cb.type === 'tool_use') {
          b = { kind: 'tool', id: cb.id, name: cb.name, input: {}, status: 'running', startedAt: Date.now() }
          toolStart.set(cb.id, Date.now())
          partialJson.set(cb.id, '')
        }
        if (b) {
          byIndex.set(e.index, b)
          msg.blocks.push(b)
          touch()
        }
      } else if (e.type === 'content_block_delta') {
        const b = byIndex.get(e.index)
        if (!b) return
        if (e.delta.type === 'text_delta' && b.kind === 'text') b.text += e.delta.text
        else if (e.delta.type === 'thinking_delta' && b.kind === 'thinking') b.text += e.delta.thinking
        else if (e.delta.type === 'input_json_delta' && b.kind === 'tool')
          partialJson.set(b.id, (partialJson.get(b.id) ?? '') + e.delta.partial_json)
        touch()
      } else if (e.type === 'content_block_stop') {
        const b = byIndex.get(e.index)
        if (b?.kind === 'thinking') {
          b.done = true
          b.endedAt = Date.now()
        } else if (b?.kind === 'tool') {
          try {
            b.input = JSON.parse(partialJson.get(b.id) || '{}')
          } catch { /* full message will fix it */ }
          finalizeToolInput(b)
        }
        touch()
      }
      return
    }
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const c of ev.message.content) if (c.type === 'tool_result') onToolResult(c.tool_use_id, c.content, !!c.is_error)
      return
    }
    if (ev.type === 'result') {
      msg.done = true
      msg.cost = ev.total_cost_usd
      const u = ev.usage ?? {}
      msg.tokens = { input: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 }
      if (ev.is_error) msg.error = typeof ev.result === 'string' ? ev.result : 'Run failed'
      touch()
    }
  }

  await new Promise<void>((resolve) => {
    child.on('close', async (code) => {
      clearInterval(timer)
      running.delete(ws.id)
      for (const b of msg.blocks) {
        if (b.kind === 'thinking' && !b.done) b.done = true
        if (b.kind === 'tool' && b.status === 'running') b.status = 'error'
      }
      if (!msg.done) {
        msg.done = true
        if (code !== 0) msg.error = stderr.trim().split('\n').slice(-3).join('\n') || `Agent exited with code ${code}`
      }
      if (run && run.status === 'running') {
        const status = code === 0 ? 'completed' : 'stopped'
        setRun({
          ...run, status, current: null,
          handoffs: run.handoffs?.map((h) => (h.status === 'working' ? { ...h, status: status === 'completed' ? 'done' : 'warning' } : h))
        })
      }
      dirty = true
      flush()
      await db.saveMessage(ws.id, msg)
      emit({ type: 'workspace', workspace: await db.updateWorkspace(ws.id, { status: msg.error ? 'error' : 'done' }) })
      running.delete(ws.id)
      // The agent asked to continue in a new branch: do it now that this turn is over.
      if (pendingFork && forkHandler) {
        const f = pendingFork
        try {
          const r = await forkHandler(ws.id, f, { ...opts, workspaceId: ws.id })
          msg.blocks.push({ kind: 'fork', id: randomUUID(), branch: r.branch, prompt: f.prompt, workspaceId: r.workspaceId })
        } catch (e: any) {
          msg.blocks.push({ kind: 'fork', id: randomUUID(), branch: f.name, prompt: f.prompt, workspaceId: null, error: e.message })
        }
        await db.saveMessage(ws.id, msg)
        emit({ type: 'message', workspaceId: ws.id, message: structuredClone(msg) })
      }
      resolve()
    })
  })
}

export const worktreeRoot = (home: string) => join(home, '.code-maxxer-2', 'worktrees')
