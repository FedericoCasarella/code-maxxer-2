import { useEffect, useState } from 'react'

type Pane = { width: number; collapsed: boolean }

const read = (key: string, fallback: Pane): Pane => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '')
    if (typeof v?.width === 'number') return { ...fallback, ...v }
  } catch { /* defaults */ }
  return fallback
}

/**
 * A side drawer with a pixel width and a collapsed flag, persisted across restarts. The dragging itself is done by
 * the affect Resizable handle; this hook only turns the dragged width into the drawer's state (clamped, and folded
 * away when pulled well past the minimum, like VS Code).
 */
export function usePane(key: string, opts: { initial: number; min: number; max: number | (() => number) }) {
  const storageKey = `cm2.pane.${key}`
  const [pane, setPane] = useState<Pane>(() => read(storageKey, { width: opts.initial, collapsed: false }))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(pane))
    } catch { /* ignore */ }
  }, [pane, storageKey])

  // The max can follow the window (a wide screen gives the drawer more room).
  const max = () => Math.max(opts.min, typeof opts.max === 'function' ? opts.max() : opts.max)
  const clamp = (w: number) => Math.round(Math.min(max(), Math.max(opts.min, w)))

  return {
    width: Math.min(pane.width, max()),
    collapsed: pane.collapsed,
    setCollapsed: (collapsed: boolean) => setPane((p) => ({ ...p, collapsed })),
    toggle: () => setPane((p) => ({ ...p, collapsed: !p.collapsed })),
    /** The width the handle was dragged to, in px */
    drag: (raw: number) => {
      // Dragging well past the minimum folds the drawer away.
      if (raw < opts.min - 60) setPane((p) => (p.collapsed ? p : { ...p, collapsed: true }))
      else setPane({ width: clamp(raw), collapsed: false })
    },
    /** Pins the stored width to the one on screen (a max clamp then can't let it grow back on its own) */
    hold: () => setPane((p) => (p.width > max() ? { ...p, width: Math.round(max()) } : p)),
    reset: () => setPane({ width: opts.initial, collapsed: false })
  }
}
