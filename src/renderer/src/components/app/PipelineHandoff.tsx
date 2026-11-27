import { useEffect, useState } from 'react'
import { Bot, FileCode2, FilePlus2, GitCommitHorizontal, Globe, OctagonAlert, Search, SquareTerminal, Square } from 'lucide-react'
import type { ModelInfo, NodeTask, PipelineRunState } from '@shared/types'
import { Marquee } from './Marquee'
import { cn } from '@/lib/utils'
import { Button } from '../affect/button'
import { AgentLoop, type LoopArtifact, type LoopBack, type LoopStep } from '../affect/agent-loop'
import { ROLE_COLOR } from './pages/RoleGlyph'
import { modelLabel as labelOf, providerOf } from './ModelSelect'
import { ProviderLogo } from './Logos'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'

export const fmtMs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

type Node = PipelineRunState['nodes'][number]

/** What a node worked with, from the tasks it did: one tile per kind. */
const TOOL_OF: Record<NodeTask['kind'], { name: string; Icon: typeof Bot }> = {
  edit: { name: 'Edits', Icon: FileCode2 },
  create: { name: 'Edits', Icon: FilePlus2 },
  run: { name: 'Terminal', Icon: SquareTerminal },
  commit: { name: 'Commit', Icon: GitCommitHorizontal },
  browse: { name: 'Browser', Icon: Globe },
  issue: { name: 'Issues', Icon: OctagonAlert },
  agent: { name: 'Subagents', Icon: Bot },
  web: { name: 'Web search', Icon: Search }
}

/*
 * Pipeline run in the chat as an affectUI Agent Loop: one step per node, the times the run went back as arcs
 * underneath, the browser checks as artifacts, the open issues and Stop under them.
 */
