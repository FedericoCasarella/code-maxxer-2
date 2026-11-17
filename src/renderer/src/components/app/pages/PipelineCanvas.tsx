import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, Controls, Handle, MarkerType, Position, ReactFlow,
  type Connection, type Edge, type EdgeChangeset, type ReactFlowInstance, type Node, type NodeChangeset, type NodeProps
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Agent, Pipeline, PipelineNode } from '@shared/types'
import { cn } from '@/lib/utils'
import { ROLE_ICON, ROLE_LABEL } from './roles'

/*
 * Pipeline as a node graph. Two kinds of links, both drawn with the mouse:
 *  - pass (green, right handle → left handle): what runs next. They must form one chain.
 *  - fail (red, bottom-right handle → bottom-left handle of an EARLIER node): the loop taken on failure, drawn as a U under the chain.
 * The chain order is what gets saved (nodes[] order + onFail), plus each node's position.
 */

type Data = { node: PipelineNode; agent?: Agent; start: boolean; detached: boolean }
type PNode = Node<Data, 'step'>

const GAP_X = 290

function StepNode({ data, selected }: NodeProps<PNode>) {
  const Icon = ROLE_ICON[data.node.role]
  return (
    <div
      className={cn(
        'w-[200px] rounded-xl border bg-raised px-3 py-2.5 shadow-[0_8px_24px_-12px_rgba(0,0,0,.8)] transition-colors',
        selected ? 'border-accent/70 ring-2 ring-accent/20' : data.detached ? 'border-warn/50 border-dashed' : 'border-line-strong'
      )}
    >
      <Handle type="target" position={Position.Left} id="in" className="!size-2.5 !border-2 !border-bg !bg-ok/80" />
      <Handle type="target" position={Position.Bottom} id="retry" style={{ left: '28%' }} className="!size-2.5 !border-2 !border-bg !bg-bad/60" />
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg border border-line bg-panel text-dim">
          <Icon size={14} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-medium text-ink">{data.node.label}</div>
          <div className="truncate text-[11px] text-mute">
            {data.agent?.name ?? ROLE_LABEL[data.node.role]} · {ROLE_LABEL[data.node.role]}
          </div>
        </div>
      </div>
      <div className="mt-2 line-clamp-2 text-[11px] leading-snug text-dim">{data.node.instructions || 'No instructions yet'}</div>
      <div className="mt-2 flex items-center gap-1.5 text-[10px]">
        {data.start && <span className="rounded bg-ok/15 px-1.5 py-px font-semibold text-ok">START</span>}
        {data.detached && <span className="rounded bg-warn/15 px-1.5 py-px font-semibold text-warn">NOT CONNECTED</span>}
        <span className="ml-auto text-mute">loop in ↓ · fail ↓ · pass →</span>
      </div>
      <Handle type="source" position={Position.Right} id="pass" className="!size-3 !border-2 !border-bg !bg-ok" />
      <Handle type="source" position={Position.Bottom} id="fail" style={{ left: '72%' }} className="!size-3 !border-2 !border-bg !bg-bad" />
    </div>
  )
}
const nodeTypes = { step: StepNode }

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
    data: { node: n, agent: agents.find((a) => a.id === n.agentId), start: chain[0]?.id === n.id, detached: detached.some((d) => d.id === n.id) }
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
        type: 'smoothstep',
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
        type: 'smoothstep',
        animated: true,
        label: `fail → ${draft.nodes.find((x) => x.id === n.onFail)?.label ?? ''}`,
        labelStyle: { fill: '#ff7a6b', fontSize: 11, fontWeight: 500 },
        labelBgStyle: { fill: '#1c1c1f' },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
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
    <div className="cm-flow h-full w-full">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
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
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  )
}
