import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { usePersisted } from '@/lib/persist'
import { Bot, Check, MoreHorizontal, SquareTerminal, CircleAlert, FileSearch, HeartPulse, Pencil, Play, Plug, Server, Settings2, Trash2, X } from 'lucide-react'
import type { EnvDetail, EnvInput, EnvKind, ReconEnv, SessionKind, SessionLog } from '@shared/recon'
import { cn } from '@/lib/utils'
import { locale, t } from '@/lib/i18n'
import { SegmentedControl } from '../../../affect/segmented-control'
import { Select } from '../../../affect/select'
import { TextField } from '../../../affect/text-field'
import { TextArea } from '../../../affect/text-area'
import { NumberInput } from '../../../affect/number-input'
import { Switch } from '../../../affect/switch'
import { Spinner } from '../../../affect/spinner'
import { Card as AffectCard, CardFooter, CardHeader } from '../../../affect/card'
import { Button } from '../../../affect/button'
import { Badge } from '../../../affect/badge'
import { UptimeBars } from './UptimeBars'
import { Accordion } from '../../../affect/smart-recommendation'
import { IconButton } from '../../../affect/icon-button'
import { DropdownMenu } from '../../../affect/dropdown-menu'
import { Marquee } from '../../Marquee'
import { ConfirmDialog } from '../../ConfirmDialog'
import { SwitchCallout } from '../../SwitchCallout'
import { Btn, Card, Dot, Md, Modal, STATE } from './ui'

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
            <div className="mt-3 text-[14px] font-semibold capitalize">{t(kind)}</div>
            <p className="mt-1 max-w-[320px] text-balance text-center text-[12.5px] text-mute">
              {t('Connect the {kind} server: Recon scans it before using it, then monitors it and deploys to it.', { kind: t(kind) })}
            </p>
            <div className="mt-4">
              <Btn primary onClick={() => setEditing({ kind, env: null })}>
                {t('Connect {kind}', { kind: t(kind) })} <Plug size={13} />
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
          <button onClick={() => setError(null)} aria-label={t('Dismiss')} className="text-mute hover:text-ink">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}

