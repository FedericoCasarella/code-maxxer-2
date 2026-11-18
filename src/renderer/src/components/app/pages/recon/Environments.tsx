import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePersisted } from '@/lib/persist'
import { Bot, Check, FileSearch, HeartPulse, Lock, Pencil, Play, Plug, Server, Settings2, Trash2, X } from 'lucide-react'
import type { EnvDetail, EnvInput, EnvKind, ReconEnv, SessionKind, SessionLog } from '@shared/recon'
import { cn, timeAgo } from '@/lib/utils'
import { SegmentedControl } from '../../../affect/segmented-control'
import { Select } from '../../../affect/select'
import { TextField } from '../../../affect/text-field'
import { TextArea } from '../../../affect/text-area'
import { NumberInput } from '../../../affect/number-input'
import { Switch } from '../../../affect/switch'
import { Spinner } from '../../../affect/spinner'
import { Card as AffectCard, CardFooter, CardHeader } from '../../../affect/card'
import { Button } from '../../../affect/button'
import { ConfirmDialog } from '../../ConfirmDialog'
import { Btn, Card, Dot, Md, Modal, Pill, STATE } from './ui'

const STEPS: { kind: SessionKind; title: string; text: string; icon: typeof Plug }[] = [
  { kind: 'connection', title: 'Connection', text: 'Log in over SSH/SFTP with the saved credentials', icon: Plug },
  { kind: 'agent_test', title: 'Agent', text: 'Check the local agent answers before it reads the server', icon: Bot },
  { kind: 'recon', title: 'Survey', text: 'Read-only survey of the server, summarised into a profile', icon: FileSearch },
  { kind: 'health_check', title: 'Health check', text: 'Health URL, load, disk and memory', icon: HeartPulse }
]
const KINDS: EnvKind[] = ['production', 'staging']

