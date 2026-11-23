import { afterPipeline as afterPipelineDocs } from './docs'
import { existsSync } from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { awaitSetup } from './projectSettings'
import { randomUUID } from 'node:crypto'
import { join, relative, isAbsolute } from 'node:path'
import type { Block, EngineEvent, Message, NodeTask, Pipeline, PipelineRunState, Provider, QueueItem, SendOptions } from '@shared/types'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { opencodeBin, providerOf, usableModel } from './models'
import { db, DATABASE_URL } from '../db'
import { applyStep, decideWait, newRunState, pipelinePrompt } from './pipelines'
import { recordClaudeRateLimit } from './usage'
import { bridge } from './browser'
import { bin, shellEnv } from './bins'
import * as plans from './plans'
import { designProtocol, designRule } from './design'
import { afterRun, agentLessons, lessonsRule } from './learning'
import { globalRulesRule, maybeSweep } from './brainAll'
import { effectivePipeline, loopStatsRule, reviewLoop } from './loops'
import { languageRule, reportLanguageRule } from './language'
import { compactContext } from '@shared/turns'
import { attach, chatSkills, skillsRule } from './skillstore'
import { pool } from '../db'
import { execFile } from 'node:child_process'

const PLAN_RULE =
  'PLANS: for a request that needs several distinct steps or touches many files, plan first: explore read-only (Read/Grep/Glob, no edits), ' +
  'then call mcp__cm2__plan_propose with 2-10 ordered tasks, each small enough for one commit, and follow what its reply says. ' +
  'Small or single-step requests: just do them, no plan. While executing an approved plan, call mcp__cm2__plan_task with status in_progress ' +
  'right before each task and done (or failed/skipped with a note) after it is checked and committed; use mcp__cm2__plan_read if you lose track.'
const ASK_RULE =
  'QUESTIONS: when you need a decision only the user can make, call mcp__cm2__ask_user (two answers per question) instead of asking in prose, then stop.'

type Emit = (e: EngineEvent) => void

const running = new Map<string, ChildProcess>()

export type ForkRequest = { name: string; prompt: string }
type ForkHandler = (wsId: string, fork: ForkRequest, opts: SendOptions) => Promise<{ workspaceId: string; branch: string }>
let forkHandler: ForkHandler | null = null
/** main wires this: create the branch + worktree, then continue the conversation there. */
export const setForkHandler = (h: ForkHandler) => (forkHandler = h)
export const BROWSER_RULE =
  'To check a UI change, use the built-in browser the user watches: mcp__cm2__browser_navigate to the dev server, browser_read, browser_click / browser_type, and browser_screenshot to verify (start the dev server in the background first if needed). ' +
  'The panel is narrow (about mobile width), so it is NOT a desktop test: every UI check covers several viewports with mcp__cm2__browser_viewport — ' +
  'mobile, tablet, mac (1440×900), desktop (fullscreen 1920×1080) and ultrawide (3440×1440) — with a browser_screenshot at each, fixing what breaks (overflow, wrapping, stretched or lost content, margins). ' +
  'Say which viewports you checked, then browser_viewport panel to give the panel back.'
export /** How the agent closes a turn: what was done, short. */
const REPLY_RULE =
  'REPLIES: the user wants short answers. When you finish, say what was done and nothing else: a few lines or a short list ' +
  '(what changed, where, and anything still open or that needs them). No recap of the request, no narration of your steps, ' +
  'no explanations they did not ask for, no repeated details, no closing offers. Full detail only when they ask for it.'
const COMMIT_RULE =
  'STANDING INSTRUCTION FROM THE USER (this is the user explicitly asking you to commit, every time): when you finish a change they asked for and its checks pass, commit it before replying: git add -A && git commit -m "<type>: <what changed>" on the current branch. One commit per logical change, conventional type (feat/fix/refactor/test/docs/chore). Never push, never amend, never rewrite history. Mention the commit in your reply.'
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
// Agent: subagents in parallel, each with its own context (only their summary comes back).
const AGENT_TOOLS = 'Bash,Read,Edit,Write,Glob,Grep,Agent'

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
/** main wires this: a run ended, or the agent asked the user something (desktop notification). */
type Alert = { workspaceId: string; kind: 'done' | 'error' | 'question'; text: string }
let alertHandler: ((a: Alert) => void) | null = null
export const setAlertHandler = (h: (a: Alert) => void) => (alertHandler = h)
/** Branches whose agent is at work right now. */
export const runningIds = () => [...running.keys()]

// ─── queue: prompts sent while busy run when the turn ends; Steer interrupts and runs one now ───
type Queued = { item: QueueItem; opts: SendOptions }
const queues = new Map<string, Queued[]>()
const steered = new Set<string>()
let lastEmit: Emit | null = null
let lastScript = ''
const publishQueue = (wsId: string) =>
  lastEmit?.({ type: 'queue', workspaceId: wsId, items: (queues.get(wsId) ?? []).map((q) => q.item) })

export const listQueue = (wsId: string) => (queues.get(wsId) ?? []).map((q) => q.item)

function findQueued(id: string): { wsId: string; i: number } | null {
  for (const [wsId, q] of queues) {
    const i = q.findIndex((x) => x.item.id === id)
    if (i >= 0) return { wsId, i }
  }
  return null
}
export function removeQueued(id: string) {
  const f = findQueued(id)
  if (!f) return
  queues.get(f.wsId)!.splice(f.i, 1)
  publishQueue(f.wsId)
}
export function editQueued(id: string, text: string) {
  const f = findQueued(id)
  if (!f) return
  const q = queues.get(f.wsId)![f.i]
  q.item.text = text
  q.opts.text = text
  publishQueue(f.wsId)
}
/** Send this queued prompt right away: it goes to the front and the current turn is interrupted. */
export function steer(id: string) {
  const f = findQueued(id)
  if (!f) return
  const q = queues.get(f.wsId)!
  const [it] = q.splice(f.i, 1)
  q.unshift(it)
  publishQueue(f.wsId)
  if (running.has(f.wsId)) {
    steered.add(f.wsId)
    stop(f.wsId, 'SIGINT')
  }
  else void runNext(f.wsId)
}
async function runNext(wsId: string) {
  const q = queues.get(wsId)
  const next = q?.shift()
  if (!next || !lastEmit) return
  // The prompts queued after it with the same settings go in the same turn: one run, each still its own message
  const group = [next]
  const same = (o: SendOptions) =>
    o.model === next.opts.model && o.effort === next.opts.effort && o.fullAccess === next.opts.fullAccess && JSON.stringify(o.mode) === JSON.stringify(next.opts.mode) && !o.forkFrom && !o.userMessageId
  while (q!.length && !next.opts.forkFrom && !next.opts.userMessageId && same(q![0].opts)) group.push(q!.shift()!)
  publishQueue(wsId)
  const opts: SendOptions =
    group.length === 1
      ? next.opts
      : {
          ...next.opts,
          text: group.map((g) => g.opts.text).join('\n\n'),
          attachments: group.flatMap((g) => g.opts.attachments ?? []),
          batch: group.map((g) => ({ text: g.opts.text, attachments: g.opts.attachments }))
        }
  await send(opts, lastEmit, lastScript).catch(() => {})
}

/** Stored session ids: Claude's bare, others prefixed with their provider. */
function parseSession(v: string | null): { provider: Provider; id: string } | null {
  if (!v) return null
  const m = v.match(/^(codex|opencode):(.+)$/)
  return m ? { provider: m[1] as Provider, id: m[2] } : { provider: 'claude', id: v }
}

