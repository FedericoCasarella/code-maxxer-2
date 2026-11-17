import { memo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRight, BookOpen, Brain, Clock, CornerDownRight, GitCommitHorizontal, GitFork, ChevronRight, FileCode2, FilePlus2, FileText, Globe, ListChecks, Search, SquareTerminal } from 'lucide-react'
import type { Block, Message } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { ThinkingLoader } from '../affect/thinking-loader'
import { ToolCallCard, ToolCallGroup } from '../affect/tool-call-card'
import { MessageActions } from '../affect/message-actions'
import { Spinner } from '../affect/spinner'
import { PipelineHandoff } from './PipelineHandoff'

export const MessageView = memo(function MessageView({ m }: { m: Message }) {
  if (m.role === 'user')
    return (
      <div className="cm-in flex justify-end">
        <div className="prose-chat max-w-[80%] rounded-2xl rounded-br-md bg-raised px-4 py-2.5 [&_p]:whitespace-pre-wrap">
          {/* lists typed in the composer render as lists */}
          <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
        </div>
      </div>
    )

  // Group consecutive tool calls; pipeline_step calls are shown by the diagram, not as cards.
  const visible = m.blocks.filter((b) => !(b.kind === 'tool' && b.name === 'mcp__cm2__pipeline_step'))
  const groups: (Block | Block[])[] = []
  for (const b of visible) {
    const last = groups[groups.length - 1]
    const listed = b.kind === 'tool' && !b.file && !commitOf(b)
    if (listed && Array.isArray(last)) last.push(b)
    else if (listed) groups.push([b])
    else groups.push(b)
  }
  const text = m.blocks.filter((b) => b.kind === 'text').map((b) => (b as any).text).join('\n\n')
  const working = !m.done && (m.blocks.length === 0 || m.blocks[m.blocks.length - 1].kind === 'tool')

  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, i) =>
        Array.isArray(g) ? (
          <ToolGroup key={(g[0] as any).id + i} tools={g as Extract<Block, { kind: 'tool' }>[]} />
        ) : (
          <BlockView key={g.id} b={g} />
        )
      )}
      {!m.done && <LiveShots />}
      {working && (
        <div className="pl-0.5">
          <ThinkingLoader variant="plain" size="sm" phases={['Working', 'Reading the code', 'Making changes', 'Checking']} interval={2600} />
        </div>
      )}
      {m.error && (
        <div className="selectable rounded-xl border border-bad/30 bg-bad/[.07] px-3.5 py-2.5 font-mono text-[12px] whitespace-pre-wrap text-bad">
          {m.error}
        </div>
      )}
      {m.interrupted && (
        <div className="flex items-center gap-1.5 text-[12px] text-mute">
          <CornerDownRight size={12} /> Interrupted to steer with your next message
        </div>
      )}
      {m.done && !m.error && (
        <div className="-ml-1.5 flex min-w-0 items-center justify-between gap-3 text-[11.5px] text-mute">
          <MessageActions text={text} actions={['copy']} quiet />
          {m.tokens && (
            <span className="shrink-0 whitespace-nowrap tabular-nums">
              {fmt(m.tokens.input + m.tokens.cacheRead)} in · {fmt(m.tokens.output)} out
              {m.tokens.cacheRead > 0 && ` · ${Math.round((m.tokens.cacheRead / Math.max(1, m.tokens.input + m.tokens.cacheRead)) * 100)}% cached`}
            </span>
          )}
        </div>
      )}
    </div>
  )
})

const fmt = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n))

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case 'thinking':
      return <ThinkingBlock b={b} />
    case 'text':
      return (
        <div className="prose-chat cm-in">
          <Markdown remarkPlugins={[remarkGfm]}>{b.text}</Markdown>
        </div>
      )
    case 'tool':
      return commitOf(b) ? <CommitCard b={b} /> : <FileEdit b={b} />
    case 'pipeline':
      return <PipelineBlock runId={b.runId} />
    case 'fork':
      return <ForkAlert b={b} />
  }
}

/** The agent's browser checks, in order, only while it runs (they vanish with the run). */
function LiveShots() {
  const ws = useStore((s) => s.selectedWs)
  const shots = useStore((s) => (ws ? s.shots[ws] : undefined))
  const [big, setBig] = useState<string | null>(null)
  if (!shots?.length) return null
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {shots.map((sh) => (
          <button
            key={sh.at}
            onClick={() => setBig(sh.dataUrl)}
            className="overflow-hidden rounded-xl border border-line bg-raised text-left"
            style={{ animation: 'cm-fade-up .45s cubic-bezier(.22,1,.36,1) both' }}
          >
            <img src={sh.dataUrl} alt={sh.caption} className="block aspect-[16/10] w-full object-cover object-top" />
            <div className="truncate px-2.5 py-1.5 text-[11.5px] text-dim">{sh.caption}</div>
          </button>
        ))}
      </div>
      {big && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-10" onClick={() => setBig(null)}>
          <img src={big} alt="" className="max-h-full max-w-full rounded-xl border border-line-strong shadow-2xl" />
        </div>
      )}
    </>
  )
}

