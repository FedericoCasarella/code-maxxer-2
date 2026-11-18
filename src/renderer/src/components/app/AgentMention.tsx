import { useEffect, useRef, useState, type RefObject } from 'react'
import { AtSign, Sparkles } from 'lucide-react'
import type { Agent } from '@shared/types'
import { useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { HoverCard } from '../affect/hover-card'
import { Popover } from '../affect/popover'
import { Spinner } from '../affect/spinner'

/** The "@query" being typed right before the caret, if any. */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = text.slice(0, caret).match(/(^|[\s(])@([a-z0-9_]{0,40})$/i)
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null
}

/**
 * The @ menu: custom agents searched on the server as you type, keyboard first.
 * The textarea keeps the focus; arrows, Enter/Tab and Escape come through `keys`.
 */
export function useAgentMention(ta: RefObject<HTMLTextAreaElement | null>, text: string, setText: (t: string, caret: number) => void) {
  const [at, setAt] = useState<{ start: number; query: string } | null>(null)
  const [items, setItems] = useState<Agent[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const seq = useRef(0)

  const sync = () => {
    const el = ta.current
    if (!el || el.selectionStart !== el.selectionEnd) return setAt(null)
    setAt(mentionAt(el.value, el.selectionStart))
  }
  useEffect(sync, [text])

  useEffect(() => {
    if (!at) return
    const my = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      const r = await window.cm.skills.searchAgents(at.query)
      if (my !== seq.current) return
      setItems(r)
      setActive(0)
      setLoading(false)
    }, 90)
    return () => clearTimeout(t)
  }, [at?.query, at === null])

  const pick = (a: Agent) => {
    if (!at || !a.handle) return
    const el = ta.current
    const caret = el?.selectionStart ?? at.start + at.query.length + 1
    const before = text.slice(0, at.start)
    const after = text.slice(caret).replace(/^\S*/, '')
    const ins = `@${a.handle} `
    setText(before + ins + after.replace(/^\s/, ''), before.length + ins.length)
    setAt(null)
  }

  /** Call first in the textarea's onKeyDown: true when the menu used the key. */
  const keys = (e: React.KeyboardEvent) => {
    if (!at) return false
    if (e.key === 'Escape') return (e.preventDefault(), setAt(null), true)
    if (!items.length) return false
    if (e.key === 'ArrowDown') return (e.preventDefault(), setActive((i) => (i + 1) % items.length), true)
    if (e.key === 'ArrowUp') return (e.preventDefault(), setActive((i) => (i - 1 + items.length) % items.length), true)
    if ((e.key === 'Enter' && !e.shiftKey && !e.metaKey) || e.key === 'Tab') return (e.preventDefault(), pick(items[active]), true)
    return false
  }

  const menu = (
    <Popover open={!!at} onClose={() => setAt(null)} anchor={ta} side="top" align="start" width={340} offset={10} focusOnOpen={false} unstyled>
      <div className="cm-in overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl" role="listbox" aria-label="Agents">
        <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11.5px] text-mute">
          <AtSign size={12} />
          <span>Agents{at?.query ? ` matching “${at.query}”` : ''}</span>
          {loading && <Spinner size={11} className="ml-auto" />}
        </div>
        {items.length === 0 && !loading ? (
          <div className="px-3 py-3 text-[12px] leading-[1.5] text-mute">
            No agents yet. Ask in a chat: “create an agent that…”, refine it there, and it shows up here.
          </div>
        ) : (
          <div className="max-h-[260px] overflow-y-auto p-1">
            {items.map((a, i) => (
              <button
                key={a.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(a)}
                className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left', i === active && 'bg-white/[.06]')}
              >
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border border-line bg-panel text-dim">
                  <Sparkles size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-[13px] font-medium text-ink">{a.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-mute">@{a.handle}</span>
                  </span>
                  <span className="block truncate text-[11.5px] text-mute">{a.description || 'No description'}</span>
                </span>
                {!!a.skills?.length && <span className="mt-0.5 shrink-0 text-[11px] text-mute">{a.skills.length} {a.skills.length === 1 ? "skill" : "skills"}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </Popover>
  )
  return { open: !!at, keys, sync, menu }
}

/** In a sent message: @handle of a custom agent, with a short recap on hover. */
export function AgentChip({ handle }: { handle: string }) {
  const agent = useStore((s) => s.agents.find((a) => a.custom && a.handle?.toLowerCase() === handle.toLowerCase()))
  const source = useStore((s) => s.workspaces.find((w) => w.id === agent?.sourceWorkspaceId))
  const chip = (
    <span
      tabIndex={agent ? 0 : undefined}
      className={cn('rounded-md px-1 py-px font-medium', agent ? 'cursor-default bg-accent/10 text-accent' : 'text-dim')}
    >
      @{handle}
    </span>
  )
  if (!agent) return chip
  return (
    <HoverCard
      width={300}
      side="top"
      content={
        <div className="space-y-2 text-left">
          <div className="flex items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-panel text-accent">
              <Sparkles size={14} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] font-semibold">{agent.name}</span>
              <span className="block font-mono text-[11px] opacity-60">@{agent.handle}</span>
            </span>
          </div>
          {agent.description && <p className="text-[12.5px] leading-[1.5] opacity-80">{agent.description}</p>}
          {!!agent.skillNames?.length && (
            <div className="flex flex-wrap gap-1">
              {agent.skillNames.map((s) => (
                <span key={s} className="rounded-md bg-white/[.07] px-1.5 py-0.5 text-[11px]">
                  {s}
                </span>
              ))}
            </div>
          )}
          <p className="text-[11px] opacity-50">
            {source ? `Trained in ${source.branch}` : 'Custom agent'}
            {agent.createdAt ? ` · ${timeAgo(agent.createdAt) === 'now' ? 'just now' : `${timeAgo(agent.createdAt)} ago`}` : ''}
          </p>
        </div>
      }
    >
      {chip}
    </HoverCard>
  )
}

/** Turn @handles into links the markdown renderer hands to AgentChip. */
export const linkMentions = (text: string) => text.replace(/(^|[\s(])@([a-z0-9_]{2,40})\b/gi, (_m, pre, h) => `${pre}[@${h}](cm-agent:${h})`)
