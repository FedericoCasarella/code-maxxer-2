import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * One-line text that fits with a soft fade when it's too long; after resting the pointer on its row
 * for `delay` ms it glides horizontally to reveal the rest, then back when the pointer leaves.
 */
export function Marquee({
  children, className, delay = 1800, speed = 40, hoverTarget
}: {
  children: ReactNode
  className?: string
  delay?: number
  /** px per second */
  speed?: number
  /** CSS selector of the ancestor whose hover starts it (default: the text itself) */
  hoverTarget?: string
}) {
  const outer = useRef<HTMLSpanElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  const [over, setOver] = useState(false)

  useEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const measure = () => setOver(i.scrollWidth - o.clientWidth > 1)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    const host = (hoverTarget && o.closest<HTMLElement>(hoverTarget)) || o
    let t: number | undefined
    const enter = () => {
      t = window.setTimeout(() => setShift(Math.max(0, i.scrollWidth - o.clientWidth)), delay)
    }
    const leave = () => {
      window.clearTimeout(t)
      setShift(0)
    }
    host.addEventListener('pointerenter', enter)
    host.addEventListener('pointerleave', leave)
    return () => {
      ro.disconnect()
      window.clearTimeout(t)
      host.removeEventListener('pointerenter', enter)
      host.removeEventListener('pointerleave', leave)
    }
  }, [delay, hoverTarget])

  const dur = Math.max(0.6, shift / speed)
  return (
    <span
      ref={outer}
      className={className}
      style={{
        display: 'block', overflow: 'hidden', whiteSpace: 'nowrap', minWidth: 0,
        WebkitMaskImage: over && shift === 0 ? 'linear-gradient(to right, #000 calc(100% - 28px), transparent)' : undefined,
        maskImage: over && shift === 0 ? 'linear-gradient(to right, #000 calc(100% - 28px), transparent)' : undefined
      }}
    >
      <span
        ref={inner}
        style={{
          display: 'inline-block',
          transform: `translateX(${-shift}px)`,
          transition: `transform ${shift ? dur : 0.35}s ${shift ? 'linear' : 'cubic-bezier(.22,1,.36,1)'}`
        }}
      >
        {children}
      </span>
    </span>
  )
}
