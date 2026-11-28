import { useEffect, useState } from 'react'
import { ChevronDown, Circle, CircleCheck, CircleX, GitCommitHorizontal, Rocket } from 'lucide-react'
import type { Deploy } from '@shared/recon'
import { t } from '@/lib/i18n'
import { Accordion } from '../affect/smart-recommendation'
import { Badge } from '../affect/badge'
import { Spinner } from '../affect/spinner'
import { Marquee } from './Marquee'
import { cn, timeAgoLabel } from '@/lib/utils'

type D = Deploy & { env_name: string }
const STATUS: Record<Deploy['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  success: 'Live',
  failed: 'Failed',
  rolled_back: 'Rolled back',
  cancelled: 'Cancelled'
}
const secs = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`)

const TONE: Record<Deploy['status'], string> = {
  queued: 'bg-mute',
  running: 'bg-[#8ab4ff]',
  success: 'bg-ok',
  failed: 'bg-bad',
  rolled_back: 'bg-bad',
  cancelled: 'bg-mute'
}
const BY: Record<Deploy['trigger'], string> = { manual: 'CI/CD', push: 'On push', agent: 'By the agent' }

/** A CI/CD deploy started from the chat, live: one row per step, folds away like the rest of the work. */
export function DeployTracker({ id }: { id: string }) {
  const [d, setD] = useState<D | null>(null)
  useEffect(() => {
    let live = true
    const load = () => void window.cm.recon.deployById(id).then((x) => live && setD(x)).catch(() => {})
    load()
    const off = window.cm.onEvent((e) => {
      if (e.type === 'recon:changed' || (e.type === 'recon:deploy-log' && e.deployId === id)) load()
    })
    return () => {
      live = false
      off()
    }
  }, [id])
  // The environment's earlier deploys: what was live before this one, and how those went
  const [history, setHistory] = useState<Deploy[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const envId = d?.env_id
  const status = d?.status
  useEffect(() => {
    if (!envId) return
    void window.cm.recon.deploys(envId).then((all) => setHistory(all.filter((x) => x.id !== id && Date.parse(x.started_at) <= Date.parse(d!.started_at)))).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId, status])
  // Log lines arrive many per second: refresh the running step's time once a second instead.
  const running = d?.status === 'running' || d?.status === 'queued'
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running) return
    const h = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(h)
  }, [running])
  if (!d) return null

  const total = (d.finished_at ? Date.parse(d.finished_at) : Date.now()) - Date.parse(d.started_at)
  const done = d.steps.filter((s) => s.status === 'success' || s.status === 'skipped').length
  // A step that counts its work (an upload's files) fills its share of the bar as it goes
  const partial = d.steps.reduce((n, s) => n + (s.status === 'running' && s.progress?.total ? s.progress.done / s.progress.total : 0), 0)
  const tone = d.status === 'success' ? 'success' : d.status === 'failed' || d.status === 'rolled_back' ? 'danger' : running ? 'info' : 'neutral'
  return (
    <div className="cm-in">
      {/* The same folding card as the pipeline and the model change */}
      <Accordion
        defaultOpen
        icon={<Rocket size={15} className="shrink-0 text-accent" />}
        title={
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0">{t('Deploy #{n} on {env}', { n: d.number, env: d.env_name })}</span>
            <Badge tone={tone} dot live={running}>{t(STATUS[d.status])}</Badge>
          </span>
        }
        meta={
          <span className="flex items-center gap-2 text-[11.5px] tabular-nums text-mute">
            {/* How far it got, in the header so it shows when the card is folded too */}
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-white/[.08]" role="progressbar" aria-valuemin={0} aria-valuemax={d.steps.length} aria-valuenow={done}>
              <span
                className={cn('block h-full rounded-full transition-[width] duration-500 ease-out', d.status === 'failed' || d.status === 'rolled_back' ? 'bg-bad' : d.status === 'success' ? 'bg-ok' : 'bg-ink')}
                style={{ width: `${d.steps.length ? Math.round(((done + partial) / d.steps.length) * 100) : 0}%` }}
              />
            </span>
            <span>{done}/{d.steps.length}</span>
            <span>{secs(total)}</span>
          </span>
        }
      >
        <div className="flex flex-col gap-0.5 px-2 pb-1">
          {d.error && <div className="selectable mb-1 rounded-lg bg-bad/10 px-2.5 py-1.5 text-[12px] text-bad">{d.error}</div>}
          {d.steps.map((s) => (
            <div key={s.idx} className="flex items-center gap-2.5 py-1.5 text-[13px]">
              {s.status === 'success' ? (
                <CircleCheck size={16} className="shrink-0 text-ok" />
              ) : s.status === 'running' ? (
                <Spinner size={14} />
              ) : s.status === 'failed' ? (
                <CircleX size={16} className="shrink-0 text-bad" />
              ) : (
                <Circle size={16} className="shrink-0 text-mute" />
              )}
              <span className={cn('min-w-0 flex-1 truncate', s.status === 'running' ? 'font-medium text-ink' : s.status === 'skipped' ? 'text-mute line-through' : 'text-dim')}>{s.name}</span>
              {s.progress && s.status === 'running' && <span className="shrink-0 text-[11.5px] tabular-nums text-mute">{t('{done}/{total} files', { done: s.progress.done, total: s.progress.total })}</span>}
              {s.ms != null && <span className="shrink-0 text-[11.5px] tabular-nums text-mute">{secs(s.ms)}</span>}
            </div>
          ))}
        </div>
      </Accordion>
      <div className="mt-1.5 flex items-center gap-3 px-1 text-[12px] text-mute">
        {history.length > 0 && (
          <button onClick={() => setShowHistory((o) => !o)} aria-expanded={showHistory} className="flex items-center gap-1 hover:text-ink">
            {t('History on {env} ({n})', { env: d.env_name, n: history.length })}
            <ChevronDown size={12} className={cn('transition-transform', showHistory && 'rotate-180')} />
          </button>
        )}
      </div>
      {showHistory && (
        <ul className="cm-in mt-1.5 flex flex-col rounded-xl border border-line bg-raised px-1 py-1">
          {history.slice(0, 8).map((x) => (
            <li key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px]">
              <span className={cn('size-1.5 shrink-0 rounded-full', TONE[x.status])} />
              <span className="shrink-0 font-medium tabular-nums text-ink">#{x.number}</span>
              <span className="shrink-0 text-dim">{t(STATUS[x.status])}</span>
              <span className="flex min-w-0 flex-1 items-center gap-1 text-mute">
                {x.commit_sha && <GitCommitHorizontal size={11} className="shrink-0" />}
                <Marquee className="min-w-0" delay={300}>
                  {[x.commit_sha?.slice(0, 7), x.commit_message ?? x.ref].filter(Boolean).join(' · ')}
                </Marquee>
              </span>
              <span className="shrink-0 text-mute">{t(BY[x.trigger] ?? x.trigger)}</span>
              {x.finished_at && <span className="shrink-0 tabular-nums text-mute">{secs(Date.parse(x.finished_at) - Date.parse(x.started_at))}</span>}
              <span className="shrink-0 text-mute">{timeAgoLabel(x.started_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