function EnvCard({ d, liveLogs, onEdit, onError, onChanged }: { d: EnvDetail; liveLogs: Record<string, SessionLog[]>; onEdit: () => void; onError: (e: string) => void; onChanged: () => void }) {
  const { env, steps, sessions, uptime24h } = d
  const st = STATE[env.monitor_state]
  const running = sessions.find((s) => s.status === 'running')
  const [shown, setShown] = useState<string | null>(null)
  const [del, setDel] = useState(false)
  const [out, setOut] = usePersisted(`recon.output.${env.id}`, false)
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
  const runAll = async () => {
    try {
      const id = await window.cm.recon.scanAll(env.id)
      if (id) setShown(null), setOut(true)
      onChanged()
    } catch (e) {
      onError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const lastOf = (k: SessionKind) => sessions.find((s) => s.kind === k)

  return (
    <AffectCard className="min-w-0" style={{ '--ui-crd-tray': 'rgba(255,255,255,.06)', '--ui-crd-pad': '6px' } as CSSProperties}>
      {/* Tray header (shown above the card): name and a menu, nothing else */}
      <CardFooter style={{ order: -1, padding: '0 0 4px 10px', minHeight: 36 }}>
        <Dot className={st.dot} pulse={env.monitor_state === 'down'} />
        <Marquee className="min-w-0 flex-1 text-[13px] font-medium text-ink" delay={300}>{env.name}</Marquee>
        {env.monitor_enabled && (
          <Badge tone={env.monitor_state === 'up' ? 'success' : 'danger'} dot>
            {env.last_ok_at
              ? t('Last uptime {at}', { at: new Date(env.last_ok_at).toLocaleString(locale(), { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) })
              : t('No uptime yet')}
          </Badge>
        )}
        <DropdownMenu
          align="end"
          width={180}
          items={[
            { label: t('Configure'), icon: <Settings2 size={14} />, onSelect: onEdit },
            { label: t('Delete'), icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => setDel(true) }
          ]}
          trigger={({ triggerProps }) => <IconButton {...triggerProps} size="sm" variant="ghost" label={t('More')} icon={<MoreHorizontal size={14} />} />}
        />
      </CardFooter>

      {/* Gated scan steps */}
      <div className="flex flex-col">
        {STEPS.map((s, i) => {
          const done = steps[s.kind]
          const last = lastOf(s.kind)
          const isRunning = running?.kind === s.kind
          const locked = i > 0 && !steps[STEPS[i - 1].kind]
          return (
            <div
              key={s.kind}
              className={cn('flex items-center gap-3 rounded-xl px-2.5 py-2', last && 'cursor-pointer hover:bg-white/[.03]', ses?.id === last?.id && last && 'bg-white/[.04]')}
              onClick={() => last && (setShown(last.id), setOut(true))}
            >
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-md text-[12px] tabular-nums',
                  done ? 'bg-ok/15 text-ok' : last?.ok === false ? 'bg-bad/15 text-bad' : 'bg-white/[.06] text-dim'
                )}
              >
                {isRunning ? <Spinner size={11} /> : done ? <Check size={12} /> : last?.ok === false ? <X size={12} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('text-[13px] leading-5', locked ? 'text-mute' : 'text-ink')}>{t(s.title)}</div>
                <Marquee className="text-[12px] leading-4 text-mute" delay={300}>
                  {last?.summary && !isRunning ? last.summary : t(s.text)}
                </Marquee>
              </div>
              {i === 0 && STEPS.some((x) => !steps[x.kind]) && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!!running}
                  iconRight={<Play size={12} />}
                  onClick={(e) => {
                    e.stopPropagation()
                    void runAll()
                  }}
                >
                  {t('Test all')}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={locked || !!running}
                iconRight={<Play size={12} />}
                onClick={(e) => {
                  e.stopPropagation()
                  void runStep(s.kind)
                }}
              >
                {done ? t('Rerun') : t('Run')}
              </Button>
            </div>
          )
        })}
      </div>

      {uptime24h && <UptimeBars title={t('Uptime, last 24 hours')} buckets={uptime24h} span="hour" />}

      {/* Output of the selected step: closed by default, opens and closes animated */}
      {ses && (
        <Accordion className="mb-1" title={t('Output')} icon={<SquareTerminal size={16} />} open={out} onOpenChange={setOut}>
          <div ref={consoleRef} className="selectable h-[200px] overflow-y-auto rounded-xl bg-black/30 px-3 py-2 font-mono text-[11.5px] leading-relaxed">
            {logs.map((l, i) =>
              l.type === 'text' ? (
                <div key={i} className="my-2 rounded-lg bg-white/[.03] p-3 font-sans">
                  <Md>{l.content}</Md>
                </div>
              ) : (
                <div key={i} className={cn('whitespace-pre-wrap break-words', l.type === 'cmd' ? 'mt-1.5 text-[#8ab4ff]' : l.type === 'err' ? 'text-bad' : 'text-dim')}>
                  {l.type === 'cmd' ? `▸ ${l.content}` : l.content}
                </div>
              )
            )}
          </div>
        </Accordion>
      )}

      {del && (
        <ConfirmDialog
          title={t('Remove {name}?', { name: env.name })}
          confirmLabel={t('Remove')}
          danger
          onClose={() => setDel(false)}
          onConfirm={async () => {
            setDel(false)
            await window.cm.recon.deleteEnv(env.id)
            onChanged()
          }}
        >
          {t('Its credentials, scans, uptime history and CI/CD config are deleted. The server itself is not touched.')}
        </ConfirmDialog>
      )}
    </AffectCard>
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
          {env ? <Pencil size={14} /> : <Plug size={14} />} {env ? t('Configure {name}', { name: env.name }) : t('Connect {kind}', { kind: t(kind) })}
        </span>
      }
      onClose={onClose}
      width={600}
      footer={
        <>
          {err && <span className="mr-auto self-center text-[12px] text-bad">{err}</span>}
          <Btn onClick={onClose}>{t('Cancel')}</Btn>
          <Btn primary disabled={busy || !complete || !tested} title={!tested ? t('Test the connection first') : undefined} onClick={() => void save()}>
            {t('Save')} {busy && <Spinner size={11} />}
          </Btn>
        </>
      }
    >
      <SegmentedControl
        size="sm"
        value={tab}
        onChange={setTab}
        aria-label={t('Section')}
        options={[
          { value: 'access', label: t('Access') },
          { value: 'monitor', label: t('Monitor') },
          { value: 'rules', label: t('Rules') }
        ]}
      />
      {tab === 'access' && (
        <div className="mt-4 grid grid-cols-6 gap-3">
          <TextField className="col-span-4" label={t('Name')} value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
          <Select
            className="col-span-2"
            label={t('Protocol')}
            value={f.protocol}
            options={[
              { value: 'ssh', label: 'SSH', description: t('Shell + files') },
              { value: 'sftp', label: 'SFTP', description: t('Files only') },
              { value: 'ftp', label: 'FTP', description: t('Files only') },
              { value: 'ftps', label: 'FTPS', description: t('Files only, over TLS') }
            ]}
            onChange={(v) => {
              const protocol = v as EnvInput['protocol']
              const ftp = protocol === 'ftp' || protocol === 'ftps'
              // FTP logs in with a password only; the port follows the protocol unless it was customised.
              set({
                protocol,
                port: ftp ? (f.port === 22 ? 21 : f.port) : f.port === 21 ? 22 : f.port,
                auth_method: ftp ? 'password' : f.auth_method
              })
            }}
          />
          <TextField className="col-span-4" label={t('Host')} placeholder={t('203.0.113.10 or server.example.com')} value={f.host ?? ''} onChange={(e) => set({ host: e.target.value.trim() })} />
          <NumberInput className="col-span-2" label={t('Port')} min={1} max={65535} value={f.port ?? 22} onValueChange={(v) => set({ port: v ?? 22 })} />
          <TextField className="col-span-3" label={t('User')} placeholder="deploy" value={f.username ?? ''} onChange={(e) => set({ username: e.target.value.trim() })} />
          <Select
            className="col-span-3"
            label={t('Authentication')}
            value={f.auth_method}
            options={[
              ...(f.protocol === 'ftp' || f.protocol === 'ftps'
                ? []
                : [
                    { value: 'agent', label: t('SSH agent'), description: t('Keys already loaded on this Mac') },
                    { value: 'key_path', label: t('Key file'), description: t('A private key on this Mac') },
                    { value: 'key', label: t('Paste a key'), description: t('Stored encrypted (AES-256)') }
                  ]),
              { value: 'password', label: t('Password'), description: t('Stored encrypted (AES-256)') }
            ]}
            onChange={(v) => set({ auth_method: v as EnvInput['auth_method'] })}
          />
          {f.auth_method === 'key_path' && (
            <TextField className="col-span-6" label={t('Key path')} value={f.key_path ?? ''} onChange={(e) => set({ key_path: e.target.value })} hint={t('Absolute path, e.g. /Users/you/.ssh/id_ed25519')} />
          )}
          {f.auth_method === 'key' && (
            <TextArea
              className="col-span-6"
              label={t('Private key')}
              minRows={4}
              maxRows={8}
              placeholder={env?.has_key ? t('A key is saved. Paste a new one to replace it.') : '-----BEGIN OPENSSH PRIVATE KEY-----'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              hint={t('Encrypted on this Mac; written to a 0600 temp file only while a command runs.')}
            />
          )}
          {f.auth_method === 'password' && (
            <TextField
              className="col-span-6"
              label={t('Password')}
              type="password"
              autoComplete="new-password"
              placeholder={env?.has_password ? t('A password is saved. Type a new one to replace it.') : ''}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
          )}
          <TextField className="col-span-6" label={t('App folder')} placeholder="/var/www/app" value={f.workdir ?? ''} onChange={(e) => set({ workdir: e.target.value })} hint={t('Where the app lives: the survey looks here and CI/CD releases go here.')} />
        </div>
      )}
      {tab === 'monitor' && (
        <div className="mt-4 grid grid-cols-6 gap-3">
          <div className="col-span-6">
            <SwitchCallout title={t('Uptime monitor')} description={t('Probe the health URL; three failures in a row open a downtime and an incident.')} checked={!!f.monitor_enabled} onChange={(on) => set({ monitor_enabled: on })} />
          </div>
          <TextField className="col-span-6" label={t('Health URL')} placeholder="https://example.com/health" value={f.health_url ?? ''} onChange={(e) => set({ health_url: e.target.value })} />
          <NumberInput className="col-span-3" label={t('Every')} unit={t('sec')} min={15} max={3600} step={15} value={f.interval_sec ?? 60} onValueChange={(v) => set({ interval_sec: v ?? 60 })} />
          <NumberInput className="col-span-3" label={t('Expected status')} optional min={100} max={599} value={f.expected_status ?? null} onValueChange={(v) => set({ expected_status: v })} hint={t('Empty: any status below 400')} />
        </div>
      )}
      {tab === 'rules' && (
        <div className="mt-4">
          <TextArea
            label={t('Rules for the agent')}
            minRows={8}
            maxRows={16}
            placeholder={t('- Never restart the database\n- The app runs under pm2 as "web"\n- Maintenance window: Sunday 02:00–04:00')}
            value={f.rules ?? ''}
            onChange={(e) => set({ rules: e.target.value })}
            hint={t('Read by the survey and by incident diagnosis. The agent only ever reads the server.')}
          />
        </div>
      )}
      {complete && !unchanged && <TestAlert state={test?.sig === sig ? test : null} onTest={() => void runTest()} />}
    </Modal>
  )
}

/** One short line from the server's error, without the tool prefix. */
const reason = (out?: string) => {
  const lines = (out ?? '').trim().split('\n').map((l) => l.trim()).filter(Boolean)
  // The tool's own error line (curl/ssh/sftp prefix) is the useful one; the rest is boilerplate.
  const line = lines.find((l) => /^(curl|ssh|sftp): /.test(l)) ?? lines[0] ?? ''
  const host = line.match(/target host name '([^']+)'/)?.[1]
  if (host) return t("The server's TLS certificate is not issued for {host}. On shared hosting, use the server's own host name from your provider.", { host })
  if (/SSL certificate problem/i.test(line)) return t("The server's TLS certificate is not trusted (self-signed or expired).")
  return line.replace(/^(curl|ssh|sftp): (\(\d+\) )?/, '').replace(/^./, (c) => c.toUpperCase()) || t('Check host, port, user and credentials.')
}