export function EnvironmentsView({ projectId, envs, liveLogs, onChanged }: {
  projectId: string; envs: EnvDetail[]; liveLogs: Record<string, SessionLog[]>; onChanged: () => void
}) {
  const [editing, setEditing] = useState<{ kind: EnvKind; env: ReconEnv | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="grid grid-cols-2 gap-3">
      {KINDS.map((kind) => {
        const d = envs.find((e) => e.env.kind === kind)
        return d ? (
          <EnvCard key={kind} d={d} liveLogs={liveLogs} onEdit={() => setEditing({ kind, env: d.env })} onError={setError} onChanged={onChanged} />
        ) : (
          <Card key={kind} className="min-h-[320px] items-center justify-center border-dashed">
            <span className="grid size-11 place-items-center rounded-2xl border border-line bg-panel text-dim">
              <Server size={18} />
            </span>
            <div className="mt-3 text-[14px] font-semibold capitalize">{kind}</div>
            <p className="mt-1 max-w-[320px] text-balance text-center text-[12.5px] text-mute">
              Connect the {kind} server: Recon scans it before using it, then monitors it and deploys to it.
            </p>
            <div className="mt-4">
              <Btn primary onClick={() => setEditing({ kind, env: null })}>
                Connect {kind} <Plug size={13} />
              </Btn>
            </div>
          </Card>
        )
      })}
      {editing && (
        <EnvDialog
          projectId={projectId}
          kind={editing.kind}
          env={editing.env}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            onChanged()
          }}
        />
      )}
      {error && (
        <div className="fixed bottom-14 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-bad/40 bg-raised px-3.5 py-2 text-[12.5px] text-bad shadow-xl">
          {error}
          <button onClick={() => setError(null)} aria-label="Dismiss" className="text-mute hover:text-ink">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function EnvCard({ d, liveLogs, onEdit, onError, onChanged }: { d: EnvDetail; liveLogs: Record<string, SessionLog[]>; onEdit: () => void; onError: (e: string) => void; onChanged: () => void }) {
  const { env, steps, sessions } = d
  const st = STATE[env.monitor_state]
  const running = sessions.find((s) => s.status === 'running')
  const [shown, setShown] = useState<string | null>(null)
  const [del, setDel] = useState(false)
  const ses = sessions.find((s) => s.id === (shown ?? running?.id)) ?? sessions[0]
  const logs = ses ? [...ses.logs, ...(ses.status === 'running' ? liveLogs[ses.id] ?? [] : [])] : []
  const consoleRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    consoleRef.current?.scrollTo({ top: consoleRef.current.scrollHeight })
  }, [logs.length])

  const runStep = async (kind: SessionKind) => {
    try {
      const id = await window.cm.recon.scan(env.id, kind)
      setShown(id)
      onChanged()
    } catch (e) {
      onError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const lastOf = (k: SessionKind) => sessions.find((s) => s.kind === k)

  return (
    <Card
      title={
        <span className="flex items-center gap-2 text-ink">
          <Dot className={st.dot} pulse={env.monitor_state === 'down'} />
          <span className="text-[13.5px] font-semibold">{env.name}</span>
          <Pill className={env.kind === 'production' ? 'bg-accent/15 text-accent' : 'bg-white/[.06] text-dim'}>{env.kind}</Pill>
        </span>
      }
      right={
        <>
          <span className={cn('text-[11.5px]', st.text)}>{st.label}</span>
          <button onClick={onEdit} aria-label="Configure" title="Configure" className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
            <Settings2 size={14} />
          </button>
          <button onClick={() => setDel(true)} aria-label="Remove" title="Remove" className="grid size-7 place-items-center rounded-md text-mute hover:bg-bad/10 hover:text-bad">
            <Trash2 size={13} />
          </button>
        </>
      }
    >
      <div className="flex items-center gap-2 px-4 pb-3 font-mono text-[11.5px] text-dim">
        <Lock size={11} className="text-mute" />
        {env.protocol} · {env.username}@{env.host}:{env.port}
        {env.workdir && <span className="truncate text-mute">· {env.workdir}</span>}
        <span className="flex-1" />
        <Pill className={env.connection_status === 'profiled' ? 'bg-ok/12 text-ok' : env.connection_status === 'verified' ? 'bg-[#4d8dff]/15 text-[#8ab4ff]' : 'bg-warn/12 text-warn'}>
          {env.connection_status === 'profiled' ? 'Scanned' : env.connection_status === 'verified' ? 'Connected' : 'Not scanned'}
        </Pill>
      </div>

      {/* gated scan steps */}
      <div className="mx-3 flex flex-col rounded-xl border border-line bg-panel/60 p-1">
        {STEPS.map((s, i) => {
          const done = steps[s.kind]
          const last = lastOf(s.kind)
          const isRunning = running?.kind === s.kind
          const locked = i > 0 && !steps[STEPS[i - 1].kind]
          const Icon = s.icon
          return (
            <div key={s.kind} className={cn('group flex items-center gap-3 rounded-lg px-2.5 py-2', last && 'cursor-pointer hover:bg-white/[.03]')} onClick={() => last && setShown(last.id)}>
              <span
                className={cn(
                  'grid size-7 shrink-0 place-items-center rounded-full border',
                  done ? 'border-ok/40 bg-ok/12 text-ok' : last?.ok === false ? 'border-bad/40 bg-bad/10 text-bad' : 'border-line text-mute'
                )}
              >
                {isRunning ? <Spinner size={12} /> : done ? <Check size={13} /> : last?.ok === false ? <X size={13} /> : <Icon size={13} />}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className={cn('text-[12.5px] font-medium', locked && 'text-mute')}>
                  {i + 1}. {s.title}
                </div>
                <div className="truncate text-[11.5px] text-mute">{last?.summary && !isRunning ? last.summary : s.text}</div>
              </div>
              {last?.finished_at && <span className="text-[11px] text-mute">{timeAgo(last.finished_at)}</span>}
              <Btn
                className="h-7 px-2.5"
                disabled={locked || !!running}
                title={locked ? `Finish "${STEPS[i - 1].title}" first` : undefined}
                onClick={(e) => {
                  e.stopPropagation()
                  void runStep(s.kind)
                }}
              >
                <Play size={11} /> {done ? 'Rerun' : 'Run'}
              </Btn>
            </div>
          )
        })}
      </div>

      {/* console */}
      <div className="m-3 flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-[#0c0c0e]">
        <div className="flex h-8 items-center gap-2 border-b border-line px-3 text-[11px] text-mute">
          <span className="font-mono">{ses ? `${ses.kind.replace('_', ' ')} · ${ses.status}` : 'console'}</span>
          {ses?.status === 'running' && <Spinner size={10} />}
          <span className="flex-1" />
          {ses?.cost_usd ? <span className="tabular-nums">${ses.cost_usd.toFixed(3)}</span> : null}
        </div>
        <div ref={consoleRef} className="selectable h-[220px] overflow-y-auto px-3 py-2 font-mono text-[11.5px] leading-relaxed">
          {!ses && <span className="text-mute">Run step 1 to start the scan.</span>}
          {logs.map((l, i) =>
            l.type === 'text' ? (
              <div key={i} className="my-2 rounded-lg bg-white/[.03] p-3 font-sans">
                <Md>{l.content}</Md>
              </div>
            ) : (
              <div key={i} className={cn('whitespace-pre-wrap break-words', l.type === 'cmd' ? 'mt-1.5 text-[#8ab4ff]' : l.type === 'err' ? 'text-bad' : l.type === 'info' ? 'text-accent' : 'text-dim')}>
                {l.type === 'cmd' ? `▸ ${l.content}` : l.content}
              </div>
            )
          )}
        </div>
      </div>

      {env.profile_summary && (
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg bg-ok/[.06] px-3 py-2 text-[12px] text-dim">
          <FileSearch size={13} className="shrink-0 text-ok" />
          <span className="truncate">{env.profile_summary}</span>
          {env.profile_md && (
            <button onClick={() => setShown(sessions.find((s) => s.kind === 'recon' && s.ok)?.id ?? null)} className="ml-auto shrink-0 text-[11.5px] text-mute hover:text-ink">
              Profile
            </button>
          )}
        </div>
      )}
      {del && (
        <ConfirmDialog
          title={`Remove ${env.name}?`}
          confirmLabel="Remove"
          danger
          onClose={() => setDel(false)}
          onConfirm={async () => {
            setDel(false)
            await window.cm.recon.deleteEnv(env.id)
            onChanged()
          }}
        >
          Its credentials, scans, uptime history and CI/CD config are deleted. The server itself is not touched.
        </ConfirmDialog>
      )}
    </Card>
  )
}

type Tab = 'access' | 'monitor' | 'rules'

function EnvDialog({ projectId, kind, env, onClose, onSaved }: { projectId: string; kind: EnvKind; env: ReconEnv | null; onClose: () => void; onSaved: () => void }) {
  const [tab, setTab] = usePersisted<Tab>('recon.envTab', 'access')
  const [f, setF] = useState<EnvInput>({
    project_id: projectId, kind,
    name: env?.name ?? (kind === 'production' ? 'Production' : 'Staging'),
    protocol: env?.protocol ?? 'ssh', host: env?.host ?? '', port: env?.port ?? 22, username: env?.username ?? '',
    auth_method: env?.auth_method ?? 'agent', key_path: env?.key_path ?? '~/.ssh/id_ed25519', workdir: env?.workdir ?? '',
    rules: env?.rules ?? '', health_url: env?.health_url ?? '', monitor_enabled: env?.monitor_enabled ?? false,
    interval_sec: env?.interval_sec ?? 60, expected_status: env?.expected_status ?? null
  })
  const [key, setKey] = useState('')
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [test, setTest] = useState<{ sig: string; state: 'running' | 'ok' | 'fail'; output: string; ms?: number } | null>(null)
  const set = (p: Partial<EnvInput>) => setF({ ...f, ...p })

  // What the connection depends on: any change means it has to be tested again.
  const access = (x: { protocol?: string; host?: string; port?: number; username?: string; auth_method?: string; key_path?: string | null; workdir?: string }, k: string, pw: string) =>
    JSON.stringify([x.protocol, x.host, x.port, x.username, x.auth_method, x.auth_method === 'key_path' ? x.key_path : '', x.protocol !== 'ssh' ? x.workdir : '', k, pw])
  const sig = access(f, key.trim(), pass)
  const unchanged = !!env && env.connection_status !== 'unverified' && sig === access(env, '', '')
  const complete =
    !!f.host?.trim() && !!f.username?.trim() && !!f.port &&
    (f.auth_method === 'agent' ||
      (f.auth_method === 'key_path' && !!f.key_path?.trim()) ||
      (f.auth_method === 'key' && (!!key.trim() || !!env?.has_key)) ||
      (f.auth_method === 'password' && (!!pass || !!env?.has_password)))
  const tested = unchanged || (test?.sig === sig && test.state === 'ok')
  const secrets = {
    ...(f.auth_method === 'key' && key.trim() ? { private_key: key } : {}),
    ...(f.auth_method === 'password' && pass ? { password: pass } : {})
  }
  const runTest = async () => {
    const at = sig
    setTest({ sig: at, state: 'running', output: '' })
    try {
      const r = await window.cm.recon.testAccess({ ...f, key_path: f.auth_method === 'key_path' ? f.key_path : null, ...secrets })
      setTest({ sig: at, state: r.ok ? 'ok' : 'fail', output: r.output, ms: r.ms })
    } catch (e) {
      setTest({ sig: at, state: 'fail', output: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }
  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      const saved = await window.cm.recon.saveEnv({
        ...f,
        key_path: f.auth_method === 'key_path' ? f.key_path : null,
        health_url: f.health_url?.trim() || null,
        ...secrets
      })
      // The test just passed: record it as the first scan step, so the environment starts verified.
      if (!unchanged) await window.cm.recon.scan(saved.id, 'connection').catch(() => {})
      onSaved()
    } catch (e) {
      setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }
  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          {env ? <Pencil size={14} /> : <Plug size={14} />} {env ? `Configure ${env.name}` : `Connect ${kind}`}
        </span>
      }
      onClose={onClose}
      width={600}
      footer={
        <>
          {err && <span className="mr-auto self-center text-[12px] text-bad">{err}</span>}
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn primary disabled={busy || !complete || !tested} title={!tested ? 'Test the connection first' : undefined} onClick={() => void save()}>
            Save {busy && <Spinner size={11} />}
          </Btn>
        </>
      }
    >
      <SegmentedControl
        size="sm"
        value={tab}
        onChange={setTab}
        aria-label="Section"
        options={[
          { value: 'access', label: 'Access' },
          { value: 'monitor', label: 'Monitor' },
          { value: 'rules', label: 'Rules' }
        ]}
      />
      {tab === 'access' && (
        <div className="mt-4 grid grid-cols-6 gap-3">
          <TextField className="col-span-4" label="Name" value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          <Select
            className="col-span-2"
            label="Protocol"
            value={f.protocol}
            options={[
              { value: 'ssh', label: 'SSH', description: 'Shell + files' },
              { value: 'sftp', label: 'SFTP', description: 'Files only' },
              { value: 'ftp', label: 'FTP', description: 'Files only' }
            ]}
            onChange={(v) => {
              const protocol = v as EnvInput['protocol']
              // FTP logs in with a password only; the port follows the protocol unless it was customised.
              set({
                protocol,
                port: protocol === 'ftp' ? (f.port === 22 ? 21 : f.port) : f.port === 21 ? 22 : f.port,
                auth_method: protocol === 'ftp' ? 'password' : f.auth_method
              })
            }}
          />
          <TextField className="col-span-4" label="Host" placeholder="203.0.113.10 or server.example.com" value={f.host ?? ''} onChange={(e) => set({ host: e.target.value.trim() })} />
          <NumberInput className="col-span-2" label="Port" min={1} max={65535} value={f.port ?? 22} onValueChange={(v) => set({ port: v ?? 22 })} />
          <TextField className="col-span-3" label="User" placeholder="deploy" value={f.username ?? ''} onChange={(e) => set({ username: e.target.value.trim() })} />
          <Select
            className="col-span-3"
            label="Authentication"
            value={f.auth_method}
            options={[
              ...(f.protocol === 'ftp'
                ? []
                : [
                    { value: 'agent', label: 'SSH agent', description: 'Keys already loaded on this Mac' },
                    { value: 'key_path', label: 'Key file', description: 'A private key on this Mac' },
                    { value: 'key', label: 'Paste a key', description: 'Stored encrypted (AES-256)' }
                  ]),
              { value: 'password', label: 'Password', description: 'Stored encrypted (AES-256)' }
            ]}
            onChange={(v) => set({ auth_method: v as EnvInput['auth_method'] })}
          />
          {f.auth_method === 'key_path' && (
            <TextField className="col-span-6" label="Key path" value={f.key_path ?? ''} onChange={(e) => set({ key_path: e.target.value })} hint="Absolute path, e.g. /Users/you/.ssh/id_ed25519" />
          )}
          {f.auth_method === 'key' && (
            <TextArea
              className="col-span-6"
              label="Private key"
              minRows={4}
              maxRows={8}
              placeholder={env?.has_key ? 'A key is saved. Paste a new one to replace it.' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              hint="Encrypted on this Mac; written to a 0600 temp file only while a command runs."
            />
          )}
          {f.auth_method === 'password' && (
            <TextField
              className="col-span-6"
              label="Password"
              type="password"
              autoComplete="new-password"
              placeholder={env?.has_password ? 'A password is saved. Type a new one to replace it.' : ''}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
          <TextField className="col-span-6" label="App folder" placeholder="/var/www/app" value={f.workdir ?? ''} onChange={(e) => set({ workdir: e.target.value })} hint="Where the app lives: the survey looks here and CI/CD releases go here." />
        </div>
      )}
      {tab === 'monitor' && (
        <div className="mt-4 grid grid-cols-6 gap-3">
          <div className="col-span-6">
            <Switch label="Uptime monitor" description="Probe the health URL; three failures in a row open a downtime and an incident." checked={!!f.monitor_enabled} onChange={(e) => set({ monitor_enabled: e.target.checked })} />
          </div>
          <TextField className="col-span-6" label="Health URL" placeholder="https://example.com/health" value={f.health_url ?? ''} onChange={(e) => set({ health_url: e.target.value })} />
          <NumberInput className="col-span-3" label="Every" unit="sec" min={15} max={3600} step={15} value={f.interval_sec ?? 60} onValueChange={(v) => set({ interval_sec: v ?? 60 })} />
          <NumberInput className="col-span-3" label="Expected status" optional min={100} max={599} value={f.expected_status ?? null} onValueChange={(v) => set({ expected_status: v })} hint="Empty: any status below 400" />
        </div>
      )}
      {tab === 'rules' && (
        <div className="mt-4">
          <TextArea
            label="Rules for the agent"
            minRows={8}
            maxRows={16}
            placeholder={'- Never restart the database\n- The app runs under pm2 as "web"\n- Maintenance window: Sunday 02:00–04:00'}
            value={f.rules ?? ''}
            onChange={(e) => set({ rules: e.target.value })}
            hint="Read by the survey and by incident diagnosis. The agent only ever reads the server."
          />
        </div>
      )}
      {complete && !unchanged && <TestAlert state={test?.sig === sig ? test : null} onTest={() => void runTest()} />}
    </Modal>
  )
}

/** One short line from the server's error, without the tool prefix. */
const reason = (out?: string) =>
  (out?.trim().split('\n').filter(Boolean).pop() ?? '').replace(/^(curl|ssh|sftp): (\(\d+\) )?/, '').replace(/^./, (c) => c.toUpperCase()) || 'Check host, port, user and credentials.'

/** Shown once every access field is filled: test the login before the environment can be saved. */
function TestAlert({ state, onTest }: { state: { state: 'running' | 'ok' | 'fail'; output: string; ms?: number } | null; onTest: () => void }) {
  const s = state?.state
  return (
    <AffectCard role="status" className="cm-in mt-5" style={{ '--ui-crd-tray': 'rgba(255,255,255,.06)', marginTop: 20 } as CSSProperties}>
      <CardHeader
        icon={
          <span className={s === 'ok' ? 'text-ok' : s === 'fail' ? 'text-bad' : undefined}>
            {s === 'running' ? <Spinner size={16} /> : s === 'ok' ? <Check size={16} /> : s === 'fail' ? <X size={16} /> : <Plug size={16} />}
          </span>
        }
        title={s === 'ok' ? 'Connection works' : s === 'fail' ? 'Could not connect' : s === 'running' ? 'Testing the connection…' : 'Test connection'}
        description={
          s === 'ok'
            ? `Logged in${state?.ms ? ` in ${(state.ms / 1000).toFixed(1)}s` : ''}. You can save now.`
            : s === 'fail'
              ? reason(state?.output)
              : 'Log in once before saving.'
        }
      />
      <CardFooter style={{ justifyContent: 'flex-end', padding: '10px 0 6px' }}>
        <Button size="sm" variant={s === 'ok' ? 'secondary' : 'primary'} disabled={s === 'running'} iconRight={<Plug size={13} />} onClick={onTest}>
          {s === 'ok' || s === 'fail' ? 'Test again' : 'Test connection'}
        </Button>
      </CardFooter>
    </AffectCard>
  )
}
