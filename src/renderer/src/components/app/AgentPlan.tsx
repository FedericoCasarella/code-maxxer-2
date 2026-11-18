import { useEffect, useMemo, useState } from 'react'
import { Check, Clock, ListTodo, PanelRight, Play, Plus, X } from 'lucide-react'
import type { Plan, PlanTask } from '@shared/types'
import { actions } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Button } from '../affect/button'
import { IconButton } from '../affect/icon-button'
import { Spinner } from '../affect/spinner'
import { TextField } from '../affect/text-field'
import { ShimmerText } from '../affect/shimmer-loader'
import { fmtMs } from './PipelineHandoff'
import { Marquee } from './Marquee'

type Row = { id: string; title: string; detail: string; files: string[]; status: PlanTask['status']; isNew?: boolean }

/**
 * The plan in the chat: a light card (title, numbered steps, a line of context each).
 * While proposed: drag to reorder, double-click to rename, add or remove steps, then run it.
 * The full checkpoints live in the side panel: the corner button opens it on this plan.
 */
export function AgentPlan({ plan }: { plan: Plan }) {
  const proposed = plan.status === 'proposed'
  const running = plan.status === 'running'
  const [draft, setDraft] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const rows: Row[] = useMemo(
    () => draft ?? plan.tasks.map((t) => ({ id: t.id, title: t.title, detail: t.detail, files: t.files, status: t.status })),
    [draft, plan.tasks]
  )
  const edit = (fn: (l: Row[]) => Row[]) => setDraft((d) => fn(d ?? rows))

  const done = plan.tasks.filter((t) => t.status === 'done' || t.status === 'skipped').length
  const commits = plan.tasks.reduce((a, t) => a + t.commits.length, 0)
  const started = plan.tasks.map((t) => t.startedAt).filter((x): x is number => !!x)
  const ended = plan.tasks.map((t) => t.finishedAt ?? (t.startedAt ? now : 0))
  const took = started.length ? Math.max(...ended) - Math.min(...started) : 0

  const status =
    plan.status === 'proposed' ? null
      : plan.status === 'running' ? `${done}/${plan.tasks.length}${took ? ` · ${fmtMs(took)}` : ''}`
        : plan.status === 'done' ? `Done${took ? ` · ${fmtMs(took)}` : ''}`
          : 'Discarded'

  const addStep = () => {
    const id = crypto.randomUUID()
    edit((l) => [...l, { id, title: '', detail: '', files: [], status: 'todo', isNew: true }])
    setEditing(id)
  }

  return (
    <section className="cm-in rounded-2xl bg-white/[.035] p-1">
      <div className="rounded-xl border border-line bg-panel px-4 pb-2 pt-3">
        <header className="flex items-center gap-1.5 text-[12px] text-mute">
          <ListTodo size={13} />
          <span>
            Plan · {rows.length} {rows.length === 1 ? 'step' : 'steps'}
          </span>
          <span className="flex-1" />
          {status && (
            <span className="flex items-center gap-1 tabular-nums">
              {running ? <Clock size={12} /> : null}
              {status}
            </span>
          )}
          <IconButton size="sm" variant="ghost" label="Open in the side panel" icon={<PanelRight size={14} />} onClick={() => actions.focusPlan(plan.id)} />
        </header>
        <h3 className="pb-1 text-[15px] font-semibold leading-snug text-ink">{plan.title}</h3>

        <ol className="py-1">
          {rows.map((t, i) => (
            <li
              key={t.id}
              draggable={proposed && editing !== t.id}
              onDragStart={(e) => {
                setDrag(t.id)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (!drag || drag === t.id) return
                e.preventDefault()
                edit((l) => {
                  const from = l.findIndex((x) => x.id === drag)
                  const n = l.slice()
                  const [m] = n.splice(from, 1)
                  n.splice(i, 0, m)
                  return n
                })
              }}
              onDragEnd={() => setDrag(null)}
              className={cn('group flex gap-3 rounded-lg py-2', proposed && 'cursor-grab', drag === t.id && 'opacity-50')}
            >
              <span className="mt-[1px] grid size-5 shrink-0 place-items-center">
                <StepMark n={i + 1} s={t.status} />
              </span>
              <div className="min-w-0 flex-1">
                {editing === t.id ? (
                  <TextField
                    size="sm"
                    aria-label="Step title"
                    autoFocus
                    defaultValue={t.title}
                    placeholder="What should happen"
                    onBlur={(e) => {
                      const v = e.target.value.trim()
                      edit((l) => (v ? l.map((x) => (x.id === t.id ? { ...x, title: v } : x)) : l.filter((x) => x.id !== t.id || !x.isNew)))
                      setEditing(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') {
                        if (t.isNew) edit((l) => l.filter((x) => x.id !== t.id))
                        setEditing(null)
                      }
                    }}
                  />
                ) : (
                  <div
                    onDoubleClick={() => proposed && setEditing(t.id)}
                    className={cn(
                      'text-[13.5px] font-medium leading-snug',
                      t.status === 'done' || t.status === 'skipped' ? 'text-dim' : 'text-ink',
                      t.status === 'skipped' && 'line-through decoration-white/25'
                    )}
                  >
                    {t.status === 'in_progress' ? <ShimmerText>{t.title}</ShimmerText> : t.title}
                  </div>
                )}
                {(t.detail || t.files.length > 0) && editing !== t.id && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-mute">
                    {t.detail && <span className="line-clamp-1">{t.detail}</span>}
                    {t.files.slice(0, 2).map((f) => (
                      <code key={f} className="rounded bg-white/[.06] px-1.5 py-px font-mono text-[10.5px] text-dim">
                        {f.split('/').pop()}
                      </code>
                    ))}
                    {t.files.length > 2 && <span className="text-[11px]">+{t.files.length - 2}</span>}
                  </div>
                )}
              </div>
              {proposed && rows.length > 1 && editing !== t.id && (
                <span className="opacity-0 transition-opacity group-hover:opacity-100">
                  <IconButton size="sm" variant="ghost" label="Remove step" icon={<X size={13} />} onClick={() => edit((l) => l.filter((x) => x.id !== t.id))} />
                </span>
              )}
            </li>
          ))}
          {proposed && (
            <li>
              <button onClick={addStep} className="flex w-full items-center gap-3 rounded-lg py-2 text-left text-[13px] text-mute hover:text-dim">
                <span className="grid size-5 place-items-center rounded-full border border-dashed border-white/25">
                  <Plus size={11} />
                </span>
                Add step
              </button>
            </li>
          )}
        </ol>
      </div>

      <footer className="flex min-h-[44px] items-center gap-2 px-3 py-1.5 text-[11.5px] text-mute">
        {proposed ? (
          <>
            <Marquee className="min-w-0 flex-1" delay={300}>{draft ? 'Edited · ' : ''}Drag to reorder · double-click to rename</Marquee>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await window.cm.cancelPlan(plan.id).finally(() => setBusy(false))
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              disabled={busy || rows.length === 0}
              iconRight={<Play size={10} fill="currentColor" />}
              onClick={async () => {
                setBusy(true)
                await window.cm.approvePlan(plan.id, draft ? draft.map((d) => ({ id: d.id, title: d.title })) : undefined).finally(() => setBusy(false))
                setDraft(null)
              }}
            >
              Run plan
            </Button>
          </>
        ) : (
          <>
            <Marquee className="min-w-0 flex-1 tabular-nums" delay={300}>
              {done}/{plan.tasks.length} done{commits > 0 ? ` · ${commits} ${commits === 1 ? 'commit' : 'commits'}` : ''}
            </Marquee>
            {running && (
              <Button size="sm" variant="ghost" onClick={() => void window.cm.cancelPlan(plan.id)}>
                Stop
              </Button>
            )}
          </>
        )}
      </footer>
    </section>
  )
}

/** The step's number while pending; a check, a spinner or a cross once it moves. */
function StepMark({ n, s }: { n: number; s: PlanTask['status'] }) {
  if (s === 'in_progress') return <Spinner size={14} className="text-accent" />
  if (s === 'done')
    return (
      <span className="grid size-5 place-items-center rounded-full bg-ok/90 text-black">
        <Check size={11} strokeWidth={3} />
      </span>
    )
  if (s === 'failed')
    return (
      <span className="grid size-5 place-items-center rounded-full bg-bad/90 text-black">
        <X size={11} strokeWidth={3} />
      </span>
    )
  return (
    <span className={cn('grid size-5 place-items-center rounded-full border text-[11px] tabular-nums', s === 'skipped' ? 'border-line text-mute/60' : 'border-line-strong text-mute')}>
      {n}
    </span>
  )
}
