import { useEffect, useState } from 'react'
import { Bot, ChevronDown, Plus, Trash2, Workflow } from 'lucide-react'
import type { Agent, NodeRole } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { PageHeader } from '../PageHeader'
import { ROLE_ICON, ROLE_LABEL } from './roles'
import { TextField } from '../../affect/text-field'
import { TextArea } from '../../affect/text-area'
import { Select } from '../../affect/select'

const ROLES = Object.keys(ROLE_LABEL) as NodeRole[]

export function AgentsPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const agents = useStore((s) => s.agents)
  const pipelines = useStore((s) => s.pipelines)
  const [selected, setSelected] = useState<string | null>(agents[0]?.id ?? null)
  const [draft, setDraft] = useState<Agent | null>(null)
  const saved = agents.find((a) => a.id === selected) ?? null
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => {
    setDraft(saved ? { ...saved } : null)
  }, [selected, agents])

  const usedBy = draft ? pipelines.filter((p) => p.nodes.some((n) => n.agentId === draft.id)) : []
  const patch = (p: Partial<Agent>) => setDraft((d) => (d ? { ...d, ...p } : d))

  const save = async () => {
    if (!draft) return
    await window.cm.saveAgent(draft)
    await actions.reloadAgents()
  }
  const create = async () => {
    const a: Agent = {
      id: `a_${Math.random().toString(36).slice(2, 8)}`, name: 'New agent', role: 'build',
      description: '', instructions: '', builtIn: false
    }
    await window.cm.saveAgent(a)
    await actions.reloadAgents()
    setSelected(a.id)
  }
  const remove = async () => {
    if (!draft || draft.builtIn) return
    if (usedBy.length) return alert(`Used by: ${usedBy.map((p) => p.name).join(', ')}. Remove it from those pipelines first.`)
    if (!confirm(`Delete agent "${draft.name}"?`)) return
    await window.cm.deleteAgent(draft.id)
    await actions.reloadAgents()
    setSelected(null)
  }

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <Bot size={14} className="text-accent" />
        <span className="font-medium text-ink">Agents</span>
        <span className="text-mute">· personas the orchestrator plays in pipeline nodes</span>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[260px] shrink-0 flex-col border-r border-line">
          <div className="flex-1 overflow-y-auto p-2">
            {agents.map((a) => {
              const Icon = ROLE_ICON[a.role]
              return (
                <button
                  key={a.id}
                  onClick={() => setSelected(a.id)}
                  className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left', selected === a.id ? 'bg-white/[.06]' : 'hover:bg-white/[.03]')}
                >
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-raised text-dim">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium">{a.name}</span>
                    <span className="block truncate text-[11.5px] text-mute">{a.description || ROLE_LABEL[a.role]}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className="border-t border-line p-2">
            <button onClick={() => void create()} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong text-[12.5px] text-dim hover:text-ink">
              <Plus size={13} /> New agent
            </button>
          </div>
        </div>

        {draft ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[680px] px-6 py-5">
                <div className="grid grid-cols-[1fr_200px] gap-3">
                  <TextField label="Name" size="sm" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
                  <Select
                    label="Role"
                    size="sm"
                    value={draft.role}
                    options={ROLES.map((r) => {
                      const Icon = ROLE_ICON[r]
                      return { value: r, label: ROLE_LABEL[r], icon: <Icon size={14} /> }
                    })}
                    onChange={(v) => patch({ role: v as NodeRole })}
                  />
                </div>
                <TextField
                  className="mt-3" label="Description" size="sm" value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })} placeholder="One line: what this agent is for"
                />
                <TextArea
                  className="mt-3"
                  label="Standing instructions"
                  minRows={6}
                  maxRows={18}
                  value={draft.instructions}
                  onChange={(e) => patch({ instructions: e.target.value })}
                  placeholder="How this agent works. Merged into every node it plays — keep it short, it costs tokens on every run."
                  inputClassName="font-mono text-[12.5px]"
                />
                <p className="mt-1.5 text-[11.5px] text-mute">
                  ~{Math.ceil(draft.instructions.length / 4)} tokens added to the pipeline prompt per node played.
                </p>

                <div className="mt-6">
                  <div className="mb-2 text-[11.5px] font-medium text-dim">Used in pipelines</div>
                  {usedBy.length === 0 ? (
                    <div className="text-[12px] text-mute">Not used yet. Add it to a pipeline from the Pipelines page.</div>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {usedBy.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => actions.setView('pipelines')}
                          className="flex items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1 text-[12px] text-dim hover:text-ink"
                        >
                          <Workflow size={12} /> {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-line px-6 py-3">
              {draft.builtIn ? (
                <span className="text-[12px] text-mute">Built-in agent · editable, not deletable</span>
              ) : (
                <button onClick={() => void remove()} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-bad hover:bg-bad/10">
                  <Trash2 size={13} /> Delete
                </button>
              )}
              <div className="flex-1" />
              {dirty && <span className="text-[12px] text-warn">Unsaved changes</span>}
              <button disabled={!dirty} onClick={() => setDraft(saved && { ...saved })} className="h-8 rounded-lg px-3 text-[12.5px] text-dim hover:text-ink disabled:opacity-40">
                Revert
              </button>
              <button disabled={!dirty || !draft.name.trim()} onClick={() => void save()} className="h-8 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-black disabled:opacity-40">
                Save
              </button>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-[13px] text-mute">Pick or create an agent</div>
        )}
      </div>
    </>
  )
}
