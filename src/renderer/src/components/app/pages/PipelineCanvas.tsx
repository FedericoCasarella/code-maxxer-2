import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minus, Plus } from 'lucide-react'
import {
  Background, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, Handle, MarkerType, Panel, Position, ReactFlow, useReactFlow,
  type EdgeProps,
  type Connection, type Edge, type EdgeChangeset, type ReactFlowInstance, type Node, type NodeChangeset, type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Agent, Pipeline, PipelineNode } from '@shared/types'
import { cn } from '@/lib/utils'
import { ROLE_LABEL } from './roles'
import { ProviderLogo } from '../Logos'
import { modelLabel, providerOf } from '../ModelSelect'
import { useStore } from '@/lib/store'
import { Marquee } from '../Marquee'
import { t } from '@/lib/i18n'

/*
 * Pipeline as a node graph. Two kinds of links, both drawn with the mouse:
 *  - pass (green, right handle → left handle): what runs next. They must form one chain.
 *  - fail (red, bottom-right handle → bottom-left handle of an EARLIER node): the loop taken on failure, drawn as a U under the chain.
 * The chain order is what gets saved (nodes[] order + onFail), plus each node's position.
 */

type Data = { node: PipelineNode; agent?: Agent; start: boolean; detached: boolean; model?: string; modelName?: string; index: number; total: number; failTo?: string }
type PNode = Node<Data, 'step'>

const GAP_X = 290

/** Role colours + a dot-matrix glyph, like agent cards in the handoff pattern. */
const ROLE_COLOR: Record<string, string> = {
  plan: '#8b7bff', spec: '#4d8dff', build: '#5aa7e8', qa: '#3fbf8f', review: '#e2a33a', security: '#e8666b', ship: '#b07cf0'
}
const GLYPH: Record<string, number[]> = {
  plan: [0, 1, 2, 3, 4, 5, 6, 7, 8], spec: [1, 3, 4, 5, 7], build: [0, 2, 4, 6, 8], qa: [0, 3, 4, 6, 7, 8],
  review: [1, 3, 5, 7], security: [0, 1, 2, 4, 7], ship: [2, 4, 5, 6, 8]
}
function DotGlyph({ role, size = 14 }: { role: string; size?: number }) {
  const on = new Set(GLYPH[role] ?? GLYPH.plan)
  const c = ROLE_COLOR[role] ?? '#8b7bff'
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={(i % 3) * 4 + 0.5} y={Math.floor(i / 3) * 4 + 0.5} width="3" height="3" rx="0.8" fill={c} opacity={on.has(i) ? 1 : 0.22} />
      ))}
    </svg>
  )
}

function StepNode({ data, selected }: NodeProps<PNode>) {
  const role = data.node.role
  const color = ROLE_COLOR[role] ?? '#8b7bff'
  const pill = data.start
    ? { t: t('Start|node'), c: 'bg-ok/12 text-ok', dot: 'bg-ok' }
    : data.detached
      ? { t: t('Detached'), c: 'bg-warn/12 text-warn', dot: 'bg-warn' }
      : { t: t(ROLE_LABEL[role]), c: 'bg-white/[.06] text-dim', dot: 'bg-mute' }
  return (
    <div
      className={cn(
        'pipe-node w-[236px] rounded-[18px] border p-1 transition-[border-color,box-shadow]',
        selected ? 'border-accent/60 bg-accent/[.06] shadow-[0_0_0_3px_rgba(217,119,87,.12)]' : data.detached ? 'border-dashed border-warn/40 bg-white/[.025]' : 'border-line bg-white/[.03]'
      )}
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !border-2 !border-bg !bg-ok/80" />
      <Handle type="target" position={Position.Bottom} id="retry" style={{ left: '28%' }} className="!size-2.5 !border-2 !border-bg !bg-bad/60" />
      <div className="rounded-[14px] border border-line-strong bg-raised px-3 pb-3 pt-2.5 shadow-[0_6px_18px_-10px_rgba(0,0,0,.8)]">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-panel">
            <DotGlyph role={role} />
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <Marquee className="text-[13.5px] font-semibold text-ink" delay={300} hoverTarget=".pipe-node">{data.node.label}</Marquee>
            <Marquee className="text-[11.5px] text-mute" delay={300} hoverTarget=".pipe-node">{data.modelName ?? t('Default model')}</Marquee>
          </div>
          <span className={cn('flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium', pill.c)}>
            <span className={cn('size-1.5 rounded-full', pill.dot)} />
            {pill.t}
          </span>
        </div>
        <Marquee className="mt-2.5 text-[12.5px] text-dim" delay={300} hoverTarget=".pipe-node">{data.node.instructions || t('No instructions yet')}</Marquee>
        <div className="mt-2.5 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[.07]">
            <div className="h-full rounded-full" style={{ width: `${Math.max(8, Math.round(((data.index + 1) / data.total) * 100))}%`, background: color }} />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-mute">
            {data.detached ? '—' : `${data.index + 1} / ${data.total}`}
          </span>
        </div>
      </div>
      <div className="flex h-7 items-center gap-1.5 px-2 text-[11px] text-mute">
        {data.model && <ProviderLogo provider={providerOf(data.model)} size={12} />}
        <Marquee className="min-w-0 text-dim" delay={300} hoverTarget=".pipe-node">{data.agent?.name ?? t(ROLE_LABEL[role])}</Marquee>
        {data.failTo && (
          <Marquee className="ml-auto min-w-0" delay={300} hoverTarget=".pipe-node">
            <span className="mr-1 text-bad">↳</span>{data.failTo}
          </Marquee>
        )}
      </div>
      <Handle type="source" position={Position.Right} id="pass" className="!size-3 !border-2 !border-bg !bg-ok" />
      <Handle type="source" position={Position.Bottom} id="fail" style={{ left: '72%' }} className="!size-3 !border-2 !border-bg !bg-bad" />
    </div>
  )
}
const nodeTypes = { step: StepNode }