/** Shown once every access field is filled: test the login before the environment can be saved. */
function TestAlert({ state, onTest }: { state: { state: 'running' | 'ok' | 'fail'; output: string; ms?: number } | null; onTest: () => void }) {
  const s = state?.state
  return (
    <AffectCard role="status" className="cm-in mt-5" style={{ '--ui-crd-tray': 'rgba(255,255,255,.06)', marginTop: 20, padding: 8 } as CSSProperties}>
      <CardHeader
        icon={
          <span className={s === 'ok' ? 'text-ok' : s === 'fail' ? 'text-bad' : undefined}>
            {s === 'running' ? <Spinner size={16} /> : s === 'ok' ? <Check size={16} /> : s === 'fail' ? <X size={16} /> : <Plug size={16} />}
          </span>
        }
        title={s === 'ok' ? t('Connection works') : s === 'fail' ? t('Could not connect') : s === 'running' ? t('Testing the connection…') : t('Test connection')}
        description={
          s === 'ok'
            ? state?.ms ? t('Logged in in {s}s. You can save now.', { s: (state.ms / 1000).toFixed(1) }) : t('Logged in. You can save now.')
            : s === 'fail'
              ? t('Check host, port, user and credentials.')
              : t('Log in once before saving.')
        }
      >
        {s === 'fail' && (
          <div className="mt-2.5 flex items-start gap-2.5 rounded-2xl border border-bad/30 bg-bad/[.08] px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-bad">
            <CircleAlert size={15} className="mt-[2px] shrink-0" />
            <span className="min-w-0">{reason(state?.output)}</span>
          </div>
        )}
      </CardHeader>
      <CardFooter style={{ justifyContent: 'flex-end', padding: '8px 0 0' }}>
        <Button size="sm" variant={s === 'ok' ? 'secondary' : 'primary'} disabled={s === 'running'} iconRight={<Plug size={13} />} onClick={onTest}>
          {s === 'ok' || s === 'fail' ? t('Test again') : t('Test connection')}
        </Button>
      </CardFooter>
    </AffectCard>
  )
}
