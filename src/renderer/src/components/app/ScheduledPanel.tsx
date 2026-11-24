import { useEffect, useMemo, useState } from 'react'
import { usePersisted } from '@/lib/persist'
import { Bot, CalendarClock, Check, Clock, GitBranch, Play, X } from 'lucide-react'
import type { ScheduledRun } from '@shared/types'
import { actions, getState, useStore } from '@/lib/store'
import { jumpToMessage } from './PlanCard'
import { cn } from '@/lib/utils'
import { EmptyState } from '../affect/empty-state'
import { SegmentedControl } from '../affect/segmented-control'
import { Tooltip } from '../affect/tooltip'
import { ScheduleDialog, relative } from './ScheduleDialog'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'

const dayLabel = (at: number) => {
  const d = new Date(at)
  const today = new Date()
  const tomorrow = new Date(Date.now() + 86_400_000)
  if (d.toDateString() === today.toDateString()) return t('Today')
  if (d.toDateString() === tomorrow.toDateString()) return t('Tomorrow')
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}
const hhmm = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** Right-drawer tab: prompts waiting to be sent and when, plus what already went out. */
export function ScheduledPanel() {
  const runs = useStore((s) => s.scheduled)
  const workspaces = useStore((s) => s.workspaces)
  const selectedWs = useStore((s) => s.selectedWs)
  const [scope, setScope] = usePersisted<'branch' | 'all'>('scheduled.scope', 'all')
  const [, tick] = useState(0)
  const [editing, setEditing] = useState<ScheduledRun | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const inScope = runs.filter((r) => scope === 'all' || r.workspaceId === selectedWs)
  const pending = inScope.filter((r) => r.status === 'pending')
  const done = inScope.filter((r) => r.status !== 'pending').slice(-8).reverse()
  const groups = useMemo(() => {
    const m = new Map<string, ScheduledRun[]>()
    for (const r of pending) m.set(dayLabel(r.at), [...(m.get(dayLabel(r.at)) ?? []), r])
    return [...m.entries()]
  }, [pending])
  const branchOf = (id: string) => workspaces.find((w) => w.id === id)?.branch ?? '—'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-2.5">
        <div className="text-[13px] font-semibold">{t('Scheduled runs')}</div>
        <div className="text-[11.5px] text-mute">{t('Prompts ready to send, and when')}</div>
        <SegmentedControl
          className="mt-2.5"
          fullWidth
          size="sm"
          value={scope}
          onChange={setScope}
          aria-label={t('Scope')}
          options={[
            { value: 'branch', label: t('This branch') },
            { value: 'all', label: t('All'), count: runs.filter((r) => r.status === 'pending').length }
          ]}
        />
      </div>
      {error && <div className="selectable mx-3 mb-2 rounded-lg bg-bad/10 px-2.5 py-1.5 text-[12px] text-bad">{error}</div>}
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {pending.length === 0 ? (
          <div className="grid h-full place-items-center px-4">
            <EmptyState
              bare
              icon={<CalendarClock size={18} />}
              title={t('Nothing scheduled')}
              text={t('Right-click the send button, or ask the orchestrator: “run this tonight at 23:00”.')}
            />
          </div>
        ) : (
          groups.map(([day, list]) => (
            <section key={day}>
              <div className="border-y border-line bg-white/[.015] px-3 py-1 text-[11px] font-semibold text-mute">{day}</div>
              {list.map((r) => (
                <div key={r.id} className="group border-b border-line px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <Clock size={12} className="text-accent" />
                    <span className="font-semibold tabular-nums">{hhmm(r.at)}</span>
                    <span className="text-mute">· {relative(r.at)}</span>
                    {r.source === 'agent' && (
                      <Tooltip content={t('Scheduled by the orchestrator')} side="left">
                        <Bot size={12} className="text-mute" />
                      </Tooltip>
                    )}
                    <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <IconBtn label={t('Send now')} onClick={() => window.cm.runScheduledNow(r.id).catch((e) => setError(e.message))}>
                        <Play size={12} />
                      </IconBtn>
                      <IconBtn label={t('Change time')} onClick={() => setEditing(r)}>
                        <CalendarClock size={12} />
                      </IconBtn>
                      <IconBtn label={t('Cancel')} danger onClick={() => window.cm.updateScheduled(r.id, { status: 'cancelled' })}>
                        <X size={13} />
                      </IconBtn>
                    </span>
                  </div>
                  <div className="selectable mt-1 line-clamp-3 text-[12.5px] leading-snug">{r.text}</div>
                  <button
                    onClick={() => void actions.selectWorkspace(r.workspaceId)}
                    className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-mute hover:text-ink"
                  >
                    {branchOf(r.workspaceId)} <GitBranch size={11} />
                  </button>
                </div>
              ))}
            </section>
          ))
        )}
        {done.length > 0 && (
          <section className="mt-3">
            <div className="px-3 pb-1 text-[11px] font-semibold text-mute">{t('Recent')}</div>
            {done.map((r) => {
              const sent = r.status !== 'cancelled'
              return (
                <button
                  key={r.id}
                  disabled={!sent}
                  onClick={() => void openSent(r)}
                  title={sent ? t('Show it in the chat') : undefined}
                  className={cn('sched-row flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-dim', sent && 'hover:bg-white/[.03] hover:text-ink')}
                >
                  {r.status === 'sent' ? <Check size={12} className="text-ok" /> : <X size={12} className={r.status === 'failed' ? 'text-bad' : 'text-mute'} />}
                  <Marquee className="min-w-0 flex-1" delay={300} hoverTarget=".sched-row">
                    <span className={cn(r.status === 'cancelled' && 'line-through')}>{r.text}</span>
                  </Marquee>
                  <span className="shrink-0 tabular-nums text-mute">{hhmm(r.sentAt ?? r.at)}</span>
                </button>
              )
            })}
          </section>
        )}
      </div>
      {editing && (
        <ScheduleDialog
          title={t('Change time')}
          text={editing.text}
          initial={editing.at}
          onSubmit={(at) => window.cm.updateScheduled(editing.id, { at })}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

/**
 * The chat message a scheduled run became: it carries the run's id; runs sent before that link
 * existed are found by their text, the first prompt sent from when the run went out.
 */
async function openSent(r: ScheduledRun) {
  await actions.selectWorkspace(r.workspaceId)
  const index = getState().chatIndex[r.workspaceId] ?? []
  const from = (r.sentAt ?? r.at) - 60_000
  const head = r.text.slice(0, 140)
  const hit = index.find((x) => x.id === r.id) ?? index.find((x) => x.at >= from && x.text.slice(0, 140) === head)
  if (hit) await jumpToMessage(r.workspaceId, hit.id)
}

function IconBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <Tooltip content={label} side="top">
      <button onClick={onClick} aria-label={label} className={cn('grid size-6 place-items-center rounded-md text-mute hover:bg-white/[.06]', danger ? 'hover:text-bad' : 'hover:text-ink')}>
        {children}
      </button>
    </Tooltip>
  )
}
