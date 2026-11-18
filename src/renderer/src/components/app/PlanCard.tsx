import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDown, ArrowUp, Bot, Check, ChevronRight, CircleDashed, FilePen, FilePlus2, GitCommitHorizontal, Globe, ListTodo, MessageSquare,
  Minus, Play, SquareTerminal, TriangleAlert, X
} from 'lucide-react'
import type { Plan, PlanStep, PlanTask } from '@shared/types'
import { actions, getState } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Spinner } from '../affect/spinner'
import { ShimmerText } from '../affect/shimmer-loader'
import { fmtMs } from './PipelineHandoff'
import { TextField } from '../affect/text-field'

const STATUS_LABEL: Record<Plan['status'], string> = { proposed: 'Waiting for approval', running: 'In progress', done: 'Done', cancelled: 'Discarded' }

export function TaskIcon({ s, size = 15 }: { s: PlanTask['status']; size?: number }) {
  if (s === 'in_progress') return <Spinner size={size - 2} className="text-accent" />
  if (s === 'done')
    return (
      <span className="grid place-items-center rounded-full bg-ok/90 text-black" style={{ width: size, height: size }}>
        <Check size={size - 5} strokeWidth={3} />
      </span>
    )
  if (s === 'failed')
    return (
      <span className="grid place-items-center rounded-full bg-bad/90 text-black" style={{ width: size, height: size }}>
        <X size={size - 5} strokeWidth={3} />
      </span>
    )
  if (s === 'skipped')
    return (
      <span className="grid place-items-center rounded-full border border-line-strong text-mute" style={{ width: size, height: size }}>
        <Minus size={size - 6} />
      </span>
    )
  return <span className="rounded-full border-[1.5px] border-white/25" style={{ width: size, height: size }} />
}

const STEP_ICON: Record<PlanStep['kind'], typeof FilePen> = {
  edit: FilePen, create: FilePlus2, run: SquareTerminal, commit: GitCommitHorizontal, browse: Globe, issue: TriangleAlert, agent: Bot, web: Globe
}

const taskMs = (t: PlanTask, now: number) => (t.startedAt ? (t.finishedAt ?? now) - t.startedAt : 0)
const filesOf = (t: PlanTask) => new Set(t.steps.map((s) => s.file).filter(Boolean)).size

