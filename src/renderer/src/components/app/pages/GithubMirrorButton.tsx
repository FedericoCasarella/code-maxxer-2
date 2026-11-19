import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import { Github } from '../Logos'
import type { GithubMirror, Project } from '@shared/types'
import { cn, timeAgo } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Popover } from '../../affect/popover'
import { Spinner } from '../../affect/spinner'
import { Switch } from '../../affect/switch'
import { Marquee } from '../Marquee'

/** Issues toolbar: per project, mirror issues to GitHub Issues + a GitHub Project board. */
export function GithubMirrorButton({ projects, onSynced }: { projects: Project[]; onSynced: () => void }) {
  const anchor = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [mirrors, setMirrors] = useState<Record<string, GithubMirror>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    const entries = await Promise.all(projects.map(async (p) => [p.id, await window.cm.githubMirror(p.id)] as const))
    setMirrors(Object.fromEntries(entries))
  }
  useEffect(() => {
    void load()
  }, [projects.map((p) => p.id).join(), open])

  const anyOn = Object.values(mirrors).some((m) => m.enabled)
  const act = async (id: string, fn: () => Promise<GithubMirror>) => {
    setBusy(id)
    const m = await fn()
    setMirrors((x) => ({ ...x, [id]: m }))
    setBusy(null)
    onSynced()
  }

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px]', anyOn ? 'border-ok/30 text-ok' : 'border-line text-dim hover:text-ink')}
      >
        {anyOn ? t('Mirrored on GitHub') : t('Mirror to GitHub')} <Github size={13} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="bottom" align="start" width={380} offset={6} unstyled>
        <div className="cm-in rounded-2xl border border-line-strong bg-raised p-3 shadow-2xl">
          <div className="px-1 text-[13px] font-semibold">{t('GitHub mirror')}</div>
          <p className="px-1 pt-0.5 text-[11.5px] leading-snug text-mute">
            {t('Each issue becomes a GitHub Issue on a project board; status stays in sync both ways.')}
          </p>
          <div className="mt-2.5 flex flex-col">
            {projects.length === 0 && <div className="px-1 py-2 text-[12px] text-mute">{t('No projects in this workspace.')}</div>}
            {projects.map((p) => {
              const m = mirrors[p.id]
              return (
                <div key={p.id} className="mirror-row border-t border-line px-1 py-2.5">
                  <div className="flex items-center gap-2">
                    <Marquee className="min-w-0 flex-1 text-[13px] font-medium" delay={300} hoverTarget=".mirror-row">{p.owner ? `${p.owner}/${p.name}` : p.name}</Marquee>
                    {busy === p.id && <Spinner size={12} />}
                    <Switch
                      size="sm"
                      checked={!!m?.enabled}
                      disabled={busy === p.id || !p.owner}
                      onChange={() => void act(p.id, () => window.cm.setGithubMirror(p.id, !m?.enabled))}
                      aria-label={t('Mirror {name} to GitHub', { name: p.name })}
                    />
                  </div>
                  {m?.enabled && (
                    <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-mute">
                      <span>{m.lastSync ? t('Synced {t} ago', { t: timeAgo(m.lastSync) }) : t('Not synced yet')}</span>
                      <button onClick={() => void act(p.id, () => window.cm.syncGithub(p.id))} className="flex items-center gap-1 hover:text-ink">
                        {t('Sync now')} <RefreshCw size={11} />
                      </button>
                      {m.boardUrl && (
                        <button onClick={() => window.open(m.boardUrl!, '_blank')} className="flex items-center gap-1 hover:text-ink">
                          {t('Board')} <ExternalLink size={11} />
                        </button>
                      )}
                      {m.repo && (
                        <button onClick={() => window.open(`https://github.com/${m.repo}/issues?q=label%3Acode-maxxer`, '_blank')} className="flex items-center gap-1 hover:text-ink">
                          {t('Issues')} <ExternalLink size={11} />
                        </button>
                      )}
                    </div>
                  )}
                  {m?.enabled && m.needsScope && (
                    <div className="mt-2 flex gap-2 rounded-lg bg-warn/10 px-2.5 py-2 text-[11.5px] leading-snug text-warn">
                      <TriangleAlert size={13} className="mt-px shrink-0" />
                      <span>
                        {t('Issues are syncing. For the board, give the GitHub CLI access to projects once:')}{' '}
                        <code className="selectable rounded bg-black/30 px-1 font-mono">gh auth refresh -s project</code>
                      </span>
                    </div>
                  )}
                  {m?.error && <div className="selectable mt-2 rounded-lg bg-bad/10 px-2.5 py-1.5 text-[11.5px] text-bad">{m.error}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </Popover>
    </>
  )
}
