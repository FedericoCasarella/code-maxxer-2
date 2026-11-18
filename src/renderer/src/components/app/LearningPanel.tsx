import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import type { LearningCycle, Lesson } from '@shared/learning'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Switch } from '../affect/switch'
import { Button } from '../affect/button'
import { IconButton } from '../affect/icon-button'
import { Spinner } from '../affect/spinner'
import { Dialog } from '../affect/dialog'
import { DecisionInbox } from '../affect/decision-inbox'
import { EmptyState } from '../affect/empty-state'
import { fmtMs } from './PipelineHandoff'
import { jumpToMessage } from './PlanCard'

const FIRST = 5

/** Right drawer: auto-learning for the project of the selected branch. */
export function LearningPanel({ workspaceId }: { workspaceId: string | null }) {
  const projectId = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.projectId ?? s.selectedProject)
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const state = useStore((s) => (projectId ? s.learning[projectId] : undefined))
  const [deciding, setDeciding] = useState<LearningCycle | null>(null)

  useEffect(() => {
    if (projectId) void actions.loadLearning(projectId)
  }, [projectId])

  if (!projectId)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare title="No project" text="Pick a branch on the left to see what the agent learned." />
      </div>
    )

  const enabled = state?.enabled ?? false
  const cycles = state?.cycles ?? []
  const active = (state?.lessons ?? []).filter((l) => l.status === 'active')
  const retired = (state?.lessons ?? []).filter((l) => l.status === 'retired')

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[11px] font-semibold text-dim">Learning</span>
        <span className="ml-auto truncate text-[11px] text-mute">{project?.name}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-4">
        {/* Callout: what it does, and the switch for this project */}
        <section className="rounded-xl border border-line bg-panel px-3.5 pb-3 pt-3">
          <div className="text-[13px] font-medium text-ink">Auto-learning</div>
          <p className="mt-1 text-[12px] leading-[1.5] text-dim">
            After each run the agent reviews how it went and proposes lessons for this project. The ones you keep guide every next run.
          </p>
          <div className="mt-2.5 flex justify-end">
            <Switch
              size="sm"
              aria-label="Auto-learning for this project"
              checked={enabled}
              onChange={(e) => void window.cm.learning.setEnabled(projectId, e.currentTarget.checked)}
            />
          </div>
        </section>

        {cycles.length > 0 ? (
          <Cycles cycles={cycles} onDecide={setDeciding} />
        ) : (
          enabled && (
            <div className="px-4 py-6">
              <EmptyState bare title="No cycles yet" text="The first one starts when a run in this project ends." />
            </div>
          )
        )}

        {(active.length > 0 || retired.length > 0) && <Lessons active={active} retired={retired} />}
      </div>

      {deciding && (
        <Dialog
          open
          onOpenChange={(o) => !o && setDeciding(null)}
          size="md"
          title="Lessons to review"
          description={deciding.title}
          closeButton
        >
          {deciding.conclusion && <p className="pb-3 text-[13px] leading-[1.55] text-dim">{deciding.conclusion}</p>}
          <DecisionInbox
            decisions={deciding.lessons
              .filter((l) => l.status === 'proposed')
              .map((l) => ({ id: l.id, title: l.title, detail: l.body || undefined, primary: 'Keep', secondary: 'Discard' }))}
            onDecide={(d, a) => {
              void window.cm.learning.decide(d.id, a === 'primary')
              const left = deciding.lessons.filter((l) => l.status === 'proposed' && l.id !== d.id)
              if (!left.length) setTimeout(() => setDeciding(null), 1200)
              else setDeciding({ ...deciding, lessons: deciding.lessons.map((l) => (l.id === d.id ? { ...l, status: a === 'primary' ? 'active' : 'rejected' } : l)) })
            }}
          />
        </Dialog>
      )}
    </div>
  )
}

