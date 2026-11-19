import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, ListChecks, MessageSquareText, MoreHorizontal, RotateCw, Trash2, X } from 'lucide-react'
import type { LearningCycle, Lesson } from '@shared/learning'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Switch } from '../affect/switch'
import { Button } from '../affect/button'
import { IconButton } from '../affect/icon-button'
import { Spinner } from '../affect/spinner'
import { Dialog } from '../affect/dialog'
import { DecisionInbox } from '../affect/decision-inbox'
import { EmptyState } from '../affect/empty-state'
import { fmtMs } from './PipelineHandoff'
import { jumpToMessage } from './PlanCard'
import { ConfirmDialog } from './ConfirmDialog'
import { DropdownMenu } from '../affect/dropdown-menu'
import { SwitchCallout } from './SwitchCallout'
import { Skeleton } from '../affect/shimmer-loader'
import { Marquee } from './Marquee'

const FIRST = 5

/** How a lesson reads: what the agent will always do, never do, or now knows. */
export const KIND_LABEL: Record<Lesson['kind'], string> = { always: 'Will always', never: 'Will never', know: 'Now knows' }
const KIND_TONE: Record<Lesson['kind'], string> = { always: 'text-ok', never: 'text-bad', know: 'text-accent' }

function KindTag({ kind }: { kind: Lesson['kind'] }) {
  return <span className={cn('shrink-0 font-medium', KIND_TONE[kind])}>{KIND_LABEL[kind]}</span>
}