export function PipelineHandoff({ run }: { run: PipelineRunState }) {
  // Running timers tick.
  const [, tick] = useState(0)
  useEffect(() => {
    if (run.status !== 'running') return
    const timer = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(timer)
  }, [run.status])

  const models = useStore((s) => s.models)
  // The chat it runs in: Stop ends its agent, so the run stops where it is
  const wsId = useStore((s) => s.selectedWs)
  const [stopping, setStopping] = useState(false)
  const live = run.status === 'running' || run.status === 'waiting'
  useEffect(() => {
    if (!live) setStopping(false)
  }, [live])
  const pipe = useStore((s) => s.pipelines.find((p) => p.id === run.pipelineId))
  // Each node shows the model that plays it (its own, else the run's).
  const nodeModel = (id: string) => run.nodes.find((n) => n.id === id)?.model || pipe?.nodes.find((n) => n.id === id)?.model || run.model || ''
  const msOf = (nd: Node) => (nd.ms ?? 0) + (nd.since && run.status === 'running' ? Date.now() - nd.since : 0)
  const steps = stepsOf(run, models, nodeModel, msOf)
  const loops = loopsOf(run)
  const artifacts = useArtifacts(run)
  const open = run.issues.filter((i) => !i.resolved && !i.minor).length

  return (
    <AgentLoop
      className="cm-in cm-loop"
      title={`Pipeline · ${run.name}`}
      subtitle={run.model ? tiny(labelOf(run.model, models)) : undefined}
      logo={run.model ? <ProviderLogo provider={providerOf(run.model)} size={12} /> : undefined}
      steps={steps}
      loops={loops}
      artifacts={artifacts}
      iteration={run.loops + 1}
      formatTime={fmtMs}
    >
      {(run.issues.length > 0 || (live && wsId)) && (
        <div className="flex flex-col gap-2.5">
          {run.issues.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-ink">{t('Brain · {n} open issues', { n: open })}</div>
              <div className="flex max-h-[96px] flex-col gap-1 overflow-y-auto">
                {run.issues.map((iss) => (
                  <div key={iss.id} className="ph-issue-row flex items-center gap-2 text-[12px]">
                    <span className={cn('size-1.5 shrink-0 rounded-full', iss.resolved ? 'bg-ok' : iss.minor ? 'bg-warn' : 'bg-bad')} />
                    <Marquee className={cn('min-w-0 flex-1', iss.resolved && 'text-mute')} delay={300} hoverTarget=".ph-issue-row">
                      <span className={cn(iss.resolved && 'line-through')}>{iss.title}</span>
                    </Marquee>
                    <span className="font-mono text-[10.5px] text-mute">{iss.nodeId}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {live && wsId && (
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="secondary"
                iconRight={<Square size={12} fill="currentColor" className="text-bad" />}
                loading={stopping}
                onClick={() => {
                  setStopping(true)
                  void window.cm.stop(wsId)
                }}
              >
                {t('Stop')}
              </Button>
            </div>
          )}
        </div>
      )}
    </AgentLoop>
  )
}

const tiny = (s: string) => s.replace(/^Claude /, '') || 'Claude'

const STATUS_OF: Record<Node['status'], LoopStep['status']> = {
  pending: 'queued', running: 'running', waiting: 'running', passed: 'done', failed: 'failed', skipped: 'queued'
}

/** One Agent Loop step per node: role color, model, what it does now, time, tokens and the tools it used. */
function stepsOf(run: PipelineRunState, models: ModelInfo[], nodeModel: (id: string) => string, msOf: (nd: Node) => number): LoopStep[] {
  return run.nodes
    .filter((n) => n.status !== 'skipped')
    .map((n) => {
      const m = n.role === 'script' || n.role === 'gate' ? '' : nodeModel(n.id)
      const nowTask = [...(n.tasks ?? [])].reverse().find((x) => x.status === 'running')
      const tools = [...new Map((n.tasks ?? []).map((x) => [TOOL_OF[x.kind].name, TOOL_OF[x.kind]])).values()]
      return {
        id: n.id,
        label: n.label,
        status: STATUS_OF[n.status],
        agent: { id: `${run.pipelineId}:${n.id}`, name: n.label, color: ROLE_COLOR[n.role] },
        model: n.role === 'script' ? t('No AI') : n.role === 'gate' ? t('You approve') : m ? tiny(labelOf(m, models)) : undefined,
        logo: m ? <ProviderLogo provider={providerOf(m)} size={12} /> : undefined,
        summary: n.status === 'waiting' ? t('Waiting for you') : nowTask?.title ?? (n.note || (n.role === 'script' ? n.command : n.instructions) || undefined),
        time: msOf(n) || undefined,
        tokens: n.tokens || undefined,
        tools: tools.length ? tools.map(({ name, Icon }) => ({ name: t(name), logo: <Icon size={11} /> })) : undefined
      }
    })
}

/** The fail paths the run took: from a node back to its onFail target, with the times and why. */
function loopsOf(run: PipelineRunState): LoopBack[] {
  const ids = new Set(run.nodes.filter((n) => n.status !== 'skipped').map((n) => n.id))
  const handoffs = run.handoffs ?? []
  return run.nodes
    .filter((n) => ids.has(n.id) && n.onFail && ids.has(n.onFail))
    .map((n) => {
      const hs = handoffs.filter((h) => h.from === n.id && h.to === n.onFail && h.back)
      return { from: n.id, to: n.onFail!, count: hs.length, label: t('Sent back'), reasons: hs.map((h) => h.title).filter(Boolean) as string[] }
    })
    // Only the times the run really went back
    .filter((l) => l.count > 0)
}

/** The browser checks the run made (QA takes at least one), per node, kept after the run: the loop's artifacts. */
function useArtifacts(run: PipelineRunState): LoopArtifact[] {
  const [shots, setShots] = useState<{ node: string; caption: string; at: number; dataUrl: string }[]>([])
  const ws = useStore((s) => s.selectedWs)
  // New ones come in while the run works: read again when a check lands or a node moves on.
  const live = useStore((s) => (ws ? s.shots[ws]?.length ?? 0 : 0))
  const step = run.nodes.map((n) => n.status).join()
  useEffect(() => {
    let on = true
    void window.cm.runShots?.(run.runId)?.then((x) => on && setShots(x))
    return () => {
      on = false
    }
  }, [run.runId, live, step, run.status])
  const label = (id: string) => run.nodes.find((n) => n.id === id)?.label ?? id
  return shots.map((sh) => ({
    id: `${sh.node}:${sh.at}`,
    title: sh.caption || label(sh.node),
    kind: 'screenshot',
    step: sh.node,
    src: sh.dataUrl,
    logo: <Globe size={11} />
  }))
}
