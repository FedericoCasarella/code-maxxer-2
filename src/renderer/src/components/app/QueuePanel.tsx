import { useState } from 'react'
import { ChevronDown, CornerDownRight, ListEnd, MoreHorizontal, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../affect/dropdown-menu'
import { TextField } from '../affect/text-field'
import { Marquee } from './Marquee'
import { SentAttachments } from './Message'
import { Badge } from '../affect/badge'
import { t } from '@/lib/i18n'

const NONE: never[] = []

/** Prompts sent while the agent was busy. They run in order when the turn ends; Steer sends one now. */
export function QueuePanel({ wsId }: { wsId: string }) {
  const items = useStore((s) => s.queues[wsId]) ?? NONE
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // A message opened in full: its whole text (4-5 lines, then it scrolls) and its attachments under it
  const [shown, setShown] = useState<string | null>(null)
  if (!items.length) return null

  const commitEdit = (id: string) => {
    if (draft.trim()) void window.cm.editQueued(id, draft.trim())
    setEditing(null)
  }

  return (
    <div className="cm-in mx-3 overflow-hidden rounded-t-xl border border-b-0 border-line bg-raised/70">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center px-3 py-2 text-[12.5px] text-dim hover:text-ink">
        {t('Queued · {n}', { n: items.length })}
        <ChevronDown size={14} className={cn('ml-auto text-mute transition-transform', !open && '-rotate-90')} />
      </button>
      {open &&
        items.map((it) => (
          <div key={it.id} className="border-t border-line">
          <div className={cn('group flex gap-2 px-3 py-2 text-[13px]', shown === it.id ? 'items-start' : 'items-center')}>
            <ListEnd size={14} className="shrink-0 text-mute" />
            {!!it.attachments?.length && (
              <span className="relative shrink-0 text-dim" aria-label={t('{n} attachments', { n: it.attachments.length })}>
                <Paperclip size={14} />
                <Badge count={it.attachments.length} tone="info" className="absolute -right-2 -top-1.5 scale-[.8]" />
              </span>
            )}
            {editing === it.id ? (
              <TextField
                size="sm"
                className="min-w-0 flex-1"
                aria-label={t('Queued message')}
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => commitEdit(it.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(it.id)
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <button
                onClick={() => setShown((v) => (v === it.id ? null : it.id))}
                aria-expanded={shown === it.id}
                className="min-w-0 flex-1 text-left"
              >
                {shown === it.id ? (
                  <p className="max-h-[100px] overflow-y-auto whitespace-pre-wrap break-words leading-[20px] text-ink">{it.text}</p>
                ) : (
                  <Marquee className="text-ink" delay={300}>{it.text}</Marquee>
                )}
              </button>
            )}
            <button
              onClick={() => void window.cm.steer(it.id)}
              title={t('Send now: interrupts the current turn and runs this')}
              className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12.5px] text-dim hover:bg-white/[.06] hover:text-ink"
            >
              {t('Steer')} <CornerDownRight size={13} />
            </button>
            <button
              onClick={() => void window.cm.removeQueued(it.id)}
              aria-label={t('Remove from queue')}
              className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-bad"
            >
              <Trash2 size={13} />
            </button>
            <DropdownMenu
              align="end"
              side="top"
              width={170}
              items={[
                {
                  label: t('Edit'), icon: <Pencil size={14} />, onSelect: () => {
                    setDraft(it.text)
                    setEditing(it.id)
                  }
                },
                { label: t('Steer now'), icon: <CornerDownRight size={14} />, onSelect: () => void window.cm.steer(it.id) },
                { label: t('Remove'), icon: <Trash2 size={14} />, danger: true, divider: true, onSelect: () => void window.cm.removeQueued(it.id) }
              ]}
              trigger={({ triggerProps }) => (
                <button {...triggerProps} aria-label={t('More')} className="grid size-6 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
                  <MoreHorizontal size={14} />
                </button>
              )}
            />
          </div>
          {shown === it.id && editing !== it.id && !!it.attachments?.length && (
            <SentAttachments list={it.attachments} className="cm-in flex flex-wrap gap-1.5 px-3 pb-2.5 pl-[30px]" />
          )}
          </div>
        ))}
    </div>
  )
}
