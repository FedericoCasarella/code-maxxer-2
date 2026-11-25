import type { EngineEvent, Message, Plan, ScheduledRun, SendOptions, Workspace } from '@shared/types'
import { DEFAULT_EVENTS, type ExchangeChat, type ExchangeEvents, type ExchangeSettings, type ExchangeState } from '@shared/exchange'
import { db } from '../db'
import { decrypt, encrypt } from '../recon/secrets'
import { rstore } from '../recon/store'
import * as plans from './plans'
import * as learning from './learning'
import * as security from './security'
import * as orch from './orchestrator'
import { listModels } from './models'

/**
 * Exchange: code-maxxer on Telegram (like code-maxxer's bot, rebuilt for this app).
 *  - Out: the agent's questions, plans to approve, lessons to keep, finished/failed runs, scheduled runs,
 *    servers down/back, security scans. Everything also stays in the app.
 *  - In: tap a button to answer or decide; any other text goes to a project's main chat and the reply comes back.
 * Only the configured chat is listened to; the bot token is stored encrypted.
 */

type Stored = ExchangeSettings & { token: string | null }
const KEY = 'exchange:telegram'
const API = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'

const state: { lastError: string | null; lastSentAt: string | null; bot: ExchangeState['bot'] } = { lastError: null, lastSentAt: null, bot: null }

async function stored(): Promise<Stored> {
  const s = await db.getSetting<Partial<Stored>>(KEY)
  return { enabled: !!s?.enabled, chatId: s?.chatId ?? '', chatTitle: s?.chatTitle, token: s?.token ?? null, events: { ...DEFAULT_EVENTS, ...(s?.events ?? {}) } }
}
const tokenOf = (s: Stored) => decrypt(s.token)

async function tg<T>(token: string, method: string, body: unknown = {}, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  const data = (await res.json()) as { ok: boolean; result?: T; description?: string }
  if (!data.ok) throw new Error(data.description ?? `Telegram HTTP ${res.status}`)
  return data.result as T
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
type Button = { text: string; data: string }

/** One queue for everything we send: keeps the order and Telegram's rate limits. */
let chain: Promise<unknown> = Promise.resolve()
function send(html: string, buttons?: Button[][], event?: keyof ExchangeEvents) {
  chain = chain
    .then(async () => {
      const s = await stored()
      const token = tokenOf(s)
      if (!s.enabled || !token || !s.chatId || (event && !s.events[event])) return
      await tg(token, 'sendMessage', {
        chat_id: s.chatId,
        text: html.slice(0, 4000),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons.map((r) => r.map((b) => ({ text: b.text.slice(0, 60), callback_data: b.data }))) } } : {})
      })
      state.lastError = null
      state.lastSentAt = new Date().toISOString()
      await new Promise((r) => setTimeout(r, 350))
    })
    .catch((e) => (state.lastError = (e as Error).message))
}

// ─── Settings (IPC) ──────────────────────────────────────────────────

async function publicState(): Promise<ExchangeState> {
  const s = await stored()
  const token = tokenOf(s)
  if (token && !state.bot) {
    const me = await tg<{ username: string; first_name: string }>(token, 'getMe').catch(() => null)
    if (me) state.bot = { username: me.username, name: me.first_name }
  }
  return { enabled: s.enabled, chatId: s.chatId, chatTitle: s.chatTitle, events: s.events, hasToken: !!token, bot: token ? state.bot : null, lastError: state.lastError, lastSentAt: state.lastSentAt }
}

