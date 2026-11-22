import { useEffect, useRef, useState } from 'react'
import { AppWindow, ArrowLeft, ArrowRight, Bot, Globe, ScanSearch, Laptop, Monitor, Play, RectangleHorizontal, RotateCw, Scaling, Smartphone, Square, Tablet, TriangleAlert, ExternalLink } from 'lucide-react'
import type { DevServerState } from '@shared/design'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { TextField } from '../affect/text-field'
import { EmptyState } from '../affect/empty-state'
import { Button } from '../affect/button'
import { Spinner } from '../affect/spinner'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'
import { ProjectPicker } from './ProjectPicker'
import { Tooltip } from '../affect/tooltip'
import { Select, type SelectOption } from '../affect/select'
import { usePersisted } from '@/lib/persist'

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
/** The dev server's note, in the UI language. */
const devNote = (m: string) => {
  const moved = m.match(/^Port (\d+) was taken: the preview runs on (\d+)\.$/)
  return moved ? t('Port {a} was taken: the preview runs on {b}.', { a: moved[1], b: moved[2] }) : t(m)
}

/** Sizes the preview renders at; "panel" fits the panel itself. */
const VIEWS: SelectOption[] = [
  { value: 'panel', label: 'Responsive', icon: <Scaling size={14} /> },
  { value: 'iphone', label: 'iPhone', icon: <Smartphone size={14} /> },
  { value: 'ipad', label: 'iPad', icon: <Tablet size={14} /> },
  { value: 'mac', label: 'Mac', icon: <Laptop size={14} /> },
  { value: 'desktop', label: 'Desktop', icon: <Monitor size={14} /> },
  { value: 'ultrawide', label: 'Ultrawide', icon: <RectangleHorizontal size={14} /> }
]

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
    const timer = setTimeout(() => setCursor(null), 300)
    return () => clearTimeout(timer)
  }, [live])
  const [now, setNow] = useState(Date.now())
  const domReady = useRef(false)
  const pendingUrl = useRef<string | null>(null)

  useEffect(() => {
    const el = view.current
    if (!el) return
    const ready = () => {
      void window.cm.browserReady(el.getWebContentsId()).then(() => {
        const v = sizeRef.current
        if (v !== 'panel' && v !== 'custom') void window.cm.browserViewport(v)
      })
      domReady.current = true
      // A preview that was already running when the panel opened
      const u = pendingUrl.current
      pendingUrl.current = null
      if (u) void el.loadURL(u).catch(() => {})
    }
    const nav = () => {
      setUrl(el.getURL())
      setInput(el.getURL() === 'about:blank' ? '' : el.getURL())
    }
    const start = () => setLoading(true)
    const stop = () => {
      setLoading(false)
      nav()
    }
    // A page that didn't load (the dev server not answering yet, or restarting) is tried again, instead of staying blank
    let retries = 0
    let retryTimer: number | undefined
    let retrying = false
    const failed = (e: any) => {
      if (!e.isMainFrame || e.errorCode === -3 || !/^https?:\/\//.test(e.validatedURL ?? '')) return
      window.clearTimeout(retryTimer)
      if (retries++ >= 30) return
      retryTimer = window.setTimeout(() => {
        retrying = true
        void el.loadURL(e.validatedURL).catch(() => {})
      }, 1000)
    }
    // Any other page opened (the preview started, an address typed): the old retries stop
    const navStart = (e: any) => {
      if (!e.isMainFrame) return
      if (retrying) return void (retrying = false)
      window.clearTimeout(retryTimer)
      retries = 0
    }
    // The page crashed: it's loaded again
    const gone = () => el.reload()
    el.addEventListener('did-fail-load', failed)
    el.addEventListener('did-start-navigation', navStart)
    el.addEventListener('render-process-gone', gone)
    el.addEventListener('dom-ready', ready)
    el.addEventListener('did-navigate', nav)
    el.addEventListener('did-navigate-in-page', nav)
    el.addEventListener('did-start-loading', start)
    el.addEventListener('did-stop-loading', stop)
    return () => {
      window.clearTimeout(retryTimer)
      el.removeEventListener('did-fail-load', failed)
      el.removeEventListener('did-start-navigation', navStart)
      el.removeEventListener('render-process-gone', gone)
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
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  const agentActive = !!cursor && now - cursor.at < 4000
  const ws = useStore((s) => s.workspaces.find((w) => w.id === cursor?.workspaceId))

  // The preview of a project's branch: the open chat's by default, another project's from the picker (the chat stays).
  const selectedWs = useStore((s) => s.selectedWs)
  const workspaces = useStore((s) => s.workspaces)
  const projects = useStore((s) => s.projects)
  const [pickedWs, setPickedWs] = useState<string | null>(null)
  useEffect(() => setPickedWs(null), [selectedWs])
  const wsId = pickedWs ?? selectedWs
  const previewProject = workspaces.find((w) => w.id === wsId)?.projectId ?? null
  const pickProject = (pid: string | null) => {
    if (!pid) return
    const sel = workspaces.find((w) => w.id === selectedWs)
    if (sel?.projectId === pid) return setPickedWs(null)
    // That project's branch to preview: its main checkout, else its latest branch
    const p = projects.find((x) => x.id === pid)
    const mine = workspaces.filter((w) => w.projectId === pid)
    const ws = mine.find((w) => w.worktreePath === p?.path) ?? [...mine].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    if (ws) setPickedWs(ws.id)
  }
  const [dev, setDev] = useState<DevServerState | null>(null)
  // The branch the preview showed last, and whether its preview was on
  const shownWs = useRef<{ id: string; projectId: string | null; on: boolean } | null>(null)
  useEffect(() => {
    if (shownWs.current && dev) shownWs.current.on = ['installing', 'starting', 'ready'].includes(dev.status)
  }, [dev])
  useEffect(() => {
    setDev(null)
    const before = shownWs.current
    shownWs.current = wsId ? { id: wsId, projectId: previewProject, on: false } : null
    if (!wsId) return
    // Already running (another branch, the panel reopened): open its page right away
    void window.cm.preview.state(wsId).then((st) => {
      setDev(st)
      if (st.status !== 'ready' || !st.url) {
        // Another branch: its page goes, so the preview never shows a branch that isn't the active one
        if (before && before.id !== wsId) {
          pendingUrl.current = null
          if (domReady.current && view.current?.getURL() !== 'about:blank') void view.current?.loadURL('about:blank').catch(() => {})
          // The same project's preview was on: it moves to this branch
          if (before.on && before.projectId === previewProject && !['installing', 'starting'].includes(st.status)) {
            void window.cm.preview.stop(before.id).then(() => window.cm.preview.start(wsId))
          }
        }
        return
      }
      if (!domReady.current) pendingUrl.current = st.url
      else if (!view.current?.getURL()?.startsWith(st.url)) void view.current?.loadURL(st.url).catch(() => {})
    })
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
  // A phone or tablet size: the page sits in a device frame on a dark backdrop (desktop sizes fill the panel)
  const [device, setDevice] = useState<{ w: number; h: number } | null>(null)
  const [size, setSize] = usePersisted<string>('browser.viewport', 'panel')
  const sizeRef = useRef(size)
  sizeRef.current = size
  useEffect(
    () =>
      window.cm.onEvent((e) => {
        if (e.type !== 'browser-viewport') return
        setViewport(e.label)
        setDevice(e.label && e.width && e.height && e.width < 1024 ? { w: e.width, h: e.height } : null)
        // The agent picked a size: the selector follows it
        setSize(e.label ? e.preset ?? 'custom' : 'panel')
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const pickView = (v: string) => {
    setSize(v)
    void window.cm.browserViewport(v === 'panel' ? null : v)
  }
  // The page area changed size: an emulated viewport is fitted again, so it always fills the height
  const area = useRef<HTMLDivElement>(null)
  const screen = useRef<HTMLDivElement>(null)
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = area.current
    const sc = screen.current
    if (!el || !sc) return
    let timer: number | undefined
    const ro = new ResizeObserver(() => {
      setAreaSize({ w: el.clientWidth, h: el.clientHeight })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => sizeRef.current !== 'panel' && void window.cm.browserRefit(), 150)
    })
    ro.observe(el)
    // The device frame resized the page: the emulation is fitted to the new screen
    ro.observe(sc)
    return () => (ro.disconnect(), window.clearTimeout(timer))
  }, [])
  // Where the device's screen sits: as large as the panel allows, never above its real size
  const frame = (() => {
    if (!device || !areaSize.w) return null
    const phone = device.w < 600
    const bezel = phone ? 12 : 16
    const s = Math.min(1, (areaSize.w - 48 - bezel * 2) / device.w, (areaSize.h - 48 - bezel * 2) / device.h)
    const w = Math.round(device.w * s)
    const h = Math.round(device.h * s)
    return { w, h, x: Math.round((areaSize.w - w) / 2), y: Math.round((areaSize.h - h) / 2), bezel, r: Math.round((phone ? 46 : 26) * s) }
  })()
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
      {/* Whose preview this is: a row of its own */}
      {wsId && (
        <div className="shrink-0 border-b border-line px-2 py-1.5">
          <ProjectPicker value={previewProject} onChange={pickProject} className="!h-8 !w-full" />
        </div>
      )}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <Tooltip content={t('Back')} side="bottom">
          <button className={btn} onClick={() => view.current?.goBack()} aria-label={t('Back')}><ArrowLeft size={14} /></button>
        </Tooltip>
        <Tooltip content={t('Forward')} side="bottom">
          <button className={btn} onClick={() => view.current?.goForward()} aria-label={t('Forward')}><ArrowRight size={14} /></button>
        </Tooltip>
        <Tooltip content={t('Reload')} side="bottom">
          <button className={btn} onClick={() => view.current?.reload()} aria-label={t('Reload')}>
            <RotateCw size={13} className={loading ? 'animate-spin' : undefined} />
          </button>
        </Tooltip>
        <Tooltip content={t('Open in the browser')} side="bottom">
          <button
            className={btn}
            onClick={() => {
              const u = view.current?.getURL() || input.trim()
              if (/^https?:\/\//.test(u)) window.open(u, '_blank')
            }}
            aria-label={t('Open in the browser')}
          >
            <ExternalLink size={13} />
          </button>
        </Tooltip>
        {wsId && (
          <Tooltip content={devOn ? t('Stop preview') : t('Start preview')} side="bottom">
            <button className={btn} onClick={toggleDev} aria-label={devOn ? t('Stop preview') : t('Start preview')}>
              {dev?.status === 'installing' || dev?.status === 'starting' ? <Spinner size={12} /> : devOn ? <Square size={12} /> : <Play size={13} />}
            </button>
          </Tooltip>
        )}
        {(dev?.pages?.length ?? 0) > 1 && (
          // The project starts several apps (site, admin…): which one the preview shows
          <Select
            size="sm"
            className="w-[130px] shrink-0"
            aria-label={t('App')}
            options={dev!.pages!.map((p) => ({ value: p.url, label: p.label.charAt(0).toUpperCase() + p.label.slice(1) }))}
            value={[...dev!.pages!].sort((a, b) => b.url.length - a.url.length).find((p) => url.startsWith(p.url))?.url ?? null}
            placeholder={t('App')}
            onChange={(u) => void view.current?.loadURL(u).catch(() => {})}
          />
        )}
        {wsId && (
          <Tooltip content={t('Work out again how to start it')} side="bottom">
            <button className={btn} onClick={() => void window.cm.preview.redetect(wsId)} aria-label={t('Work out again how to start it')}>
              <ScanSearch size={13} />
            </button>
          </Tooltip>
        )}
        <TextField
          size="sm"
          className="min-w-0 flex-1"
          inputClassName="font-mono"
          prefix={<Globe size={12} />}
          aria-label={t('Address')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="localhost:5173"
          spellCheck={false}
        />
        <Select
          size="sm"
          className="w-[150px] shrink-0"
          aria-label={t('Viewport')}
          options={VIEWS.map((o) => ({ ...o, label: t(o.label) }))}
          value={VIEWS.some((o) => o.value === size) ? size : null}
          placeholder={viewport ?? t('Responsive')}
          onChange={pickView}
        />
      </div>
      {dev?.status === 'ready' && dev.message && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-warn/[.08] px-3 py-1 text-[11.5px] text-warn">
          <TriangleAlert size={12} className="shrink-0" />
          <Marquee className="min-w-0 flex-1" delay={300}>{devNote(dev.message)}</Marquee>
        </div>
      )}
      {agentActive && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-accent/[.08] px-3 py-1 text-[11.5px] text-accent">
          <Bot size={12} /> {t('The agent is using the browser')}
          {viewport && <span className="ml-auto shrink-0 whitespace-nowrap text-accent/80">{viewport}</span>}
        </div>
      )}
      <div ref={area} className={cn('relative min-h-0 flex-1', frame ? 'bg-[#0b0b0d]' : 'bg-white')}>
        {frame && (
          <div
            aria-hidden
            className="pointer-events-none absolute bg-[#18181b] shadow-[0_0_0_1px_rgba(255,255,255,.09),inset_0_0_0_1px_rgba(255,255,255,.05),0_30px_80px_-20px_rgba(0,0,0,.8)]"
            style={{ left: frame.x - frame.bezel, top: frame.y - frame.bezel, width: frame.w + frame.bezel * 2, height: frame.h + frame.bezel * 2, borderRadius: frame.r + frame.bezel }}
          >
            {/* The side buttons */}
            <span className="absolute -left-[3px] top-[18%] h-[6%] w-[3px] rounded-l bg-[#26262b]" />
            <span className="absolute -left-[3px] top-[27%] h-[9%] w-[3px] rounded-l bg-[#26262b]" />
            <span className="absolute -right-[3px] top-[24%] h-[12%] w-[3px] rounded-r bg-[#26262b]" />
          </div>
        )}
        <div
          ref={screen}
          className="absolute overflow-hidden bg-white"
          style={frame ? { left: frame.x, top: frame.y, width: frame.w, height: frame.h, borderRadius: frame.r } : { inset: 0 }}
        >
        <webview ref={view as any} src="about:blank" partition="persist:cm2-browser" className="absolute inset-0 h-full w-full" />
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
                <span className="text-[12px] font-semibold leading-tight text-white">{t('Agent')}</span>
                <Marquee className="max-w-[120px] rounded-md bg-white/10 px-1.5 py-px font-mono text-[10px] leading-tight text-white/75" delay={300}>{ws?.branch ?? 'browser'}</Marquee>
              </div>
              <Marquee className="mt-0.5 text-[11.5px] leading-snug text-white/60" delay={300}>{cursor.label}</Marquee>
            </div>
          </div>
        )}
        </div>
        {!url || url === 'about:blank' ? (
          <div className="absolute inset-0 grid place-items-center bg-bg px-6">
            {dev?.status === 'ready' && dev.app ? (
              <EmptyState
                bare
                icon={dev.app === 'window' ? <AppWindow size={16} /> : <Smartphone size={16} />}
                title={dev.app === 'window' ? t('The app is running in its own window') : dev.app === 'ios' ? t('The app is running on the iOS Simulator') : t('The app is running on the Android emulator')}
              />
            ) : dev?.detecting ? (
              <EmptyState
                bare
                icon={<Spinner size={16} />}
                title={t('Working out how to start the project…')}
                text={t('Once only: frontend, backend and the linked projects.')}
              />
            ) : dev?.status === 'installing' || dev?.status === 'starting' ? (
              <EmptyState
                bare
                icon={<Spinner size={16} />}
                title={dev.status === 'installing' ? t('Installing dependencies…') : t('Starting the preview…')}
                text={(dev.services?.length ?? 0) > 1 ? t('Starting: {names}.', { names: dev.services!.join(', ') }) : dev.app === 'window' ? t('The app opens in its own window.') : dev.app === 'ios' ? t('The app opens on the iOS Simulator.') : dev.app === 'android' ? t('The app opens on the Android emulator.') : t('The page opens here when the dev server answers.')}
              />
            ) : (
              <EmptyState
                bare
                icon={<Globe size={16} />}
                title={dev?.status === 'error' ? t("The preview didn't start") : t('No preview')}
                text={dev?.status === 'error' ? <span className="text-bad">{dev.message}</span> : t('Start the dev server, or type an address above.')}
                action={
                  wsId && (
                    <Button size="sm" variant="secondary" iconRight={<Play size={13} />} onClick={toggleDev}>
                      {dev?.status === 'error' ? t('Try again') : t('Start preview')}
                    </Button>
                  )
                }
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
