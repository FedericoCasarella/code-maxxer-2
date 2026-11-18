import { useEffect, useState } from 'react'

/**
 * useState that survives page changes and restarts: the user's view choices (period, chart type,
 * filters, tabs) come back as they left them. Stored per key in localStorage; any failure falls back to the default.
 */
export function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const k = `cm2.view.${key}`
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(k)
      return raw === null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch { /* private mode or full: keep it in memory */ }
  }, [k, v])
  return [v, setV]
}
