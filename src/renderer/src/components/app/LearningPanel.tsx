import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Check, ChevronDown, CircleFadingArrowUp, PencilLine, SendHorizontal, TriangleAlert, ChevronUp, Lightbulb, Minus, Repeat, ListChecks, MessageSquareText, MoreHorizontal, RotateCw, Trash2, Undo2, X } from 'lucide-react'
import type { LearningCycle, Lesson, LoopReview, LoopTweak } from '@shared/learning'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { ProjectPicker } from './ProjectPicker'
import { Switch } from '../affect/switch'
import { Button } from '../affect/button'
import { IconButton } from '../affect/icon-button'
import { Spinner } from '../affect/spinner'
import { Dialog } from '../affect/dialog'
import { NoteTray } from '../affect/decision-inbox'
import { EmptyState } from '../affect/empty-state'
import { fmtMs } from './PipelineHandoff'
import { jumpToMessage } from './PlanCard'
import { ConfirmDialog } from './ConfirmDialog'
import { DropdownMenu } from '../affect/dropdown-menu'
import { SwitchCallout } from './SwitchCallout'
import { Skeleton } from '../affect/shimmer-loader'
import { TextArea } from '../affect/text-area'
import { Badge } from '../affect/badge'
import { ProviderLogo } from './Logos'
import { modelLabel as labelOf, providerOf } from './ModelSelect'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'

const FIRST = 5

/** What kind of lesson: something to always do, to stop doing, or a fact. The icon says it, the sentence explains it. */
// A check would read as "done": the kinds get their own icons, and a word where there's room.
const KIND_ICON: Record<Lesson['kind'], { icon: React.ReactNode; label: string; tag: string }> = {
  always: { icon: <Repeat size={14} className="text-ok" />, label: 'Something to always do', tag: 'Always do' },
  never: { icon: <Ban size={14} className="text-bad" />, label: 'Something to stop doing', tag: 'Avoid' },
  know: { icon: <Lightbulb size={14} className="text-sky-400" />, label: 'Something to know', tag: 'Good to know' }
}

function KindIcon({ kind, size = 15 }: { kind: Lesson['kind']; size?: number }) {
  const k = KIND_ICON[kind]
  return (
    <span title={t(k.label)} aria-label={t(k.label)} className="inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {k.icon}
    </span>
  )
}

/** Right drawer: auto-learning for the project of the selected branch. */
export function LearningPanel({ workspaceId }: { workspaceId: string | null }) {
  const own = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.projectId ?? s.selectedProject)
  // Another project picked here wins until you move to another branch.
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => setPicked(null), [own])
  const projectId = picked ?? own
  const state = useStore((s) => (projectId ? s.learning[projectId] : undefined))
  const [deciding, setDeciding] = useState<LearningCycle | null>(null)
  // After the last lesson: the answer shows, the content fades, then a check and "All done", then it closes.
  const [phase, setPhase] = useState<'deciding' | 'leaving' | 'done'>('deciding')
  const [doneHeight, setDoneHeight] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  const finish = () => {
    setTimeout(() => setPhase('leaving'), 650)
    setTimeout(() => {
      setDoneHeight(Math.min(body.current?.offsetHeight ?? 0, 260))
      setPhase('done')
    }, 850)
    setTimeout(() => setDeciding(null), 2300)
  }
  useEffect(() => {
    if (!deciding) setPhase('deciding')
  }, [deciding])

  useEffect(() => {
    if (projectId) void actions.loadLearning(projectId)
  }, [projectId])

  if (!projectId)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare title={t('No project')} text={t('Pick a branch on the left to see what the agent learned.')} />
      </div>
    )

  const enabled = state?.enabled ?? false
  const cycles = state?.cycles ?? []
  // In use first, then the retired ones.
  const lessons = [...(state?.lessons ?? [])].sort((a, b) => Number(a.status === 'retired') - Number(b.status === 'retired') || b.at - a.at)

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center px-2 pb-1 pt-2">
        <ProjectPicker className="w-full max-w-none" value={projectId} onChange={(id) => id && setPicked(id)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {!state ? (
          <LoadingSkeleton />
        ) : (
          <>
            {/* Callout: title and text on the left, the switch for this project on the right */}
            <div className="px-2">
              <SwitchCallout
                title={t('Auto-learning')}
                description={t('When a run ends, a small model looks at what went wrong or cost time and proposes lessons: things the agent will always do, never do, or should know about this project. The ones you keep, or that two more runs confirm, guide the next runs. A strategist judges every loop and tunes it.')}
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
                      <EmptyState bare title={t('No cycles yet')} text={t('The first one starts when a run in this project ends.')} />
                    </div>
                  )}
                </div>
                {state.loops.length > 0 && (
                  <div className="px-2 pt-3">
                    <Loops loops={state.loops} projectId={projectId} />
                  </div>
                )}
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
          title={phase === 'done' ? '' : t('Should the agent learn this?')}
          closeButton={phase !== 'done'}
        >
          {phase === 'done' ? (
            <AllDone minHeight={doneHeight} />
          ) : (
          <div ref={body} className={cn('transition-opacity duration-200', phase === 'leaving' && 'opacity-0')}>
          <CycleStory
            c={deciding}
            onCustom={(l, text) => {
              void actions.customLesson(projectId, l.id, text)
              const left = deciding.lessons.filter((x) => x.status === 'proposed' && x.id !== l.id)
              if (!left.length) finish()
              else setDeciding({ ...deciding, lessons: deciding.lessons.map((x) => (x.id === l.id ? { ...x, title: text, status: 'active' } : x)) })
            }}
            onDecide={(l, keep) => {
              void actions.decideLesson(projectId, l.id, keep)
              const left = deciding.lessons.filter((x) => x.status === 'proposed' && x.id !== l.id)
              if (!left.length) finish()
              else setDeciding({ ...deciding, lessons: deciding.lessons.map((x) => (x.id === l.id ? { ...x, status: keep ? 'active' : 'rejected' } : x)) })
            }}
          />
          </div>
          )}
        </Dialog>
      )}
    </div>
  )
}

