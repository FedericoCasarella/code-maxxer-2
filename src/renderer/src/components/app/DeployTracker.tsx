import { useEffect, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { Deploy } from '@shared/recon'
import { t } from '@/lib/i18n'
import { actions } from '@/lib/store'
import { ProgressTracker } from '../affect/progress-tracker'
import { Marquee } from './Marquee'

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
  const steps = d.steps.map((s) => ({
    id: String(s.idx),
    label: s.name,
    done: s.status === 'success',
    state: s.status === 'running' ? ('running' as const) : s.status === 'failed' ? ('failed' as const) : s.status === 'skipped' ? ('skipped' as const) : undefined,
    meta: s.ms != null ? secs(s.ms) : undefined
  }))
  return (
    <div className="cm-in max-w-[520px]">
      <ProgressTracker
        readOnly
        collapsible
        defaultOpen
        title={t('Deploy #{n} on {env}', { n: d.number, env: d.env_name })}
        subtitle={
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={d.status === 'success' ? 'text-ok' : d.status === 'failed' || d.status === 'rolled_back' ? 'text-bad' : undefined}>{t(STATUS[d.status])}</span>
            <span>· {secs(total)}</span>
            {d.error && (
              <span className="min-w-0 flex-1 text-bad">
                <Marquee delay={300}>· {d.error}</Marquee>
              </span>
            )}
          </span>
        }
        steps={steps}
        className="cm-deploy-tracker"
      />
      <button onClick={() => actions.openReconCicd()} className="mt-1.5 flex items-center gap-1 px-1 text-[12px] text-mute hover:text-ink">
        {t('Open in CI/CD')} <ArrowUpRight size={12} />
      </button>
    </div>
  )
}