/** When the model changes mid-chat, the new one gets the recent conversation (handoff through context). */
async function recentContext(wsId: string): Promise<string> {
  const msgs = (await db.messages(wsId)).slice(-8)
  const lines = msgs.map((m) =>
    m.role === 'user'
      ? `USER: ${m.text}`
      : `ASSISTANT: ${m.blocks.filter((b) => b.kind === 'text').map((b: any) => b.text).join(' ').slice(0, 1200)}`
  )
  return lines.length ? `Conversation so far (handled by another model):\n${lines.join('\n')}\n\nNew request:\n` : ''
}

function segmentPrompt(handoff: string, task: string): string {
  return `You take over a pipeline run from a previous agent (different model).\nOriginal task: ${task}\n\nHandoff from the previous agent:\n${handoff || '(none)'}\n\nOpen issues are in the brain (mcp__cm2__brain_search kind=issue open=true). Continue from the node the protocol says.`
}

export function isRunning(workspaceId: string) {
  return running.has(workspaceId)
}

/** Runs the user stopped with the Stop button: they end with that, not with an exit code. */
const userStopped = new Set<string>()
export function stopByUser(workspaceId: string) {
  if (running.has(workspaceId)) userStopped.add(workspaceId)
  stop(workspaceId)
}

export function stop(workspaceId: string, signal: NodeJS.Signals = 'SIGTERM') {
  const p = running.get(workspaceId)
  if (p?.pid) {
    try {
      process.kill(-p.pid, signal)
    } catch {
      p.kill(signal)
    }
  }
}

export const STOPPED_BY_USER = 'Run stopped by the user'

const RESUME_PROMPT =
  'code-maxxer restarted while you were working, and your previous turn was cut off mid-way. ' +
  'Check the current state of the files (git status, what you already changed), then continue the task from where you stopped. Do not redo finished work.'

/**
 * At launch: branches still marked running lost their agent when the app quit.
 * Close the cut-off turn and continue it in the same session.
 */
export async function resumeCutRuns(emit: Emit, mcpScript: string): Promise<void> {
  for (const ws of await db.workspaces()) {
    if (ws.status !== 'running' || running.has(ws.id)) continue
    const msgs = await db.messages(ws.id)
    const last = [...msgs].reverse().find((m) => m.role === 'assistant')
    if (last && last.role === 'assistant' && !last.done) {
      for (const b of last.blocks) {
        if (b.kind === 'thinking' && !b.done) b.done = true
        if (b.kind === 'tool' && b.status === 'running') b.status = 'error'
      }
      last.done = true
      last.cutOff = true
      last.endedAt = Date.now()
      await db.saveMessage(ws.id, last)
      emit({ type: 'message', workspaceId: ws.id, message: last })
    }
    const saved = await db.getSetting<Pick<SendOptions, 'model' | 'effort' | 'mode' | 'fullAccess'>>(`opts:${ws.id}`)
    if (!saved || !ws.sessionId) {
      emit({ type: 'workspace', workspace: await db.updateWorkspace(ws.id, { status: 'done' }) })
      continue
    }
    // A pipeline run can't be picked up mid-node: the agent continues its session directly.
    const mode = saved.mode?.kind === 'pipeline' ? ({ kind: 'direct' } as const) : saved.mode ?? { kind: 'sentient' as const }
    void send({ workspaceId: ws.id, text: RESUME_PROMPT, model: saved.model, effort: saved.effort, mode, fullAccess: saved.fullAccess, resumeCut: true }, emit, mcpScript).catch((e) =>
      console.warn('[resume]', ws.branch, e.message)
    )
  }
}