/** The review is over: a check that draws itself, and the words. */
function AllDone({ minHeight }: { minHeight: number }) {
  return (
    <div className="grid place-items-center py-8" style={{ minHeight }}>
      <div className="flex flex-col items-center gap-3">
        <span className="grid size-12 place-items-center rounded-full bg-ok/90 text-black" style={{ animation: 'cm-pop .42s cubic-bezier(.34,1.56,.64,1) both' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray="1" style={{ strokeDashoffset: 1, animation: 'cm-draw .36s .22s cubic-bezier(.65,0,.35,1) forwards' }} />
          </svg>
        </span>
        <span className="text-[14px] font-medium text-ink" style={{ animation: 'cm-fade-up .4s .3s cubic-bezier(.22,1,.36,1) both' }}>
          {t('All done')}
        </span>
      </div>
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
        <span className="font-medium text-ink">{t('Cycles')}</span>
        <span className="text-mute">· {since}</span>
        <span className="flex-1" />
        {needs > 0 && (
          <span className="flex items-center gap-1 text-dim">
            <span className="size-1.5 rounded-full bg-warn" />
            {t('{n} needs you', { n: needs })}
          </span>
        )}
        {needs > 0 && <span className="text-mute">·</span>}
        <span className="flex items-center gap-1 text-dim">
          <span className="size-1.5 rounded-full bg-ok" />
          {t('{n} done', { n: done })}
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
            {more ? t('Show less') : t('Show {n} more', { n: cycles.length - FIRST })}
            <ChevronDown size={12} className={cn('transition-transform', more && 'rotate-180')} />
          </button>
        </footer>
      )}
    </section>
  )
}

