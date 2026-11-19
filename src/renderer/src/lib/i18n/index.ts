import { useSyncExternalStore } from 'react'
import { it } from './it'

/*
 * Interface language. The English text is the key: t('No preview') returns it as is in English,
 * or its translation. Placeholders in braces are filled from vars: t('{n} files', { n: 3 }).
 * A string with no translation falls back to English.
 */

export type UiLang = 'en' | 'it'
export const UI_LANGS: Record<UiLang, string> = { en: 'English', it: 'Italiano' }

const DICTS: Record<UiLang, Record<string, string>> = { en: {}, it }
const KEY = 'cm2.uiLang'

const read = (): UiLang => {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'it' || v === 'en' ? v : 'en'
  } catch {
    return 'en'
  }
}

let lang: UiLang = read()
const subs = new Set<() => void>()

export const uiLang = () => lang
export function setUiLang(next: UiLang) {
  if (next === lang) return
  lang = next
  try {
    localStorage.setItem(KEY, next)
  } catch { /* the choice still applies until restart */ }
  document.documentElement.lang = next
  subs.forEach((f) => f())
}
document.documentElement.lang = lang

/** Re-renders the caller when the language changes. */
export const useUiLang = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => lang
  )

/**
 * Same English word, different meaning: add the context after a bar, t('Open|status').
 * Without a translation the part before the bar shows.
 */
export function t(en: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang][en] ?? (en.includes('|') ? en.slice(0, en.indexOf('|')) : en)
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s
}

/** Locale for dates and numbers. */
export const locale = () => (lang === 'it' ? 'it-IT' : 'en-US')