/** "Branch forked → name · prompt": opens the new branch's chat. */
function ForkAlert({ b }: { b: Extract<Block, { kind: 'fork' }> }) {
  const exists = useStore((s) => !!b.workspaceId && s.workspaces.some((w) => w.id === b.workspaceId))
  return (
    <button
      disabled={!exists}
      onClick={() => b.workspaceId && void actions.selectWorkspace(b.workspaceId)}
      className={cn(
        'cm-in flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[12.5px] transition-colors',
        b.error ? 'border-bad/30 bg-bad/[.06]' : 'border-[#8ab4ff]/25 bg-[#8ab4ff]/[.06] hover:bg-[#8ab4ff]/[.1]'
      )}
    >
      <GitFork size={15} className={b.error ? 'text-bad' : 'text-[#8ab4ff]'} />
      <span className="shrink-0 font-medium">{b.error ? 'Branch fork failed' : 'Branch forked'}</span>
      <ArrowRight size={13} className="shrink-0 text-mute" />
      <span className="shrink-0 font-mono text-[12px] text-ink">{b.branch}</span>
      <span className="min-w-0 flex-1 truncate text-dim">{b.error ?? b.prompt}</span>
      {exists && <span className="shrink-0 text-[11.5px] text-[#8ab4ff]">Open</span>}
    </button>
  )
}

function PipelineBlock({ runId }: { runId: string }) {
  const run = useStore((s) => s.runs[runId])
  return run ? <PipelineHandoff run={run} /> : null
}

