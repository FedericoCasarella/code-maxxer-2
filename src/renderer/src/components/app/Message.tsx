import { memo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookOpen, Brain, ChevronRight, FileCode2, FilePlus2, FileText, Globe, ListChecks, Search, SquareTerminal } from 'lucide-react'
import type { Block, Message } from '@shared/types'
import { useStore } from '@/lib/store'
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
    if (b.kind === 'tool' && !b.file && Array.isArray(last)) last.push(b)
    else if (b.kind === 'tool' && !b.file) groups.push([b])
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
      return <FileEdit b={b} />
    case 'pipeline':
      return <PipelineBlock runId={b.runId} />
  }
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
  mcp__cm2__brain_resolve: { label: 'Brain · resolve', icon: <Brain size={14} />, summary: (i) => i?.id ?? '' }
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
  if (tools.length === 1) return <div className="cm-in">{cards}</div>
  const runningN = tools.filter((t) => t.status === 'running').length
  return (
    <ToolCallGroup
      className="cm-in"
      label={`${tools.length} tool calls`}
      runningLabel={runningN ? `Running ${tools.length} tools` : undefined}
    >
      {cards}
    </ToolCallGroup>
  )
}