/** Every review, newest first, in a tray: what happened, and what needs the user. */
function Cycles({ cycles, onDecide }: { cycles: LearningCycle[]; onDecide: (c: LearningCycle) => void }) {
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const needs = cycles.filter((c) => c.status === 'needs_you').length
  const done = cycles.filter((c) => c.status === 'done').length
  const shown = more ? cycles : cycles.slice(0, FIRST)
  const since = useMemo(() => ago(cycles[cycles.length - 1]?.at ?? Date.now()), [cycles])

  return (
    <section className="rounded-2xl bg-white/[.035] p-1">
      <header className="flex items-center gap-2 px-2.5 pb-2 pt-1.5 text-[12px]">
        <span className="font-medium text-ink">Cycles</span>
        <span className="text-mute">· {since}</span>
        <span className="flex-1" />
        {needs > 0 && (
          <span className="flex items-center gap-1 text-dim">
            <span className="size-1.5 rounded-full bg-warn" />
            {needs} needs you
          </span>
        )}
        {needs > 0 && <span className="text-mute">·</span>}
        <span className="flex items-center gap-1 text-dim">
          <span className="size-1.5 rounded-full bg-accent" />
          {done} done
        </span>
      </header>
      <ol className="overflow-hidden rounded-xl border border-line bg-panel py-1">
        {shown.map((c) => (
          <CycleRow key={c.id} c={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onDecide={() => onDecide(c)} />
        ))}
      </ol>
      {cycles.length > FIRST && (
        <footer className="flex items-center px-2.5 pb-1 pt-1.5">
          <button onClick={() => setMore(!more)} className="flex items-center gap-1 text-[12px] text-mute hover:text-dim">
            {more ? 'Show less' : `Show ${cycles.length - FIRST} more`}
            <ChevronDown size={12} className={cn('transition-transform', more && 'rotate-180')} />
          </button>
        </footer>
      )}
    </section>
  )
}

function CycleIcon({ s }: { s: LearningCycle['status'] }) {
  if (s === 'running') return <Spinner size={13} className="text-dim" />
  if (s === 'needs_you')
    return (
      <span className="grid size-[15px] place-items-center rounded-full border-[1.5px] border-warn">
        <span className="size-[5px] rounded-full bg-warn" />
      </span>
    )
  if (s === 'failed')
    return (
      <span className="grid size-[15px] place-items-center rounded-full bg-bad/90 text-black">
        <X size={10} strokeWidth={3} />
      </span>
    )
  return (
    <span className="grid size-[15px] place-items-center rounded-full bg-accent text-black">
      <Check size={10} strokeWidth={3} />
    </span>
  )
}

function subtitle(c: LearningCycle): string {
  if (c.status === 'running') return 'Reviewing the run…'
  const proposed = c.lessons.filter((l) => l.status === 'proposed').length
  if (c.status === 'needs_you') return `${proposed} ${proposed === 1 ? 'lesson' : 'lessons'} to review`
  if (c.status === 'failed') return 'Review failed'
  const kept = c.lessons.filter((l) => l.status === 'active').length
  const s = c.signals
  const bits = [
    kept ? `${kept} kept` : c.lessons.length ? 'nothing kept' : 'nothing new',
    s.commits ? `${s.commits} ${s.commits === 1 ? 'commit' : 'commits'}` : '',
    s.toolErrors ? `${s.toolErrors} ${s.toolErrors === 1 ? 'error' : 'errors'}` : '',
    s.ms ? fmtMs(s.ms) : ''
  ]
  return bits.filter(Boolean).join(' · ')
}

function CycleRow({ c, open, onToggle, onDecide }: { c: LearningCycle; open: boolean; onToggle: () => void; onDecide: () => void }) {
  return (
    <li className={cn('mx-1 rounded-lg transition-colors', open ? 'bg-white/[.04]' : 'hover:bg-white/[.025]')}>
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-start gap-2.5 text-left" aria-expanded={open}>
          <span className="mt-[2px] grid w-4 shrink-0 place-items-center">
            <CycleIcon s={c.status} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] text-ink">{c.title}</span>
            <span className="block truncate text-[12px] text-mute">
              {c.branch} · {subtitle(c)}
            </span>
          </span>
        </button>
        {c.status === 'needs_you' ? (
          <Button size="sm" variant="secondary" onClick={onDecide}>
            Decide
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => jumpToMessage(c.workspaceId, c.messageId)}>
            Open
          </Button>
        )}
      </div>
      {open && (
        <div className="cm-in space-y-2 pb-2.5 pl-[36px] pr-3">
          {c.conclusion && <p className="text-[12.5px] leading-[1.55] text-dim">{c.conclusion}</p>}
          {c.lessons.length > 0 && (
            <ul className="space-y-1">
              {c.lessons.map((l) => (
                <li key={l.id} className="flex items-start gap-1.5 text-[12px]">
                  <span
                    className={cn(
                      'mt-[5px] size-1.5 shrink-0 rounded-full',
                      l.status === 'active' ? 'bg-accent' : l.status === 'proposed' ? 'bg-warn' : 'bg-white/20'
                    )}
                  />
                  <span className={cn('min-w-0', l.status === 'rejected' || l.status === 'retired' ? 'text-mute line-through decoration-white/20' : 'text-ink/85')}>
                    {l.title}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(c.confirmed.length > 0 || c.violated.length > 0) && (
            <p className="text-[11.5px] text-mute">
              {c.confirmed.length > 0 && `Followed ${c.confirmed.length} ${c.confirmed.length === 1 ? 'lesson' : 'lessons'}`}
              {c.confirmed.length > 0 && c.violated.length > 0 && ' · '}
              {c.violated.length > 0 && `went against ${c.violated.length}`}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/** The lessons every run of the project gets, and the ones that retired. */
function Lessons({ active, retired }: { active: Lesson[]; retired: Lesson[] }) {
  return (
    <section className="rounded-xl border border-line bg-panel py-1.5">
      <div className="flex items-center px-3.5 pb-1 pt-0.5 text-[12px]">
        <span className="font-medium text-ink">Lessons in use</span>
        <span className="ml-1.5 text-mute">{active.length}</span>
      </div>
      {active.length === 0 && <p className="px-3.5 py-1 text-[12px] text-mute">None yet: keep a proposed lesson to add it.</p>}
      <ul>
        {active.map((l) => (
          <li key={l.id} className="group flex items-start gap-2 px-3.5 py-1.5">
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] text-ink/90">{l.title}</span>
              {l.body && <span className="block text-[11.5px] leading-[1.45] text-mute">{l.body}</span>}
            </span>
            {(l.confirmations > 0 || l.violations > 0) && (
              <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-mute" title="Runs that confirmed it · went against it">
                {l.confirmations}✓ {l.violations > 0 && `${l.violations}✗`}
              </span>
            )}
            <span className="opacity-0 transition-opacity group-hover:opacity-100">
              <IconButton size="sm" variant="ghost" label="Stop using this lesson" icon={<X size={13} />} onClick={() => void window.cm.learning.retire(l.id)} />
            </span>
          </li>
        ))}
      </ul>
      {retired.length > 0 && (
        <details className="px-3.5 pt-1">
          <summary className="cursor-default text-[11.5px] text-mute">Retired · {retired.length}</summary>
          <ul className="pb-1 pt-1">
            {retired.map((l) => (
              <li key={l.id} className="py-0.5 text-[12px] text-mute line-through decoration-white/20">
                {l.title}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function ago(at: number): string {
  const m = Math.max(1, Math.round((Date.now() - at) / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d`
}
