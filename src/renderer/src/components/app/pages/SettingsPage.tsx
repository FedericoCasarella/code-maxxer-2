import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowLeft, Bot, Check, Copy, Cpu, Eye, EyeOff, Info, KeyRound, Plug, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import type { McpInfo, Provider } from '@shared/types'
import { actions, useStore, type SettingsSection } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { Switch } from '../../affect/switch'
import { Kbd } from '../../affect/kbd'
import { Spinner } from '../../affect/spinner'
import { ConfirmDialog } from '../ConfirmDialog'
import { Github, ProviderLogo } from '../Logos'
import { ModelSelect } from '../ModelSelect'
import { AgentsPage } from './AgentsPage'

const NAV: { group: string; items: { id: SettingsSection; label: string; icon: ReactNode; keywords: string }[] }[] = [
  {
    group: 'AI',
    items: [
      { id: 'general', label: 'General', icon: <SlidersHorizontal size={15} />, keywords: 'default model effort access' },
      { id: 'providers', label: 'Providers', icon: <Cpu size={15} />, keywords: 'claude codex opencode cli version models' },
      { id: 'agents', label: 'Agents', icon: <Bot size={15} />, keywords: 'personas planner builder qa reviewer instructions' }
    ]
  },
  {
    group: 'Connections',
    items: [
      { id: 'mcp', label: 'MCP server', icon: <Plug size={15} />, keywords: 'mcp hermes external agents token auth http' },
      { id: 'github', label: 'GitHub', icon: <Github size={14} />, keywords: 'github gh issues board project scope' }
    ]
  },
  {
    group: 'Account',
    items: [
      { id: 'license', label: 'License', icon: <KeyRound size={15} />, keywords: 'license key pro activate' },
      { id: 'about', label: 'About', icon: <Info size={15} />, keywords: 'version about repository' }
    ]
  }
]