/** Claude-style reasoning: live loader while streaming, expandable to the raw thought. */
function ThinkingBlock({ b }: { b: Extract<Block, { kind: 'thinking' }> }) {
  const [open, setOpen] = useState(false)
  const secs = Math.max(1, Math.round(((b.endedAt ?? Date.now()) - b.startedAt) / 1000))
  return (
    <div className="cm-in">
      <button onClick={() => setOpen((o) => !o)} className="group flex items-center gap-1.5 text-[13px] text-dim hover:text-ink">
        {b.done ? (
          <>
            <Brain size={14} className="text-mute" />
            <span>Thought for {secs}s</span>
          </>
        ) : (
          <ThinkingLoader variant="plain" size="sm" phases={['Thinking']} />
        )}
        <ChevronRight size={13} className={cn('text-mute transition-transform', open && 'rotate-90')} />
      </button>
      {open && b.text && (
        <div className="selectable mt-2 max-h-80 overflow-y-auto border-l-2 border-line pl-3.5 text-[13px] leading-6 whitespace-pre-wrap text-dim">
          {b.text}
          {!b.done && <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 bg-dim" style={{ animation: 'cm-pulse 1s infinite' }} />}
        </div>
      )}
    </div>
  )
}

/** v0-style file edit row: icon, path, +/− and a live state. */
function FileEdit({ b }: { b: Extract<Block, { kind: 'tool' }> }) {
  if (!b.file) return <ToolGroup tools={[b]} />
  const created = b.name === 'Write'
  const parts = b.file.path.split('/')
  const name = parts.pop()
  return (
    <div
      className={cn(
        'cm-in flex h-10 items-center gap-2.5 rounded-xl border px-3 text-[12.5px]',
        b.status === 'running' ? 'cm-file-active border-accent/30' : 'border-line bg-white/[.015]',
        b.status === 'error' && 'border-bad/30'
      )}
    >
      {b.status === 'running' ? (
        <Spinner size={13} className="text-accent" />
      ) : created ? (
        <FilePlus2 size={14} className="text-ok" />
      ) : (
        <FileCode2 size={14} className="text-dim" />
      )}
      <span className="text-mute">{b.status === 'running' ? (created ? 'Creating' : 'Editing') : created ? 'Created' : 'Edited'}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
        <span className="text-mute">{parts.length ? parts.join('/') + '/' : ''}</span>
        <span className="text-ink">{name}</span>
      </span>
      {b.file.added > 0 && <span className="font-mono text-[11.5px] text-ok">+{b.file.added}</span>}
      {b.file.removed > 0 && <span className="font-mono text-[11.5px] text-bad">−{b.file.removed}</span>}
    </div>
  )
}

const TOOL_META: Record<string, { label: string; icon: React.ReactNode; summary: (i: any) => string }> = {
  Bash: { label: 'Run', icon: <SquareTerminal size={14} />, summary: (i) => i?.command ?? '' },
  Read: { label: 'Read', icon: <FileText size={14} />, summary: (i) => i?.file_path?.split('/').slice(-2).join('/') ?? '' },
  Grep: { label: 'Search', icon: <Search size={14} />, summary: (i) => i?.pattern ?? '' },
  Glob: { label: 'Find files', icon: <Search size={14} />, summary: (i) => i?.pattern ?? '' },
  WebFetch: { label: 'Fetch', icon: <Globe size={14} />, summary: (i) => i?.url ?? '' },
  WebSearch: { label: 'Web search', icon: <Globe size={14} />, summary: (i) => i?.query ?? '' },
  TodoWrite: { label: 'Todos', icon: <ListChecks size={14} />, summary: (i) => `${i?.todos?.length ?? 0} items` },
  mcp__cm2__brain_record: { label: 'Brain · record', icon: <Brain size={14} />, summary: (i) => `${i?.kind}: ${i?.title ?? ''}` },
  mcp__cm2__brain_search: { label: 'Brain · search', icon: <BookOpen size={14} />, summary: (i) => i?.query ?? i?.kind ?? '' },
  mcp__cm2__brain_read: { label: 'Brain · read', icon: <BookOpen size={14} />, summary: (i) => i?.id ?? '' },
  mcp__cm2__fork_branch: { label: 'Fork to branch', icon: <GitFork size={14} />, summary: (i) => i?.name ?? '' },
  mcp__cm2__schedule_run: { label: 'Schedule run', icon: <Clock size={14} />, summary: (i) => (i?.at ? new Date(i.at).toLocaleString() : '') },
  mcp__cm2__browser_navigate: { label: 'Browser · open', icon: <Globe size={14} />, summary: (i) => i?.url ?? '' },
  mcp__cm2__browser_read: { label: 'Browser · read', icon: <Globe size={14} />, summary: () => 'page' },
  mcp__cm2__browser_click: { label: 'Browser · click', icon: <Globe size={14} />, summary: (i) => (i?.index !== undefined ? `#${i.index}` : i?.selector ?? `${i?.x},${i?.y}`) },
  mcp__cm2__browser_type: { label: 'Browser · type', icon: <Globe size={14} />, summary: (i) => i?.text ?? '' },
  mcp__cm2__browser_key: { label: 'Browser · key', icon: <Globe size={14} />, summary: (i) => i?.key ?? '' },
  mcp__cm2__browser_scroll: { label: 'Browser · scroll', icon: <Globe size={14} />, summary: (i) => String(i?.dy ?? '') },
  mcp__cm2__browser_screenshot: { label: 'Browser · screenshot', icon: <Globe size={14} />, summary: (i) => i?.caption ?? '' },
  mcp__cm2__brain_resolve: { label: 'Brain · resolve', icon: <Brain size={14} />, summary: (i) => i?.id ?? '' }
}

/** A Bash call that ran `git commit`: parse "[branch abc1234] message" and the shortstat. */
function commitOf(b: Block): { branch: string; hash: string; message: string; files?: number; plus?: number; minus?: number } | null {
  if (b.kind !== 'tool' || b.name !== 'Bash') return null
  const cmd = String((b.input as any)?.command ?? '')
  if (!/\bgit\b[^|;&]*\bcommit\b/.test(cmd)) return null
  const out = String(b.result ?? '')
  const m = out.match(/\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,})\] (.+)/)
  if (!m) return b.status === 'running' ? { branch: '', hash: '', message: (cmd.match(/-m\s+["']([^"']+)/)?.[1] ?? 'Committing…') } : null
  const st = out.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/)
  return { branch: m[1], hash: m[2], message: m[3], files: st ? +st[1] : undefined, plus: st?.[2] ? +st[2] : 0, minus: st?.[3] ? +st[3] : 0 }
}

function CommitCard({ b }: { b: Extract<Block, { kind: 'tool' }> }) {
  const c = commitOf(b)!
  return (
    <div className="cm-in flex items-center gap-2.5 rounded-xl border border-ok/25 bg-ok/[.05] px-3 py-2.5 text-[12.5px]">
      {b.status === 'running' ? <Spinner size={13} className="text-ok" /> : <GitCommitHorizontal size={15} className="text-ok" />}
      <span className="shrink-0 font-medium text-ok">{b.status === 'running' ? 'Committing' : 'Committed'}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{c.message}</span>
      {c.hash && <span className="shrink-0 font-mono text-[11.5px] text-mute">{c.hash.slice(0, 7)}</span>}
      {c.files !== undefined && (
        <span className="shrink-0 font-mono text-[11px] text-mute">
          {c.files} file{c.files === 1 ? '' : 's'} <span className="text-ok">+{c.plus}</span> <span className="text-bad">−{c.minus}</span>
        </span>
      )}
    </div>
  )
}

function ToolGroup({ tools }: { tools: Extract<Block, { kind: 'tool' }>[] }) {
  const cards = tools.map((t) => {
    const meta = TOOL_META[t.name]
    return (
      <ToolCallCard
        key={t.id}
        name={meta?.label ?? t.name.replace(/^mcp__/, '').replace(/__/g, ' · ')}
        icon={meta?.icon}
        summary={meta?.summary(t.input)}
        status={t.status}
        args={t.input}
        result={t.status === 'error' ? undefined : t.result}
        error={t.status === 'error' ? String(t.result ?? 'Failed') : undefined}
        startedAt={t.startedAt}
        duration={t.duration}
        openOnError={false}
      />
    )
  })
  // Every call stays visible, one line each (open one to see arguments and result).
  return <div className="cm-in flex flex-col gap-1.5">{cards}</div>
}
