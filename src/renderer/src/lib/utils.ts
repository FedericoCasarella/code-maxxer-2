import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { t } from './i18n'

export const cn = (...v: ClassValue[]) => twMerge(clsx(v))

/**
 * Short relative time: '5m', '3h', '2d' (translated units). Under a minute it returns the literal 'now'
 * (untranslated: callers compare against it); show it with timeAgoLabel, or t('now').
 */
export function timeAgo(iso: string | number): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return t('{n}d', { n: Math.round(h / 24) })
}

/** timeAgo for display on its own: 'now' comes out translated. */
export const timeAgoLabel = (iso: string | number): string => {
  const v = timeAgo(iso)
  return v === 'now' ? t('now') : v
}

export function untilLabel(ts: number | null): string {
  if (!ts) return '—'
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d ? t('{d}d {h}h', { d, h }) : h ? `${h}h ${m % 60}m` : `${m}m`
}
