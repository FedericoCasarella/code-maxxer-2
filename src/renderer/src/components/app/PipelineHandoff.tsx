import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bot, ChevronDown, ClipboardList, Eye, FileCode2, FilePlus2, FlaskConical, GitCommitHorizontal, Globe, Hammer, OctagonAlert, Search, ShieldCheck,
  SquareTerminal, Workflow, Coins, Timer, Flag } from 'lucide-react'
import type { ModelInfo, NodeRole, NodeTask, PipelineRunState } from '@shared/types'
import { Marquee } from './Marquee'
import { cn } from '@/lib/utils'
import { Badge } from '../affect/badge'
import { Accordion } from '../affect/smart-recommendation'
import { Shot, ShotGallery } from './Shot'
import { AgentStateMachine, AgentStateMachineHead, type MachineState, type MachineTransition } from '../affect/agent-state-machine'
import { DotGlyph, ROLE_COLOR } from './pages/RoleGlyph'
import { modelLabel as labelOf, providerOf } from './ModelSelect'
import { ProviderLogo } from './Logos'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'


const TASK_ICON: Record<NodeTask['kind'], typeof Hammer> = {
  edit: FileCode2, create: FilePlus2, run: SquareTerminal, commit: GitCommitHorizontal, browse: Globe, issue: OctagonAlert, agent: Bot, web: Search
}

const CSS = `
@keyframes cm-ph-streak { from { stroke-dashoffset: 22 } to { stroke-dashoffset: -100 } }
.cm-ph-streak { stroke-dasharray: 22 100; animation: cm-ph-streak .9s cubic-bezier(.45,0,.2,1) both; filter: drop-shadow(0 0 4px rgba(217,119,87,.9)); }
@keyframes cm-ph-row { from { opacity: 0; transform: translateY(4px) } to { opacity: 1; transform: none } }
.cm-ph-row { animation: cm-ph-row .32s var(--aui-ease) both; }
@media (prefers-reduced-motion: reduce) { .cm-ph-streak { display: none } .cm-ph-row { animation: none } }
`

export const fmtMs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

type Node = PipelineRunState['nodes'][number]

/*
 * Pipeline run in the chat as an Agent Crew: the lead (the run), one card per node, and under each node the
 * subagents it started in parallel. Handoffs run as a light along the connectors; a click opens a card's details.
 */
