import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'

type Pane = { width: number; collapsed: boolean }

const read = (key: string, fallback: Pane): Pane => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '')
    if (typeof v?.width === 'number') return { ...fallback, ...v }
  } catch { /* defaults */ }
  return fallback
}

/**
 * A side drawer with a pixel width the user drags (VS Code style) and a collapsed flag.
 * `edge` is the side of the drawer the handle sits on.
 */
export function usePane(key: string, opts: { initial: number; min: number; max: number; edge: 'right' | 'left' }) {
  const storageKey = `cm2.pane.${key}`
  const [pane, setPane] = useState<Pane>(() => read(storageKey, { width: opts.initial, collapsed: false }))
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; w: number } | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pane))
    } catch { /* ignore */ }
  }, [pane, storageKey])

  const clamp = (w: number) => Math.round(Math.min(opts.max, Math.max(opts.min, w)))

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      start.current = { x: e.clientX, w: pane.width }
      setDragging(true)
    },
    [pane.width]
  )
  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current) return
    const dx = e.clientX - start.current.x
    const raw = start.current.w + (opts.edge === 'right' ? dx : -dx)
    // Dragging well past the minimum folds the drawer away, like VS Code.
    if (raw < opts.min - 60) setPane((p) => ({ ...p, collapsed: true }))
    else setPane({ width: clamp(raw), collapsed: false })
  }
  const end = () => {
    start.current = null
    setDragging(false)
  }

  return {
    width: pane.width,
    collapsed: pane.collapsed,
    setCollapsed: (collapsed: boolean) => setPane((p) => ({ ...p, collapsed })),
    toggle: () => setPane((p) => ({ ...p, collapsed: !p.collapsed })),
    dragging,
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: end,
      onDoubleClick: () => setPane({ width: opts.initial, collapsed: false })
    }
  }
}
