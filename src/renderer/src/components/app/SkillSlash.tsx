import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Zap } from 'lucide-react'
import type { LibrarySkill } from '@shared/skills'
import { cn } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { HoverCard } from '../affect/hover-card'
import { Spinner } from '../affect/spinner'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'

/** The "/query" being typed right before the caret, at the start of a word. */
export function slashAt(text: string, caret: number): { start: number; query: string } | null {
  const m = text.slice(0, caret).match(/(^|\s)\/([\w:.-]{0,60})$/)
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null
}

/**
 * The / menu: the skills of the app's library, filtered as you type. Beside the list, the highlighted skill's
 * description, so the right one goes with the prompt. Picking one writes /slug in the text; the app attaches it on send.
 */
export function useSkillSlash(ta: RefObject<HTMLTextAreaElement | null>, text: string, setText: (t: string, caret: number) => void) {
  const [at, setAt] = useState<{ start: number; query: string } | null>(null)
  const [all, setAll] = useState<LibrarySkill[] | null>(null)
  const [active, setActive] = useState(0)

  const sync = () => {
    const el = ta.current
    if (!el || el.selectionStart !== el.selectionEnd) return setAt(null)
    setAt(slashAt(el.value, el.selectionStart))
  }
  useEffect(sync, [text])

  // The library, read when the menu opens (skills installed meanwhile show up next time)
  useEffect(() => {
    if (!at) return
    void window.cm.skills.list().then(setAll, () => setAll([]))
  }, [at === null])

  const items = useMemo(() => {
    const q = (at?.query ?? '').toLowerCase()
    return (all ?? []).filter((s) => !q || s.slug.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
  }, [all, at?.query])
  useEffect(() => setActive(0), [at?.query])

  const pick = (s: LibrarySkill) => {
    if (!at) return
    const caret = ta.current?.selectionStart ?? at.start + at.query.length + 1
    const before = text.slice(0, at.start)
    const after = text.slice(caret).replace(/^\S*/, '')
    const ins = `/${s.slug} `
    setText(before + ins + after.replace(/^\s/, ''), before.length + ins.length)
    setAt(null)
  }

  /** Call in the textarea's onKeyDown: true when the menu used the key. */
  const keys = (e: React.KeyboardEvent) => {
    if (!at) return false
    if (e.key === 'Escape') return (e.preventDefault(), setAt(null), true)
    if (!items.length) return false
    if (e.key === 'ArrowDown') return (e.preventDefault(), setActive((i) => (i + 1) % items.length), true)
    if (e.key === 'ArrowUp') return (e.preventDefault(), setActive((i) => (i - 1 + items.length) % items.length), true)
    if ((e.key === 'Enter' && !e.shiftKey && !e.metaKey) || e.key === 'Tab') return (e.preventDefault(), pick(items[active]), true)
    return false
  }

  const current = items[active]
  const menu = (
    <Popover open={!!at} onClose={() => setAt(null)} anchor={ta} side="top" align="start" width={660} offset={10} focusOnOpen={false} unstyled>
      <div className="cm-in flex items-end gap-2">
        <div className="w-[300px] shrink-0 overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl" role="listbox" aria-label={t('Skills')}>
          <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11.5px] text-mute">
            <Zap size={12} />
            <span>{t('Skills')}</span>
            {!all && <Spinner size={11} className="ml-auto" />}
          </div>
          {all && items.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-mute">{t('No skills match')}</div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto p-1">
              {items.map((s, i) => (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(s)}
                  className={cn('skill-row flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px]', i === active ? 'bg-white/[.06] text-ink' : 'text-dim')}
                >
                  <Zap size={13} className="shrink-0 text-mute" />
                  <Marquee className="min-w-0 flex-1" delay={300} hoverTarget=".skill-row">{s.name}</Marquee>
                </button>
              ))}
            </div>
          )}
        </div>
        {current && (
          <div className="w-[340px] shrink-0 rounded-xl border border-line-strong bg-raised p-3.5 shadow-2xl" aria-live="polite">
            <div className="font-mono text-[12px] text-mute">/{current.slug}</div>
            <p className="mt-1.5 max-h-[220px] overflow-y-auto text-[12.5px] leading-[1.55] text-dim">{current.description || t('No description')}</p>
          </div>
        )}
      </div>
    </Popover>
  )
  return { open: !!at, keys, sync, menu }
}

/** The app's skill library, read once and shared (the / menu reads it fresh when it opens). */
let library: LibrarySkill[] | null = null
let loading: Promise<LibrarySkill[]> | null = null
export function useLibrarySkills(): LibrarySkill[] {
  const [list, setList] = useState<LibrarySkill[]>(library ?? [])
  useEffect(() => {
    if (library) return
    loading ??= window.cm.skills.list().then((l) => (library = l), () => [])
    void loading.then(setList)
  }, [])
  return list
}

