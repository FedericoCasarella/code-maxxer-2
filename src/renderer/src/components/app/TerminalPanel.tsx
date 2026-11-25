import { useEffect, useRef, useState } from 'react'
import { Plus, RotateCcw, SquareTerminal } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { t } from '@/lib/i18n'
import { Button } from '../affect/button'
import { EmptyState } from '../affect/empty-state'
import { Tab } from './editor/EditorTabs'

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

const MAIN = 'main'

/**
 * The branch's shells, in its folder, as tabs: the user types here, and the agents run the app, servers and project
 * commands here too (a server in its own tab), so everything they run stays in sight.
 */
export function TerminalPanel({ workspaceId }: { workspaceId: string | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [ended, setEnded] = useState(false)
  const [round, setRound] = useState(0)
  const [tabs, setTabs] = useState<string[]>([MAIN])
  const [tab, setTab] = useState(MAIN)
  const all = [MAIN, ...tabs.filter((x) => x !== MAIN)]

  // The tabs of the branch, also those an agent opens
  useEffect(() => {
    if (!workspaceId) return
    setTab(MAIN)
    void window.cm.terminal.tabs(workspaceId).then(setTabs)
    return window.cm.onEvent((e) => e.type === 'terminal-tabs' && e.workspaceId === workspaceId && setTabs(e.tabs))
  }, [workspaceId])
  // A closed tab can't stay in front
  useEffect(() => {
    if (tab !== MAIN && !tabs.includes(tab)) setTab(MAIN)
  }, [tabs.join(), tab])

  useEffect(() => {
    const el = box.current
    if (!el || !workspaceId) return
    setEnded(false)
    const term = new Terminal({
      fontFamily: css('--font-mono', 'Menlo, monospace'),
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: { background: css('--color-bg', '#111113'), foreground: css('--color-ink', '#ededed'), cursor: css('--color-ink', '#ededed'), selectionBackground: 'rgba(255,255,255,.18)' }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()
    let live = true
    void window.cm.terminal.open(workspaceId, tab, term.cols, term.rows).then((past) => {
      if (!live) return
      if (past) term.write(past)
      term.focus()
    })
    const input = term.onData((d) => void window.cm.terminal.write(workspaceId, tab, d))
    const resize = term.onResize(({ cols, rows }) => void window.cm.terminal.resize(workspaceId, tab, cols, rows))
    const off = window.cm.onEvent((e) => {
      if (e.type === 'terminal-data' && e.workspaceId === workspaceId && e.tab === tab) term.write(e.data)
      else if (e.type === 'terminal-exit' && e.workspaceId === workspaceId && e.tab === tab) setEnded(true)
    })
    const ro = new ResizeObserver(() => {
      if (el.offsetWidth > 0 && el.offsetHeight > 0) fit.fit()
    })
    ro.observe(el)
    return () => {
      live = false
      ro.disconnect()
      off()
      input.dispose()
      resize.dispose()
      term.dispose()
    }
  }, [workspaceId, round, tab])

  if (!workspaceId)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare icon={<SquareTerminal size={16} />} title={t('Open a branch to use its terminal')} />
      </div>
    )
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div role="tablist" className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 [scrollbar-width:none]">
        {all.map((x) => (
          <Tab
            key={x}
            active={x === tab}
            onClick={() => setTab(x)}
            onClose={x === MAIN ? undefined : () => void window.cm.terminal.close(workspaceId, x)}
            icon={<SquareTerminal size={14} className="text-dim" />}
            label={x === MAIN ? t('Main') : x}
          />
        ))}
        <button
          aria-label={t('New terminal')}
          title={t('New terminal')}
          onClick={() => void window.cm.terminal.add(workspaceId).then(setTab)}
          className="grid size-7 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink"
        >
          <Plus size={15} />
        </button>
      </div>
      <div ref={box} className="min-h-0 flex-1 px-2 pt-2" />
      {ended && (
        <div className="absolute inset-x-0 bottom-0 top-10 grid place-items-center bg-bg/90">
          <EmptyState
            bare
            icon={<SquareTerminal size={16} />}
            title={t('The terminal was closed')}
            action={
              <Button size="sm" variant="secondary" iconRight={<RotateCcw size={13} />} onClick={() => setRound((r) => r + 1)}>
                {t('Open again')}
              </Button>
            }
          />
        </div>
      )}
    </div>
  )
}