export function PipelineHandoff({ run }: { run: PipelineRunState }) {
  // Open while it runs; folds itself away when the run ends (reopen any time).
  const [open, setOpen] = useState(run.status === 'running' || run.status === 'waiting')
  const prevStatus = useRef(run.status)
  useEffect(() => {
    if (prevStatus.current === 'running' && run.status !== 'running' && run.status !== 'waiting') setOpen(false)
    if (prevStatus.current !== 'running' && run.status === 'running') setOpen(true)
    prevStatus.current = run.status
  }, [run.status])
  // Running timers tick.
  const [, tick] = useState(0)
  useEffect(() => {
    if (run.status !== 'running' || !open) return
    const timer = setInterval(() => tick((x) => x + 1), 1000)
    return () => clearInterval(timer)
  }, [run.status, open])

  const tone = run.status === 'completed' ? 'success' : run.status === 'running' ? 'info' : run.status === 'failed' ? 'danger' : run.status === 'waiting' ? 'warning' : 'neutral'
  const models = useStore((s) => s.models)
  const pipe = useStore((s) => s.pipelines.find((p) => p.id === run.pipelineId))
  // Each node shows the model that plays it (its own, else the run's).
  const nodeModel = (id: string) => run.nodes.find((n) => n.id === id)?.model || pipe?.nodes.find((n) => n.id === id)?.model || run.model || ''
  const msOf = (nd: Node) => (nd.ms ?? 0) + (nd.since && run.status === 'running' ? Date.now() - nd.since : 0)
  const machine = machineOf(run, models, nodeModel, msOf)
  const asmAgent = { id: run.pipelineId, name: run.name, model: run.model ? tiny(labelOf(run.model, models)) : undefined, logo: run.model ? <ProviderLogo provider={providerOf(run.model)} size={12} /> : undefined }

  return (
    // The same folding card as the model change (affectUI Smart Recommendation's accordion): opens and closes animated.
    <Accordion
      className="cm-in"
      open={open}
      onOpenChange={setOpen}
      // The machine's own header (moving mark, name, model, where it is) is the title: not repeated inside
      title={
        <AgentStateMachineHead
          className="cm-asm-title"
          title={<Marquee className="min-w-0" delay={300}>{`Pipeline · ${run.name}`}</Marquee>}
          agent={asmAgent}
          states={machine.states}
          transitions={machine.transitions}
          current={machine.current}
        />
      }
      meta={
        <span className="flex items-center gap-1.5">
          {!open && (
            <span className="flex items-center gap-1" aria-hidden="true">
              {run.nodes.map((nd) => (
                <span
                  key={nd.id}
                  title={`${nd.label}: ${t(nd.status)}`}
                  className={cn(
                    'h-1.5 w-4 rounded-full',
                    nd.status === 'passed' ? 'bg-ok/70' : nd.status === 'failed' ? 'bg-bad/70' : nd.status === 'running' ? 'bg-[#8ab4ff]' : nd.status === 'waiting' ? 'bg-warn/80' : 'bg-white/15'
                  )}
                />
              ))}
              <span className="ml-1.5 text-[11.5px] text-mute">{fmtMs(run.nodes.reduce((a, nd) => a + msOf(nd), 0))}</span>
            </span>
          )}
          <span className={cn('ml-2 text-[11.5px] tabular-nums', run.loops ? 'text-warn' : 'text-mute')}>
            Loop {run.loops}/{run.maxLoops}
          </span>
        </span>
      }
    >
      <style>{CSS}</style>
          <div>
            <AgentStateMachine
              className="cm-asm-flat"
              hideHead
              agent={asmAgent}
              states={machine.states}
              transitions={machine.transitions}
              current={machine.current}
            />
          </div>

          <RunShots run={run} />

          {run.issues.length > 0 && (
            <div className="border-t border-line px-3.5 py-2.5">
              <div className="mb-2 text-[13px] font-semibold text-ink">
                {t('Brain · {n} open issues', { n: run.issues.filter((i) => !i.resolved && !i.minor).length })}
              </div>
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

          {run.status !== 'running' && run.status !== 'waiting' && (
            // When the run is over: what it cost, at a glance.
            <div className="border-t border-line px-3.5 py-2.5">
              <div className="mb-2 text-[13px] font-semibold text-ink">{t('Report')}</div>
              <div className="flex flex-wrap gap-1.5">
                <Badge icon={<Coins size={12} />}>{t('{n} tokens written', { n: fmtTokens(run.nodes.reduce((a, nd) => a + (nd.tokens ?? 0), 0)) })}</Badge>
                <Badge icon={<Timer size={12} />}>{fmtMs(run.nodes.reduce((a, nd) => a + msOf(nd), 0))}</Badge>
              </div>
            </div>
          )}
    </Accordion>
  )
}

const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n))

const tiny = (s: string) => s.replace(/^Claude /, '') || 'Claude'

const DONE = '__done'
const STATUS_OF: Record<Node['status'], 'queued' | 'running' | 'waiting' | 'done' | 'failed' | 'stopped'> = {
  pending: 'queued', running: 'running', waiting: 'waiting', passed: 'done', failed: 'failed', skipped: 'stopped'
}

/**
 * The run as a state machine: one Agent Tree card per pipeline node (role glyph, model, status, what it does, time and
 * tokens), the chain forward, the fail loops back, and a final Done. Counts come from the handoffs the run made.
 */