/** The run: its title, then what went wrong (yellow) and what changes in the next runs (blue). */
function CycleStory({
  c, headline = true, onDecide, onCustom
}: { c: LearningCycle; headline?: boolean; onDecide?: (l: Lesson, keep: boolean) => void; onCustom?: (l: Lesson, text: string) => void }) {
  // While deciding, what changes next time is the proposed lesson itself, with Keep / Discard on it.
  const proposed = onDecide ? c.lessons.filter((l) => l.status === 'proposed') : []
  // Or the user writes how the agent should act instead: the proposal folds away.
  const [custom, setCustom] = useState(false)
  const [text, setText] = useState('')
  const send = () => text.trim() && proposed[0] && onCustom?.(proposed[0], text.trim())
  const only = !c.problem && !c.fix ? c.conclusion : ''
  if (!headline && !c.problem && !c.fix && !only) return null
  return (
    <div className="mb-3 space-y-3">
      {(headline || only) && (
        <div className="rounded-xl border border-line bg-raised px-3.5 py-3">
          {headline && <div className="text-[14px] font-semibold leading-snug text-ink">{c.title}</div>}
          {only && <p className={cn('text-[12.5px] leading-[1.55] text-dim', headline && 'mt-1.5')}>{only}</p>}
        </div>
      )}
      {c.problem && (
        <NoteTray
          icon={<TriangleAlert size={16} />}
          label={t('What went wrong')}
          color="var(--color-warn)"
          footer={c.model ? <ModelChip model={c.model} /> : undefined}
        >
          {c.problem}
        </NoteTray>
      )}
      {proposed.length > 0
        ? proposed.map((l) => (
            <NoteTray
              key={l.id}
              icon={<CircleFadingArrowUp size={16} />}
              label={t('What changes next time')}
              color="#60a5fa"
              collapsed={custom}
              onToggle={custom ? () => setCustom(false) : undefined}
              footer={
                <div className="flex w-full justify-end gap-2">
                  <Button size="sm" variant="secondary" iconRight={<X size={13} />} onClick={() => onDecide?.(l, false)}>
                    {t('Discard')}
                  </Button>
                  <Button size="sm" iconRight={<Check size={13} />} onClick={() => onDecide?.(l, true)}>
                    {t('Keep')}
                  </Button>
                </div>
              }
            >
              {l.title}
            </NoteTray>
          ))
        : c.fix && (
            <NoteTray icon={<CircleFadingArrowUp size={16} />} label={t('What changes next time')} color="#60a5fa">
              {c.fix}
            </NoteTray>
          )}
      {proposed.length > 0 && onCustom && (
        <NoteTray
          icon={<PencilLine size={16} />}
          label={t('Custom solution')}
          color="#c4b5fd"
          collapsed={!custom}
          onToggle={() => setCustom(!custom)}
          footer={
            <div className="flex w-full justify-end">
              <Button size="sm" iconRight={<SendHorizontal size={13} />} disabled={!text.trim()} onClick={send}>
                {t('Send')}
              </Button>
            </div>
          }
        >
          <TextArea
            autoFocus
            minRows={3}
            maxRows={8}
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            onSubmitShortcut={send}
            placeholder={t('How should the agent act instead?')}
            aria-label={t('Custom solution')}
          />
        </NoteTray>
      )}
    </div>
  )
}

/** The model that ran the run the lesson comes from: to see which one gets things wrong more often. */
function ModelChip({ model }: { model: string }) {
  const models = useStore((s) => s.models)
  return (
    <Badge icon={<ProviderLogo provider={providerOf(model)} size={12} />}>{labelOf(model, models)}</Badge>
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
    <span className="grid size-[15px] place-items-center rounded-full bg-ok/90 text-black">
      <Check size={10} strokeWidth={3} />
    </span>
  )
}

