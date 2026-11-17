import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, GitBranch, Moon, Palette, PencilLine, RefreshCw, ScanSearch, Sparkles, Sun } from 'lucide-react'
import type { DesignState, DevServerState } from '@shared/design'
import { actions, useStore } from '@/lib/store'
import { PageHeader } from '../PageHeader'
import { GateOverlay, ProBadge, ProGate } from '../ProGate'
import { PromptDialog } from '../PromptDialog'
import { Select } from '../../affect/select'
import { SegmentedControl } from '../../affect/segmented-control'
import { Button } from '../../affect/button'
import { EmptyState } from '../../affect/empty-state'
import { Spinner } from '../../affect/spinner'
import { ShimmerText } from '../../affect/shimmer-loader'

type Props = { leftCollapsed: boolean; onExpandLeft: () => void }

/** Design System (Pro): the project's components in one place, built and kept by the agent. */
export function DesignPage(p: Props) {
  return (
    <>
      <PageHeader leftCollapsed={p.leftCollapsed} onExpandLeft={p.onExpandLeft}>
        <Palette size={14} className="text-accent" />
        <span className="font-medium text-ink">Design System</span>
        <ProBadge />
      </PageHeader>
      <ProGate
        feature="Design System"
        description="One place for every component and token of the project. The agent builds it from your code or from scratch, then uses it for all UI work."
        preview={<DesignPreview />}
      >
        {() => <Design />}
      </ProGate>
    </>
  )
}