export const exchange = {
  get: publicState,
  async save(p: Partial<ExchangeSettings> & { token?: string }): Promise<ExchangeState> {
    const cur = await stored()
    let token = cur.token
    if (p.token !== undefined) {
      const t = p.token.trim()
      if (t) {
        const me = await tg<{ username: string; first_name: string }>(t, 'getMe').catch(() => {
          throw new Error('Telegram does not accept this token')
        })
        state.bot = { username: me.username, name: me.first_name }
      } else state.bot = null
      token = t ? encrypt(t) : null
    }
    await db.setSetting(KEY, { ...cur, ...p, token, events: { ...cur.events, ...(p.events ?? {}) } })
    return publicState()
  },
  async detect(typed?: string): Promise<ExchangeChat[]> {
    const token = typed?.trim() || tokenOf(await stored())
    if (!token) throw new Error('Add the bot token first')
    // While our poll runs, getUpdates would conflict: read what the poll has seen instead.
    const fresh = polling ? [] : await tg<TgUpdate[]>(token, 'getUpdates', { timeout: 0, allowed_updates: ['message', 'my_chat_member'] }).catch(() => [] as TgUpdate[])
    const all = new Map(seenChats)
    for (const u of fresh) {
      const c = u.message?.chat ?? u.my_chat_member?.chat
      if (c) all.set(String(c.id), { id: String(c.id), title: c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id)), kind: c.type })
    }
    return [...all.values()]
  },
  async test() {
    const s = await stored()
    const token = tokenOf(s)
    if (!token || !s.chatId) throw new Error('Bot token and chat are needed')
    await tg(token, 'sendMessage', { chat_id: s.chatId, text: '<b>code-maxxer</b> is connected. Questions, decisions and notifications will arrive here; write here to talk to a project.', parse_mode: 'HTML' })
    state.lastError = null
    state.lastSentAt = new Date().toISOString()
  }
}

// ─── Out: events from the engine ────────────────────────────────────

let approvePlan: (planId: string) => Promise<void> = async () => {}
/** The same approval the app does (approve, then the agent goes on with the branch's settings). */
export const setPlanApprover = (fn: (planId: string) => Promise<void>) => (approvePlan = fn)

const sent = new Set<string>()
const once = (id: string) => (sent.has(id) ? false : (sent.add(id), true))
/** Branches whose next reply goes back to Telegram in full (the message came from there). */
const mirror = new Set<string>()
let lastScheduled = new Map<string, ScheduledRun['status']>()
const openIncidents = new Map<string, Set<string>>()

