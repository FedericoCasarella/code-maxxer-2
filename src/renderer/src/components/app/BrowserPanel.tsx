import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, Globe, Monitor, Play, RotateCw, Square } from 'lucide-react'
import type { DevServerState } from '@shared/design'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { TextField } from '../affect/text-field'
import { EmptyState } from '../affect/empty-state'
import { Button } from '../affect/button'
import { Spinner } from '../affect/spinner'
import { Marquee } from './Marquee'

type WebviewEl = HTMLElement & {
  getWebContentsId(): number
  loadURL(url: string): Promise<void>
  getURL(): string
  goBack(): void
  goForward(): void
  reload(): void
  canGoBack(): boolean
  canGoForward(): boolean
}

/**
 * Right-drawer tab: the browser the agent tests in. Same page for you and for it; when the agent acts,
 * its cursor glides to the target and pulses on click.
 */
export function BrowserPanel() {
  const view = useRef<WebviewEl | null>(null)
  const [url, setUrl] = useState('')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const live = useStore((s) => s.cursor)
  // The last position stays a moment after the run ends, so the cursor fades out instead of vanishing.
  const [cursor, setCursor] = useState(live)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (live) return void (setCursor(live), setLeaving(false))
    setLeaving(true)
    const t = setTimeout(() => setCursor(null), 300)
    return () => clearTimeout(t)
  }, [live])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const el = view.current
    if (!el) return
    const ready = () => void window.cm.browserReady(el.getWebContentsId())
    const nav = () => {
      setUrl(el.getURL())
      setInput(el.getURL() === 'about:blank' ? '' : el.getURL())
    }
    const start = () => setLoading(true)
    const stop = () => {
      setLoading(false)
      nav()
    }
    el.addEventListener('dom-ready', ready)
    el.addEventListener('did-navigate', nav)
    el.addEventListener('did-navigate-in-page', nav)
    el.addEventListener('did-start-loading', start)
    el.addEventListener('did-stop-loading', stop)
    return () => {
      el.removeEventListener('dom-ready', ready)
      el.removeEventListener('did-navigate', nav)
      el.removeEventListener('did-navigate-in-page', nav)
      el.removeEventListener('did-start-loading', start)
      el.removeEventListener('did-stop-loading', stop)
      void window.cm.browserReady(null)
    }
  }, [])

  // The cursor dims a little when the agent hasn't moved it for a while (it never disappears).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const agentActive = !!cursor && now - cursor.at < 4000
  const ws = useStore((s) => s.workspaces.find((w) => w.id === cursor?.workspaceId))

  // The selected branch's preview: start it here, the page opens when it's ready.
  const wsId = useStore((s) => s.selectedWs)
  const [dev, setDev] = useState<DevServerState | null>(null)
  useEffect(() => {
    setDev(null)
    if (!wsId) return
    void window.cm.preview.state(wsId).then(setDev)
    return window.cm.onEvent((e) => {
      if (e.type !== 'devserver' || e.state.workspaceId !== wsId) return
      setDev((prev) => {
        if (e.state.status === 'ready' && prev?.status !== 'ready' && e.state.url) void view.current?.loadURL(e.state.url)
        return e.state
      })
    })
  }, [wsId])
  // The viewport the agent tests at (the page is zoomed out to fit when it's larger than the panel).
  const [viewport, setViewport] = useState<string | null>(null)
  useEffect(() => window.cm.onEvent((e) => e.type === 'browser-viewport' && setViewport(e.label)), [])
  const devOn = !!dev && ['installing', 'starting', 'ready'].includes(dev.status)
  const toggleDev = () => wsId && void (devOn ? window.cm.preview.stop(wsId) : window.cm.preview.start(wsId))

  const go = () => {
    let u = input.trim()
    if (!u) return
    if (!/^[a-z]+:\/\//i.test(u)) u = (/^(localhost|127\.|\[::1\])/.test(u) ? 'http://' : 'https://') + u
    void view.current?.loadURL(u)
  }
  const btn = 'grid size-7 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink'

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <button className={btn} onClick={() => view.current?.goBack()} aria-label="Back"><ArrowLeft size={14} /></button>
        <button className={btn} onClick={() => view.current?.goForward()} aria-label="Forward"><ArrowRight size={14} /></button>
        <button className={btn} onClick={() => view.current?.reload()} aria-label="Reload">
          <RotateCw size={13} className={loading ? 'animate-spin' : undefined} />
        </button>
        <TextField
          size="sm"
          className="min-w-0 flex-1"
          inputClassName="font-mono"
          prefix={<Globe size={12} />}
          aria-label="Address"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="localhost:5173"
          spellCheck={false}
        />
        {wsId && (
          <button className={btn} onClick={toggleDev} aria-label={devOn ? 'Stop preview' : 'Start preview'} title={devOn ? 'Stop preview' : 'Start preview'}>
            {dev?.status === 'installing' || dev?.status === 'starting' ? <Spinner size={12} /> : devOn ? <Square size={12} /> : <Play size={13} />}
          </button>
        )}
      </div>
      {agentActive && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-accent/[.08] px-3 py-1 text-[11.5px] text-accent">
          <Bot size={12} /> The agent is using the browser
          {viewport && <span className="ml-auto shrink-0 whitespace-nowrap text-accent/80">{viewport}</span>}
        </div>
      )}
      {!agentActive && viewport && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-1 text-[11.5px] text-mute">
          <Monitor size={12} /> {viewport}
        </div>
      )}
      <div className="relative min-h-0 flex-1 bg-white">
        <webview ref={view as any} src="about:blank" partition="persist:cm2-browser" className="absolute inset-0 h-full w-full" />
        {!url || url === 'about:blank' ? (
          <div className="absolute inset-0 grid place-items-center bg-bg px-6">
            {dev?.status === 'installing' || dev?.status === 'starting' ? (
              <EmptyState
                bare
                icon={<Spinner size={16} />}
                title={dev.status === 'installing' ? 'Installing dependencies…' : 'Starting the preview…'}
                text="The page opens here when the dev server answers."
              />
            ) : (
              <EmptyState
                bare
                icon={<Globe size={16} />}
                title={dev?.status === 'error' ? "The preview didn't start" : 'No preview'}
                text={dev?.status === 'error' ? <span className="text-bad">{dev.message}</span> : 'Start the dev server, or type an address above.'}
                action={
                  wsId && (
                    <Button size="sm" variant="secondary" iconRight={<Play size={13} />} onClick={toggleDev}>
                      {dev?.status === 'error' ? 'Try again' : 'Start preview'}
                    </Button>
                  )
                }
              />
            )}
          </div>
        ) : null}
        {cursor && (
          /* The agent's cursor stays where it last was and glides to each new point, like a real pointer. */
          <div
            className={cn('pointer-events-none absolute left-0 top-0 z-10 transition-[transform,opacity] duration-[650ms] ease-[cubic-bezier(.45,0,.2,1)]', leaving && 'duration-300', leaving ? 'opacity-0' : agentActive ? 'opacity-100' : 'opacity-80')}
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
          >
            {cursor.click && <span key={cursor.at} className="absolute -left-3 -top-3 size-7 rounded-full border-2 border-[#a78bfa]" style={{ animation: 'cm-ping .6s ease-out forwards' }} />}
            <svg width="20" height="22" viewBox="0 0 20 22" className="drop-shadow-[0_2px_4px_rgba(0,0,0,.5)]">
              <path d="M2.2 1.8 17.4 9.3l-6.9 1.9-3.2 6.9z" fill="#111113" stroke="#f5f5f2" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <div className="absolute left-6 top-6 min-w-[120px] max-w-[240px] rounded-xl border border-white/10 bg-[#111113]/95 px-2.5 py-1.5 shadow-[0_0_0_1px_rgba(167,139,250,.25),0_8px_24px_-8px_rgba(124,58,237,.55)]">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold leading-tight text-white">Agent</span>
                <Marquee className="max-w-[120px] rounded-md bg-white/10 px-1.5 py-px font-mono text-[10px] leading-tight text-white/75" delay={300}>{ws?.branch ?? 'browser'}</Marquee>
              </div>
              <Marquee className="mt-0.5 text-[11.5px] leading-snug text-white/60" delay={300}>{cursor.label}</Marquee>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