function Design() {
  const space = useStore((s) => s.space)
  const projects = useStore((s) => s.projects).filter((x) => x.spaceId === space)
  const selectedProject = useStore((s) => s.selectedProject)
  const workspaces = useStore((s) => s.workspaces)
  const [pid, setPid] = useState<string | null>(projects.find((x) => x.id === selectedProject)?.id ?? projects[0]?.id ?? null)
  const [st, setSt] = useState<DesignState | null>(null)
  const [library, setLibrary] = useState<string | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const [dev, setDev] = useState<DevServerState | null>(null)
  const [editing, setEditing] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!pid) return
    const s = await window.cm.design.state(pid)
    setSt(s)
    setLibrary((l) => l ?? s.libraries[0]?.id ?? null)
  }, [pid])
  // Branch status changes (agent working, done) can change the state.
  useEffect(() => void load(), [load, workspaces])

  // The showcase needs the project's dev server: start it in the background when the page opens.
  const wsId = st?.manifest ? st.workspaceId : null
  useEffect(() => {
    if (!wsId) return
    void window.cm.design.devStart(wsId).then(setDev)
    return window.cm.onEvent((e) => e.type === 'devserver' && e.state.workspaceId === wsId && setDev(e.state))
  }, [wsId])

  const openChat = (id: string) => {
    void actions.selectWorkspace(id)
    actions.setView('chat')
  }
  const start = async (origin: 'existing' | 'scratch') => {
    if (!pid || !library) return
    try {
      openChat(await window.cm.design.start(pid, origin, library))
    } catch (e: any) {
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? 'Could not start')
    }
  }

  const toolbar = (
    <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-4">
      <Select
        className="w-64"
        size="sm"
        aria-label="Project"
        value={pid}
        options={projects.map((x) => ({ value: x.id, label: x.owner ? `${x.owner}/${x.name}` : x.name }))}
        onChange={(v) => {
          setPid(v)
          setSt(null)
          setLibrary(null)
          setDev(null)
        }}
      />
      {st?.branch && (
        <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-mute">
          <GitBranch size={12} /> {st.branch}
        </span>
      )}
      <span className="flex-1" />
      {st?.manifest && (
        <>
          <SegmentedControl
            size="sm"
            aria-label="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'light', label: 'Light', icon: <Sun size={12} /> },
              { value: 'dark', label: 'Dark', icon: <Moon size={12} /> }
            ]}
          />
          <Button variant="secondary" size="sm" icon={<PencilLine size={13} />} onClick={() => setEditing(true)}>
            Change
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={13} />}
            onClick={() => pid && void window.cm.design.edit(pid, 'Rebuild the design system page and the manifest from the current code.').then(openChat)}
          >
            Rebuild
          </Button>
          {dev?.url && (
            <Button variant="ghost" size="sm" icon={<ExternalLink size={13} />} onClick={() => window.open(`${dev.url}${st.manifest!.route}?theme=${theme}`, '_blank')}>
              Open
            </Button>
          )}
        </>
      )}
    </div>
  )

  if (!pid) {
    return (
      <div className="py-20">
        <EmptyState title="No project" text="Add a project to this workspace first." />
      </div>
    )
  }
  if (!st) {
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner size={16} className="text-mute" />
      </div>
    )
  }

  // No design system yet: the page blurred under the setup choice.
  if (!st.manifest && !st.building) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {toolbar}
        <GateOverlay
          label="Set up the design system"
          preview={<DesignPreview />}
          icon={<Palette size={20} className="text-accent" />}
          title="Set up the design system"
          description="Every button, field and card gets built once and reused everywhere. The agent works in its own branch and shows its plan in the chat."
          action={{ label: 'From the existing codebase', icon: <ScanSearch size={15} />, onClick: () => void start('existing') }}
          secondary={{ label: 'From scratch: it asks you a few questions', icon: <Sparkles size={13} />, onClick: () => void start('scratch') }}
        >
          <div className="mt-4 text-left">
            <Select
              size="sm"
              label="Component library"
              value={library}
              options={st.libraries.map((l) => ({ value: l.id, label: l.present ? `${l.label} · in the project` : l.label }))}
              onChange={setLibrary}
            />
            {error && <p className="mt-2 text-[12px] text-bad">{error}</p>}
          </div>
        </GateOverlay>
      </div>
    )
  }

  // Being built in its branch.
  if (!st.manifest) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {toolbar}
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 blur-[6px] saturate-50" aria-hidden>
            <DesignPreview />
          </div>
          <div className="absolute inset-0 bg-bg/40" />
          <div className="absolute inset-0 grid place-items-center p-6">
            <div className="cm-in w-[400px] rounded-2xl border border-line-strong bg-raised/95 p-6 text-center shadow-2xl backdrop-blur">
              <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-line-strong bg-panel">
                <Palette size={20} className="text-accent" />
              </span>
              <h2 className="mt-4 text-[17px] font-semibold">
                <ShimmerText>Building the design system</ShimmerText>
              </h2>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                The agent is working in <span className="font-mono text-ink">{st.branch}</span>. Answer its questions and follow the plan in the chat.
              </p>
              <div className="mt-5">
                <Button className="w-full" onClick={() => st.workspaceId && openChat(st.workspaceId)}>
                  Open the chat
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const src = dev?.url ? `${dev.url}${st.manifest.route}?theme=${theme}&v=${nonce}` : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      <div className="relative mx-6 mb-6 min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-panel">
        {src ? (
          <iframe key={src} src={src} title="Design system" className="size-full bg-white" />
        ) : (
          <div className="grid h-full place-items-center p-6">
            <div className="w-[460px] text-center">
              {dev?.status === 'error' ? (
                <>
                  <p className="text-[13.5px] font-medium text-bad">{dev.message}</p>
                  <pre className="selectable mt-3 max-h-48 overflow-auto rounded-lg border border-line bg-black/30 p-2.5 text-left font-mono text-[11px] text-dim">
                    {dev.log.slice(-14).join('\n')}
                  </pre>
                  <Button className="mt-3" size="sm" onClick={() => wsId && void window.cm.design.devStart(wsId).then(setDev)}>
                    Try again
                  </Button>
                </>
              ) : (
                <>
                  <ShimmerText className="text-[13.5px]">
                    {dev?.status === 'installing' ? 'Installing the project dependencies…' : 'Starting the project dev server…'}
                  </ShimmerText>
                  {dev?.log.length ? <p className="mt-2 truncate font-mono text-[11px] text-mute">{dev.log[dev.log.length - 1]}</p> : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {editing && (
        <PromptDialog
          title="Change the design system"
          label="Describe the change: the agent applies it in the design-system branch and updates the page."
          confirmLabel="Send to the chat"
          onSubmit={async (v) => {
            const id = await window.cm.design.edit(pid, v)
            setNonce((n) => n + 1)
            openChat(id)
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  )
}

/** A stand-in showcase for the blurred backgrounds: swatches, type, controls, cards. */
function DesignPreview() {
  const swatches = ['#d97757', '#1f1f23', '#ededed', '#4fc38a', '#f2b84b', '#ff7a6b', '#4d9fff', '#a78bfa']
  return (
    <div className="h-full overflow-hidden px-8 pt-6">
      <div className="grid grid-cols-[1fr_1fr] gap-6">
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="text-[12px] text-mute">Colors</div>
          <div className="mt-3 grid grid-cols-4 gap-3">
            {swatches.map((c) => (
              <div key={c}>
                <div className="h-14 rounded-xl border border-line" style={{ background: c }} />
                <div className="mt-1 font-mono text-[10.5px] text-mute">{c}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="text-[12px] text-mute">Typography</div>
          <div className="mt-2 text-[34px] font-bold tracking-tight">Display 34</div>
          <div className="text-[22px] font-semibold">Heading 22</div>
          <div className="text-[15px] text-dim">Body 15 · The quick brown fox jumps over the lazy dog.</div>
          <div className="mt-1 font-mono text-[12px] text-mute">mono 12 · const ok = true</div>
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="text-[12px] text-mute">Buttons</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-black">Primary</span>
            <span className="rounded-lg border border-line-strong px-4 py-2 text-[13px]">Secondary</span>
            <span className="rounded-lg px-4 py-2 text-[13px] text-dim">Ghost</span>
            <span className="rounded-lg bg-bad/15 px-4 py-2 text-[13px] text-bad">Delete</span>
          </div>
          <div className="mt-4 text-[12px] text-mute">Fields</div>
          <div className="mt-2 h-9 rounded-lg border border-line bg-input" />
          <div className="mt-2 h-9 rounded-lg border border-bad/50 bg-input" />
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <div className="text-[12px] text-mute">Cards and feedback</div>
          <div className="mt-3 rounded-xl border border-line bg-raised p-4">
            <div className="text-[14px] font-medium">Card title</div>
            <div className="mt-1 text-[12.5px] text-dim">Supporting text that wraps on two lines in a calm grey.</div>
          </div>
          <div className="mt-3 flex gap-2">
            <span className="rounded-full bg-ok/15 px-2.5 py-0.5 text-[11.5px] text-ok">Success</span>
            <span className="rounded-full bg-warn/15 px-2.5 py-0.5 text-[11.5px] text-warn">Warning</span>
            <span className="rounded-full bg-bad/15 px-2.5 py-0.5 text-[11.5px] text-bad">Error</span>
          </div>
        </div>
      </div>
    </div>
  )
}
