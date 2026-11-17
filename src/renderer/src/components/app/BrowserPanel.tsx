import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, Globe, RotateCw } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { TextField } from '../affect/text-field'

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
  const cursor = useStore((s) => s.cursor)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const el = view.current
    if (!el) return
    const ready = () => void window.cm.browserReady(el.getWebContentsId())
    const nav = () => {
      setUrl(el.getURL())
      setInput(el.getURL())
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

  // Fade the agent cursor out a few seconds after its last move.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const agentActive = !!cursor && now - cursor.at < 4000
  const ws = useStore((s) => s.workspaces.find((w) => w.id === cursor?.workspaceId))
  const agentName = ws ? `Agent · ${ws.branch}` : 'Agent'

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
      </div>
      {agentActive && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-accent/[.08] px-3 py-1 text-[11.5px] text-accent">
          <Bot size={12} /> The agent is using the browser
        </div>
      )}
      <div className="relative min-h-0 flex-1 bg-white">
        <webview ref={view as any} src="about:blank" partition="persist:cm2-browser" className="absolute inset-0 h-full w-full" />
        {!url || url === 'about:blank' ? (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-bg text-center text-[12.5px] text-mute">
            <div>
              <Globe size={20} className="mx-auto mb-2" />
              The agent opens your dev server here to test.
              <br />
              You can browse it too.
            </div>
          </div>
        ) : null}
        {cursor && (
          <div
            className={cn('pointer-events-none absolute left-0 top-0 z-10 transition-[transform,opacity] duration-[380ms] ease-[cubic-bezier(.22,1,.36,1)]', agentActive ? 'opacity-100' : 'opacity-0')}
            style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)` }}
          >
            {cursor.click && <span key={cursor.at} className="absolute -left-4 -top-4 size-8 rounded-full border-2 border-accent" style={{ animation: 'cm-ping .6s ease-out forwards' }} />}
            {/* pointer + bubble with who and what, like a multiplayer cursor */}
            <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-[0_2px_3px_rgba(0,0,0,.45)]">
              <path d="M2 1.6 16 8.4l-6.3 1.7-2.9 6.3z" fill="#f5f5f2" stroke="#1c1c1f" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
            <div className="absolute left-5 top-5 min-w-[96px] max-w-[220px] rounded-[14px] rounded-tl-[4px] bg-accent px-3 py-1.5 shadow-[0_6px_18px_-6px_rgba(0,0,0,.6)]">
              <div className="text-[10.5px] font-medium leading-tight text-black/55">{agentName}</div>
              <div className="truncate text-[12.5px] font-medium leading-snug text-black">{cursor.label}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