/** A plan as a card: tasks that expand into their checkpoints. Proposed plans can be edited and approved here. */
export function PlanCard({ plan, compact = false, showChatLink = false }: { plan: Plan; compact?: boolean; showChatLink?: boolean }) {
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [draft, setDraft] = useState<{ id: string; title: string }[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const proposed = plan.status === 'proposed'
  const running = plan.status === 'running'

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])
  // The task being worked on stays open, so its checkpoints show up live.
  const current = plan.tasks.find((t) => t.status === 'in_progress')?.id
  useEffect(() => {
    if (current) setOpen((o) => (o.has(current) ? o : new Set([...o, current])))
  }, [current])

  const rows: PlanTask[] = useMemo(() => {
    if (!draft) return plan.tasks
    return draft.map((d) => ({ ...plan.tasks.find((t) => t.id === d.id)!, title: d.title }))
  }, [draft, plan.tasks])
  const edit = (fn: (l: { id: string; title: string }[]) => { id: string; title: string }[]) =>
    setDraft((d) => fn(d ?? plan.tasks.map((t) => ({ id: t.id, title: t.title }))))

  const done = plan.tasks.filter((t) => t.status === 'done' || t.status === 'skipped').length
  const total = plan.tasks.length
  const totalMs = plan.tasks.reduce((a, t) => a + taskMs(t, now), 0)
  const commits = plan.tasks.reduce((a, t) => a + t.commits.length, 0)

  const toggle = (id: string) => setOpen((o) => {
    const s = new Set(o)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  return (
    <section className="cm-in overflow-hidden rounded-xl border border-line bg-panel">
      <header className="flex items-center gap-2 px-3.5 pb-2 pt-2.5">
        <ListTodo size={14} className="shrink-0 text-accent" />
        <span className="shrink-0 text-[13px] font-semibold text-ink">Plan</span>
        <span className="min-w-0 truncate text-[13px] text-dim">{plan.title}</span>
        <span className="flex-1" />
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-px text-[11px]',
            proposed ? 'bg-warn/10 text-warn' : running ? 'bg-accent/10 text-accent' : plan.status === 'done' ? 'bg-ok/10 text-ok' : 'bg-white/[.06] text-mute'
          )}
        >
          {STATUS_LABEL[plan.status]}
        </span>
      </header>
      {!compact && plan.summary && <p className="px-3.5 pb-2 text-[12.5px] leading-[1.5] text-dim">{plan.summary}</p>}

      {running && (
        <div className="mx-3.5 mb-2 h-1 overflow-hidden rounded-full bg-white/[.06]">
          <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${(done / Math.max(1, total)) * 100}%` }} />
        </div>
      )}

      <ol className="mx-1.5 mb-1.5 rounded-lg bg-bg/60 py-1">
        {rows.map((t, i) => {
          const isOpen = open.has(t.id) && !proposed
          const ms = taskMs(t, now)
          const nf = filesOf(t)
          return (
            <li key={t.id}>
              <div
                onClick={() => (proposed ? undefined : toggle(t.id))}
                className={cn('group flex min-h-[32px] cursor-default items-center gap-2.5 px-2.5', !proposed && 'hover:bg-white/[.03]')}
              >
                <span className="grid w-4 shrink-0 place-items-center">
                  <TaskIcon s={t.status} />
                </span>
                {editing === t.id ? (
                  <TextField
                    size="sm"
                    className="min-w-0 flex-1"
                    aria-label="Task title"
                    autoFocus
                    defaultValue={t.title}
                    onBlur={(e) => {
                      const v = e.target.value
                      edit((l) => l.map((x) => (x.id === t.id ? { ...x, title: v } : x)))
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <span
                    onDoubleClick={() => proposed && setEditing(t.id)}
                    className={cn(
                      'min-w-0 flex-1 truncate text-[13px]',
                      t.status === 'done' || t.status === 'skipped' ? 'text-dim' : t.status === 'in_progress' ? 'text-ink' : 'text-ink/85',
                      t.status === 'skipped' && 'line-through decoration-white/25'
                    )}
                    title={proposed ? 'Double-click to rename' : t.title}
                  >
                    {t.status === 'in_progress' ? <ShimmerText>{t.title}</ShimmerText> : t.title}
                  </span>
                )}
                {proposed ? (
                  <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <MiniBtn label="Move up" disabled={i === 0} onClick={() => edit((l) => swap(l, i, i - 1))}>
                      <ArrowUp size={12} />
                    </MiniBtn>
                    <MiniBtn label="Move down" disabled={i === rows.length - 1} onClick={() => edit((l) => swap(l, i, i + 1))}>
                      <ArrowDown size={12} />
                    </MiniBtn>
                    <MiniBtn label="Remove" disabled={rows.length === 1} onClick={() => edit((l) => l.filter((x) => x.id !== t.id))}>
                      <X size={12} />
                    </MiniBtn>
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-2.5 text-[11px] tabular-nums text-mute">
                    {t.commits.length > 0 && (
                      <span className="flex items-center gap-0.5">
                        <GitCommitHorizontal size={12} />
                        {t.commits.length}
                      </span>
                    )}
                    {nf > 0 && <span>{nf} {nf === 1 ? 'file' : 'files'}</span>}
                    {ms > 0 && <span>{fmtMs(ms)}</span>}
                    <ChevronRight size={12} className={cn('transition-transform duration-150', isOpen && 'rotate-90')} />
                  </span>
                )}
              </div>
              {isOpen && <TaskDetail t={t} wsId={plan.workspaceId} now={now} />}
            </li>
          )
        })}
      </ol>

      <footer className="flex items-center gap-2 px-3.5 pb-2.5 pt-1 text-[11.5px] text-mute">
        {proposed ? (
          <>
            <span className="min-w-0 flex-1 truncate">{draft ? 'Edited · ' : ''}Double-click a task to rename it</span>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await window.cm.cancelPlan(plan.id).finally(() => setBusy(false))
              }}
              className="h-7 rounded-lg px-2.5 text-[12px] text-dim hover:bg-white/[.06] hover:text-ink disabled:opacity-40"
            >
              Discard
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await window.cm.approvePlan(plan.id, draft ?? undefined).finally(() => setBusy(false))
                setDraft(null)
              }}
              className="flex h-7 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12px] font-medium text-black hover:bg-ink/90 disabled:opacity-40"
            >
              {busy ? <Spinner size={11} /> : <Play size={11} fill="currentColor" />} Approve and start
            </button>
          </>
        ) : (
          <>
            <span className="tabular-nums">
              {done}/{total} done
            </span>
            {totalMs > 0 && <span>· {fmtMs(totalMs)}</span>}
            {commits > 0 && <span>· {commits} {commits === 1 ? 'commit' : 'commits'}</span>}
            <span className="flex-1" />
            {showChatLink && plan.messageId && (
              <button onClick={() => jumpToMessage(plan.workspaceId, plan.messageId!)} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-dim hover:bg-white/[.06] hover:text-ink">
                Chat <MessageSquare size={11.5} />
              </button>
            )}
            {running && (
              <button onClick={() => void window.cm.cancelPlan(plan.id)} className="rounded px-1.5 py-0.5 text-dim hover:bg-white/[.06] hover:text-ink">
                Stop plan
              </button>
            )}
          </>
        )}
      </footer>
    </section>
  )
}

function swap<T>(l: T[], a: number, b: number): T[] {
  const n = l.slice()
  ;[n[a], n[b]] = [n[b], n[a]]
  return n
}

function MiniBtn(p: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={p.label}
      title={p.label}
      disabled={p.disabled}
      onClick={(e) => {
        e.stopPropagation()
        p.onClick()
      }}
      className="grid size-6 place-items-center rounded text-mute hover:bg-white/[.08] hover:text-ink disabled:opacity-25"
    >
      {p.children}
    </button>
  )
}

/**
 * Show the chat and scroll to a message (loading the slice around it when the chat is long), then flash it.
 * Assistant messages aren't in the prompt index: those only scroll when already loaded.
 */
export async function jumpToMessage(wsId: string, messageId: string) {
  await actions.selectWorkspace(wsId)
  actions.focusEditor(wsId, null)
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const find = () => document.querySelector<HTMLElement>(`[data-mid="${messageId}"]`)
  await frames()
  let node = find()
  let loaded = false
  if (!node) {
    const it = getState().chatIndex[wsId]?.find((x) => x.id === messageId)
    if (it && it.seq !== Number.MAX_SAFE_INTEGER) {
      await actions.loadAround(wsId, it.seq)
      await frames()
      node = find()
      loaded = true
    }
  }
  if (!node) return
  // Flash first: it adds room around the message, and the scroll should land with that room in view.
  node.classList.remove('cm-flash-msg')
  void node.offsetWidth
  node.classList.add('cm-flash-msg')
  node.scrollIntoView({ block: 'start', behavior: loaded ? 'auto' : 'smooth' })
  // Rows above may still be measuring (content-visibility): settle once more.
  if (loaded) requestAnimationFrame(() => requestAnimationFrame(() => node!.scrollIntoView({ block: 'start' })))
}

/** What the task is, then its checkpoints: one row per thing the agent did, on a rail. */
export function TaskDetail({ t, wsId, now }: { t: PlanTask; wsId: string; now: number }) {
  return (
    <div className="cm-in pb-2 pl-[38px] pr-3">
      {t.detail && <p className="pb-1.5 text-[12px] leading-[1.5] text-dim">{t.detail}</p>}
      {t.note && <p className="pb-1.5 text-[12px] italic text-mute">{t.note}</p>}
      {t.steps.length === 0 ? (
        <div className="flex items-center gap-1.5 py-1 text-[11.5px] text-mute">
          {t.status === 'in_progress' ? <Spinner size={10} /> : <CircleDashed size={11} />}
          {t.status === 'in_progress' ? 'Looking around…' : t.status === 'todo' ? 'Not started' : 'No steps recorded'}
        </div>
      ) : (
        <ol className="relative">
          <span className="absolute bottom-3 left-[5px] top-3 w-px bg-white/[.1]" />
          {t.steps.map((s, i) => {
            const Icon = STEP_ICON[s.kind] ?? SquareTerminal
            const ms = s.ms ?? (s.status === 'running' ? now - s.startedAt : 0)
            return (
              <li key={s.id} className="relative flex h-7 items-center gap-2.5" style={{ animation: `cm-ph-row .3s ${Math.min(i, 10) * 30}ms both` }}>
                {/* Done: green check · failed: red ×, with the reason on hover · running: accent ring */}
                <span
                  title={s.status === 'error' ? 'This step failed (e.g. a command was refused or exited with an error)' : s.status === 'done' ? 'Done' : 'Running'}
                  className={cn(
                    'relative z-[1] grid size-[13px] shrink-0 place-items-center rounded-full',
                    s.status === 'running' ? 'border-2 border-accent bg-bg' : s.status === 'error' ? 'bg-bad text-black' : 'bg-ok/90 text-black'
                  )}
                >
                  {s.status === 'done' && <Check size={8} strokeWidth={3.5} />}
                  {s.status === 'error' && <X size={8} strokeWidth={3.5} />}
                </span>
                <span className="grid size-5 shrink-0 place-items-center rounded-md border border-line bg-raised text-dim">
                  <Icon size={11} />
                </span>
                <span className={cn('min-w-0 flex-1 truncate text-[12px]', s.status === 'running' ? 'text-ink' : s.status === 'error' ? 'text-bad/90' : 'text-ink/80')}>
                  {s.title}
                  {s.count && s.count > 1 ? <span className="text-mute"> ×{s.count}</span> : null}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-mute">{s.status === 'running' ? <Spinner size={10} /> : ms > 0 ? fmtMs(ms) : ''}</span>
              </li>
            )
          })}
        </ol>
      )}
      {t.commits.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1.5">
          {t.commits.map((c) => (
            <button
              key={c.sha}
              title={c.subject}
              onClick={() => actions.showRight('scm')}
              className="flex max-w-full items-center gap-1 rounded-full border border-line-strong px-2 py-0.5 text-[11px] text-dim hover:text-ink"
            >
              <GitCommitHorizontal size={11} />
              <span className="font-mono">{c.sha.slice(0, 7)}</span>
              <span className="truncate">{c.subject}</span>
            </button>
          ))}
        </div>
      )}
      {t.files.length > 0 && t.steps.length === 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {t.files.map((f) => (
            <button
              key={f}
              onClick={() => actions.openEditor(wsId, { kind: 'file', path: f })}
              className="rounded bg-white/[.05] px-1.5 py-px font-mono text-[10.5px] text-dim hover:text-ink"
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
