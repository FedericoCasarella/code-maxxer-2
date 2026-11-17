import { useEffect, useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, ChevronDown, FileSearch, FileText, Globe, Search, X } from 'lucide-react'
import type { Block, Message } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { ShimmerText } from '../affect/shimmer-loader'
import { fileIcon } from './FilesPanel'

type Tool = Extract<Block, { kind: 'tool' }>
type Thinking = Extract<Block, { kind: 'thinking' }>
type Row =
  | { k: 'think'; id: string; b: Thinking }
  | { k: 'search'; id: string; tools: Tool[] }
  | { k: 'tool'; id: string; b: Tool }
  | { k: 'note'; id: string; text: string }

/** Lookups: they become chips under one "Searched" row. */
const LOOKUP = new Set([
  'Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'mcp__cm2__brain_search', 'mcp__cm2__brain_read', 'mcp__cm2__browser_read', 'mcp__cm2__plan_read'
])

const base = (p: string) => String(p ?? '').split('/').pop() || String(p ?? '')
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

export function rowsOf(blocks: Block[]): Row[] {
  const rows: Row[] = []
  for (const b of blocks) {
    if (b.kind === 'thinking') rows.push({ k: 'think', id: b.id, b })
    else if (b.kind === 'text') b.text.trim() && rows.push({ k: 'note', id: b.id, text: b.text })
    else if (b.kind === 'tool') {
      const last = rows[rows.length - 1]
      if (LOOKUP.has(b.name)) {
        if (last?.k === 'search') last.tools.push(b)
        else rows.push({ k: 'search', id: b.id, tools: [b] })
      } else rows.push({ k: 'tool', id: b.id, b })
    }
  }
  return rows
}

/** One turn's work on a rail: "Working…" while it runs, "Worked for Ns" after, every step inside. */
export function Timeline({ m, blocks }: { m: Extract<Message, { role: 'assistant' }>; blocks: Block[] }) {
  const running = !m.done
  const [open, setOpen] = useState(running)
  const wasRunning = useRef(running)
  // Open while it works, folds itself once the answer is there.
  useEffect(() => {
    if (wasRunning.current && !running) setOpen(false)
    if (running) setOpen(true)
    wasRunning.current = running
  }, [running])
  const [, tick] = useState(0)
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  const rows = rowsOf(blocks)
  const end = running
    ? Date.now()
    : Math.max(
        m.at,
        ...blocks.map((b) => (b.kind === 'tool' ? b.startedAt + (b.duration ?? 0) : b.kind === 'thinking' ? (b.endedAt ?? b.startedAt) : 0))
      )
  const secs = Math.max(1, Math.round((end - m.at) / 1000))
  const failed = !!m.error

  return (
    <div className="cm-in">
      <button onClick={() => setOpen((o) => !o)} className="group flex items-center gap-1.5 text-[13.5px] text-dim hover:text-ink">
        <ChevronDown size={14} className={cn('text-mute transition-transform duration-200', !open && '-rotate-90')} />
        {running ? <ShimmerText>Working…</ShimmerText> : <span>Worked for {fmtSecs(secs)}</span>}
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="min-h-0 overflow-hidden">
          <ol className="relative mt-2 pl-0.5">
            {rows.map((r, i) => (
              <RowView key={r.id} r={r} last={i === rows.length - 1 && running} />
            ))}
            {!running && (
              <Step icon={failed ? <X size={10} strokeWidth={3} /> : <Check size={10} strokeWidth={3} />} tone={failed ? 'bad' : 'done'} end>
                <span className="text-ink/90">{failed ? 'Stopped' : m.interrupted ? 'Interrupted' : 'Finished'}</span>
              </Step>
            )}
            {running && rows.length === 0 && (
              <Step end>
                <ShimmerText>Starting</ShimmerText>
              </Step>
            )}
          </ol>
        </div>
      </div>
    </div>
  )
}

const fmtSecs = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)

/** A rail stop: a dot (or an icon) on the line, then the content. */
function Step({ icon, tone, end, children }: { icon?: ReactNode; tone?: 'done' | 'bad'; end?: boolean; children: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {!end && <span className="absolute bottom-0 left-[8px] top-[22px] w-px bg-white/[.1]" />}
      <span className="relative z-[1] grid h-[22px] w-[17px] shrink-0 place-items-center">
        {icon && tone ? (
          <span className={cn('grid size-[15px] place-items-center rounded-full text-black', tone === 'bad' ? 'bg-bad' : 'bg-[#4d9fff]')}>{icon}</span>
        ) : icon ? (
          <span className="text-mute">{icon}</span>
        ) : (
          <span className="size-[6px] rounded-full bg-white/25" />
        )}
      </span>
      <div className="min-w-0 flex-1 pt-[1px] text-[13px] leading-5 text-dim">{children}</div>
    </li>
  )
}

