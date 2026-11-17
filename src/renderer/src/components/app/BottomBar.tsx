import { useRef, useState } from 'react'
import { ChevronRight, RefreshCw } from 'lucide-react'
import type { UsageWindow } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn, untilLabel } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { SegmentedControl } from '../affect/segmented-control'
import { ClaudeGlyph, CodexGlyph } from './Logos'

const primary = (w: UsageWindow[]) => w.find((x) => x.label === '5h') ?? w[0]

export function BottomBar() {
  const usage = useStore((s) => s.usage)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'detailed' | 'compact'>('compact')
  const [spinning, setSpinning] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const c = primary(usage.claude.windows)
  const x = primary(usage.codex.windows)

  const refresh = async () => {
    setSpinning(true)
    await actions.refreshUsage()
    setSpinning(false)
  }

  const rows = [
    { id: 'claude', name: 'Claude', glyph: <ClaudeGlyph size={16} />, windows: usage.claude.windows },
    { id: 'codex', name: 'Codex', glyph: <CodexGlyph size={16} />, windows: usage.codex.windows }
  ]

  return (
    <footer className="flex h-7 shrink-0 items-center gap-1 border-t border-line bg-bg px-2 text-[11.5px] text-dim">
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        className={cn('flex h-5 items-center gap-2.5 rounded-md px-1.5 hover:bg-white/5', open && 'bg-white/5')}
      >
        <span className="text-mute">Used</span>
        <span className="flex items-center gap-1.5">
          <ClaudeGlyph size={12} />
          <span className="tabular-nums">{c ? `${c.usedPercent}%` : '—'}</span>
          {c?.resetsAt && <span className="tabular-nums text-mute">{untilLabel(c.resetsAt)}</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <CodexGlyph size={12} />
          <span className="tabular-nums">{x ? `${x.usedPercent}%` : '—'}</span>
          {x?.resetsAt && <span className="tabular-nums text-mute">{untilLabel(x.resetsAt)}</span>}
        </span>
      </button>
      <button onClick={refresh} className="grid size-5 place-items-center rounded-md text-mute hover:bg-white/5 hover:text-ink" aria-label="Refresh usage">
        <RefreshCw size={11} className={spinning ? 'animate-spin' : undefined} />
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="top" align="start" width={400} offset={8} unstyled>
        <div className="cm-in rounded-2xl border border-line-strong bg-raised p-3 shadow-2xl">
          <div className="flex items-center gap-2 px-1 pb-2.5">
            <span className="text-[13.5px] font-semibold text-ink">Usage</span>
            <span className="text-[12px] text-mute">· all agents</span>
            <button onClick={refresh} className="text-mute hover:text-ink" aria-label="Refresh">
              <RefreshCw size={12} className={spinning ? 'animate-spin' : undefined} />
            </button>
          </div>
          <SegmentedControl
            fullWidth
            size="sm"
            value={view}
            onChange={setView}
            options={[
              { value: 'detailed', label: 'Detailed' },
              { value: 'compact', label: 'Compact' }
            ]}
            aria-label="Usage view"
          />
          <div className="mt-2 flex flex-col">
            {rows.map((r) => {
              const p = primary(r.windows)
              return (
                <div key={r.id} className="border-b border-line py-2.5 last:border-0">
                  <div className="flex items-center gap-3 px-1">
                    {r.glyph}
                    <span className="flex-1 text-[13px] text-ink">{r.name}</span>
                    <span className="text-[12px] tabular-nums text-dim">{p?.resetsAt ? untilLabel(p.resetsAt) : 'no data'}</span>
                    <Bar pct={p?.usedPercent ?? 0} />
                    <span className="w-9 text-right text-[12.5px] tabular-nums text-ink">{p ? `${p.usedPercent}%` : '—'}</span>
                    <ChevronRight size={13} className="text-mute" />
                  </div>
                  {view === 'detailed' &&
                    r.windows.map((w) => (
                      <div key={w.label} className="mt-1.5 flex items-center gap-3 pl-8 pr-6 text-[11.5px] text-mute">
                        <span className="flex-1">{w.label} window · resets in {untilLabel(w.resetsAt)}</span>
                        <Bar pct={w.usedPercent} />
                        <span className="w-9 text-right tabular-nums">{w.usedPercent}%</span>
                      </div>
                    ))}
                </div>
              )
            })}
          </div>
          <p className="px-1 pt-1 text-[11px] leading-4 text-mute">
            Claude updates from each agent run. Codex is read from <span className="font-mono">codex app-server</span>.
          </p>
        </div>
      </Popover>
    </footer>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <span className="h-1.5 w-14 overflow-hidden rounded-full bg-white/10">
      <span
        className={cn('block h-full rounded-full transition-[width] duration-500', pct >= 90 ? 'bg-bad' : pct >= 70 ? 'bg-warn' : 'bg-dim')}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </span>
  )
}