async function where(wsId: string) {
  const ws = await db.workspace(wsId)
  const p = ws ? await db.project(ws.projectId) : null
  return { ws, label: p ? `${p.name}${ws && ws.worktreePath !== p.path ? ` · ${ws.branch}` : ''}` : 'code-maxxer' }
}
const textOf = (m: Extract<Message, { role: 'assistant' }>) =>
  m.blocks
    .filter((b): b is Extract<typeof b, { kind: 'text' }> => b.kind === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim()

/** Hooked on every engine event (main/index.ts wraps emit). Never throws. */
export function onEngineEvent(e: EngineEvent) {
  void handleEvent(e).catch((err) => (state.lastError = (err as Error).message))
}

async function handleEvent(e: EngineEvent) {
  if (!ready) return
  // A question asked mid-run (the run waits for it): to Telegram right away, not at the end of the turn
  if (e.type === 'message' && e.message.role === 'assistant' && !e.message.done) {
    const ask = e.message.blocks.find((b): b is Extract<typeof b, { kind: 'ask' }> => b.kind === 'ask' && !b.answer)
    if (ask && once(`ask:${ask.id}`)) startQuestions(e.workspaceId, ask.id, (await where(e.workspaceId)).label, ask.questions)
    return
  }
  if (e.type === 'message' && e.message.role === 'assistant' && e.message.done && once(`msg:${e.message.id}`)) {
    const m = e.message
    const { label } = await where(e.workspaceId)
    const ask = m.blocks.find((b): b is Extract<typeof b, { kind: 'ask' }> => b.kind === 'ask' && !b.answer)
    if (ask) return once(`ask:${ask.id}`) ? startQuestions(e.workspaceId, ask.id, label, ask.questions) : undefined
    if (m.blocks.some((b) => b.kind === 'plan')) return // the plan event sends its own card
    const text = textOf(m)
    if (mirror.delete(e.workspaceId)) {
      return send(`<b>${esc(label)}</b>${m.error ? ' · failed' : ''}\n\n${esc(text || m.error || 'Done.').slice(0, 3500)}`)
    }
    if (m.interrupted) return
    send(
      m.error ? `✕ <b>${esc(label)}</b> · run failed\n${esc(m.error.slice(0, 600))}` : `✓ <b>${esc(label)}</b> · done\n${esc(text.slice(0, 600))}`,
      undefined,
      'runs'
    )
  } else if (e.type === 'plan' && e.plan.status === 'proposed' && once(`plan:${e.plan.id}`)) {
    sendPlan(e.plan, (await where(e.plan.workspaceId)).label)
  } else if (e.type === 'learning') {
    const st = await learning.learningState(e.projectId)
    const p = await db.project(e.projectId)
    for (const l of st.lessons.filter((x) => x.status === 'proposed' && once(`lesson:${x.id}`))) {
      send(
        `💡 <b>${esc(p?.name ?? 'Project')}</b> · new lesson\n<b>${esc(l.title)}</b>\n${esc(l.body.slice(0, 900))}`,
        [[{ text: 'Keep', data: `ls:${l.id}:1` }, { text: 'Discard', data: `ls:${l.id}:0` }]],
        'lessons'
      )
    }
  } else if (e.type === 'scheduled') {
    const next = new Map(e.runs.map((r) => [r.id, r.status]))
    for (const r of e.runs) {
      const before = lastScheduled.get(r.id)
      if (before === r.status || (r.status !== 'sent' && r.status !== 'failed')) continue
      if (before === undefined && lastScheduled.size) continue // only changes we watched happen
      const { label } = await where(r.workspaceId)
      send(
        r.status === 'sent' ? `⏰ <b>${esc(label)}</b> · scheduled run sent\n${esc(r.text.slice(0, 300))}` : `⏰ <b>${esc(label)}</b> · scheduled run failed\n${esc(r.error ?? '')}`,
        undefined,
        'scheduled'
      )
    }
    lastScheduled = next
  } else if (e.type === 'recon:changed') {
    const p = await db.project(e.projectId)
    const incs = await rstore.incidents(e.projectId)
    const known = openIncidents.get(e.projectId) ?? new Set<string>()
    const nowOpen = new Set(incs.filter((i) => i.status !== 'resolved').map((i) => i.id))
    for (const i of incs) {
      if (nowOpen.has(i.id) && !known.has(i.id) && once(`inc:${i.id}`))
        send(`🔴 <b>${esc(p?.name ?? 'Recon')}</b> · ${esc(i.title)}\n${esc((i.details || '').slice(0, 500))}`, undefined, 'recon')
      if (!nowOpen.has(i.id) && known.has(i.id)) send(`🟢 <b>${esc(p?.name ?? 'Recon')}</b> · resolved: ${esc(i.title)}`, undefined, 'recon')
    }
    openIncidents.set(e.projectId, nowOpen)
  } else if (e.type === 'security') {
    const d = await security.dashboard(e.projectId, 30)
    const p = await db.project(e.projectId)
    for (const t of d.targets) {
      const s = t.lastScan
      if (!s || s.status === 'running' || !s.finishedAt || !once(`scan:${s.id}`)) continue
      send(
        s.status === 'failed'
          ? `🛡 <b>${esc(p?.name ?? 'Security')}</b> · ${t.target} scan failed\n${esc(s.error ?? '')}`
          : `🛡 <b>${esc(p?.name ?? 'Security')}</b> · ${t.target} ${t.score ?? '—'}/100 · ${t.open} open\n${esc(s.summary.slice(0, 500))}`,
        undefined,
        'security'
      )
    }
  }
}

function sendPlan(p: Plan, label: string) {
  const tasks = p.tasks.slice(0, 12).map((t, i) => `${i + 1}. ${esc(t.title)}`).join('\n')
  send(
    `🗺 <b>${esc(label)}</b> · plan to approve\n<b>${esc(p.title)}</b>\n${esc(p.summary.slice(0, 600))}${tasks ? `\n\n${tasks}` : ''}`,
    [[{ text: 'Approve', data: `pl:${p.id}:1` }, { text: 'Reject', data: `pl:${p.id}:0` }]],
    'plans'
  )
}

// ─── Questions: one at a time, then all answers go back as one message ─

type Q = { id: string; title: string; detail?: string; primary: string; secondary: string }
type Asking = { wsId: string; blockId: string; label: string; questions: Q[]; idx: number; answers: string[] }
let asking: Asking | null = null
const LET_AGENT = 'You decide (the user left the choice to you)'

function startQuestions(wsId: string, blockId: string, label: string, questions: Q[]) {
  asking = { wsId, blockId, label, questions, idx: 0, answers: [] }
  askCurrent()
}
function askCurrent() {
  if (!asking) return
  const q = asking.questions[asking.idx]
  const n = asking.questions.length
  send(
    `❓ <b>${esc(asking.label)}</b>${n > 1 ? ` · ${asking.idx + 1}/${n}` : ''}\n<b>${esc(q.title)}</b>${q.detail ? `\n${esc(q.detail)}` : ''}\n\nTap an answer or write your own.`,
    [[{ text: `★ ${q.primary}`, data: `qa:${asking.blockId.slice(-24)}:${asking.idx}:p` }], [{ text: q.secondary, data: `qa:${asking.blockId.slice(-24)}:${asking.idx}:s` }], [{ text: 'You decide', data: `qa:${asking.blockId.slice(-24)}:${asking.idx}:x` }]],
    'questions'
  )
}
async function answer(text: string) {
  if (!asking) return
  const a = asking
  a.answers[a.idx] = text
  if (a.idx + 1 < a.questions.length) {
    a.idx++
    return askCurrent()
  }
  asking = null
  const lines = a.questions.map((q, i) => `- ${q.title} → ${a.answers[i]}`)
  mirror.add(a.wsId)
  // The run is still waiting on them: it goes on with the answers. Otherwise they go as a new message.
  if (!orch.answerAsk(a.blockId, lines.join('\n'))) await sendToChat(a.wsId, lines.join('\n'))
  send(`Answers sent to <b>${esc(a.label)}</b>: the agent goes on. I'll send its reply here.`)
}

// ─── In: messages to a project's chat ───────────────────────────────

async function sendToChat(wsId: string, text: string) {
  const o = (await db.getSetting<Partial<SendOptions>>(`opts:${wsId}`)) ?? (await db.getSetting<Partial<SendOptions>>('opts:last'))
  const models = await listModels(false)
  const opts: SendOptions = {
    workspaceId: wsId,
    text,
    model: o?.model ?? models[0]?.id ?? 'claude-opus-5-5',
    effort: o?.effort ?? 'medium',
    mode: o?.mode ?? { kind: 'direct' },
    fullAccess: o?.fullAccess ?? false
  }
  orch.send(opts, emitFn, mcpScript).catch((e) => send(`Could not send: ${esc((e as Error).message)}`))
}

/** The project's main chat: the branch on the project folder itself, else the latest one. */
async function mainChat(projectId: string): Promise<Workspace | null> {
  const p = await db.project(projectId)
  const all = (await db.workspaces()).filter((w) => w.projectId === projectId)
  return all.find((w) => w.worktreePath === p?.path) ?? all[0] ?? null
}

const waiting = new Map<string, string>()
let seq = 0
async function routeText(text: string) {
  if (asking) return answer(text)
  const projects = await db.projects()
  if (!projects.length) return send('No project yet: add one in the app first.')
  if (projects.length === 1) return toProject(projects[0].id, text)
  // The project used last from here comes first.
  const key = String(++seq)
  waiting.set(key, text)
  setTimeout(() => waiting.delete(key), 15 * 60_000)
  const recent = (await db.workspaces()).map((w) => w.projectId)
  const ordered = [...projects].sort((a, b) => (recent.indexOf(a.id) + 1 || 1e9) - (recent.indexOf(b.id) + 1 || 1e9)).slice(0, 10)
  send('Which project?', ordered.map((p) => [{ text: p.owner ? `${p.owner}/${p.name}` : p.name, data: `to:${p.id.slice(0, 40)}:${key}` }]))
}
async function toProject(projectId: string, text: string) {
  const ws = await mainChat(projectId)
  if (!ws) return send('This project has no chat yet: open it in the app once.')
  const { label } = await where(ws.id)
  mirror.add(ws.id)
  await sendToChat(ws.id, text)
  send(orch.isRunning(ws.id) ? `Queued for <b>${esc(label)}</b>: it runs after the current turn.` : `Sent to <b>${esc(label)}</b>. The reply comes here.`)
}

async function onCallback(data: string): Promise<string> {
  const pl = data.match(/^pl:(.+):([01])$/)
  if (pl) {
    const p = await plans.getPlan(pl[1])
    if (!p || p.status !== 'proposed') return 'Already decided'
    if (pl[2] === '1') {
      mirror.add(p.workspaceId)
      await approvePlan(p.id)
      return 'Approved: the agent starts'
    }
    await plans.cancel(p.id)
    return 'Rejected'
  }
  const ls = data.match(/^ls:(.+):([01])$/)
  if (ls) {
    await learning.decide(ls[1], ls[2] === '1')
    return ls[2] === '1' ? 'Kept: it guides the next runs' : 'Discarded'
  }
  const qa = data.match(/^qa:(.+):(\d+):([psx])$/)
  if (qa) {
    if (!asking || !asking.blockId.endsWith(qa[1]) || asking.idx !== Number(qa[2])) return 'Already answered'
    const q = asking.questions[asking.idx]
    const pick = qa[3] === 'p' ? q.primary : qa[3] === 's' ? q.secondary : LET_AGENT
    await answer(pick)
    return qa[3] === 'x' ? 'The agent decides' : pick
  }
  const to = data.match(/^to:(.+):(\d+)$/)
  if (to) {
    const text = waiting.get(to[2])
    waiting.delete(to[2])
    if (!text) return 'Expired: write it again'
    const p = (await db.projects()).find((x) => x.id.startsWith(to[1]))
    if (p) await toProject(p.id, text)
    return p?.name ?? 'Unknown project'
  }
  return ''
}

// ─── Long poll ──────────────────────────────────────────────────────

type TgChat = { id: number; type: string; title?: string; username?: string; first_name?: string; last_name?: string }
type TgUpdate = {
  update_id: number
  message?: { message_id: number; chat: TgChat; text?: string }
  my_chat_member?: { chat: TgChat }
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } }
}
/** Chats that wrote to the bot, for "Detect" while the poll owns getUpdates. */
const seenChats = new Map<string, ExchangeChat>()