function Label({ live, error, children }: { live: boolean; error?: boolean; children: ReactNode }) {
  if (live) return <ShimmerText>{children}</ShimmerText>
  return <span className={error ? 'text-bad/90' : undefined}>{children}</span>
}

function RowView({ r, last }: { r: Row; last: boolean }) {
  if (r.k === 'note')
    return (
      <Step>
        <div className="prose-chat text-[13px] leading-5 text-dim [&_p]:my-0">
          <Markdown remarkPlugins={[remarkGfm]}>{r.text}</Markdown>
        </div>
      </Step>
    )
  if (r.k === 'think') return <ThinkRow b={r.b} />
  if (r.k === 'search') return <SearchRow tools={r.tools} />
  return <ToolRow b={r.b} last={last} />
}

function ThinkRow({ b }: { b: Thinking }) {
  const [open, setOpen] = useState(false)
  const secs = Math.max(1, Math.round(((b.endedAt ?? Date.now()) - b.startedAt) / 1000))
  return (
    <Step>
      <button disabled={!b.text} onClick={() => setOpen((o) => !o)} className="text-left enabled:hover:text-ink">
        <Label live={!b.done}>{b.done ? `Thought for ${fmtSecs(secs)}` : 'Thinking'}</Label>
      </button>
      {open && b.text && <div className="selectable mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-5 text-mute">{b.text}</div>}
    </Step>
  )
}

function chipOf(t: Tool): { key: string; icon: ReactNode; label: string; path?: string } {
  const i: any = t.input ?? {}
  if (t.name === 'Read') return { key: t.id, icon: fileIcon(base(i.file_path)), label: base(i.file_path), path: i.file_path }
  if (t.name === 'Grep') return { key: t.id, icon: <Search size={12} />, label: `“${i.pattern ?? ''}”` }
  if (t.name === 'Glob' || t.name === 'LS') return { key: t.id, icon: <FileSearch size={12} />, label: i.pattern ?? i.path ?? 'files' }
  if (t.name === 'WebSearch') return { key: t.id, icon: <Globe size={12} />, label: i.query ?? 'web' }
  if (t.name === 'WebFetch') return { key: t.id, icon: <Globe size={12} />, label: host(i.url ?? '') }
  if (t.name === 'mcp__cm2__browser_read') return { key: t.id, icon: <Globe size={12} />, label: 'Page in the browser' }
  if (t.name === 'mcp__cm2__plan_read') return { key: t.id, icon: <FileText size={12} />, label: 'The plan' }
  return { key: t.id, icon: <FileText size={12} />, label: i.query ?? i.id ?? 'Brain' }
}

function SearchRow({ tools }: { tools: Tool[] }) {
  const [all, setAll] = useState(false)
  const wsId = useStore((s) => s.selectedWs)
  const live = tools.some((t) => t.status === 'running')
  const chips = tools.map(chipOf)
  // The same file read twice shows once.
  const uniq = chips.filter((c, i) => chips.findIndex((x) => x.label === c.label) === i)
  const shown = all ? uniq : uniq.slice(0, 4)
  const reads = tools.filter((t) => t.name === 'Read').length
  return (
    <Step icon={<FileSearch size={15} />}>
      <Label live={live}>{live ? 'Searching' : reads === tools.length ? `Read ${reads} ${reads === 1 ? 'file' : 'files'}` : 'Searched'}</Label>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {shown.map((c) => (
          <button
            key={c.key}
            title={c.path ?? c.label}
            disabled={!c.path || !wsId}
            onClick={() => c.path && wsId && actions.openEditor(wsId, { kind: 'file', path: c.path })}
            className="flex h-7 max-w-[240px] items-center gap-1.5 rounded-lg bg-white/[.05] px-2 text-[12px] text-ink/85 enabled:hover:bg-white/[.08]"
          >
            <span className="grid shrink-0 place-items-center text-dim">{c.icon}</span>
            <span className="truncate">{c.label}</span>
          </button>
        ))}
        {uniq.length > 4 && (
          <button onClick={() => setAll((a) => !a)} className="px-1 text-[12px] text-mute hover:text-ink">
            {all ? 'Less' : `+${uniq.length - 4} more`}
          </button>
        )}
      </div>
    </Step>
  )
}