function subtitle(c: LearningCycle): string {
  if (c.status === 'running') return t('Reviewing the run…')
  const proposed = c.lessons.filter((l) => l.status === 'proposed').length
  if (c.status === 'needs_you') return proposed === 1 ? t('1 lesson to review') : t('{n} lessons to review', { n: proposed })
  if (c.status === 'failed') return t("Couldn't review this run")
  const kept = c.lessons.filter((l) => l.status === 'active').length
  const s = c.signals
  const bits = [
    kept ? t('{n} kept', { n: kept }) : c.lessons.length ? t('nothing kept') : t('nothing new'),
    s.commits ? (s.commits === 1 ? t('1 commit') : t('{n} commits', { n: s.commits })) : '',
    s.toolErrors ? (s.toolErrors === 1 ? t('1 error') : t('{n} errors', { n: s.toolErrors })) : '',
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
            {t('Review lessons')}
          </Button>
        ) : c.status === 'failed' ? (
          <Button size="sm" variant="ghost" iconRight={<RotateCw size={13} />} onClick={() => void window.cm.learning.retry(c.id)}>
            {t('Try again')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => jumpToMessage(c.workspaceId, c.messageId)}>
            {t('Open')}
          </Button>
        )}
      </div>
      {open && (
        <div className="cm-in space-y-2 pb-2.5 pl-[36px] pr-3">
          {c.status === 'failed' ? (
            <p className="text-[12.5px] leading-[1.55] text-bad">{c.conclusion.replace(/^Review failed: /, '')}</p>
          ) : (
            <>
              <CycleStory c={c} headline={false} />
            </>
          )}
          {c.lessons.length > 0 && (
            <ul className="space-y-1.5">
              {c.lessons.map((l) => (
                <li key={l.id} className="flex items-start gap-2 text-[12px]">
                  <span className="mt-px"><KindIcon kind={l.kind} size={14} /></span>
                  <span className={cn('min-w-0', l.status === 'rejected' || l.status === 'retired' ? 'text-mute line-through decoration-white/20' : 'text-ink/85')}>
                    {l.title}
                    {l.status === 'proposed' && <span className="text-mute"> · {t('waiting for you')}</span>}
                    {l.status === 'rejected' && <span className="text-mute no-underline"> · {t('discarded')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(c.confirmed.length > 0 || c.violated.length > 0) && (
            <p className="text-[11.5px] text-mute">
              {c.confirmed.length > 0 && (c.confirmed.length === 1 ? t('Followed 1 lesson') : t('Followed {n} lessons', { n: c.confirmed.length }))}
              {c.confirmed.length > 0 && c.violated.length > 0 && ' · '}
              {c.violated.length > 0 && t('went against {n}', { n: c.violated.length })}
            </p>
          )}
        </div>
      )}
    </li>
  )
}

/** The strategist's verdict on each loop run, and the changes it made to the loop (undoable). Same tray as the cycles. */
function Loops({ loops, projectId }: { loops: LoopReview[]; projectId: string }) {
  const [more, setMore] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const shown = more ? loops : loops.slice(0, FIRST)
  return (
    <section className="rounded-2xl bg-white/[.035] p-1">
      <header className="flex items-center gap-2 px-2.5 pb-2 pt-1.5 text-[12px]">
        <span className="font-medium text-ink">{t('Loops')}</span>
      </header>
      <ol className="overflow-hidden rounded-xl border border-line bg-panel py-1">
        {shown.map((l) => (
          <LoopRow key={l.id} l={l} projectId={projectId} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} />
        ))}
      </ol>
      {loops.length > FIRST && (
        <footer className="flex items-center px-2.5 pb-1 pt-1.5">
          <button onClick={() => setMore(!more)} className="flex items-center gap-1 text-[12px] text-mute hover:text-dim">
            {more ? t('Show less') : t('Show {n} more', { n: loops.length - FIRST })}
            <ChevronDown size={12} className={cn('transition-transform', more && 'rotate-180')} />
          </button>
        </footer>
      )}
    </section>
  )
}

const VERDICT: Record<LoopReview['verdict'], string> = { good: 'Went well', bad: 'Went badly', no_effect: 'No effect' }

function VerdictIcon({ v }: { v: LoopReview['verdict'] }) {
  const Icon = v === 'good' ? Check : v === 'bad' ? X : Minus
  return (
    <span className={cn('grid size-[15px] place-items-center rounded-full text-black', v === 'good' ? 'bg-ok/90' : v === 'bad' ? 'bg-bad/90' : 'bg-white/30')}>
      <Icon size={10} strokeWidth={3} />
    </span>
  )
}

function tweakText(x: LoopTweak): string {
  return x.kind === 'skip' ? t('{node}: skipped', { node: x.nodeLabel }) : t('{node}: now on {model}', { node: x.nodeLabel, model: x.value.replace(/^claude-/, '') })
}

function LoopRow({ l, projectId, open, onToggle }: { l: LoopReview; projectId: string; open: boolean; onToggle: () => void }) {
  const s = l.stats
  const sub = [
    t(VERDICT[l.verdict]),
    s.loops ? (s.loops === 1 ? t('1 loop') : t('{n} loops', { n: s.loops })) : '',
    s.tokens ? `${Math.round(s.tokens / 1000)}k token` : '',
    s.ms ? fmtMs(s.ms) : ''
  ].filter(Boolean).join(' · ')
  return (
    <li className={cn('mx-1 rounded-lg transition-colors', open ? 'bg-white/[.04]' : 'hover:bg-white/[.025]')}>
      <div className="flex items-center gap-2.5 px-2.5 py-2">
        <button onClick={onToggle} className="loop-row-btn flex min-w-0 flex-1 items-start gap-2.5 text-left" aria-expanded={open}>
          <span className="mt-[2px] grid w-4 shrink-0 place-items-center">
            <VerdictIcon v={l.verdict} />
          </span>
          <span className="min-w-0 flex-1">
            <Marquee className="text-[13px] text-ink" delay={300} hoverTarget=".loop-row-btn">{l.task || l.pipelineName}</Marquee>
            <Marquee className="text-[12px] text-mute" delay={300} hoverTarget=".loop-row-btn">
              {sub}
            </Marquee>
          </span>
        </button>
        <Button size="sm" variant="ghost" onClick={() => jumpToMessage(l.workspaceId, l.messageId)}>
          {t('Open')}
        </Button>
      </div>
      {open && (
        <div className="cm-in space-y-2 pb-2.5 pl-[36px] pr-3">
          {l.summary && (
            <div className="rounded-xl border border-line bg-raised px-3.5 py-3">
              <p className="text-[12.5px] leading-[1.55] text-dim">{l.summary}</p>
            </div>
          )}
          {l.tweaks.map((x) => (
            <div key={x.id} className="flex items-start gap-2 text-[12px]">
              <span className="min-w-0 flex-1">
                <span className={cn(x.status === 'active' ? 'text-ink/85' : 'text-mute line-through decoration-white/20')}>{tweakText(x)}</span>
                {x.status === 'rolled_back' && <span className="text-mute"> · {t('undone on its own: the loop got worse')}</span>}
                {x.status === 'undone' && <span className="text-mute"> · {t('undone')}</span>}
                {x.reason && <span className="block text-mute">{x.reason}</span>}
              </span>
              {x.status === 'active' && (
                <Button size="sm" variant="ghost" iconRight={<Undo2 size={12} />} onClick={() => void actions.undoTweak(projectId, x.id)}>
                  {t('Undo')}
                </Button>
              )}
            </div>
          ))}
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
          {lessons.length === 1 ? t('1 lesson') : t('{n} lessons', { n: lessons.length })}
        </span>
        <span className="ml-auto text-mute">{t('{n} in use', { n: inUse })}</span>
      </div>
      {lessons.map((l) => (
        <LessonItem key={l.id} l={l} open={openId === l.id} onToggle={() => setOpenId((o) => (o === l.id ? null : l.id))} onRemove={() => setRemoving(l)} />
      ))}
      {removing && (
        <ConfirmDialog
          title={t('Delete this lesson?')}
          confirmLabel={t('Delete')}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await actions.removeLesson(removing.projectId, removing.id)
            setRemoving(null)
          }}
        >
          {t('“{title}” stops guiding the agent and is removed for good.', { title: removing.title })}
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
          <div className={cn('flex items-start gap-2 text-[13px] leading-snug', retired ? 'text-mute' : 'text-ink')}>
            <span className="mt-px"><KindIcon kind={l.kind} /></span>
            <span className="line-clamp-2 min-w-0">{l.title}</span>
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11.5px] text-mute">
            <span className={cn('size-1.5 shrink-0 rounded-full', retired ? 'bg-white/20' : 'bg-ok')} />
            <span>{retired ? t('Retired') : l.auto ? t('Technical note') : t('In use')}</span>
            <span>· {timeAgo(l.at) === 'now' ? t('just now') : t('{t} ago', { t: timeAgo(l.at) })}</span>
            {o && <Marquee className="min-w-0" delay={300} hoverTarget=".lesson-row-btn">· {o.branch}</Marquee>}
            {o?.model && <Marquee className="min-w-0" delay={300} hoverTarget=".lesson-row-btn">· {o.model}</Marquee>}
          </div>
        </button>
        <IconButton size="sm" variant="ghost" label={open ? t('Collapse') : t('Expand')} icon={open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={onToggle} />
        <DropdownMenu
          align="end"
          width={180}
          items={[
            ...(o ? [{ label: t('Open chat'), icon: <MessageSquareText size={14} />, onSelect: () => jumpToMessage(o.workspaceId, o.messageId) }] : []),
            { label: t('Delete'), icon: <Trash2 size={14} />, danger: true, divider: !!o, onSelect: onRemove }
          ]}
          trigger={({ triggerProps }) => (
            <IconButton {...triggerProps} size="sm" variant="ghost" label={t('More')} icon={<MoreHorizontal size={14} />} />
          )}
        />
      </div>
      {open && (
        <div className="cm-in mx-3 mb-3 rounded-xl border border-line bg-raised">
          {l.body && (
            <p className="px-3 pb-2.5 pt-3 text-[12.5px] leading-[1.55] text-dim">
              {l.body}
            </p>
          )}
          <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-2.5 text-[12px]', l.body && 'border-t border-line')}>
            <Meta k={t('Created')}>{new Date(l.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</Meta>
            <Meta k={t('Agent')}>{o?.model ?? t('Unknown')}</Meta>
            <Meta k={t('Branch')}>{o?.branch ?? t('Unknown')}</Meta>
            {o && <Meta k={t('From run')}>{o.run}</Meta>}
            <Meta k={t('Track record')}>
              {l.confirmations === 1 ? t('Helped in 1 run') : t('Helped in {n} runs', { n: l.confirmations })} · {t('ignored or wrong in {n}', { n: l.violations })}
            </Meta>
          </dl>
          <div className="flex items-center gap-1.5 border-t border-line p-2.5">
            {o && (
              <Button size="sm" variant="secondary" iconRight={<MessageSquareText size={12} />} onClick={() => jumpToMessage(o.workspaceId, o.messageId)}>
                {t('Open chat')}
              </Button>
            )}
            <span className="ml-auto">
              <Switch
                size="sm"
                aria-label={t('Use this lesson')}
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
    <div aria-busy="true" aria-label={t('Loading')}>
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
