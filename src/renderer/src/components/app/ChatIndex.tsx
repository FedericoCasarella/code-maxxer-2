import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Marquee } from './Marquee'

const NONE: never[] = []
const MAX_BARS = 36
const GAP = 7 // px between bars
const BASE = 10 // bar width at rest
const PEAK = 26 // bar width under the pointer
const REACH = 34 // px of influence around the pointer (dock magnification)
const DWELL = 350 // ms resting on a bar before its title shows

/**
 * The chat's index rail: one bar per prompt (sampled when there are many). Hovering works like a dock:
 * the bar under the pointer grows (its neighbours a little), resting on it shows its title, a click goes there.
 */
export function ChatIndex({ wsId, scroller, onJumped }: { wsId: string; scroller: RefObject<HTMLDivElement | null>; onJumped: () => void }) {
  const index = useStore((s) => s.chatIndex[wsId]) ?? NONE
  const rail = useRef<HTMLDivElement>(null)
  const [pointerY, setPointerY] = useState<number | null>(null)
  const [label, setLabel] = useState<number | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const dwell = useRef<number | undefined>(undefined)

  const bars = useMemo(() => {
    if (index.length <= MAX_BARS) return index
    const step = index.length / MAX_BARS
    return Array.from({ length: MAX_BARS }, (_, i) => index[Math.floor(i * step)])
  }, [index])

  // Which prompt is at the top of the view.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const update = () => {
      const top = el.getBoundingClientRect().top + 60
      let best: string | null = null
      for (const it of index) {
        const node = el.querySelector<HTMLElement>(`[data-mid="${it.id}"]`)
        if (!node) continue
        if (node.getBoundingClientRect().top <= top) best = it.id
        else if (best) break
      }
      setCurrent(best)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [index, scroller])

  if (index.length < 2) return null

  // Bar centres in rail coordinates (fixed: magnification grows width, never shifts bars).
  const center = (i: number) => 8 + i * GAP + 1
  const nearest = pointerY === null ? null : Math.max(0, Math.min(bars.length - 1, Math.round((pointerY - 9) / GAP)))
  const curBar = (() => {
    const ci = index.findIndex((x) => x.id === current)
    if (ci < 0) return -1
    let b = 0
    for (let i = 0; i < bars.length; i++) if (index.indexOf(bars[i]) <= ci) b = i
    return b
  })()

  const jump = async (it: (typeof index)[number]) => {
    const el = scroller.current
    if (!el) return
    onJumped()
    let node = el.querySelector<HTMLElement>(`[data-mid="${it.id}"]`)
    let loaded = false
    if (!node && it.seq !== Number.MAX_SAFE_INTEGER) {
      await actions.loadAround(wsId, it.seq)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      node = el.querySelector<HTMLElement>(`[data-mid="${it.id}"]`)
      loaded = true
    }
    if (!node) return
    node.scrollIntoView({ block: 'start', behavior: loaded ? 'auto' : 'smooth' })
    if (loaded) requestAnimationFrame(() => requestAnimationFrame(() => node!.scrollIntoView({ block: 'start' })))
  }

  const onMove = (e: React.MouseEvent) => {
    const r = rail.current!.getBoundingClientRect()
    const y = e.clientY - r.top
    setPointerY(y)
    const n = Math.max(0, Math.min(bars.length - 1, Math.round((y - 9) / GAP)))
    if (n !== label) {
      setLabel(null)
      window.clearTimeout(dwell.current)
      dwell.current = window.setTimeout(() => setLabel(n), DWELL)
    }
  }
  const onLeave = () => {
    setPointerY(null)
    setLabel(null)
    window.clearTimeout(dwell.current)
  }

  const height = 16 + (bars.length - 1) * GAP + 2

  return (
    <div className="absolute right-1 top-1/2 z-20 -translate-y-1/2">
      <div
        ref={rail}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
        onClick={() => nearest !== null && void jump(bars[nearest])}
        className="relative cursor-pointer"
        style={{ height, width: PEAK + 14 }}
        role="navigation"
        aria-label="Chat index"
      >
        {bars.map((b, i) => {
          const d = pointerY === null ? Infinity : Math.abs(center(i) - pointerY)
          const t = Math.max(0, 1 - d / REACH)
          const w = BASE + (PEAK - BASE) * t * t
          const hot = i === nearest
          return (
            <span
              key={b.id}
              className={cn(
                'absolute right-2 h-[2px] rounded-full transition-[width,background-color] duration-150 ease-out',
                hot ? 'bg-ink' : i === curBar ? 'bg-ink/80' : t > 0 ? 'bg-white/45' : 'bg-white/22'
              )}
              style={{ top: center(i) - 1, width: i === curBar && pointerY === null ? BASE + 6 : w }}
            />
          )
        })}
        {label !== null && bars[label] && (
          <div
            className="cm-in pointer-events-none absolute right-full mr-2 max-w-[300px] -translate-y-1/2 rounded-lg border border-line-strong bg-raised px-2.5 py-1.5 text-[12.5px] text-ink shadow-xl"
            style={{ top: center(label) }}
          >
            <Marquee delay={300}>
              <span className="mr-1.5 text-[11px] tabular-nums text-mute">{index.indexOf(bars[label]) + 1}</span>
              {bars[label].text || '…'}
            </Marquee>
          </div>
        )}
      </div>
    </div>
  )
}
