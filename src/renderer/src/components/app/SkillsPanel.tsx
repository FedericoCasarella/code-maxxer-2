import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink, FolderOpen, MoreHorizontal, Puzzle, X } from 'lucide-react'
import type { ChatSkill } from '@shared/skills'
import { useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { IconButton } from '../affect/icon-button'
import { DropdownMenu } from '../affect/dropdown-menu'
import { EmptyState } from '../affect/empty-state'
import { Skeleton } from '../affect/shimmer-loader'

const ago = (t: number) => (timeAgo(t) === 'now' ? 'just now' : `${timeAgo(t)} ago`)
const host = (u: string | null) => {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, '') : 'written here'
  } catch {
    return 'written here'
  }
}

/** Right drawer: the skills this chat has loaded (installed here, or brought by an @agent). */
export function SkillsPanel({ workspaceId }: { workspaceId: string | null }) {
  const tick = useStore((s) => s.skillsTick)
  const [list, setList] = useState<ChatSkill[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => setList(null), [workspaceId])
  useEffect(() => {
    if (!workspaceId) return
    let live = true
    void window.cm.skills.forChat(workspaceId).then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [workspaceId, tick])

  if (!workspaceId)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare title="No branch" text="Pick a branch on the left to see the skills its chat loaded." />
      </div>
    )

  const remove = (id: string) => {
    setList((l) => l?.filter((x) => x.id !== id) ?? l)
    void window.cm.skills.detach(workspaceId, id)
  }

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="px-3 pb-2 pt-2.5">
        <div className="text-[13px] font-semibold">Skills</div>
        <div className="text-[11.5px] text-mute">What this chat has loaded</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {!list ? (
          <div className="space-y-3 border-t border-line px-3 pt-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton width="60%" height={13} radius={4} />
                <Skeleton width="40%" height={10} radius={4} />
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="grid h-full place-items-center px-4">
            <EmptyState
              bare
              icon={<Puzzle size={18} />}
              title="No skills loaded"
              text="Ask the agent: “install this skill https://… and use it to…”, or call an @agent that has some."
            />
          </div>
        ) : (
          <>
            <div className="flex items-center border-y border-line px-3 py-1.5 text-[12px]">
              <span className="font-medium text-ink">
                {list.length} {list.length === 1 ? 'skill' : 'skills'}
              </span>
            </div>
            {list.map((s) => (
              <SkillItem key={s.id} s={s} open={openId === s.id} onToggle={() => setOpenId((o) => (o === s.id ? null : s.id))} onRemove={() => remove(s.id)} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function SkillItem({ s, open, onToggle, onRemove }: { s: ChatSkill; open: boolean; onToggle: () => void; onRemove: () => void }) {
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => {
    if (open && body === null) void window.cm.skills.body(s.id).then(setBody)
  }, [open])
  // The instructions without the frontmatter.
  const text = (body ?? '').replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
  return (
    <div className={cn('border-b border-line', open && 'bg-white/[.015]')}>
      <div className="flex items-start gap-1.5 px-3 py-2.5">
        <button onClick={onToggle} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <div className="line-clamp-2 text-[13px] font-medium leading-snug text-ink">{s.name}</div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[11.5px] text-mute">
            <span className={cn('size-1.5 shrink-0 rounded-full', s.via === 'agent' ? 'bg-white/40' : 'bg-accent')} />
            <span>{s.via === 'agent' ? `via @${s.agent}` : 'Installed here'}</span>
            <span>· {ago(s.addedAt)}</span>
            <span className="min-w-0 truncate">· {host(s.sourceUrl)}</span>
          </div>
        </button>
        <IconButton size="sm" variant="ghost" label={open ? 'Collapse' : 'Expand'} icon={open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} onClick={onToggle} />
        <DropdownMenu
          align="end"
          width={200}
          items={[
            ...(s.sourceUrl ? [{ label: 'Open source', icon: <ExternalLink size={14} />, onSelect: () => window.open(s.sourceUrl!, '_blank') }] : []),
            { label: 'Show in Finder', icon: <FolderOpen size={14} />, onSelect: () => void window.cm.revealPath(s.dir) },
            { label: 'Remove from chat', icon: <X size={14} />, danger: true, divider: true, onSelect: onRemove }
          ]}
          trigger={({ triggerProps }) => <IconButton {...triggerProps} size="sm" variant="ghost" label="More" icon={<MoreHorizontal size={14} />} />}
        />
      </div>
      {open && (
        <div className="cm-in mx-3 mb-3 rounded-xl border border-line bg-raised">
          {s.description && <p className="px-3 pb-2.5 pt-3 text-[12.5px] leading-[1.55] text-dim">{s.description}</p>}
          <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-3 py-2.5 text-[12px]', s.description && 'border-t border-line')}>
            <dt className="text-mute">Loaded</dt>
            <dd className="min-w-0 truncate text-dim">{s.via === 'agent' ? `by @${s.agent}` : 'in this chat'}</dd>
            <dt className="text-mute">Source</dt>
            <dd className="min-w-0 truncate text-dim">{s.sourceUrl ?? 'written by the agent'}</dd>
            <dt className="text-mute">Files</dt>
            <dd className="min-w-0 truncate text-dim">{s.files}</dd>
            <dt className="text-mute">Installed</dt>
            <dd className="min-w-0 truncate text-dim">{new Date(s.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
          </dl>
          <div className="border-t border-line px-3 py-2.5">
            <div className="pb-1.5 text-[11px] text-mute">Instructions</div>
            {body === null ? (
              <Skeleton width="100%" height={60} radius={6} />
            ) : (
              <pre className="selectable max-h-[220px] overflow-auto whitespace-pre-wrap font-mono text-[11.5px] leading-[1.5] text-dim">{text || 'Empty'}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