type LinkData = { kind: 'pass' | 'fail'; label?: string; onDelete: () => void }
/** A link with its own delete button: loops show it with their label, chain links on hover. */
function LinkEdge(p: EdgeProps<Edge<LinkData>>) {
  const [path, lx, ly] = getSmoothStepPath({
    sourceX: p.sourceX, sourceY: p.sourceY, sourcePosition: p.sourcePosition,
    targetX: p.targetX, targetY: p.targetY, targetPosition: p.targetPosition,
    offset: p.data?.kind === 'fail' ? 36 : 20, borderRadius: 10
  })
  const fail = p.data?.kind === 'fail'
  return (
    <>
      <BaseEdge id={p.id} path={path} style={p.style} markerEnd={p.markerEnd} interactionWidth={18} />
      <EdgeLabelRenderer>
        <div
          className={cn('nodrag nopan group/edge pointer-events-auto absolute flex items-center gap-1', !fail && 'opacity-0 hover:opacity-100')}
          style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${fail ? ly : ly}px)` }}
        >
          {fail && (
            <span className="rounded-md border border-bad/30 bg-raised px-1.5 py-0.5 text-[11px] font-medium text-bad">{p.data?.label}</span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              p.data?.onDelete()
            }}
            title={fail ? t('Remove this loop') : t('Unlink')}
            aria-label={fail ? t('Remove loop') : t('Unlink nodes')}
            className={cn(
              'grid size-5 place-items-center rounded-full border bg-raised text-[11px] leading-none shadow',
              fail ? 'border-bad/40 text-bad hover:bg-bad hover:text-black' : 'border-ok/40 text-ok hover:bg-ok hover:text-black'
            )}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
const edgeTypes = { link: LinkEdge }

/** Zoom / fit toolbar in the app's own style (instead of React Flow's stock controls). */
function Toolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const btn = 'grid size-7 place-items-center rounded-md text-dim hover:bg-white/[.07] hover:text-ink'
  return (
    <Panel position="bottom-right" className="!m-3 flex items-center gap-0.5 rounded-lg border border-line-strong bg-raised/95 p-0.5 shadow-lg backdrop-blur">
      <button className={btn} onClick={() => void zoomOut()} aria-label={t('Zoom out')} title={t('Zoom out')}><Minus size={14} /></button>
      <button className={btn} onClick={() => void zoomIn()} aria-label={t('Zoom in')} title={t('Zoom in')}><Plus size={14} /></button>
      <span className="mx-0.5 h-4 w-px bg-line" />
      <button className={btn} onClick={() => void fitView({ padding: 0.2, maxZoom: 1, duration: 300 })} aria-label={t('Fit to view')} title={t('Fit to view')}><Maximize2 size={13} /></button>
    </Panel>
  )
}

/** Walk pass links from the node nobody points to; anything not reached is detached. */
function order(nodes: PipelineNode[], next: Record<string, string | null>) {
  const incoming = new Set(Object.values(next).filter(Boolean) as string[])
  const start = nodes.find((n) => !incoming.has(n.id)) ?? nodes[0]
  const chain: PipelineNode[] = []
  const seen = new Set<string>()
  let cur: PipelineNode | undefined = start
  while (cur && !seen.has(cur.id)) {
    chain.push(cur)
    seen.add(cur.id)
    const nid: string | null = next[cur.id] ?? null
    cur = nid ? nodes.find((n) => n.id === nid) : undefined
  }
  const detached = nodes.filter((n) => !seen.has(n.id))
  return { chain, detached }
}

const linksFrom = (nodes: PipelineNode[]) =>
  Object.fromEntries(nodes.map((n, i) => [n.id, nodes[i + 1]?.id ?? null])) as Record<string, string | null>

export function PipelineCanvas({
  draft, agents, selected, onSelect, onChange, onDetached
}: {
  draft: Pipeline
  agents: Agent[]
  selected: string | null
  onSelect: (id: string | null) => void
  onChange: (p: Pipeline) => void
  onDetached: (ids: string[]) => void
}) {
  // Pass links live here while editing (a detached node has none); nodes[] order follows the chain.
  const [next, setNext] = useState<Record<string, string | null>>(() => linksFrom(draft.nodes))
  const pid = useRef(draft.id)
  useEffect(() => {
    if (pid.current !== draft.id) {
      pid.current = draft.id
      setNext(linksFrom(draft.nodes))
    }
  }, [draft.id])
  // New nodes from outside (Add node) attach to the end of the chain.
  useEffect(() => {
    const known = new Set(Object.keys(next))
    const added = draft.nodes.filter((n) => !known.has(n.id))
    if (!added.length) return
    const { chain } = order(draft.nodes.filter((n) => known.has(n.id)), next)
    const nx = { ...next }
    let tail = chain[chain.length - 1]?.id
    for (const a of added) {
      if (tail) nx[tail] = a.id
      nx[a.id] = null
      tail = a.id
    }
    setNext(nx)
  }, [draft.nodes.length])

  const models = useStore((s) => s.models)
  const { chain, detached } = useMemo(() => order(draft.nodes, next), [draft.nodes, next])
  useEffect(() => onDetached(detached.map((d) => d.id)), [detached.map((d) => d.id).join()])

  const commit = (nx: Record<string, string | null>, nodes = draft.nodes) => {
    setNext(nx)
    const o = order(nodes, nx)
    const pos = new Map(o.chain.map((n, i) => [n.id, i]))
    // A loop must point back: drop fail links that now point forward.
    const fixed = [...o.chain, ...o.detached].map((n) =>
      n.onFail && (pos.get(n.onFail) ?? 99) >= (pos.get(n.id) ?? -1) ? { ...n, onFail: undefined } : n
    )
    onChange({ ...draft, nodes: fixed })
  }

  const derived: PNode[] = draft.nodes.map((n, i) => ({
    id: n.id,
    type: 'step',
    position: { x: n.x ?? 40 + i * GAP_X, y: n.y ?? 80 },
    selected: n.id === selected,
    data: {
      node: n, agent: agents.find((a) => a.id === n.agentId), start: chain[0]?.id === n.id, detached: detached.some((d) => d.id === n.id),
      model: n.model || draft.model, modelName: (n.model || draft.model) ? modelLabel(n.model || draft.model, models) : undefined,
      index: Math.max(0, chain.findIndex((c) => c.id === n.id)), total: Math.max(1, chain.length),
      failTo: n.onFail ? draft.nodes.find((x) => x.id === n.onFail)?.label : undefined
    }
  }))
  // Fit the whole chain once nodes are measured, and whenever another pipeline is opened.
  const rf = useRef<ReactFlowInstance<PNode, Edge> | null>(null)
  useEffect(() => {
    const t = setTimeout(() => void rf.current?.fitView({ padding: 0.2, maxZoom: 1 }), 120)
    return () => clearTimeout(t)
  }, [draft.id])
  // React Flow measures nodes through changes; keep those measurements across our re-derivations.
  const [measured, setMeasured] = useState<PNode[]>([])
  const rfNodes = derived.map((n) => {
    const m = measured.find((x) => x.id === n.id)
    return m ? { ...m, ...n, measured: m.measured, width: m.width, height: m.height } : n
  })

  const rfEdges: Edge[] = [
    ...Object.entries(next)
      .filter(([s, t]) => t && draft.nodes.some((n) => n.id === s) && draft.nodes.some((n) => n.id === t))
      .map(([s, t]) => ({
        id: `pass:${s}`,
        source: s,
        sourceHandle: 'pass',
        target: t!,
        targetHandle: 'in',
        type: 'link',
        data: { kind: 'pass', onDelete: () => commit({ ...next, [s]: null }) },
        style: { stroke: 'rgba(79,195,138,.75)', strokeWidth: 1.8 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'rgba(79,195,138,.9)', width: 16, height: 16 }
      })),
    ...draft.nodes
      .filter((n) => n.onFail)
      .map((n) => ({
        id: `fail:${n.id}`,
        source: n.id,
        sourceHandle: 'fail',
        target: n.onFail!,
        targetHandle: 'retry',
        type: 'link',
        animated: true,
        data: {
          kind: 'fail',
          label: t('fail → {node}', { node: draft.nodes.find((x) => x.id === n.onFail)?.label ?? '' }),
          onDelete: () => onChange({ ...draft, nodes: draft.nodes.map((x) => (x.id === n.id ? { ...x, onFail: undefined } : x)) })
        },
        style: { stroke: 'rgba(255,122,107,.8)', strokeWidth: 1.6, strokeDasharray: '6 5' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#ff7a6b', width: 16, height: 16 }
      }))
  ]

  // v13 hands over a changeset; iterate its changes.
  const onNodesChange = (set: NodeChangeset<PNode>) => {
    const changes = set.toArray()
    setMeasured(set.applyTo(rfNodes))
    let nodes = draft.nodes
    let moved = false
    for (const c of changes) {
      if (c.type === 'position' && c.position) {
        nodes = nodes.map((n) => (n.id === c.id ? { ...n, x: Math.round(c.position!.x), y: Math.round(c.position!.y) } : n))
        moved = true
      } else if (c.type === 'select' && c.selected) onSelect(c.id)
      else if (c.type === 'remove') {
        // Bridge the chain over the removed node.
        const nx = { ...next }
        const prev = Object.keys(nx).find((k) => nx[k] === c.id)
        if (prev) nx[prev] = nx[c.id] ?? null
        delete nx[c.id]
        nodes = nodes.filter((n) => n.id !== c.id).map((n) => (n.onFail === c.id ? { ...n, onFail: undefined } : n))
        if (selected === c.id) onSelect(null)
        return commit(nx, nodes)
      }
    }
    if (moved) onChange({ ...draft, nodes })
  }

  const onEdgesChange = (set: EdgeChangeset<Edge>) => {
    const changes = set.toArray()
    for (const c of changes) {
      if (c.type !== 'remove') continue
      if (c.id.startsWith('pass:')) commit({ ...next, [c.id.slice(5)]: null })
      if (c.id.startsWith('fail:')) {
        const id = c.id.slice(5)
        onChange({ ...draft, nodes: draft.nodes.map((n) => (n.id === id ? { ...n, onFail: undefined } : n)) })
      }
    }
  }

  const isValid = (c: Connection | Edge) => {
    if (!c.source || !c.target || c.source === c.target) return false
    if (c.sourceHandle === 'fail') {
      // Loops only go back to a node earlier in the chain.
      const i = chain.findIndex((n) => n.id === c.source)
      const j = chain.findIndex((n) => n.id === c.target)
      return i >= 0 && j >= 0 && j < i && c.targetHandle === 'retry'
    }
    return c.sourceHandle === 'pass' && c.targetHandle === 'in'
  }

  const onConnect = (c: Connection) => {
    if (!isValid(c)) return
    if (c.sourceHandle === 'fail') {
      onChange({ ...draft, nodes: draft.nodes.map((n) => (n.id === c.source ? { ...n, onFail: c.target! } : n)) })
      return
    }
    // One way in and one way out per node: re-linking replaces the old link.
    const nx = { ...next }
    for (const k of Object.keys(nx)) if (nx[k] === c.target) nx[k] = null
    nx[c.source!] = c.target!
    commit(nx)
  }

  return (
    <div className="cm-flow h-full w-full select-none [&_*]:select-none">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValid}
        onPaneClick={() => onSelect(null)}
        onInit={(inst) => {
          rf.current = inst
          setTimeout(() => void inst.fitView({ padding: 0.2, maxZoom: 1 }), 80)
        }}
        minZoom={0.3}
        maxZoom={1.6}
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        connectionLineStyle={{ stroke: '#d97757', strokeWidth: 2 }}
      >
        <Background gap={20} size={1} color="rgba(255,255,255,.07)" />
        <Toolbar />
      </ReactFlow>
    </div>
  )
}
