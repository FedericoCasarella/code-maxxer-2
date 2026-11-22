import { useEffect, useRef, useState } from 'react'
import { RotateCcw, SquareTerminal } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { t } from '@/lib/i18n'
import { Button } from '../affect/button'
import { EmptyState } from '../affect/empty-state'

const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback

/** The branch's shell, in its folder: the user types here, and the agents' terminal commands show up here too. */
export function TerminalPanel({ workspaceId }: { workspaceId: string | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [ended, setEnded] = useState(false)
  const [round, setRound] = useState(0)

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
    void window.cm.terminal.open(workspaceId, term.cols, term.rows).then((past) => {
      if (!live) return
      if (past) term.write(past)
      term.focus()
    })
    const input = term.onData((d) => void window.cm.terminal.write(workspaceId, d))
    const resize = term.onResize(({ cols, rows }) => void window.cm.terminal.resize(workspaceId, cols, rows))
    const off = window.cm.onEvent((e) => {
      if (e.type === 'terminal-data' && e.workspaceId === workspaceId) term.write(e.data)
      else if (e.type === 'terminal-exit' && e.workspaceId === workspaceId) setEnded(true)
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
  }, [workspaceId, round])

  if (!workspaceId) return <EmptyState bare icon={<SquareTerminal size={16} />} title={t('Open a branch to use its terminal')} />
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={box} className="min-h-0 flex-1 px-2 pt-2" />
      {ended && (
        <div className="absolute inset-0 grid place-items-center bg-bg/90">
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
