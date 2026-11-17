import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Check, CircleSlash, KeyRound, Plus, Rocket, RotateCcw, Square, Trash2, X } from 'lucide-react'
import type { CicdConfig, Deploy, EnvDetail } from '@shared/recon'
import { cn, timeAgo } from '@/lib/utils'
import { SegmentedControl } from '../../../affect/segmented-control'
import { Switch } from '../../../affect/switch'
import { Spinner } from '../../../affect/spinner'
import { EmptyState } from '../../../affect/empty-state'
import { Btn, Card, fmtDur, Pill } from './ui'
import { TextField } from '../../../affect/text-field'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const DEPLOY_STATUS: Record<Deploy['status'], { label: string; c: string }> = {
  queued: { label: 'Queued', c: 'bg-white/[.06] text-dim' },
  running: { label: 'Running', c: 'bg-[#4d8dff]/15 text-[#8ab4ff]' },
  success: { label: 'Live', c: 'bg-ok/12 text-ok' },
  failed: { label: 'Failed', c: 'bg-bad/12 text-bad' },
  rolled_back: { label: 'Rolled back', c: 'bg-warn/12 text-warn' },
  cancelled: { label: 'Cancelled', c: 'bg-white/[.06] text-mute' }
}

export function CicdView({ envs, tick, liveLogs }: { envs: EnvDetail[]; tick: number; liveLogs: Record<string, { step: number; line: string }[]> }) {
  const [envId, setEnvId] = useState<string | null>(envs[0]?.env.id ?? null)
  const env = envs.find((e) => e.env.id === envId)?.env ?? envs[0]?.env
  const [cfg, setCfg] = useState<(CicdConfig & { doc: string }) | null>(null)
  const [yaml, setYaml] = useState('')
  const [deploys, setDeploys] = useState<Deploy[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ step: number; line: string }[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [secretDraft, setSecretDraft] = useState<{ name: string; value: string } | null>(null)

  useEffect(() => {
    if (!env) return
    void window.cm.recon.cicd(env.id).then((c) => {
      setCfg(c)
      setYaml(c.yaml)
    })
    setSel(null)
  }, [env?.id])
  useEffect(() => {
    if (env) void window.cm.recon.deploys(env.id).then(setDeploys)
  }, [env?.id, tick])
  const shown = deploys.find((d) => d.id === sel) ?? deploys[0]
  useEffect(() => {
    if (shown) void window.cm.recon.deployLogs(shown.id).then(setLogs)
    else setLogs([])
  }, [shown?.id, shown?.status])
  const allLogs = shown?.status === 'running' ? [...logs, ...(liveLogs[shown.id] ?? []).slice(0)] : logs
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [allLogs.length])

  if (!env)
    return (
      <div className="py-20">
        <EmptyState title="No environment yet" text="Connect production or staging in Environments first: deploys go to a scanned server." />
      </div>
    )
  const dirty = cfg && yaml !== cfg.yaml
  const running = deploys.find((d) => d.status === 'running')

  const save = async (p: { enabled?: boolean; yaml?: string }) => {
    setErr(null)
    try {
      const c = await window.cm.recon.saveCicd(env.id, p)
      setCfg(c)
      setYaml(c.yaml)
    } catch (e) {
      setErr(clean(e))
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <SegmentedControl size="sm" value={env.id} onChange={setEnvId} aria-label="Environment" options={envs.map((e) => ({ value: e.env.id, label: e.env.name }))} />
        {cfg && (
          <Switch size="sm" label="Enabled" checked={cfg.enabled} onChange={(e) => void save({ enabled: e.target.checked, ...(dirty ? { yaml } : {}) })} />
        )}
        <span className="flex-1" />
        {err && <span className="max-w-[420px] truncate text-[12px] text-bad" title={err}>{err}</span>}
        {running ? (
          <Btn danger onClick={() => void window.cm.recon.cancelDeploy(running.id)}>
            <Square size={12} /> Cancel deploy
          </Btn>
        ) : (
          <Btn
            primary
            disabled={busy || !cfg?.enabled || !cfg.valid || !!dirty}
            title={!cfg?.enabled ? 'Enable the pipeline first' : dirty ? 'Save the YAML first' : undefined}
            onClick={async () => {
              setBusy(true)
              setErr(null)
              try {
                setSel(await window.cm.recon.deploy(env.id))
              } catch (e) {
                setErr(clean(e))
              }
              setBusy(false)
            }}
          >
            {busy ? <Spinner size={11} /> : <Rocket size={13} />} Deploy {env.name}
          </Btn>
        )}
      </div>

      <div className="grid grid-cols-12 gap-3">
        {/* YAML */}
        <Card
          className="col-span-7"
          title="deploy.yml"
          right={
            <>
              {cfg && (cfg.valid ? <span className="flex items-center gap-1 text-[11.5px] text-ok"><Check size={12} /> Valid</span> : <span className="flex items-center gap-1 text-[11.5px] text-bad"><AlertCircle size={12} /> {cfg.errors.length} problem{cfg.errors.length === 1 ? '' : 's'}</span>)}
              <Btn className="h-7" disabled={!dirty} onClick={() => setYaml(cfg!.yaml)}>Revert</Btn>
              <Btn primary className="h-7" disabled={!dirty} onClick={() => void save({ yaml })}>Save</Btn>
            </>
          }
        >
          <textarea
            value={yaml}
            onChange={(e) => setYaml(e.target.value)}
            spellCheck={false}
            className="selectable mx-3 h-[440px] resize-none rounded-xl border border-line bg-[#0c0c0e] p-4 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-line-strong"
          />
          {cfg && !cfg.valid && (
            <ul className="mx-3 mt-2 flex flex-col gap-1">
              {cfg.errors.map((e) => (
                <li key={e} className="flex items-start gap-1.5 text-[12px] text-bad"><X size={12} className="mt-0.5 shrink-0" /> {e}</li>
              ))}
            </ul>
          )}
          <details className="mx-3 mb-3 mt-2 text-[12px] text-mute">
            <summary className="cursor-pointer hover:text-dim">Format</summary>
            <pre className="selectable mt-2 whitespace-pre-wrap font-sans leading-relaxed">{cfg?.doc}</pre>
          </details>
        </Card>

        <div className="col-span-5 flex min-w-0 flex-col gap-3">
          {/* secrets */}
          <Card
            title={<><KeyRound size={13} /> Secrets</>}
            right={<Btn className="h-7" onClick={() => setSecretDraft({ name: '', value: '' })}><Plus size={12} /> Add</Btn>}
          >
            <div className="flex flex-col px-2 pb-2">
              {cfg?.secrets.length === 0 && !secretDraft && <div className="px-2 py-3 text-[12px] text-mute">Encrypted on this Mac, masked in logs. Reference them by name.</div>}
              {cfg?.secrets.map((s) => (
                <div key={s} className="group flex h-8 items-center gap-2 rounded-lg px-2 font-mono text-[12px] hover:bg-white/[.03]">
                  {s}
                  <span className="text-mute">= •••••••</span>
                  <button
                    onClick={async () => setCfg({ ...cfg, secrets: await window.cm.recon.setSecret(env.id, s, null) })}
                    aria-label={`Delete ${s}`}
                    className="ml-auto grid size-6 place-items-center rounded-md text-mute opacity-0 hover:bg-bad/10 hover:text-bad group-hover:opacity-100"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              {secretDraft && (
                <form
                  className="flex items-center gap-1.5 px-1 py-1"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    try {
                      const names = await window.cm.recon.setSecret(env.id, secretDraft.name.trim(), secretDraft.value)
                      setCfg(cfg && { ...cfg, secrets: names })
                      setSecretDraft(null)
                    } catch (er) {
                      setErr(clean(er))
                    }
                  }}
                >
                  <TextField size="md" className="w-36" inputClassName="font-mono" aria-label="Secret name" autoFocus placeholder="NAME" value={secretDraft.name} onChange={(e) => setSecretDraft({ ...secretDraft, name: e.target.value.toUpperCase() })} />
                  <TextField size="md" type="password" className="min-w-0 flex-1" inputClassName="font-mono" aria-label="Secret value" placeholder="value" value={secretDraft.value} onChange={(e) => setSecretDraft({ ...secretDraft, value: e.target.value })} />
                  <Btn primary className="h-8" disabled={!secretDraft.name.trim() || !secretDraft.value}>Save</Btn>
                  <Btn className="h-8 px-2" type="button" onClick={() => setSecretDraft(null)}><X size={13} /></Btn>
                </form>
              )}
            </div>
          </Card>

          {/* history */}
          <Card title="Deploys" className="min-h-0">
            <div className="flex max-h-[220px] flex-col overflow-y-auto px-2 pb-2">
              {deploys.length === 0 && <div className="px-2 py-3 text-[12px] text-mute">No deploys yet.</div>}
              {deploys.map((d) => (
                <button key={d.id} onClick={() => setSel(d.id)} className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-white/[.03]', shown?.id === d.id && 'bg-white/[.05]')}>
                  <span className="w-7 shrink-0 font-mono text-[11px] text-mute">#{d.number}</span>
                  <span className="min-w-0 flex-1 truncate">{d.commit_message || d.ref}</span>
                  <span className="font-mono text-[11px] text-mute">{d.commit_sha?.slice(0, 7)}</span>
                  <Pill className={DEPLOY_STATUS[d.status].c}>{d.status === 'running' && <Spinner size={9} />}{DEPLOY_STATUS[d.status].label}</Pill>
                  <span className="w-8 shrink-0 text-right text-[11px] text-mute">{timeAgo(d.started_at)}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* selected deploy: steps + log */}
        {shown && (
          <Card
            className="col-span-12"
            title={
              <span className="flex items-center gap-2">
                Deploy #{shown.number} <Pill className={DEPLOY_STATUS[shown.status].c}>{DEPLOY_STATUS[shown.status].label}</Pill>
                <span className="font-normal text-mute">{shown.trigger} · {shown.ref}{shown.release_id ? ` · release ${shown.release_id}` : ''}</span>
              </span>
            }
            right={shown.finished_at && <span className="text-[11.5px] tabular-nums text-mute">{fmtDur(new Date(shown.finished_at).getTime() - new Date(shown.started_at).getTime())}</span>}
          >
            <div className="flex flex-wrap gap-1.5 px-4 pb-3">
              {shown.steps.map((s) => (
                <span
                  key={s.idx}
                  className={cn(
                    'flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11.5px]',
                    s.status === 'success' ? 'border-ok/30 text-ok' : s.status === 'failed' ? 'border-bad/40 text-bad' : s.status === 'running' ? 'border-[#4d8dff]/40 text-[#8ab4ff]' : 'border-line text-mute'
                  )}
                >
                  {s.status === 'running' ? <Spinner size={10} /> : s.status === 'success' ? <Check size={11} /> : s.status === 'failed' ? <X size={11} /> : s.status === 'skipped' ? <CircleSlash size={11} /> : <span className="size-1.5 rounded-full bg-current" />}
                  {s.name}
                  {s.ms !== null && <span className="tabular-nums text-mute">{fmtDur(s.ms)}</span>}
                </span>
              ))}
            </div>
            {shown.error && (
              <div className="mx-4 mb-2 flex items-center gap-2 text-[12px] text-bad">
                {shown.status === 'rolled_back' ? <RotateCcw size={12} /> : <AlertCircle size={12} />} {shown.error}
              </div>
            )}
            <div ref={logRef} className="selectable mx-3 mb-3 h-[260px] overflow-y-auto rounded-xl border border-line bg-[#0c0c0e] px-3 py-2 font-mono text-[11.5px] leading-relaxed">
              {allLogs.length === 0 && <span className="text-mute">No output yet.</span>}
              {allLogs.map((l, i) => (
                <div key={i} className={cn('whitespace-pre-wrap break-words', l.line.startsWith('$ ') ? 'mt-1 text-[#8ab4ff]' : l.line.startsWith('✗') ? 'text-bad' : l.line.startsWith('↩') ? 'text-warn' : 'text-dim')}>
                  <span className="mr-2 select-none text-mute">{String(l.step + 1).padStart(2, ' ')}</span>
                  {l.line}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
