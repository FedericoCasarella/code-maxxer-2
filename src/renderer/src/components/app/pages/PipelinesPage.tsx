import { useEffect, useState } from 'react'
import { ChevronDown, Copy, MousePointerClick, Plus, Trash2, Workflow } from 'lucide-react'
import type { Pipeline, PipelineNode } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { PageHeader } from '../PageHeader'
import { ConfirmDialog } from '../ConfirmDialog'
import { ROLE_LABEL } from './roles'
import { Field, inputCls } from './Field'
import { PipelineCanvas } from './PipelineCanvas'

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`

export function PipelinesPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const pipelines = useStore((s) => s.pipelines)
  const agents = useStore((s) => s.agents)
  const [selected, setSelected] = useState<string | null>(pipelines[0]?.id ?? null)
  const [draft, setDraft] = useState<Pipeline | null>(null)
  const [node, setNode] = useState<string | null>(null)
  const [detached, setDetached] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const saved = pipelines.find((p) => p.id === selected) ?? null
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => {
    setDraft(saved ? structuredClone(saved) : null)
    setNode(null)
  }, [selected, pipelines])

  const patch = (p: Partial<Pipeline>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const patchNode = (id: string, p: Partial<PipelineNode>) =>
    setDraft((d) => (d ? { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) } : d))
  const removeNode = (id: string) => {
    setDraft((d) => (d ? { ...d, nodes: d.nodes.filter((n) => n.id !== id).map((n) => (n.onFail === id ? { ...n, onFail: undefined } : n)) } : d))
    setNode(null)
  }
  const addNode = (agentId: string) => {
    const a = agents.find((x) => x.id === agentId)!
    const last = draft?.nodes[draft.nodes.length - 1]
    const id = uid('n')
    setDraft((d) =>
      d
        ? {
            ...d,
            nodes: [
              ...d.nodes,
              { id, role: a.role, agentId: a.id, label: a.name, instructions: a.description, x: (last?.x ?? (d.nodes.length - 1) * 290 + 40) + 290, y: last?.y ?? 80 }
            ]
          }
        : d
    )
    setNode(id)
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

  const current = draft?.nodes.find((n) => n.id === node) ?? null
  const blocked = detached.length > 0 ? `${detached.length} node${detached.length === 1 ? ' is' : 's are'} not connected to the chain` : draft?.nodes.length === 0 ? 'Add at least one node' : null

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <Workflow size={14} className="text-accent" />
        <span className="font-medium text-ink">Pipelines</span>
        <span className="text-mute">· drag green to chain nodes, red back under an earlier node to loop</span>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[220px] shrink-0 flex-col border-r border-line">
          <div className="flex-1 overflow-y-auto p-2">
            {pipelines.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={cn('flex w-full flex-col rounded-lg px-2.5 py-2 text-left', selected === p.id ? 'bg-white/[.06]' : 'hover:bg-white/[.03]')}
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
            {/* pipeline fields */}
            <div className="flex shrink-0 items-end gap-3 border-b border-line px-4 py-3">
              <Field label="Name" className="w-56">
                <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} className={inputCls} />
              </Field>
              <Field label="Description" className="min-w-0 flex-1">
                <input value={draft.description} onChange={(e) => patch({ description: e.target.value })} className={inputCls} placeholder="Shown in the composer's execution menu" />
              </Field>
              <Field label="Max loops" className="w-24">
                <input
                  type="number" min={0} max={20} value={draft.maxLoops}
                  onChange={(e) => patch({ maxLoops: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
                  className={inputCls}
                />
              </Field>
              <DropdownMenu
                width={300}
                align="end"
                title="Add a node played by"
                items={agents.map((a) => ({ label: a.name, description: a.description, onSelect: () => addNode(a.id) }))}
                trigger={({ triggerProps }) => (
                  <button {...triggerProps} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
                    <Plus size={13} /> Add node
                  </button>
                )}
              />
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="relative min-w-0 flex-1 bg-bg/40">
                <PipelineCanvas
                  draft={draft}
                  agents={agents}
                  selected={node}
                  onSelect={setNode}
                  onChange={setDraft}
                  onDetached={setDetached}
                />
                {draft.nodes.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-mute">Add a node to start the chain</div>
                )}
              </div>

              {/* inspector */}
              <div className="flex w-[300px] shrink-0 flex-col border-l border-line">
                {current ? (
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-mute">Node</div>
                    <Field label="Label">
                      <input value={current.label} onChange={(e) => patchNode(current.id, { label: e.target.value })} className={inputCls} />
                    </Field>
                    <Field label="Agent" className="mt-3">
                      <DropdownMenu
                        width={270}
                        items={agents.map((a) => ({
                          label: a.name, description: a.description, type: 'radio' as const, checked: a.id === current.agentId,
                          onSelect: () => patchNode(current.id, { agentId: a.id, role: a.role })
                        }))}
                        trigger={({ triggerProps }) => (
                          <button {...triggerProps} className={cn(inputCls, 'flex items-center justify-between text-left')}>
                            <span>
                              {agents.find((a) => a.id === current.agentId)?.name ?? 'Pick an agent'}{' '}
                              <span className="text-mute">· {ROLE_LABEL[current.role]}</span>
                            </span>
                            <ChevronDown size={12} className="text-mute" />
                          </button>
                        )}
                      />
                    </Field>
                    <Field label="What this node must do" className="mt-3">
                      <textarea
                        value={current.instructions}
                        onChange={(e) => patchNode(current.id, { instructions: e.target.value })}
                        rows={7}
                        className={cn(inputCls, 'h-auto resize-y py-2 leading-relaxed')}
                      />
                    </Field>
                    <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-dim">
                      {current.onFail ? (
                        <>
                          On failure loops back to <b className="text-bad">{draft.nodes.find((n) => n.id === current.onFail)?.label}</b>. Select the red link and press ⌫ to remove it.
                        </>
                      ) : (
                        'No loop. Drag from the red handle (bottom right) to the small red dot (bottom left) of an earlier node to add one.'
                      )}
                    </div>
                    <button onClick={() => removeNode(current.id)} className="mt-4 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-bad hover:bg-bad/10">
                      <Trash2 size={13} /> Remove node
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[12.5px] text-mute">
                    <MousePointerClick size={18} />
                    Select a node to edit it.
                    <div className="mt-2 text-left text-[12px] leading-relaxed">
                      <div><span className="text-ok">●</span> right → left: what runs next</div>
                      <div><span className="text-bad">●</span> bottom right → bottom left of an earlier node: loop on failure</div>
                      <div className="text-mute">Select a link and press ⌫ to delete it.</div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
              <button onClick={() => void create(draft)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-dim hover:bg-white/5 hover:text-ink">
                <Copy size={13} /> Duplicate
              </button>
              {!draft.builtIn && (
                <button onClick={() => setConfirmDelete(true)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-bad hover:bg-bad/10">
                  <Trash2 size={13} /> Delete
                </button>
              )}
              <div className="flex-1" />
              {blocked ? <span className="text-[12px] text-warn">{blocked}</span> : dirty && <span className="text-[12px] text-warn">Unsaved changes</span>}
              <button disabled={!dirty} onClick={() => setDraft(saved && structuredClone(saved))} className="h-8 rounded-lg px-3 text-[12.5px] text-dim hover:text-ink disabled:opacity-40">
                Revert
              </button>
              <button disabled={!dirty || saving || !!blocked} onClick={() => void save()} className="h-8 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-black disabled:opacity-40">
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-[13px] text-mute">Pick or create a pipeline</div>
        )}
      </div>
      {confirmDelete && draft && (
        <ConfirmDialog
          title={`Delete pipeline "${draft.name}"?`}
          danger
          confirmLabel="Delete"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await window.cm.deletePipeline(draft.id)
            await actions.reloadPipelines()
            setSelected(null)
          }}
        >
          Past runs keep their record; this pipeline won't be offered in the composer anymore.
        </ConfirmDialog>
      )}
    </>
  )
}