/** One line under a lesson: when it applies and why it was learned. */
const lessonDetail = (l: Lesson) => [l.situation && `When: ${l.situation}`, l.body && `Why: ${l.body}`].filter(Boolean).join(' · ') || undefined

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
  // In use first, then the retired ones.
  const lessons = [...(state?.lessons ?? [])].sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired') || b.at - a.at)

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[11px] font-semibold text-dim">Learning</span>
        <Marquee className="ml-auto text-[11px] text-mute" delay={300}>{project?.name}</Marquee>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {!state ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Callout: title and text on the left, the switch for this project on the right */}
            <div className="px-2">
              <SwitchCallout
                title="Auto-learning"
                description="When a run ends, a small model looks at what went wrong or cost time and proposes lessons: things the agent will always do, never do, or should know about this project. The ones you keep guide the next runs."
                checked={enabled}
                onChange={(on) => void actions.setLearningEnabled(projectId, on)}
              />
            </div>

            {enabled && (
              <>
                <div className="px-2 pt-3">
                  {cycles.length > 0 ? (
                    <Cycles cycles={cycles} onDecide={setDeciding} />
                  ) : (
                    <div className="px-4 py-6">
                      <EmptyState bare title="No cycles yet" text="The first one starts when a run in this project ends." />
                    </div>
                  )}
                </div>
                {lessons.length > 0 && <Lessons lessons={lessons} />}
              </>
            )}
          </>
        )}
      </div>

      {deciding && (
        <Dialog
          open
          onOpenChange={(o) => !o && setDeciding(null)}
          size="md"
          title="Should the agent learn this?"
          description={deciding.title}
          closeButton
        >
          <CycleStory c={deciding} />
          <p className="pb-3 text-[12px] leading-[1.55] text-mute">
            Keep: the agent follows the lesson in the next runs of this project. Discard: it's forgotten.
          </p>
          <DecisionInbox
            decisions={deciding.lessons
              .filter((l) => l.status === 'proposed')
              .map((l) => ({ id: l.id, title: `${KIND_LABEL[l.kind]}: ${l.title}`, detail: lessonDetail(l), primary: 'Keep', secondary: 'Discard' }))}
            onDecide={(d, a) => {
              void actions.decideLesson(projectId, d.id, a === 'primary')
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

/** What went wrong in the run, and what keeping the lessons changes. */
function CycleStory({ c }: { c: LearningCycle }) {
  // Reviews from before these fields only have the conclusion.
  const old = !c.problem && !c.fix
  if (old && !c.conclusion) return null
  return (
    <dl className="mb-3 space-y-2 rounded-xl border border-line bg-raised px-3 py-2.5 text-[12.5px] leading-[1.55]">
      {old && (
        <div>
          <dt className="text-mute">How it went</dt>
          <dd className="text-ink/85">{c.conclusion}</dd>
        </div>
      )}
      {c.problem && (
        <div>
          <dt className="text-mute">What went wrong</dt>
          <dd className="text-ink/85">{c.problem}</dd>
        </div>
      )}
      {c.fix && (
        <div>
          <dt className="text-mute">What changes next time</dt>
          <dd className="text-ink/85">{c.fix}</dd>
        </div>
      )}
    </dl>
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
  if (c.status === 'failed') return "Couldn't review this run"
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
        <button onClick={onToggle} className="cycle-row-btn flex min-w-0 flex-1 items-start gap-2.5 text-left" aria-expanded={open}>
          <span className="mt-[2px] grid w-4 shrink-0 place-items-center">
            <CycleIcon s={c.status} />
          </span>
          <span className="min-w-0 flex-1">
            <Marquee className="text-[13px] text-ink" delay={300} hoverTarget=".cycle-row-btn">{c.title}</Marquee>
            <Marquee className="text-[12px] text-mute" delay={300} hoverTarget=".cycle-row-btn">
              {c.branch} · {subtitle(c)}
            </Marquee>
          </span>
        </button>
        {c.status === 'needs_you' ? (
          <Button size="sm" variant="secondary" iconRight={<ListChecks size={13} />} onClick={onDecide}>
            Review lessons
          </Button>
        ) : c.status === 'failed' ? (
          <Button size="sm" variant="ghost" iconRight={<RotateCw size={13} />} onClick={() => void window.cm.learning.retry(c.id)}>
            Try again
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => jumpToMessage(c.workspaceId, c.messageId)}>
            Open
          </Button>
        )}
      </div>
      {open && (
        <div className="cm-in space-y-2 pb-2.5 pl-[36px] pr-3">
          {c.status === 'failed' ? (
            <p className="text-[12.5px] leading-[1.55] text-bad">{c.conclusion.replace(/^Review failed: /, '')}</p>
          ) : (
            <>
              <CycleStory c={c} />
              {c.conclusion && (c.problem || c.fix) && <p className="text-[12.5px] leading-[1.55] text-dim">{c.conclusion}</p>}
            </>
          )}
          {c.lessons.length > 0 && (
            <ul className="space-y-1.5">
              {c.lessons.map((l) => (
                <li key={l.id} className="flex items-start gap-1.5 text-[12px]">
                  <span
                    className={cn(
                      'mt-[5px] size-1.5 shrink-0 rounded-full',
                      l.status === 'active' ? 'bg-accent' : l.status === 'proposed' ? 'bg-warn' : 'bg-white/20'
                    )}
                  />
                  <span className={cn('min-w-0', l.status === 'rejected' || l.status === 'retired' ? 'text-mute line-through decoration-white/20' : 'text-ink/85')}>
                    <KindTag kind={l.kind} /> {l.title}
                    {l.status === 'proposed' && <span className="text-mute"> · waiting for you</span>}
                    {l.status === 'rejected' && <span className="text-mute no-underline"> · discarded</span>}
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

/** The lessons, full width and stacked like the agent sessions: a recap at a glance, details and actions when opened. */
function Lessons({ lessons }: { lessons: Lesson[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Lesson | null>(null)
  const inUse = lessons.filter((l) => l.status === 'active').length
  return (
    <section className="mt-4">
      <div className="flex items-center gap-2 border-y border-line px-3 py-1.5 text-[12px]">
        <span className="font-medium text-ink">
          {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}
        </span>
        <span className="ml-auto text-mute">{inUse} in use</span>
      </div>
      {lessons.map((l) => (
        <LessonItem key={l.id} l={l} open={openId === l.id} onToggle={() => setOpenId((o) => (o === l.id ? null : l.id))} onRemove={() => setRemoving(l)} />
      ))}
      {removing && (
        <ConfirmDialog
          title="Delete this lesson?"
          confirmLabel="Delete"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await actions.removeLesson(removing.projectId, removing.id)
            setRemoving(null)
          }}
        >
          “{removing.title}” stops guiding the agent and is removed for good.
        </ConfirmDialog>
      )}
    </section>
  )
}

function LessonItem({ l, open, onToggle, onRemove }: { l: Lesson; open: boolean; onToggle: () => void; onRemove: () => void }) {
  const retired = l.status === 'retired'
  const o = l.origin
  return (
    <div className={cn('border-b border-line', open && 'bg-white/[.015]')}>
      <div className="group flex items-start gap-1.5 px-3 py-2.5">
        <button onClick={onToggle} className="lesson-row-btn min-w-0 flex-1 text-left" aria-expanded={open}>
          <div className={cn('line-clamp-2 text-[13px] leading-snug', retired ? 'text-mute' : 'text-ink')}>
            <KindTag kind={l.kind} /> {l.title}
          </div>
          {l.situation && <div className="mt-0.5 line-clamp-1 text-[12px] text-dim">When {l.situation}</div>}
          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11.5px] text-mute">
            <span className={cn('size-1.5 shrink-0 rounded-full', retired ? 'bg-white/20' : 'bg-accent')} />
            <span>{retired ? 'Retired' : 'In use'}</span>
            <span>· {timeAgo(l.at) === 'now' ? 'just now' : `${timeAgo(l.at)} ago`}</span>
            {o && <Marquee className="min-w-0" delay={300} hoverTarget=".lesson-row-btn">· {o.branch}</Marquee>}
            {o?.model && <Marquee className="min-w-0" delay={300} hoverTarget=".lesson-row-btn">· {o.model}</Marquee>}
          </div>
        </button>
        <IconButton size="sm" variant="ghost" label={open ? 'Collapse' : 'Expand'} icon={open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={onToggle} />
        <DropdownMenu
          align="end"
          width={180}
          items={[
            ...(o ? [{ label: 'Open chat', icon: <MessageSquareText size={14} />, onSelect: () => jumpToMessage(o.workspaceId, o.messageId) }] : []),
            { label: 'Delete', icon: <Trash2 size={14} />, danger: true, divider: !!o, onSelect: onRemove }
          ]}
          trigger={({ triggerProps }) => (
            <IconButton {...triggerProps} size="sm" variant="ghost" label="More" icon={<MoreHorizontal size={14} />} />
          )}
        />
      </div>
      {open && (
        <div className="cm-in mx-3 mb-3 rounded-xl border border-line bg-raised">
          {l.body && (
            <p className="px-3 pb-2.5 pt-3 text-[12.5px] leading-[1.55] text-dim">
              <span className="text-mute">Learned because </span>
              {l.body}
            </p>
          )}
          <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-2.5 text-[12px]', l.body && 'border-t border-line')}>
            <Meta k="Created">{new Date(l.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Meta>
            <Meta k="Agent">{o?.model ?? 'Unknown'}</Meta>
            <Meta k="Branch">{o?.branch ?? 'Unknown'}</Meta>
            {o && <Meta k="From run">{o.run}</Meta>}
            <Meta k="Track record">
              Helped in {l.confirmations} {l.confirmations === 1 ? 'run' : 'runs'} · ignored or wrong in {l.violations}
            </Meta>
          </dl>
          <div className="flex items-center gap-1.5 border-t border-line p-2.5">
            {o && (
              <Button size="sm" variant="secondary" iconRight={<MessageSquareText size={12} />} onClick={() => jumpToMessage(o.workspaceId, o.messageId)}>
                Open chat
              </Button>
            )}
            <span className="ml-auto">
              <Switch
                size="sm"
                aria-label="Use this lesson"
                checked={!retired}
                onChange={(e) => void actions.setLessonStatus(l.projectId, l.id, e.currentTarget.checked ? 'active' : 'retired')}
              />
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Meta({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-mute">{k}</dt>
      <dd className="min-w-0 text-dim">
        <Marquee delay={300}>{children}</Marquee>
      </dd>
    </>
  )
}

/** While the project's learning data loads: the callout, the cycles tray and a few lesson rows. */
function LoadingSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="px-2">
        <Skeleton width="100%" height={78} radius={12} />
      </div>
      <div className="px-2 pt-3">
        <Skeleton width="100%" height={150} radius={16} />
      </div>
      <div className="mt-4 space-y-3 border-t border-line px-3 pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton width="70%" height={13} radius={4} />
            <Skeleton width="45%" height={10} radius={4} />
          </div>
        ))}
      </div>
    </div>
  )
}

function ago(at: number): string {
  const m = Math.max(1, Math.round((Date.now() - at) / 60000))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d`
}