let emitFn: (e: EngineEvent) => void = () => {}
let mcpScript = ''
let ready = false
let polling = false

export async function startExchange(emit: (e: EngineEvent) => void, script: string) {
  emitFn = emit
  mcpScript = script
  // Start from what is already there: only news gets sent.
  for (const p of await db.projects()) {
    const st = await learning.learningState(p.id).catch(() => null)
    st?.lessons.filter((l) => l.status === 'proposed').forEach((l) => sent.add(`lesson:${l.id}`))
    const incs = await rstore.incidents(p.id).catch(() => [])
    openIncidents.set(p.id, new Set(incs.filter((i) => i.status !== 'resolved').map((i) => i.id)))
    const d = await security.dashboard(p.id, 30).catch(() => null)
    d?.targets.forEach((t) => t.lastScan && sent.add(`scan:${t.lastScan.id}`))
  }
  lastScheduled = new Map((await db.scheduled()).map((r) => [r.id, r.status]))
  ready = true
  void loop()
}

async function loop() {
  let offset = 0
  for (;;) {
    try {
      const s = await stored()
      const token = tokenOf(s)
      polling = !!(s.enabled && token)
      if (!s.enabled || !token) {
        await sleep(5000)
        continue
      }
      const ups = await tg<TgUpdate[]>(token, 'getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query', 'my_chat_member'] }, 45_000)
      for (const u of ups) {
        offset = u.update_id + 1
        const c = u.message?.chat ?? u.my_chat_member?.chat
        if (c) seenChats.set(String(c.id), { id: String(c.id), title: c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || String(c.id)), kind: c.type })
        try {
          if (u.callback_query) {
            const cq = u.callback_query
            if (String(cq.message?.chat.id) !== s.chatId || !cq.data) {
              await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id })
              continue
            }
            const note = await onCallback(cq.data)
            await tg(token, 'answerCallbackQuery', { callback_query_id: cq.id, text: note.slice(0, 190) })
            // The tapped message keeps its text, without buttons (no double taps).
            if (cq.message) await tg(token, 'editMessageReplyMarkup', { chat_id: s.chatId, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {})
          } else if (u.message?.text && String(u.message.chat.id) === s.chatId) {
            const t = u.message.text.trim()
            if (t === '/start') send('Write here to talk to a project. Questions, decisions and notifications from code-maxxer arrive here.')
            else await routeText(t)
          }
        } catch (err) {
          state.lastError = (err as Error).message
        }
      }
    } catch (err) {
      const msg = (err as Error).message
      if (!/aborted|timeout|fetch failed/i.test(msg)) state.lastError = msg
      await sleep(/409|Conflict|webhook/i.test(msg) ? 15_000 : 3000)
    }
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