function machineOf(run: PipelineRunState, models: ModelInfo[], nodeModel: (id: string) => string, msOf: (nd: Node) => number) {
  const nodes = run.nodes.filter((n) => n.status !== 'skipped')
  const handoffs = run.handoffs ?? []
  const states: MachineState[] = nodes.map((n) => {
    const m = n.role === 'script' || n.role === 'gate' ? '' : nodeModel(n.id)
    const nowTask = [...(n.tasks ?? [])].reverse().find((x) => x.status === 'running')
    return {
      id: n.id,
      label: n.label,
      kind: n.role === 'gate' ? 'waiting' : n.status === 'failed' && run.status === 'failed' && run.current === n.id ? 'error' : 'normal',
      color: ROLE_COLOR[n.role],
      icon: <DotGlyph role={n.role} size={12} />,
      description: nowTask?.title ?? (n.note || (n.role === 'script' ? n.command : n.instructions) || undefined),
      time: msOf(n) || undefined,
      visits: n.visits,
      card: {
        model: n.role === 'script' ? t('No AI') : n.role === 'gate' ? t('You approve') : m ? tiny(labelOf(m, models)) : undefined,
        tools: m ? [<ProviderLogo key="m" provider={providerOf(m)} size={10} />] : undefined,
        status: STATUS_OF[n.status],
        task: nowTask?.title ?? (n.note || (n.role === 'script' ? n.command : n.instructions) || undefined),
        meta: [msOf(n) ? fmtMs(msOf(n)) : '', n.visits > 1 ? `${n.visits}×` : '', n.tokens ? t('{n} tokens', { n: fmtTokens(n.tokens) }) : ''].filter(Boolean).join(' · ') || t('Not started yet')
      }
    }
  })
  const finished = run.status === 'completed'
  states.push({
    id: DONE, label: t('Done'), kind: 'final', visits: finished ? 1 : 0,
    card: { avatar: <Flag size={13} />, status: finished ? 'done' : 'queued', task: finished ? t('Every step passed') : t('The run ends here'), meta: finished ? fmtMs(run.nodes.reduce((a, nd) => a + msOf(nd), 0)) : '' }
  })
  // Cards fit two to a row in the chat column: the chain runs down each column, then on to the next.
  const perCol = Math.max(1, Math.ceil(states.length / 2))
  states.forEach((st, k) => Object.assign(st, { col: Math.floor(k / perCol), row: k % perCol }))
  const taken = (from: string, to: string, back: boolean) => handoffs.filter((h) => h.from === from && h.to === to && !!h.back === back)
  const transitions: MachineTransition[] = []
  nodes.forEach((n, i) => {
    const next = nodes[i + 1]
    if (next) {
      const hs = taken(n.id, next.id, false)
      transitions.push({ from: n.id, to: next.id, label: n.role === 'gate' ? t('Approved|gate') : t('Passed'), count: hs.length || (next.visits > 0 ? next.visits : 0), detail: hs.at(-1)?.title })
    } else {
      transitions.push({ from: n.id, to: DONE, label: t('Passed'), count: finished ? 1 : 0 })
    }
    const fail = n.onFail
    if (fail && nodes.some((x) => x.id === fail)) {
      const hs = taken(n.id, fail, true)
      transitions.push({ from: n.id, to: fail, label: t('Sent back'), count: hs.length, detail: hs.at(-1)?.title })
    }
  })
  const current = finished ? DONE : run.wait?.node ?? run.current ?? undefined
  return { states, transitions, current }
}

/** The browser checks the run made (QA takes at least one), per node, kept after the run: a click opens them big. */
function RunShots({ run }: { run: PipelineRunState }) {
  const [shots, setShots] = useState<{ node: string; caption: string; at: number; dataUrl: string }[]>([])
  const [big, setBig] = useState<number | null>(null)
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
  if (!shots.length) return null
  const label = (id: string) => run.nodes.find((n) => n.id === id)?.label ?? id
  const nodes = [...new Set(shots.map((x) => x.node))]
  return (
    <div className="border-t border-line px-3.5 py-2.5">
      <div className="mb-2 text-[13px] font-semibold text-ink">{t('Browser checks · {n}', { n: shots.length })}</div>
      <div className="flex flex-col gap-2.5">
        {nodes.map((node) => (
          <div key={node}>
            <div className="mb-1.5 text-[11.5px] text-mute">{label(node)}</div>
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
              {shots.map((sh, i) =>
                sh.node === node ? <Shot key={sh.at} src={sh.dataUrl} caption={sh.caption || label(node)} onOpen={() => setBig(i)} /> : null
              )}
            </div>
          </div>
        ))}
      </div>
      {big !== null && (
        <ShotGallery images={shots.map((x) => ({ src: x.dataUrl, title: x.caption || label(x.node) }))} start={big} onClose={() => setBig(null)} />
      )}
    </div>
  )
}
