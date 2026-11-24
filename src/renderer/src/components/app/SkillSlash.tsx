import { useEffect, useMemo, useState, type RefObject } from 'react'
import { Zap } from 'lucide-react'
import type { LibrarySkill } from '@shared/skills'
import { cn } from '@/lib/utils'
import { Popover } from '../affect/popover'
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