function toolLabel(b: Tool): { text: string; extra?: ReactNode; path?: string } {
  const i: any = b.input ?? {}
  const live = b.status === 'running'
  if ((b.name === 'Edit' || b.name === 'MultiEdit' || b.name === 'Write') && b.file) {
    const created = b.name === 'Write'
    return {
      text: `${live ? (created ? 'Creating' : 'Editing') : created ? 'Created' : 'Edited'} ${base(b.file.path)}`,
      path: b.file.path,
      extra: (
        <span className="ml-1.5 font-mono text-[11.5px]">
          {b.file.added > 0 && <span className="text-ok">+{b.file.added}</span>}
          {b.file.removed > 0 && <span className="ml-1 text-bad">−{b.file.removed}</span>}
        </span>
      )
    }
  }
  if (b.name === 'Bash') {
    const cmd = String(i.command ?? '')
    if (/\bgit\b[^|;&]*\bcommit\b/.test(cmd)) {
      const m = String(b.result ?? '').match(/\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)/)
      const msg = m?.[3] ?? cmd.match(/-m\s+["']([^"'\n]+)/)?.[1] ?? cmd.match(/<<'?EOF'?\n([^\n]+)/)?.[1]
      return { text: live ? 'Committing' : msg ? `Committed ${msg}` : 'Committed', extra: m ? <span className="ml-1.5 font-mono text-[11.5px] text-mute">{m[2]}</span> : undefined }
    }
    const d = String(i.description ?? '').trim() || cmd.split('\n')[0].trim()
    return { text: `${live ? 'Running' : 'Ran'} ${d}` }
  }
  const map: Record<string, string> = {
    mcp__cm2__browser_navigate: `Opened ${host(i.url ?? '')}`,
    mcp__cm2__browser_click: 'Clicked in the page',
    mcp__cm2__browser_type: `Typed “${i.text ?? ''}”`,
    mcp__cm2__browser_key: `Pressed ${i.key ?? ''}`,
    mcp__cm2__browser_scroll: 'Scrolled the page',
    mcp__cm2__browser_screenshot: `Checked the page${i.caption ? `: ${i.caption}` : ''}`,
    mcp__cm2__brain_record: `Noted ${i.kind ?? ''}: ${i.title ?? ''}`,
    mcp__cm2__brain_resolve: 'Resolved an issue',
    mcp__cm2__fork_branch: `Moved to branch ${i.name ?? ''}`,
    mcp__cm2__schedule_run: 'Scheduled a run',
    mcp__cm2__plan_propose: `Proposed a plan: ${i.title ?? ''}`,
    mcp__cm2__plan_task: `Plan task ${i.status === 'in_progress' ? 'started' : i.status ?? ''}`,
    mcp__cm2__ask_user: 'Asked you',
    TodoWrite: 'Updated the to-do list',
    Task: `Delegated: ${i.description ?? ''}`,
    Agent: `Delegated: ${i.description ?? ''}`
  }
  return { text: map[b.name] ?? b.name.replace(/^mcp__\w+__/, '').replace(/_/g, ' ') }
}

function ToolRow({ b, last }: { b: Tool; last: boolean }) {
  const [open, setOpen] = useState(false)
  const wsId = useStore((s) => s.selectedWs)
  const { text, extra, path } = toolLabel(b)
  const live = b.status === 'running'
  const output = b.name === 'Bash' ? String(b.result ?? '').trim() : ''
  const cmd = b.name === 'Bash' ? String((b.input as any)?.command ?? '') : ''
  return (
    <Step>
      <button
        onClick={() => (path && wsId ? actions.openEditor(wsId, { kind: 'file', path }) : setOpen((o) => !o))}
        className="max-w-full truncate text-left hover:text-ink"
        title={cmd || path || text}
      >
        <Label live={live || (last && b.status === 'running')} error={b.status === 'error'}>
          {text}
        </Label>
        {extra}
      </button>
      {open && (cmd || output) && (
        <pre className="selectable mt-1.5 max-h-56 overflow-auto rounded-lg border border-line bg-black/30 px-2.5 py-2 font-mono text-[11.5px] leading-[1.5] text-dim">
          {cmd && <span className="text-mute">$ {cmd}{'\n'}</span>}
          {output}
        </pre>
      )}
    </Step>
  )
}