/** Settings: its own page (sidebar of sections + cards), like a desktop app's preferences. */
export function SettingsPage(_: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const section = useStore((s) => s.settingsSection)
  const [q, setQ] = useState('')
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase()
    return NAV.map((g) => ({ ...g, items: g.items.filter((i) => !s || `${i.label} ${i.keywords}`.toLowerCase().includes(s)) })).filter((g) => g.items.length)
  }, [q])
  const title = NAV.flatMap((g) => g.items).find((i) => i.id === section)?.label ?? 'Settings'

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=alertdialog]') && actions.setView('chat')
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-[264px] shrink-0 flex-col border-r border-line bg-bg">
        {/* traffic-light lane, then "Back to app" on its own row above the search */}
        <div className="drag h-11 shrink-0" />
        <div className="px-3 pb-2">
          <button onClick={() => actions.setView('chat')} className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-[13px] text-dim hover:bg-white/[.05] hover:text-ink">
            <ArrowLeft size={14} /> Back to app
          </button>
        </div>
        <div className="px-3 pb-3">
          <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 focus-within:border-accent/50">
            <Search size={13} className="text-mute" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" className="selectable min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-mute" />
            <Kbd keys={['⌘', ',']} />
          </label>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((g) => (
            <div key={g.group} className="mb-3">
              <div className="px-2.5 pb-1 text-[10.5px] font-semibold text-mute">{g.group}</div>
              {g.items.map((i) => (
                <button
                  key={i.id}
                  onClick={() => actions.setSettingsSection(i.id)}
                  className={cn('flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px]', section === i.id ? 'bg-white/[.07] text-ink' : 'text-dim hover:bg-white/[.03] hover:text-ink')}
                >
                  <span className={section === i.id ? 'text-ink' : 'text-mute'}>{i.icon}</span>
                  {i.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-panel">
        <header className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-5 text-[12.5px]">
          <span className="text-mute">Settings</span>
          <span className="text-mute">/</span>
          <span className="text-ink">{title}</span>
          <div className="flex-1" />
          <button onClick={() => actions.setView('chat')} className="no-drag grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label="Close settings">
            <X size={15} />
          </button>
        </header>
        {section === 'agents' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <AgentsPage leftCollapsed={false} onExpandLeft={() => {}} embedded />
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[720px] px-6 py-6">
              {section === 'general' && <General />}
              {section === 'providers' && <Providers />}
              {section === 'mcp' && <Mcp />}
              {section === 'github' && <GithubSection />}
              {section === 'license' && <LicenseSection />}
              {section === 'about' && <About />}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function Group({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 text-[14px] font-semibold">{title}</h2>
      {hint && <p className="-mt-1 mb-2 text-[12px] text-mute">{hint}</p>}
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-raised/40">{children}</div>
    </section>
  )
}
function Row({ label, hint, children }: { label: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-[52px] items-center gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] text-mute">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

const PREFS_KEY = 'cm2.composer'
function General() {
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    } catch {
      return {}
    }
  }
  const [prefs, setPrefs] = useState<any>(read)
  const save = (p: object) => {
    const next = { ...read(), ...p }
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next))
    } catch { /* ignore */ }
    setPrefs(next)
  }
  return (
    <>
      <Group title="New chats" hint="What the composer starts with. You can change it per message.">
        <Row label="Default model">
          <div className="w-64">
            <ModelSelect trigger="field" side="bottom" value={prefs.model ?? 'claude-opus-5-5'} onChange={(id) => id && save({ model: id })} />
          </div>
        </Row>
        <Row label="Full access" hint="The agent edits and runs commands without asking. Off: it accepts edits, asks before risky commands.">
          <Switch checked={prefs.fullAccess ?? true} onChange={(e) => save({ fullAccess: e.currentTarget.checked })} aria-label="Full access" />
        </Row>
      </Group>
      <Group title="Shortcuts">
        <Row label="Settings"><Kbd keys={['⌘', ',']} /></Row>
        <Row label="Jump to branch"><Kbd keys={['⌘', 'K']} /></Row>
        <Row label="New branch"><Kbd keys={['⌘', 'N']} /></Row>
        <Row label="Previous / next branch"><Kbd keys={['⌘', '⇧', '↑']} /></Row>
        <Row label="Filter files"><Kbd keys={['⌘', 'P']} /></Row>
      </Group>
    </>
  )
}

function Providers() {
  const [list, setList] = useState<{ id: Provider; name: string; path: string; version: string | null }[] | null>(null)
  const models = useStore((s) => s.models)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.cm.providersStatus().then(setList)
  }, [])
  return (
    <Group title="Agent CLIs" hint="code-maxxer drives these command-line agents with your own logins and subscriptions.">
      {!list ? (
        <div className="flex justify-center py-6"><Spinner size={14} /></div>
      ) : (
        list.map((p) => (
          <Row
            key={p.id}
            label={p.name}
            hint={<span className="font-mono text-[11px]">{p.version ? `${p.version} · ${p.path}` : `Not found (${p.path})`}</span>}
          >
            <span className="flex items-center gap-2 text-[12px] text-dim">
              <ProviderLogo provider={p.id} size={16} />
              {models.filter((m) => m.provider === p.id).length} models
              <span className={cn('size-2 rounded-full', p.version ? 'bg-ok' : 'bg-bad')} />
            </span>
          </Row>
        ))
      )}
      <Row label="Model lists" hint="Codex models come from its app server, OpenCode's from `opencode models`.">
        <button
          onClick={async () => {
            setBusy(true)
            await actions.reloadModels(true)
            setBusy(false)
          }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-[12.5px] text-dim hover:text-ink"
        >
          {busy ? <Spinner size={12} /> : <RefreshCw size={13} />} Refresh
        </button>
      </Row>
    </Group>
  )
}

function Mcp() {
  const [info, setInfo] = useState<McpInfo | null>(null)
  const [show, setShow] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [rotate, setRotate] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void window.cm.mcpInfo().then(setInfo)
  }, [])
  if (!info) return <div className="flex justify-center py-10"><Spinner size={14} /></div>
  const config = JSON.stringify(
    { mcpServers: { 'code-maxxer': { type: 'http', url: info.url || 'http://127.0.0.1:3727/mcp', ...(info.auth ? { headers: { Authorization: `Bearer ${info.token}` } } : {}) } } },
    null,
    2
  )
  const copy = (k: string, v: string) => {
    void navigator.clipboard.writeText(v)
    setCopied(k)
    setTimeout(() => setCopied(null), 1400)
  }
  const configure = async (patch: { enabled?: boolean; auth?: boolean }) => {
    setBusy(true)
    setInfo(await window.cm.configureMcp(patch))
    setBusy(false)
  }
  const CopyBtn = ({ k, v }: { k: string; v: string }) => (
    <button onClick={() => copy(k, v)} className="grid size-7 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label="Copy">
      {copied === k ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )
  return (
    <>
      <Group title="MCP server" hint="Lets outside agents such as Hermes drive code-maxxer: projects, branches, prompts, pipelines, issues, brain, scheduled runs.">
        <Row label="Enabled" hint={info.running ? `Listening on ${info.url} (this Mac only)` : 'Off: no outside agent can reach code-maxxer.'}>
          {busy && <Spinner size={12} />}
          <Switch checked={info.enabled} onChange={(e) => void configure({ enabled: e.currentTarget.checked })} aria-label="Enable MCP server" />
        </Row>
        <Row label="Require token" hint={info.auth ? 'Clients must send Authorization: Bearer <token>.' : 'Any program on this Mac can call it. Keep this on unless you have a reason.'}>
          <Switch checked={info.auth} disabled={!info.enabled} onChange={(e) => void configure({ auth: e.currentTarget.checked })} aria-label="Require token" />
        </Row>
      </Group>
      {info.enabled && (
        <Group title="Connect a client">
          <div className="flex flex-col gap-3 p-4">
            <Field label="URL (Streamable HTTP)">
              <code className="selectable min-w-0 flex-1 truncate font-mono text-[12px]">{info.url}</code>
              <CopyBtn k="url" v={info.url} />
            </Field>
            {info.auth && (
              <Field label="Bearer token">
                <code className="selectable min-w-0 flex-1 truncate font-mono text-[12px]">{show ? info.token : '•'.repeat(28)}</code>
                <button onClick={() => setShow((x) => !x)} className="grid size-7 place-items-center rounded-md text-mute hover:text-ink" aria-label={show ? 'Hide' : 'Show'}>
                  {show ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <CopyBtn k="token" v={info.token} />
                <button onClick={() => setRotate(true)} title="New token" className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink" aria-label="New token">
                  <RefreshCw size={13} />
                </button>
              </Field>
            )}
            <div>
              <div className="mb-1 flex items-center text-[11.5px] font-medium text-dim">
                Config to paste in Hermes
                <span className="ml-auto"><CopyBtn k="cfg" v={config} /></span>
              </div>
              <pre className="selectable max-h-56 overflow-auto rounded-lg border border-line bg-panel p-3 font-mono text-[11.5px] leading-relaxed text-dim">
                {show || !info.auth ? config : config.replace(info.token, '•'.repeat(12))}
              </pre>
            </div>
          </div>
        </Group>
      )}
      {rotate && (
        <ConfirmDialog
          title="Create a new token?"
          confirmLabel="Create new token"
          onClose={() => setRotate(false)}
          onConfirm={async () => setInfo(await window.cm.rotateMcpToken())}
        >
          Clients using the current token stop working until you give them the new one.
        </ConfirmDialog>
      )}
    </>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-dim">{label}</div>
      <div className="flex h-9 items-center gap-1 rounded-lg border border-line bg-input pl-3 pr-1">{children}</div>
    </div>
  )
}

function GithubSection() {
  const [st, setSt] = useState<{ account: string | null; scopes: string | null } | null>(null)
  useEffect(() => {
    void window.cm.ghStatus().then(setSt)
  }, [])
  const hasProject = !!st?.scopes?.split(/,\s*/).includes('project')
  return (
    <Group title="GitHub CLI" hint="Used for the Issues mirror (GitHub Issues + Project board). Turn the mirror on per project from the Issues page.">
      <Row label="Account" hint={st ? (st.account ?? 'Not logged in: run `gh auth login`') : 'Checking…'}>
        <Github size={16} />
      </Row>
      <Row
        label="Permissions"
        hint={st?.scopes ? <span className="font-mono text-[11px]">{st.scopes}</span> : '—'}
      >
        <span className={cn('rounded-md px-2 py-0.5 text-[11.5px]', hasProject ? 'bg-ok/12 text-ok' : 'bg-warn/12 text-warn')}>
          {hasProject ? 'Board ready' : 'Board needs `gh auth refresh -s project`'}
        </span>
      </Row>
    </Group>
  )
}

function LicenseSection() {
  const lic = useStore((s) => s.license)
  return (
    <Group title="License" hint="code-maxxer is free to use; a license unlocks Pro on this Mac.">
      <Row label={lic?.state === 'active' ? `${lic.license?.plan ?? 'Pro'} · ${lic.license?.name}` : lic?.state === 'free' ? 'Free' : `License ${lic?.state ?? '…'}`} hint={lic?.license?.email ?? (lic?.lastCheck ? `Checked ${timeAgo(lic.lastCheck)} ago` : undefined)}>
        {lic?.state === 'active' ? (
          <button
            onClick={async () => actions.setLicense(await window.cm.recheckLicense())}
            className="h-8 rounded-lg border border-line px-3 text-[12.5px] text-dim hover:text-ink"
          >
            Check now
          </button>
        ) : (
          <button onClick={() => actions.openLicenseDialog(true)} className="h-8 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
            Activate…
          </button>
        )}
      </Row>
    </Group>
  )
}

function About() {
  return (
    <Group title="code-maxxer">
      <Row label="Version" hint="Prototype">
        <span className="font-mono text-[12px] text-dim">0.0.1</span>
      </Row>
      <Row label="Source" hint="github.com/FedericoCasarella/code-maxxer-2 (private)">
        <button onClick={() => window.open('https://github.com/FedericoCasarella/code-maxxer-2', '_blank')} className="h-8 rounded-lg border border-line px-3 text-[12.5px] text-dim hover:text-ink">
          Open
        </button>
      </Row>
    </Group>
  )
}
