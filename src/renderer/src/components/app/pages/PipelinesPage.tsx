import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, Copy, CornerDownLeft, Plus, Trash2, Workflow } from 'lucide-react'
import type { Pipeline, PipelineNode } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { PageHeader } from '../PageHeader'
import { ROLE_ICON, ROLE_LABEL } from './roles'
import { Field, inputCls } from './Field'

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`

export function PipelinesPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const pipelines = useStore((s) => s.pipelines)
  const agents = useStore((s) => s.agents)
  const [selected, setSelected] = useState<string | null>(pipelines[0]?.id ?? null)
  const [draft, setDraft] = useState<Pipeline | null>(null)
  const [saving, setSaving] = useState(false)
  const saved = pipelines.find((p) => p.id === selected) ?? null
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => {
    setDraft(saved ? structuredClone(saved) : null)
  }, [selected, pipelines])

  const patch = (p: Partial<Pipeline>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const patchNode = (id: string, p: Partial<PipelineNode>) =>
    setDraft((d) => (d ? { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) } : d))
  const moveNode = (i: number, dir: -1 | 1) =>
    setDraft((d) => {
      if (!d) return d
      const nodes = d.nodes.slice()
      const j = i + dir
      if (j < 0 || j >= nodes.length) return d
      ;[nodes[i], nodes[j]] = [nodes[j], nodes[i]]
      return { ...d, nodes }
    })
  const removeNode = (id: string) =>
    setDraft((d) =>
      d ? { ...d, nodes: d.nodes.filter((n) => n.id !== id).map((n) => (n.onFail === id ? { ...n, onFail: undefined } : n)) } : d
    )
  const addNode = (agentId: string) => {
    const a = agents.find((x) => x.id === agentId)!
    setDraft((d) =>
      d ? { ...d, nodes: [...d.nodes, { id: uid('n'), role: a.role, agentId: a.id, label: a.name, instructions: a.description }] } : d
    )
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    await window.cm.savePipeline(draft)
    await actions.reloadPipelines()
    setSaving(false)
  }
  const create = async (from?: Pipeline) => {
    const p: Pipeline = from
      ? { ...structuredClone(from), id: uid('p'), name: `${from.name} copy`, builtIn: false }
      : { id: uid('p'), name: 'New pipeline', description: '', maxLoops: 3, nodes: [] }
    await window.cm.savePipeline(p)
    await actions.reloadPipelines()
    setSelected(p.id)
  }
  const remove = async () => {
    if (!draft || draft.builtIn) return
    if (!confirm(`Delete pipeline "${draft.name}"?`)) return
    await window.cm.deletePipeline(draft.id)
    await actions.reloadPipelines()
    setSelected(null)
  }

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <Workflow size={14} className="text-accent" />
        <span className="font-medium text-ink">Pipelines</span>
        <span className="text-mute">· plans the orchestrator runs node by node, looping on failure</span>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[240px] shrink-0 flex-col border-r border-line">
          <div className="flex-1 overflow-y-auto p-2">
            {pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={cn(
                  'flex w-full flex-col rounded-lg px-2.5 py-2 text-left',
                  selected === p.id ? 'bg-white/[.06]' : 'hover:bg-white/[.03]'
                )}
              >
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  {p.name}
                  {p.builtIn && <span className="rounded bg-white/[.06] px-1 text-[10px] font-normal text-mute">built-in</span>}
                </span>
                <span className="truncate text-[11.5px] text-mute">{p.nodes.map((n) => n.label).join(' → ') || 'No nodes'}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-line p-2">
            <button onClick={() => void create()} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[12.5px] text-dim hover:text-ink">
              <Plus size={13} /> New pipeline
            </button>
          </div>
        </div>

        {draft ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[760px] px-6 py-5">
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <Field label="Name">
                    <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Max loops">
                    <input
                      type="number" min={0} max={20} value={draft.maxLoops}
                      onChange={(e) => patch({ maxLoops: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                      className={inputCls}
                    />
                  </Field>
                </div>
                <Field label="Description" className="mt-3">
                  <input value={draft.description} onChange={(e) => patch({ description: e.target.value })} className={inputCls} placeholder="Shown in the composer's execution menu" />
                </Field>

                {/* the chain at a glance */}
                <div className="mt-5 flex flex-wrap items-center gap-1.5 rounded-xl border border-line bg-bg/50 p-3">
                  {draft.nodes.length === 0 && <span className="text-[12px] text-mute">Add nodes below</span>}
                  {draft.nodes.map((n, i) => {
                    const Icon = ROLE_ICON[n.role]
                    return (
                      <span key={n.id} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-mute">→</span>}
                        <span className="flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1 text-[12px]">
                          <Icon size={12} className="text-dim" />
                          {n.label}
                          {n.onFail && (
                            <span className="flex items-center gap-0.5 text-[10.5px] text-bad">
                              <CornerDownLeft size={10} />
                              {draft.nodes.find((x) => x.id === n.onFail)?.label}
                            </span>
                          )}
                        </span>
                      </span>
                    )
                  })}
                </div>

                <div className="mt-5 flex flex-col gap-2.5">
                  {draft.nodes.map((n, i) => {
                    const agent = agents.find((a) => a.id === n.agentId)
                    const Icon = ROLE_ICON[n.role]
                    return (
                      <div key={n.id} className="rounded-xl border border-line bg-raised p-3">
                        <div className="flex items-center gap-2">
                          <span className="grid size-6 place-items-center rounded-md border border-line text-[11px] tabular-nums text-mute">{i + 1}</span>
                          <Icon size={14} className="text-dim" />
                          <input
                            value={n.label}
                            onChange={(e) => patchNode(n.id, { label: e.target.value })}
                            className="min-w-0 flex-1 bg-transparent text-[13.5px] font-medium outline-none"
                          />
                          <IconBtn label="Move up" disabled={i === 0} onClick={() => moveNode(i, -1)}><ArrowUp size={13} /></IconBtn>
                          <IconBtn label="Move down" disabled={i === draft.nodes.length - 1} onClick={() => moveNode(i, 1)}><ArrowDown size={13} /></IconBtn>
                          <IconBtn label="Remove node" onClick={() => removeNode(n.id)} danger><Trash2 size={13} /></IconBtn>
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                          <Field label="Agent">
                            <DropdownMenu
                              width={280}
                              items={agents.map((a) => ({
                                label: a.name, description: a.description, type: 'radio' as const, checked: a.id === n.agentId,
                                onSelect: () => patchNode(n.id, { agentId: a.id, role: a.role })
                              }))}
                              trigger={({ triggerProps }) => (
                                <button {...triggerProps} className={cn(inputCls, 'flex items-center justify-between text-left')}>
                                  <span>{agent?.name ?? 'Pick an agent'} <span className="text-mute">· {ROLE_LABEL[n.role]}</span></span>
                                  <ChevronDown size={12} className="text-mute" />
                                </button>
                              )}
                            />
                          </Field>
                          <Field label="On failure, loop back to">
                            <DropdownMenu
                              width={240}
                              items={[
                                { label: 'No loop (stop)', type: 'radio' as const, checked: !n.onFail, onSelect: () => patchNode(n.id, { onFail: undefined }) },
                                ...draft.nodes.slice(0, i).map((t, k) => ({
                                  label: t.label, type: 'radio' as const, checked: n.onFail === t.id, divider: k === 0,
                                  onSelect: () => patchNode(n.id, { onFail: t.id })
                                }))
                              ]}
                              trigger={({ triggerProps }) => (
                                <button {...triggerProps} className={cn(inputCls, 'flex items-center justify-between text-left')}>
                                  <span className={n.onFail ? 'text-bad' : 'text-dim'}>
                                    {draft.nodes.find((x) => x.id === n.onFail)?.label ?? 'No loop'}
                                  </span>
                                  <ChevronDown size={12} className="text-mute" />
                                </button>
                              )}
                            />
                          </Field>
                        </div>
                        <Field label="What this node must do" className="mt-2.5">
                          <textarea
                            value={n.instructions}
                            onChange={(e) => patchNode(n.id, { instructions: e.target.value })}
                            rows={3}
                            className={cn(inputCls, 'h-auto resize-y py-2 leading-relaxed')}
                          />
                        </Field>
                      </div>
                    )
                  })}
                  <DropdownMenu
                    width={300}
                    title="Add a node played by"
                    items={agents.map((a) => ({ label: a.name, description: a.description, onSelect: () => addNode(a.id) }))}
                    trigger={({ triggerProps }) => (
                      <button {...triggerProps} className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-[12.5px] text-dim hover:text-ink">
                        <Plus size={13} /> Add node
                      </button>
                    )}
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-6 py-3">
              <button onClick={() => void create(draft)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-dim hover:bg-white/5 hover:text-ink">
                <Copy size={13} /> Duplicate
              </button>
              {!draft.builtIn && (
                <button onClick={() => void remove()} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-bad hover:bg-bad/10">
                  <Trash2 size={13} /> Delete
                </button>
              )}
              <div className="flex-1" />
              {dirty && <span className="text-[12px] text-warn">Unsaved changes</span>}
              <button disabled={!dirty} onClick={() => setDraft(saved && structuredClone(saved))} className="h-8 rounded-lg px-3 text-[12.5px] text-dim hover:text-ink disabled:opacity-40">
                Revert
              </button>
              <button
                disabled={!dirty || saving || draft.nodes.length === 0}
                onClick={() => void save()}
                className="h-8 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-black disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-[13px] text-mute">Pick or create a pipeline</div>
        )}
      </div>
    </>
  )
}

function IconBtn({ children, label, onClick, disabled, danger }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn('grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] disabled:opacity-30', danger ? 'hover:text-bad' : 'hover:text-ink')}
    >
      {children}
    </button>
  )
}