export async function send(opts: SendOptions, emit: Emit, mcpScript: string): Promise<void> {
  await awaitSetup(opts.workspaceId) // the project's setup script, when it asks the agent to wait
  const ws = await db.workspace(opts.workspaceId)
  if (!ws) throw new Error('Workspace not found')
  lastEmit = emit
  lastScript = mcpScript
  if (running.has(ws.id)) {
    // Busy: queue it, it runs when this turn ends.
    const q = queues.get(ws.id) ?? []
    q.push({ item: { id: randomUUID(), workspaceId: ws.id, text: opts.text, at: Date.now(), attachments: opts.attachments?.length ? opts.attachments : undefined }, opts })
    queues.set(ws.id, q)
    publishQueue(ws.id)
    return
  }

  // Remember this branch's settings: scheduled runs reuse them.
  if (!opts.resumeCut) void db.setSetting(`opts:${ws.id}`, { model: opts.model, effort: opts.effort, mode: opts.mode, fullAccess: opts.fullAccess })
  void db.setSetting('opts:last', { model: opts.model, effort: opts.effort, fullAccess: opts.fullAccess })

  let currentUserId: string | null = null
  const sentIds = new Set<string>()
  if (!opts.segment && !opts.resumeCut) {
    // Queued prompts sent together: each one its own bubble, the run answers them all
    for (const part of opts.batch ?? [{ text: opts.text, attachments: opts.attachments }]) {
      const user: Message = { id: (!opts.batch && opts.userMessageId) || randomUUID(), role: 'user', text: part.text, at: Date.now(), ...(part.attachments?.length ? { attachments: part.attachments } : {}), ...(opts.rewrittenBy ? { rewrittenBy: opts.rewrittenBy } : {}) }
      currentUserId = user.id
      sentIds.add(user.id)
      await db.saveMessage(ws.id, user)
      emit({ type: 'message', workspaceId: ws.id, message: user })
    }
  }

  const msg: Extract<Message, { role: 'assistant' }> = {
    id: randomUUID(), role: 'assistant', blocks: [], at: Date.now(), done: false
  }

  // Pipeline mode: the run state lives here (mirror) and in the MCP server (authority).
  let run: PipelineRunState | null = null
  let appendPrompt = ''
  let model = opts.model
  // Small, routine tasks (git operations, quick questions) go to the cheapest model: same result, a fraction of the cost.
  const small =
    opts.mode.kind !== 'pipeline' && !opts.segment && !opts.resumeCut && !opts.attachments?.length &&
    !/@\w/.test(opts.text) && (await db.getSetting<boolean>('model:smallTasks')) !== false && isSmallTask(opts.text)
  if (small) {
    model = CHEAPEST
    msg.route = { kind: 'small', model: CHEAPEST }
  }
  let segment: string[] | null = null
  let pipelineDef: Pipeline | null = null
  const runId = opts.segment?.runId ?? opts.resumeRun ?? randomUUID()
  if (opts.mode.kind === 'pipeline') {
    const mode = opts.mode
    const found = await db.pipeline(mode.pipelineId)
    if (!found) throw new Error('Pipeline not found')
    // As this run plays it: Security always in, tests only with Pro, the strategist's changes and advice.
    const p = await effectivePipeline(found, ws.projectId)
    pipelineDef = p
    const base = p.model || opts.model
    if (opts.segment || opts.resumeRun) {
      run = (await db.runs(ws.id)).find((r) => r.runId === runId) ?? null
      if (!run) throw new Error('Pipeline run not found')
      if (opts.resumeRun) msg.blocks.push({ kind: 'pipeline', id: 'pl_' + runId + '_' + Date.now(), runId })
    } else {
      run = { ...newRunState(p, runId), task: opts.text, model: base, handoffs: [] }
      msg.blocks.push({ kind: 'pipeline', id: 'pl_' + runId, runId })
    }
    // The stretch of nodes sharing one model runs as one agent session; another model means a new agent + handoff.
    const startId = run.current ?? p.nodes.find((n) => !n.skip)?.id
    const start = Math.max(0, p.nodes.findIndex((n) => n.id === startId))
    const modelOf = (i: number) => p.nodes[i]?.model || base
    model = modelOf(start)
    segment = []
    // Skipped nodes don't run: they never split the stretch.
    for (let i = start; i < p.nodes.length && (p.nodes[i].skip || modelOf(i) === model); i++) if (!p.nodes[i].skip) segment.push(p.nodes[i].id)
    // A loop target before `start` is still ours if it has our model.
    for (const n of p.nodes) if (!n.skip && (n.model || base) === model && !segment.includes(n.id)) segment.push(n.id)
    // The task here may be the orchestrator's rewrite (often in English): the language comes from the settings, not from it.
    appendPrompt = (await reportLanguageRule()) + '\n\n' + REPLY_RULE + '\n\n' + pipelinePrompt(p, await db.agents(), { only: segment, startAt: p.nodes[start]?.id, multi: p.nodes.some((n, i) => !n.skip && modelOf(i) !== base) })
    if (opts.resumeRun && run.current)
      appendPrompt += `\n\nRESUMING: the run waited for the user and the user's message is their decision. Continue the pipeline from [${run.current}] following the protocol (call pipeline_step running for it).`
    if (opts.segment) msg.blocks.push({ kind: 'handoff', id: randomUUID(), model, toNode: p.nodes[start]?.label ?? '', text: opts.segment.handoff })
    await db.saveRun(ws.id, run)
    emit({ type: 'pipeline', workspaceId: ws.id, state: run })
  } else {
    // Sentient: the orchestrator decides between acting itself and handing the request to a pipeline.
    const sentient = opts.mode.kind === 'sentient'
    const pls = sentient ? await db.pipelines() : []
    appendPrompt =
      (await languageRule()) + '\n\n' + REPLY_RULE + '\n\n' +
      (sentient
        ? 'You are the code-maxxer orchestrator in SENTIENT mode. Every request that changes files (code, styles, config, docs in the repo) goes to a loop: ' +
          'a loop checks the work, runs a security check on every change and learns from each run. ' +
          'Do it yourself only when nothing in the files changes: questions, explanations, reading or searching the code, git operations (commit, push, merge, branches), ' +
          'and setting things up in the app (automations, skills, agents, scans). ' +
          'SIZE THE LOOP TO THE CHANGE: the library loops below are for real work (a feature, a refactor, a bug across files). ' +
          'A small, contained change (a value in a config, a port, an env var, a text, a style, a fix in one or two files) never gets them: ' +
          'make a flash pipeline with mcp__cm2__pipeline_flash, with only the steps it needs, usually Build then a check: a script node with the repo\'s own command (typecheck, tests, build: no AI, no tokens) when one proves the change, else a short QA; add Security only when the change touches auth, secrets, input or exposure. ' +
          'Flash pipelines are made for this task and not saved in the library. Otherwise pick the library loop that fits with mcp__cm2__pipeline_start. ' +
          'Before anything else call mcp__cm2__route_explain with your choice and one short sentence on why (the user sees it):\n' +
          pls.map((p) => `- ${p.id}: ${p.name} — ${p.description} (${p.nodes.map((n) => n.label).join(' → ')})`).join('\n') + '\n' +
          ((r) => (r ? r + '\n' : ''))(await loopStatsRule(ws.projectId))
        : 'You are the code-maxxer orchestrator in direct mode: act on the files yourself. ') +
      'Use mcp__cm2__brain_search before re-investigating known problems and mcp__cm2__brain_record to save issues, lessons and decisions worth keeping. ' +
      COMMIT_RULE + ' ' + BROWSER_RULE + ' ' + PLAN_RULE + ' ' + ASK_RULE + ' ' + ((await designProtocol(ws.id)) || designRule(ws.worktreePath)) +
      ((r) => (r ? '\n\n' + r : ''))(await lessonsRule(ws.projectId)) +
      ((r) => (r ? '\n\n' + r : ''))(await globalRulesRule()) +
      (await linkedRule(ws.id)) +
      '\n\nMORE THAN ONE REPO: when a request spans several repositories (a frontend and its backend, two repos inside your folder, another project of the workspace), ' +
      'find them first (folders with a .git inside yours, mcp__cm2__projects_list) and check how they connect (API base URLs, shared types, env, docs); ' +
      'if the user did not say which, tell them in one line what you found. Then call mcp__cm2__project_link for each other repo and work on all of them in the same turn, ' +
      'each in its own folder; commit each repo on its own.' +
      '\n\nAUTOMATIONS: when the user wants something to happen on its own (every morning, on push, on new commits, a check on each change), ' +
      'set it up with mcp__cm2__automation_save (see automation_list first to avoid duplicates).' +
      '\n\nPARALLEL WORK: for independent pieces (searching several areas, changes to separate files, checks), start several subagents with the Agent tool ' +
      'in ONE message so they run at the same time. Give each a short, complete brief (files, goal, what to report) and ask for a short report: ' +
      'their reading stays in their context, only the summary reaches yours. Don\'t use them for small tasks or for pieces that touch the same files.' +
      ' While they work, don\'t do other work in the same area: wait for their reports, then check everything once (one typecheck and test run), and don\'t redo their work: send a wrong piece back to its subagent.' +
      '\n\nWAITING: never wait with a fixed sleep (sleep 8, sleep 10). Wait for the thing itself with a short timeout: until curl answers on the port, a file exists, the process prints its ready line.' +
      '\n\nLEARNING FROM ANOTHER PROJECT: when the user says to look at how something was done in another project and learn from it, ' +
      'find it with mcp__cm2__projects_list, read its code in its folder and its lessons (mcp__cm2__project_lessons), ' +
      'then save what applies here with mcp__cm2__lessons_import and tell the user what was learned.' +
      '\n\nSKILLS AND AGENTS: when the user asks to install a skill use mcp__cm2__skill_install; when they ask to create or train an agent, ' +
      'refine it with them, then save it with mcp__cm2__agent_save (instructions + the skills loaded here).' +
      '\n\nSKILLS ON DEMAND: when you struggle with a kind of work (the user corrected you on the same thing twice, a check keeps failing, you lack know-how: animations, accessibility, SEO…) ' +
      'and no installed skill covers it (mcp__cm2__skill_list), look for a well-made skill online: `gh search code "filename:SKILL.md <topic>"`, `gh search repos "<topic> claude skill"`, ' +
      'github.com/anthropics/skills; read the candidates\' SKILL.md (curl the raw file) and pick the best one, then ask with mcp__cm2__skill_propose. Never install one without that approval. Propose every skill the work needs in one go, then stop and wait: do not start the work until the user has decided (a message tells you).' +
      '\n\nAGENT PROPOSALS: the app learns from how it is used. When, over several messages here, the user keeps teaching you how to do a repeatable kind of work ' +
      '(their taste, rules, checklists: e.g. how to review and fix a landing page design) and no agent does it yet, propose to consolidate it with mcp__cm2__agent_propose: ' +
      'a name, one sentence why, and standing instructions with everything they taught. When they use an @agent and correct it, propose updating that agent (same handle) with the correction. ' +
      'Not for one-off tasks; at most once per chat and topic; then carry on with the request.' +
      '\n\nYOU RUN THE WHOLE APP: Cyber Security and the servers are yours too. To scan or check security (code, production, staging, malware…) call mcp__cm2__security_scan with a focus; ' +
      'to see scores and open findings mcp__cm2__security_status; to fix them, fix the code (or the server through env_exec when the user asked), verify, then mcp__cm2__security_update. ' +
      'To look at or troubleshoot a server: mcp__cm2__env_info, then mcp__cm2__env_exec (read-only unless the user asked for a change). ' +
      'Recon is yours too: set up or rename environments, monitoring, incidents, the CI/CD pipeline, its secrets and deploys with mcp__cm2__recon — do it yourself instead of asking the user to click through Recon.'
  }
  // Custom agents called with @handle: their skills load in this chat and their instructions lead this request.
  const called = await calledAgents(opts.text)
  for (const a of called) for (const sid of a.skills ?? []) await attach(pool, ws.id, sid, a.handle ?? a.name)
  if (called.some((a) => a.skills?.length)) emit({ type: 'skills', workspaceId: ws.id })
  const loaded = await chatSkills(pool, ws.id)
  if (loaded.length) appendPrompt += '\n\n' + skillsRule(loaded)

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
          CM2_BRIDGE_URL: bridge.url,
          CM2_BRIDGE_TOKEN: bridge.token,
          CM2_AUTOPLAN: opts.fullAccess ? '1' : '0',
          CM2_WORKTREE: ws.worktreePath,
          CM2_MODEL: model,
          CM2_SENTIENT: opts.mode.kind === 'sentient' ? '1' : '0',
          ...(run && pipelineDef
            ? { CM2_PIPELINE: JSON.stringify(pipelineDef), CM2_RUN_STATE: JSON.stringify(run), CM2_SEGMENT: JSON.stringify(segment ?? []) }
            : {})
        }
      }
    }
  }

  // No Claude Code on this Mac: the run goes to the installed provider instead (Codex), not to a CLI that isn't there.
  model = await usableModel(model)
  const provider = providerOf(model)
  const sess = parseSession(ws.sessionId)
  // Switching provider mid-chat can't resume the other one's session: pass the recent conversation instead.
  let prompt = opts.segment ? segmentPrompt(opts.segment.handoff, opts.text) : opts.text
  // Attached files live outside the worktree: the agent opens them with its Read tool (images included).
  if (opts.attachments?.length)
    prompt += `\n\nThe user attached ${opts.attachments.length === 1 ? 'a file' : `${opts.attachments.length} files`}; read ${opts.attachments.length === 1 ? 'it' : 'them'} with the Read tool:\n` +
      opts.attachments.map((a) => `- ${a.path}${a.kind === 'image' ? ' (image)' : ''}`).join('\n')
  if (called.length) {
    const intros: string[] = []
    for (const a of called) {
      // Its own experience comes with it, from every project it worked in
      const learned = a.handle ? await agentLessons(a.handle) : ''
      intros.push(`[The user called @${a.handle}, a custom agent: work as this agent for this request.]\n${a.name}: ${a.description}\n${a.instructions}${learned ? `\n\n${learned}` : ''}`)
    }
    prompt = intros.join('\n\n') + '\n\n[Request]\n' + prompt
  }
  // Compact context (default): every request starts a fresh session with short notes of the earlier turns,
  // instead of resending the whole conversation on each step; the agent reads old turns back with history_read.
  const compact = !opts.segment && !opts.forkFrom && !opts.resumeCut && (await db.getSetting<boolean>('context:compact')) !== false
  const canResume = !compact && !opts.segment && sess && sess.provider === provider
  if (compact) {
    const before = (await db.messages(ws.id)).filter((m) => !sentIds.has(m.id))
    prompt = compactContext(before) + prompt
  } else if (!opts.segment && !opts.forkFrom && sess && sess.provider !== provider) prompt = (await recentContext(ws.id)) + prompt

  let cmd = ''
  let args: string[] = []
  let env: NodeJS.ProcessEnv = shellEnv()
  if (provider === 'claude') {
    cmd = bin('claude')
    args = [
      '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--model', model, '--effort', opts.effort,
      '--permission-mode', opts.fullAccess ? 'bypassPermissions' : 'acceptEdits',
      '--append-system-prompt', appendPrompt,
      // Resumed sessions would otherwise keep the prompt snapshotted at their first turn (old rules).
      '--system-prompt-snapshot', 'off',
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
    // The other projects of the workspace are readable, so the agent can learn from them when asked.
    for (const dir of await siblingFolders(ws.projectId)) args.push('--add-dir', dir)
    // Twin branches live under the worktrees folder: a repo linked mid-turn is writable right away.
    const wtRoot = join(homedir(), '.code-maxxer-2', 'worktrees')
    if (existsSync(wtRoot)) args.push('--add-dir', wtRoot)
    for (const tw of await db.linkedWorkspaces(ws.id)) if (existsSync(tw.worktreePath)) args.push('--add-dir', tw.worktreePath)
    for (const id of (await db.project(ws.projectId))?.linked ?? []) {
      const lp = await db.project(id)
      if (lp && existsSync(lp.path)) args.push('--add-dir', lp.path)
    }
    if (opts.forkFrom) args.push('--resume', opts.forkFrom, '--fork-session')
    else if (canResume) args.push('--resume', sess!.id)
  } else if (provider === 'codex') {
    cmd = bin('codex')
    const srv = mcpConfig.mcpServers.cm2
    const toml = (v: string) => JSON.stringify(v)
    args = [
      'exec', ...(canResume ? ['resume'] : []),
      '--json', '--skip-git-repo-check',
      '-c', 'approval_policy="never"',
      ...(opts.fullAccess ? ['--dangerously-bypass-approvals-and-sandbox'] : ['-c', 'sandbox_mode="workspace-write"']),
      '-m', model,
      '-c', `model_reasoning_effort=${toml(opts.effort)}`,
      '-c', `developer_instructions=${toml(appendPrompt)}`,
      '-c', `mcp_servers.cm2.command=${toml(srv.command)}`,
      '-c', `mcp_servers.cm2.args=[${srv.args.map(toml).join(',')}]`,
      '-c', `mcp_servers.cm2.env={${Object.entries(srv.env).map(([k, v]) => `${k}=${toml(String(v))}`).join(',')}}`,
      '-c', 'mcp_servers.cm2.default_tools_approval_mode="approve"',
      ...(opts.attachments ?? []).filter((a) => a.kind === 'image').flatMap((a) => ['-i', a.path]),
      ...(canResume ? [sess!.id] : ['-C', ws.worktreePath]),
      '-'
    ]
  } else {
    // OpenCode: our agent + MCP live in a private config dir.
    cmd = opencodeBin()
    const dir = await mkdtemp(join(tmpdir(), 'cm2-oc-'))
    await mkdir(join(dir, 'agent'), { recursive: true })
    await writeFile(join(dir, 'agent', 'cm2.md'), `---\nmode: primary\n---\n${appendPrompt}\n`)
    const srv = mcpConfig.mcpServers.cm2
    await writeFile(join(dir, 'opencode.json'), JSON.stringify({ mcp: { cm2: { type: 'local', command: [srv.command, ...srv.args], environment: srv.env, enabled: true } } }))
    env = { ...env, OPENCODE_CONFIG_DIR: dir, PWD: ws.worktreePath }
    args = ['run', '--standalone', '--auto', '--format', 'json', '--agent', 'cm2', '-m', model, ...(canResume ? ['-s', sess!.id] : [])]
  }

  const child = spawn(cmd, args, { cwd: ws.worktreePath, env, detached: true })
  // The CLI isn't installed: say so in the chat instead of crashing on an unhandled error
  child.on('error', (e: NodeJS.ErrnoException) => {
    msg.error =
      e.code === 'ENOENT'
        ? provider === 'claude'
          ? 'Claude Code is not installed. Install it with: npm install -g @anthropic-ai/claude-code (or from claude.com/code), sign in with claude, then send the message again.'
          : `${provider} is not installed on this Mac.`
        : e.message
  })
  child.stdin.on('error', () => {})
  running.set(ws.id, child)
  emit({ type: 'workspace', workspace: await db.updateWorkspace(ws.id, { status: 'running' }) })
  child.stdin.end(prompt)

  // --- streaming state ---
  const byIndex = new Map<number, Block>()
  const partialJson = new Map<string, string>()
  const toolStart = new Map<string, number>()
  let dirty = false
  let savedAt = 0
  const flush = () => {
    if (!dirty) return
    dirty = false
    emit({ type: 'message', workspaceId: ws.id, message: structuredClone(msg) })
    // Keep the turn so far on disk: after a restart the chat still shows what the agent did.
    if (Date.now() - savedAt > 2000) {
      savedAt = Date.now()
      void db.saveMessage(ws.id, structuredClone(msg)).catch(() => {})
    }
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
  // Sentient mode: the request handed to a pipeline, started when this turn ends.
  let pendingPipeline: { pipelineId: string; task: string } | null = null

  // Files touched while each node was running: what that node hands on.
  const nodeFiles = new Map<string, Set<string>>()
  // Tool call → the node it ran under and the task row it fills.
  const taskNode = new Map<string, string>()
  // Plan task the agent is on: its tool calls become the task's steps, its commits link to it.
  let planTask = await plans.activeTask(ws.id)
  const planStep = new Map<string, Promise<{ taskId: string; stepId: string }>>()
  const taskOf_ = new Map<string, string>()

  const stepWithHandoffs = (prev: PipelineRunState, step: { node: string; status: 'running' | 'passed' | 'failed'; note?: string }) => {
    const next = applyStep(prev, step).state
    const now = Date.now()
    // Time per node: a pass opens on running and closes on passed/failed (or when another node starts).
    for (const nd of next.nodes) {
      const close = step.status === 'running' ? nd.id !== step.node : nd.id === step.node
      if (nd.since && close) {
        nd.ms = (nd.ms ?? 0) + (now - nd.since)
        nd.since = undefined
      }
    }
    if (step.status === 'running') {
      const nd = next.nodes.find((n) => n.id === step.node)
      if (nd && !nd.since) nd.since = now
    }
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
    if (run?.current && run.status === 'running') {
      const t = taskOf(b.name, b.input, relPath)
      const nd = run.nodes.find((n) => n.id === run!.current)
      if (t && nd && !taskNode.has(b.id)) {
        const tasks = (nd.tasks ??= [])
        const last = tasks[tasks.length - 1]
        taskNode.set(b.id, nd.id)
        if (last && last.title === t.title && last.kind === t.kind && last.status !== 'running') {
          // Same edit again on one file: one row with a count.
          last.count = (last.count ?? 1) + 1
          last.status = 'running'
          taskOf_.set(b.id, last.id)
        } else {
          const id = randomUUID()
          const ai: any = b.input
          tasks.push({
            id, ...t, status: 'running', startedAt: Date.now(),
            ...(t.kind === 'agent' ? { agent: { prompt: String(ai?.prompt ?? '').slice(0, 1500), steps: 0, last: '', model: ai?.model ? String(ai.model) : undefined } } : {})
          })
          if (tasks.length > 40) tasks.splice(0, tasks.length - 40)
          taskOf_.set(b.id, id)
        }
        setRun({ ...run })
      }
    }
    if (b.name === 'mcp__cm2__plan_task') {
      const i = b.input as any
      if (i?.status === 'in_progress' && i.id) planTask = { id: String(i.id), planId: planTask?.planId ?? '' }
      else if (planTask && i?.id === planTask.id) planTask = null
    } else if (planTask && !planStep.has(b.id)) {
      const t = taskOf(b.name, b.input, relPath)
      if (t) {
        const taskId = planTask.id
        const planId = planTask.planId
        planStep.set(
          b.id,
          plans.addStep(taskId, { ...t, file: b.file?.path }).then(async (stepId) => {
            if (planId) await plans.publishPlan(planId)
            return { taskId, stepId }
          })
        )
      }
    }
    // Entering a node shows at once; verdicts wait for the tool's answer (it can refuse them, and it runs the scripts).
    if (b.name === 'mcp__cm2__pipeline_step' && run && (b.input as any)?.status === 'running') {
      const nd = run.nodes.find((n) => n.id === (b.input as any).node)
      if (nd && nd.role !== 'script' && nd.role !== 'gate' && run.status === 'running') setRun(stepWithHandoffs(run, b.input as any))
    }
    if (b.name === 'mcp__cm2__fork_branch') {
      const i = b.input as any
      if (i?.name && i?.prompt) pendingFork = { name: String(i.name), prompt: String(i.prompt) }
    }
  }

  const onPlanToolResult = async (b: Extract<Block, { kind: 'tool' }>, text: string, isError: boolean) => {
    const step = planStep.get(b.id)
    if (step) {
      const { taskId, stepId } = await step
      await plans.finishStep(taskId, stepId, b.duration ?? 0, isError)
      // A commit made while on the task: link it to the card.
      if (!isError && b.name === 'Bash' && /\bgit\s+commit\b/.test(String((b.input as any)?.command ?? ''))) {
        const out = await new Promise<string>((ok) =>
          execFile(bin('git'), ['log', '-1', '--format=%H%x1f%s'], { cwd: ws.worktreePath, env: shellEnv() }, (_e, o) => ok(String(o ?? '')))
        )
        const [sha, subject] = out.trim().split('\x1f')
        if (sha) await plans.addCommit(taskId, { sha, subject: subject ?? '' })
      }
      const pid = planTask?.planId || (await plans.activeTask(ws.id))?.planId
      if (pid) await plans.publishPlan(pid)
    }
    if (b.name === 'mcp__cm2__pipeline_step' && run && !isError && !text.startsWith('REFUSED')) {
      const i = b.input as any
      let next = run
      if (i?.status && i.status !== 'running') next = stepWithHandoffs(next, i)
      // Steps the server applied itself: the scripts it ran.
      for (const m of text.matchAll(/^@@step (\{.*\})$/gm)) {
        try {
          next = stepWithHandoffs(next, JSON.parse(m[1]))
        } catch { /* malformed line */ }
      }
      if (next !== run) setRun(next)
    }
    if (!isError && (b.name === 'mcp__cm2__skill_install' || b.name === 'mcp__cm2__skill_load')) emit({ type: 'skills', workspaceId: ws.id })
    if (!isError && b.name === 'mcp__cm2__agent_save') emit({ type: 'agents' })
    if (!isError && b.name === 'mcp__cm2__pipeline_start' && text.startsWith('OK:')) {
      const i = b.input as any
      pendingPipeline = { pipelineId: String(i.pipelineId), task: String(i.task) }
      return
    }
    // A flash pipeline: made for this task only, its id is in the answer
    if (!isError && b.name === 'mcp__cm2__pipeline_flash' && text.startsWith('OK:')) {
      const id = text.match(/\bid=(flash-[\w-]+)/)?.[1]
      if (id) pendingPipeline = { pipelineId: id, task: String((b.input as any).task) }
      return
    }
    if (!isError && b.name === 'mcp__cm2__ask_user') {
      const qs = Array.isArray((b.input as any)?.questions) ? (b.input as any).questions : []
      const questions = qs
        .filter((q: any) => q?.title && q?.primary && q?.secondary)
        .slice(0, 4)
        .map((q: any, i: number) => ({ id: `q${i}`, title: String(q.title), detail: q.detail ? String(q.detail) : undefined, primary: String(q.primary), secondary: String(q.secondary) }))
      if (questions.length) {
        msg.blocks.push({ kind: 'ask', id: 'ask_' + b.id, questions })
        touch()
        alertHandler?.({ workspaceId: ws.id, kind: 'question', text: questions[0].title })
      }
      return
    }
    if (isError || !b.name.startsWith('mcp__cm2__plan_')) return
    if (b.name === 'mcp__cm2__plan_propose') {
      const pid = text.match(/plan_id: (\S+)/)?.[1]
      if (!pid) return
      await plans.setMessage(pid, msg.id)
      msg.blocks.push({ kind: 'plan', id: 'plan_' + pid, planId: pid })
      touch()
      if (/Approved automatically/.test(text)) planTask = null
      await plans.publishPlan(pid)
      return
    }
    const cur = await plans.activeTask(ws.id)
    if (cur && planTask && planTask.id === cur.id) planTask = cur
    const r = await plans.listPlans(ws.id)
    const live = r.find((p) => p.tasks.some((t) => t.id === (b.input as any)?.id)) ?? r[0]
    if (live) await plans.publishPlan(live.id)
  }

  const onToolResult = (id: string, content: any, isError: boolean) => {
    const b = msg.blocks.find((x) => x.kind === 'tool' && x.id === id) as Extract<Block, { kind: 'tool' }> | undefined
    if (!b) return
    const text = Array.isArray(content) ? content.map((c: any) => c.text ?? '').join('\n') : typeof content === 'string' ? content : JSON.stringify(content ?? '')
    b.status = isError ? 'error' : 'success'
    b.result = text.length > 4000 ? text.slice(0, 4000) + '\n…' : text
    b.duration = Date.now() - (toolStart.get(id) ?? b.startedAt)
    const tn = taskNode.get(id)
    if (run && tn) {
      const t = run.nodes.find((n) => n.id === tn)?.tasks?.find((x) => x.id === taskOf_.get(id))
      if (t && t.agent && !isError && (b.input as any)?.run_in_background) {
        // Started in the background: the result only says it started. It stays at work until its own last message.
        bgAgents.add(t.id)
      } else if (t) {
        t.status = isError ? 'error' : 'done'
        t.ms = (t.ms ?? 0) + b.duration
        if (t.agent) t.agent.report = text.replace(/\s+/g, ' ').trim().slice(0, 600)
        setRun({ ...run })
      }
    }
    if (b.file) emit({ type: 'files', workspaceId: ws.id, event: { kind: 'active', path: b.file.path, active: false } })
    void onPlanToolResult(b, text, isError)
    if (run && b.name === 'mcp__cm2__brain_record' && (b.input as any)?.kind === 'issue') {
      let bid = 'b_?'
      try {
        bid = JSON.parse(text).id
      } catch { /* keep */ }
      setRun({ ...run, issues: [...run.issues, { id: bid, title: (b.input as any).title, nodeId: (b.input as any).node ?? run.current ?? '', resolved: false, ...((b.input as any).severity === 'minor' ? { minor: true } : {}) }] })
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
      if (provider === 'claude') handle(ev)
      else if (provider === 'codex') handleCodex(ev)
      else handleOpencode(ev)
    }
  })

  const setSession = (id: string) => {
    const stored = provider === 'claude' ? id : `${provider}:${id}`
    if (stored === ws!.sessionId) return
    ws!.sessionId = stored
    void db.updateWorkspace(ws!.id, { sessionId: stored })
  }
  const addTool = (id: string, name: string, input: any, status: 'running' | 'success' | 'error' = 'running') => {
    let b = msg.blocks.find((x) => x.kind === 'tool' && x.id === id) as Extract<Block, { kind: 'tool' }> | undefined
    if (!b) {
      b = { kind: 'tool', id, name, input: input ?? {}, status, startedAt: Date.now() }
      toolStart.set(id, Date.now())
      msg.blocks.push(b)
      finalizeToolInput(b)
    }
    touch()
    return b
  }
  const addText = (text: string, key?: string) => {
    const last = key ? (msg.blocks.find((x) => x.kind === 'text' && x.id === key) as Extract<Block, { kind: 'text' }> | undefined) : undefined
    if (last) last.text = text
    else msg.blocks.push({ kind: 'text', id: key ?? randomUUID(), text })
    touch()
  }
  const addThinking = (text: string) => {
    msg.blocks.push({ kind: 'thinking', id: randomUUID(), text, done: true, startedAt: Date.now(), endedAt: Date.now() })
    touch()
  }
  const toks = { input: 0, output: 0, cacheRead: 0 }

  // Codex `exec --json`: thread/turn/item events; text arrives whole per message.
  function handleCodex(ev: any) {
    if (ev.type === 'thread.started' && ev.thread_id) return setSession(ev.thread_id)
    if (ev.type === 'turn.completed') {
      const u = ev.usage ?? {}
      toks.input += (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0)
      toks.cacheRead += u.cached_input_tokens ?? 0
      toks.output += (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0)
      msg.tokens = { ...toks }
      return touch()
    }
    if (ev.type === 'turn.failed' || ev.type === 'error') {
      msg.error = ev.error?.message ?? ev.message ?? 'Codex failed'
      return touch()
    }
    const it = ev.item
    if (!it) return
    const asTool = (): [string, any] | null => {
      if (it.type === 'command_execution') return ['Bash', { command: it.command }]
      if (it.type === 'mcp_tool_call') return [`mcp__${it.server}__${it.tool}`, it.arguments ?? {}]
      if (it.type === 'web_search') return ['WebSearch', { query: it.query }]
      return null
    }
    if (ev.type === 'item.started') {
      const t = asTool()
      if (t && it.id) addTool(it.id, t[0], t[1])
      return
    }
    if (ev.type !== 'item.completed') return
    if (it.type === 'agent_message' && it.text) return addText(it.text)
    if (it.type === 'reasoning' && it.text) return addThinking(it.text)
    if (it.type === 'error') {
      msg.error = it.message ?? 'Codex error'
      return touch()
    }
    if (it.type === 'file_change') {
      for (const ch of it.changes ?? []) {
        const b = addTool(`${it.id}:${ch.path}`, ch.kind === 'add' ? 'Write' : 'Edit', { file_path: ch.path })
        onToolResult(b.id, ch.kind ?? 'updated', it.status === 'failed')
      }
      return
    }
    const t = asTool()
    if (!t || !it.id) return
    addTool(it.id, t[0], t[1])
    const failed = it.type === 'command_execution' ? (it.exit_code ?? 0) !== 0 : it.status === 'failed' || !!it.error
    const out =
      it.type === 'command_execution'
        ? `${it.aggregated_output ?? ''}${it.exit_code ? `\nexit=${it.exit_code}` : ''}`
        : it.type === 'mcp_tool_call'
          ? (it.result?.content ?? it.error?.message ?? it.result ?? '')
          : it.status ?? ''
    onToolResult(it.id, out, failed)
  }

  // OpenCode `run --format json`: text/reasoning/tool_use/step_finish parts; tool start and end come together.
  const OC_TOOLS: Record<string, string> = { read: 'Read', write: 'Write', edit: 'Edit', patch: 'Edit', bash: 'Bash', shell: 'Bash', grep: 'Grep', glob: 'Glob', list: 'LS', webfetch: 'WebFetch', websearch: 'WebSearch', todowrite: 'TodoWrite' }
  function handleOpencode(ev: any) {
    const part = ev.part ?? {}
    const sid = ev.sessionID ?? part.sessionID
    if (sid) setSession(sid)
    if (ev.type === 'text' && part.text) return addText(part.text, `oc:${part.id ?? part.messageID}`)
    if (ev.type === 'reasoning' && part.text) return addThinking(part.text)
    if (ev.type === 'step_finish') {
      const t = part.tokens ?? {}
      toks.input += t.input ?? 0
      toks.output += (t.output ?? 0) + (t.reasoning ?? 0)
      toks.cacheRead += t.cache?.read ?? 0
      msg.tokens = { ...toks }
      msg.cost = (msg.cost ?? 0) + (part.cost ?? 0)
      return touch()
    }
    if (ev.type === 'tool_use') {
      // OpenCode 2 "code mode": one `execute` call running JS that calls tools.<server>.<tool>(); the real calls are in metadata.
      const calls: any[] = part.state?.metadata?.metadata?.toolCalls ?? []
      if (part.tool === 'execute' && calls.length) {
        const base = String(part.callID ?? part.id ?? randomUUID())
        calls.forEach((c, i) => {
          const [server, ...rest] = String(c.tool ?? '').split('.')
          const name = server && rest.length ? `mcp__${server}__${rest.join('.')}` : String(c.tool)
          const id = `${base}:${i}`
          addTool(id, name, c.input ?? {})
          const last = i === calls.length - 1
          onToolResult(id, last ? part.state?.output : c.status, c.status === 'error')
        })
        return
      }
      const raw = String(part.tool ?? 'tool')
      const name = raw.startsWith('cm2_') ? `mcp__cm2__${raw.slice(4)}` : OC_TOOLS[raw] ?? raw
      const input = { ...(part.state?.input ?? {}) }
      if (input.filePath && !input.file_path) input.file_path = input.filePath
      const id = String(part.callID ?? part.id ?? randomUUID())
      addTool(id, name, input)
      if (part.state?.status === 'completed' || part.state?.status === 'error')
        onToolResult(id, part.state?.status === 'error' ? part.state?.error : part.state?.output, part.state?.status === 'error')
      return
    }
    if (ev.type === 'error') {
      const e = ev.error ?? {}
      msg.error = e.data?.message ?? e.message ?? e.type ?? 'OpenCode error'
      touch()
    }
  }

  /** Agents started in the background: at work until their last message, not until the call that started them returns */
  const bgAgents = new Set<string>()
  function subagentEvent(ev: any) {
    if (ev.type !== 'assistant' || !Array.isArray(ev.message?.content)) return
    const parent = msg.blocks.find((b): b is Extract<Block, { kind: 'tool' }> => b.kind === 'tool' && b.id === ev.parent_tool_use_id)
    if (!parent) return
    for (const c of ev.message.content) {
      if (c.type !== 'tool_use') continue
      const i = c.input ?? {}
      const what = i.file_path ?? i.description ?? i.command?.split('\n')[0] ?? i.pattern ?? i.query ?? i.url ?? ''
      parent.sub = { steps: (parent.sub?.steps ?? 0) + 1, last: `${c.name}${what ? ` ${String(what).split('/').pop()}` : ''}`.slice(0, 120) }
    }
    // The pipeline view shows each subagent as a card: what it's on, its model and how full its context is.
    const tn = taskNode.get(parent.id)
    const task = run && tn ? run.nodes.find((n) => n.id === tn)?.tasks?.find((x) => x.id === taskOf_.get(parent.id)) : undefined
    if (run && task?.agent && bgAgents.has(task.id)) {
      // A background agent: its time runs until it writes its last message (text, no more tools)
      task.ms = Date.now() - task.startedAt
      const said = ev.message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ').trim()
      if (said && !ev.message.content.some((c: any) => c.type === 'tool_use')) {
        task.status = 'done'
        task.agent.report = said.replace(/\s+/g, ' ').slice(0, 600)
        bgAgents.delete(task.id)
      }
    }
    if (run && task?.agent) {
      const u = ev.message.usage
      task.agent = {
        ...task.agent,
        steps: parent.sub?.steps ?? task.agent.steps,
        last: parent.sub?.last ?? task.agent.last,
        model: ev.message.model ?? task.agent.model,
        context: u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : task.agent.context
      }
      setRun({ ...run })
    }
    touch()
  }

  function handle(ev: any) {
    // A subagent's own stream: it stays out of the message, its parent Agent row shows the progress.
    if (ev.parent_tool_use_id) return subagentEvent(ev)
    if (ev.session_id) setSession(ev.session_id)
    if (ev.type === 'rate_limit_event') return recordClaudeRateLimit(ev.rate_limit_info)
    if (ev.type === 'stream_event') {
      const e = ev.event
      if (e.type === 'message_start') {
        byIndex.clear()
        const u = e.message?.usage
        if (run && u) {
          run.context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          const nd = run.current ? run.nodes.find((n) => n.id === run!.current) : undefined
          if (nd && nd.status === 'running') nd.context = run.context
        }
      }
      else if (e.type === 'message_delta' && run?.current && e.usage?.output_tokens) {
        const nd = run.nodes.find((n) => n.id === run!.current)
        if (nd) {
          nd.tokens = (nd.tokens ?? 0) + e.usage.output_tokens
          setRun({ ...run })
        }
      }
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
      // The turn is over. A dev server the agent left running in the background can keep the CLI alive:
      // give it a moment to exit on its own, then end its process group so the branch stops "running".
      setTimeout(() => {
        if (running.get(ws!.id) !== child || child.exitCode !== null) return
        try {
          process.kill(-child.pid!, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      }, 4000)
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
      const wasSteered = steered.delete(ws.id)
      if (wasSteered) {
        // Stopped on purpose: not a failure.
        msg.done = true
        msg.interrupted = true
        msg.error = undefined
      }
      const byUser = userStopped.delete(ws.id)
      if (!msg.done) {
        msg.done = true
        if (byUser) msg.error = STOPPED_BY_USER
        // Keep the provider's own error when it sent one.
        else if (code !== 0 && !msg.error) msg.error = stderr.trim().split('\n').slice(-3).join('\n') || `Agent exited with code ${code}`
      }
      // Next model's turn: the run moved to a node outside our stretch.
      const nextSegment = !!run && run.status === 'running' && !!run.current && !!segment && !segment.includes(run.current) && !wasSteered && code === 0
      if (run && run.status === 'running' && !nextSegment) {
        const status = code === 0 ? 'completed' : 'stopped'
        const now = Date.now()
        setRun({
          ...run, status, current: null,
          nodes: run.nodes.map((n) => (n.since ? { ...n, ms: (n.ms ?? 0) + (now - n.since), since: undefined } : n)),
          handoffs: run.handoffs?.map((h) => (h.status === 'working' ? { ...h, status: status === 'completed' ? 'done' : 'warning' } : h))
        })
      }
      msg.endedAt = Date.now()
      dirty = true
      flush()
      await db.saveMessage(ws.id, msg)
      emit({ type: 'workspace', workspace: await db.updateWorkspace(ws.id, { status: msg.error ? 'error' : 'done' }) })
      running.delete(ws.id)
      // Self-improving loop: review this run in the background (projects with auto-learning on).
      if (!opts.segment && !wasSteered && !pendingPipeline) void afterRun(ws, msg, model).catch(() => {}).then(() => maybeSweep()).catch(() => {})
      // A loop that ended: the strategist judges it and tunes the loop for the next runs.
      if (run && pipelineDef && !pipelineDef.flash && !nextSegment && !wasSteered && run.status !== 'waiting') void reviewLoop(ws, run, pipelineDef, msg.id).catch(() => {})
      // Documentation (Pro): a pipeline that ended well updates the user manual on this branch, when its switch is on.
      if (run && pipelineDef && !nextSegment && !wasSteered && !msg.error && run.status !== 'waiting') void afterPipelineDocs(ws).then((o) => o && send(o, emit, mcpScript)).catch(() => {})
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
      // The work is over (not handed to a pipeline or the next model, not stopped by Steer): tell the user.
      if (!wasSteered && !(pendingPipeline as unknown) && !nextSegment && !msg.blocks.some((b) => b.kind === 'ask'))
        alertHandler?.(run?.status === 'waiting' && !msg.error ? {
          workspaceId: ws.id,
          kind: 'question',
          text: run.wait?.kind === 'budget' ? 'Loop budget exhausted: decide how to go on' : `Waiting for your approval: ${run.nodes.find((n) => n.id === run!.current)?.label ?? ''}`
        } : {
          workspaceId: ws.id,
          kind: msg.error ? 'error' : 'done',
          // The conclusion: the agent's last message, not its first words.
          text: (msg.error ?? (msg.blocks.filter((b) => b.kind === 'text').pop() as any)?.text ?? '').replace(/[#*`_>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140)
        })
      if (pendingPipeline && !wasSteered) {
        const pp = pendingPipeline
        void send({ ...opts, mode: { kind: 'pipeline', pipelineId: pp.pipelineId }, text: pp.task, attachments: undefined, rewrittenBy: model }, emit, mcpScript).catch(() => {})
        return
      }
      if (nextSegment && run) {
        const handoff = msg.blocks.filter((b) => b.kind === 'text').map((b) => (b as any).text).join('\n').slice(-2500)
        void send({ ...opts, segment: { runId: run.runId, handoff } }, emit, mcpScript).catch(() => {})
        return
      }
      // Whatever was queued meanwhile goes next, except when the turn ended asking the user something:
      // the queue waits for the answers (it would be taken as the answer), and moves on after that turn.
      if (queues.get(ws.id)?.length && !msg.blocks.some((b) => b.kind === 'ask')) void runNext(ws.id)
    })
  })
}

/**
 * The user's decision on a pipeline run that waits for them (approval node, or loop budget used up):
 * the run goes on in the same chat, with the decision as the user's message, or it stops.
 */
export async function decidePipeline(
  wsId: string, runId: string, d: { decision: 'approve' | 'back' | 'stop'; target?: string; note?: string; text: string }, emit: Emit, mcpScript: string
): Promise<void> {
  const r = (await db.runs(wsId)).find((x) => x.runId === runId)
  if (!r || r.status !== 'waiting') throw new Error('This run is not waiting for a decision')
  if (running.has(wsId)) throw new Error('The agent is busy on this branch')
  const next = decideWait(r, d)
  if (next === r) throw new Error('Unknown step')
  await db.saveRun(wsId, next)
  emit({ type: 'pipeline', workspaceId: wsId, state: next })
  if (next.status !== 'running') return
  const saved = await db.getSetting<Pick<SendOptions, 'model' | 'effort' | 'fullAccess'>>(`opts:${wsId}`)
  const at = next.nodes.find((n) => n.id === next.current)
  const text = `${d.text}${d.note?.trim() ? `\n\n${d.note.trim()}` : ''}`
  void at
  await send({ workspaceId: wsId, text, model: saved?.model ?? r.model ?? '', effort: saved?.effort ?? 'medium', fullAccess: saved?.fullAccess ?? false, mode: { kind: 'pipeline', pipelineId: r.pipelineId }, resumeRun: runId }, emit, mcpScript)
}

/** Custom agents named with @handle in a prompt. */
async function calledAgents(text: string) {
  const handles = [...new Set([...text.matchAll(/(?:^|[\s(])@([a-z0-9_]{2,40})\b/gi)].map((m) => m[1].toLowerCase()))]
  if (!handles.length) return []
  return (await db.agents()).filter((a) => a.custom && a.handle && handles.includes(a.handle.toLowerCase()))
}

export const worktreeRoot = (home: string) => join(home, '.code-maxxer-2', 'worktrees')

/** A tool call worth listing as one of the agent's tasks (reads and searches are not). */
function taskOf(name: string, input: any, rel: (p: string) => string): { title: string; kind: NodeTask['kind'] } | null {
  const base = (p: string) => rel(p).split('/').pop() || p
  const file = input?.file_path ?? input?.notebook_path
  if ((name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') && file) return { title: `Edit ${base(file)}`, kind: 'edit' }
  if (name === 'Write' && file) return { title: `Write ${base(file)}`, kind: 'create' }
  if (name === 'Bash') {
    const cmd = String(input?.command ?? '')
    if (/\bgit\s+commit\b/.test(cmd)) {
      const m = cmd.match(/-m\s+["']([^"']+)/)
      return { title: m ? `Commit: ${m[1]}` : 'Commit', kind: 'commit' }
    }
    const d = String(input?.description ?? '').trim() || cmd.split('\n')[0].trim()
    return d ? { title: d.length > 80 ? d.slice(0, 79) + '…' : d, kind: 'run' } : null
  }
  if (name === 'mcp__cm2__browser_navigate' && input?.url) return { title: `Open ${String(input.url).replace(/^https?:\/\//, '')}`, kind: 'browse' }
  if (name === 'mcp__cm2__browser_click') return { title: `Click ${input?.label ?? input?.selector ?? 'in the page'}`, kind: 'browse' }
  if (name === 'mcp__cm2__brain_record' && input?.title) return { title: `${input.kind === 'issue' ? 'Issue' : 'Note'}: ${input.title}`, kind: 'issue' }
  if (name === 'mcp__cm2__brain_resolve') return { title: 'Resolve an issue', kind: 'issue' }
  if ((name === 'Task' || name === 'Agent') && input?.description) return { title: String(input.description), kind: 'agent' }
  if (name === 'WebFetch' || name === 'WebSearch') return { title: String(input?.query ?? input?.url ?? 'Web lookup'), kind: 'web' }
  return null
}

/** Folders of the other projects in the same code-maxxer workspace. */
/** The repos this chat already works on besides its own: their folders and branches. */
async function linkedRule(wsId: string): Promise<string> {
  const ws = await db.workspace(wsId)
  const twins = await db.linkedWorkspaces(wsId)
  const ps = await db.projects()
  const me = ps.find((p) => p.id === ws?.projectId)
  // Projects the user linked to this one (a frontend and its backend): known up front, worked on when the request touches them.
  const partners = (me?.linked ?? []).map((id) => ps.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p && !twins.some((w) => w.projectId === p.id))
  return (
    (partners.length
      ? '\n\nLINKED PROJECTS (the user linked them to this one: they work together, e.g. frontend and backend). When a request touches one, ' +
        'call mcp__cm2__project_link {project} first and work on its twin branch:\n' + partners.map((p) => `- ${p.name}: ${p.path}`).join('\n')
      : '') +
    (twins.length
      ? '\n\nLINKED REPOS (this chat works on them too, on twin branches; edit and commit there):\n' +
        twins.map((w) => `- ${ps.find((p) => p.id === w.projectId)?.name ?? w.projectId}: ${w.worktreePath} (branch ${w.branch})`).join('\n')
      : '')
  )
}

async function siblingFolders(projectId: string): Promise<string[]> {
  const r = await pool.query(
    `select p.path from projects p join projects me on me.id=$1
      where p.id <> me.id and p.space_id is not distinct from me.space_id`,
    [projectId]
  )
  // A missing folder would stop the CLI: only the ones still on disk.
  return r.rows.map((x) => String(x.path)).filter((p) => existsSync(p))
}

/** The cheapest model, for small routine tasks. */
const CHEAPEST = 'claude-haiku-5-5'
const OPS = /\b(push|pusha|pushare|pull|pulla|merge|merg[ia]+|mergiare|commit|committa|committare|rebase|fetch|stash|tag|checkout|status|cherry-pick|branch)\b/i
const WORK = /\b(fix|implement|implementa|crea|create|aggiungi|add|modifica|change|refactor|riscrivi|rewrite|pagina|page|component|componente|bug|test|design|layout|feature)\b/i
/** A git operation asked in a few words, with nothing to build or change in the code. */
export function isSmallTask(text: string): boolean {
  const t = text.trim()
  return t.length <= 160 && OPS.test(t) && !WORK.test(t)
}