/** Splits a text into plain parts and /slug parts that name a library skill. */
export function splitSkills(text: string, skills: LibrarySkill[]): ({ text: string } | { text: string; skill: LibrarySkill })[] {
  if (!skills.length || !text.includes('/')) return [{ text }]
  const bySlug = new Map(skills.map((s) => [s.slug.toLowerCase(), s]))
  const out: ({ text: string } | { text: string; skill: LibrarySkill })[] = []
  let last = 0
  for (const m of text.matchAll(/(^|\s)\/([\w:.-]+)/g)) {
    const skill = bySlug.get(m[2].toLowerCase())
    if (!skill) continue
    const start = m.index! + m[1].length
    if (start > last) out.push({ text: text.slice(last, start) })
    out.push({ text: '/' + m[2], skill })
    last = start + m[2].length + 1
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

/** A skill's card: its name, /slug and what it does. */
export function SkillCard({ skill }: { skill: LibrarySkill }) {
  return (
    <div className="text-left">
      <div className="flex items-center gap-2">
        <Zap size={14} className="shrink-0" />
        <Marquee className="min-w-0 text-[14px] font-semibold" delay={300}>{skill.name}</Marquee>
      </div>
      <div className="mt-0.5 font-mono text-[11.5px] opacity-60">/{skill.slug}</div>
      <p className="mt-1.5 max-h-[220px] overflow-y-auto text-[12.5px] leading-[1.5] opacity-75">{skill.description || t('No description')}</p>
    </div>
  )
}

/** /slug in a sent message: a chip, its card on hover. */
export function SkillChip({ slug }: { slug: string }) {
  const skills = useLibrarySkills()
  const skill = skills.find((s) => s.slug.toLowerCase() === slug.toLowerCase())
  const chip = <span tabIndex={skill ? 0 : undefined} className={cn('rounded-md px-1 py-px font-medium', skill ? 'cursor-default bg-accent/10 text-accent' : 'text-dim')}>/{slug}</span>
  if (!skill) return chip
  return (
    <HoverCard width={320} side="top" content={<SkillCard skill={skill} />}>
      {chip}
    </HoverCard>
  )
}

/** Turn /slug into links the markdown renderer hands to SkillChip. */
export const linkSkills = (text: string, skills: LibrarySkill[]) =>
  splitSkills(text, skills).map((p) => ('skill' in p ? `[${p.text}](cm-skill:${p.skill.slug})` : p.text)).join('')

/**
 * Behind the composer's textarea: the same text, with each /skill drawn as a chip; the pointer over a chip opens its
 * card. The textarea stays on top (typing, selection, caret), this layer only paints and anchors.
 */
export function SkillHighlights({ ta, text, className }: { ta: RefObject<HTMLTextAreaElement | null>; text: string; className: string }) {
  const skills = useLibrarySkills()
  const parts = useMemo(() => splitSkills(text, skills), [text, skills])
  const layer = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [scroll, setScroll] = useState(0)
  // Leaving the chip doesn't close the card at once: the pointer has time to reach it, and inside it the card stays
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keep = () => {
    if (closing.current) clearTimeout(closing.current)
    closing.current = null
  }
  const closeSoon = () => {
    keep()
    closing.current = setTimeout(() => setHover(null), 300)
  }

  useEffect(() => {
    const el = ta.current
    if (!el) return
    const onScroll = () => setScroll(el.scrollTop)
    // The pointer is over the textarea: find the chip under it
    const onMove = (e: MouseEvent) => {
      const chips = [...(layer.current?.querySelectorAll<HTMLElement>('[data-skill-chip]') ?? [])]
      const hit = chips.findIndex((c) => [...c.getClientRects()].some((r) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom))
      if (hit >= 0) {
        keep()
        setHover(Number(chips[hit].dataset.skillChip))
      } else closeSoon()
    }
    const onLeave = () => closeSoon()
    el.addEventListener('scroll', onScroll)
    el.addEventListener('mousemove', onMove)
    el.addEventListener('mouseleave', onLeave)
    return () => (el.removeEventListener('scroll', onScroll), el.removeEventListener('mousemove', onMove), el.removeEventListener('mouseleave', onLeave))
  }, [ta])
  useEffect(() => keep, [])

  if (!parts.some((p) => 'skill' in p)) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div ref={layer} className={cn(className, 'whitespace-pre-wrap break-words text-transparent')} style={{ transform: `translateY(${-scroll}px)` }}>
        {parts.map((p, i) =>
          'skill' in p ? (
            <HoverCard key={i} width={320} side="top" className="pointer-events-auto" open={hover === i} onOpenChange={(o) => (o ? keep() : closeSoon())} content={<div onMouseEnter={keep} onMouseLeave={closeSoon}><SkillCard skill={p.skill} /></div>}>
              <span data-skill-chip={i} className="rounded-[5px] bg-accent/20 shadow-[0_0_0_2px_color-mix(in_srgb,var(--color-accent)_20%,transparent)]">{p.text}</span>
            </HoverCard>
          ) : (
            <span key={i}>{p.text}</span>
          )
        )}
        {'​'}
      </div>
    </div>
  )
}
