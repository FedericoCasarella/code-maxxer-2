import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Brain, FileText, GitBranch, Lightbulb, Plus, Scale, Search, Trash2 } from 'lucide-react'
import type { BrainEntry } from '@shared/types'
import { useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { PageHeader } from '../PageHeader'
import { ConfirmDialog } from '../ConfirmDialog'
import { SegmentedControl } from '../../affect/segmented-control'
import { Select } from '../../affect/select'
import { TextField } from '../../affect/text-field'
import { TextArea } from '../../affect/text-area'
import { EmptyState } from '../../affect/empty-state'
import { Spinner } from '../../affect/spinner'

type Tab = 'claude' | 'lesson' | 'decision' | 'issue'
type Entry = BrainEntry & { branch: string }
const KIND_ICON = { lesson: Lightbulb, decision: Scale, issue: BookOpen }

/** Everything the agent knows about a project, editable: CLAUDE.md, lessons, decisions, issues. */
export function BrainPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const space = useStore((s) => s.space)
  const projects = useStore((s) => s.projects).filter((p) => p.spaceId === space)
  const selectedProject = useStore((s) => s.selectedProject)
  const [pid, setPid] = useState<string | null>(projects.find((p) => p.id === selectedProject)?.id ?? projects[0]?.id ?? null)
  const [tab, setTab] = useState<Tab>('claude')
  const [entries, setEntries] = useState<Entry[]>([])
  const [md, setMd] = useState<{ path: string; text: string; exists: boolean } | null>(null)
  const [mdDraft, setMdDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<Partial<Entry> | null>(null)
  const [toDelete, setToDelete] = useState<Entry | null>(null)

  const load = async () => {
    if (!pid) return
    setEntries(await window.cm.projectBrain(pid))
    const m = await window.cm.readClaudeMd(pid)
    setMd(m)
    setMdDraft(m.text)
  }
  useEffect(() => {
    void load()
  }, [pid])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return entries.filter((e) => e.kind === tab && (!s || `${e.title} ${e.body}`.toLowerCase().includes(s)))
  }, [entries, tab, q])
  const count = (k: string) => entries.filter((e) => e.kind === k).length

  const saveEntry = async () => {
    if (!pid || !editing?.title?.trim()) return
    await window.cm.saveBrainEntry(pid, { id: editing.id, kind: (editing.kind ?? tab) as BrainEntry['kind'], title: editing.title.trim(), body: editing.body ?? '' })
    setEditing(null)
    await load()
  }

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <Brain size={14} className="text-accent" />
        <span className="font-medium text-ink">Brain</span>
        <span className="text-mute">· what the agent knows about this project; it queries it through tools, never all at once</span>
      </PageHeader>

      <div className="flex shrink-0 items-end gap-3 px-6 pb-3 pt-4">
        <Select
          className="w-64"
          size="sm"
          label="Project"
          value={pid}
          options={projects.map((p) => ({ value: p.id, label: p.owner ? `${p.owner}/${p.name}` : p.name }))}
          onChange={(v) => setPid(v)}
        />
        <SegmentedControl
          size="sm"
          value={tab}
          onChange={setTab}
          aria-label="Section"
          options={[
            { value: 'claude', label: 'CLAUDE.md', icon: <FileText size={13} /> },
            { value: 'lesson', label: 'Lessons', count: count('lesson') },
            { value: 'decision', label: 'Decisions', count: count('decision') },
            { value: 'issue', label: 'Issues', count: count('issue') }
          ]}
        />
      </div>

      {!pid ? (
        <div className="grid flex-1 place-items-center">
          <EmptyState title="No project" text="Add a project to this workspace first." />
        </div>
      ) : tab === 'claude' ? (
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
          <div className="mb-2 flex items-center gap-2 text-[12px] text-mute">
            <span className="font-mono">{md?.path}</span>
            {md && !md.exists && <span className="rounded bg-warn/10 px-1.5 text-warn">not created yet</span>}
            <span className="ml-auto">Read by the agent at the start of every run, so keep it short.</span>
          </div>
          <textarea
            value={mdDraft}
            onChange={(e) => setMdDraft(e.target.value)}
            spellCheck={false}
            placeholder={'# Project rules\n\n- How to run the app and the tests\n- Conventions the agent must follow\n- Things it must never do'}
            className="selectable min-h-0 flex-1 resize-none rounded-xl border border-line bg-input p-4 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-mute focus:border-line-strong"
          />
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[12px] text-mute">~{Math.ceil(mdDraft.length / 4)} tokens per run</span>
            <div className="flex-1" />
            {md && mdDraft !== md.text && <span className="text-[12px] text-warn">Unsaved changes</span>}
            <button disabled={!md || mdDraft === md.text} onClick={() => setMdDraft(md?.text ?? '')} className="h-8 rounded-lg px-3 text-[12.5px] text-dim hover:text-ink disabled:opacity-40">
              Revert
            </button>
            <button
              disabled={!md || mdDraft === md.text || saving}
              onClick={async () => {
                setSaving(true)
                await window.cm.writeClaudeMd(pid, mdDraft)
                await load()
                setSaving(false)
              }}
              className="flex h-8 items-center gap-2 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-black disabled:opacity-40"
            >
              {saving && <Spinner size={12} />} Save CLAUDE.md
            </button>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="flex items-center gap-2">
            <label className="flex h-8 w-80 items-center gap-2 rounded-lg border border-line bg-raised px-2.5 focus-within:border-accent/50">
              <Search size={13} className="text-mute" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="selectable min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-mute" />
            </label>
            <div className="flex-1" />
            {tab !== 'issue' && (
              <button onClick={() => setEditing({ kind: tab, title: '', body: '' })} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
                <Plus size={13} /> New {tab}
              </button>
            )}
          </div>
          <p className="mt-2 text-[12px] text-mute">
            {tab === 'lesson' && 'Things learned the hard way. The agent searches them before redoing work.'}
            {tab === 'decision' && 'Choices made and why (root causes, trade-offs). The agent reads them on demand.'}
            {tab === 'issue' && 'Problems found by QA and reviews. Manage their status on the Issues board.'}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {list.length === 0 && (
              <div className="py-12">
                <EmptyState bare title={`No ${tab === 'issue' ? 'issues' : tab + 's'} yet`} text="The agent records them as it works; you can add your own." />
              </div>
            )}
            {list.map((e) => {
              const Icon = KIND_ICON[e.kind]
              return (
                <article key={e.id} className="group rounded-xl border border-line bg-raised/50 p-3.5 hover:border-line-strong">
                  <div className="flex items-start gap-2.5">
                    <Icon size={15} className={cn('mt-0.5 shrink-0', e.kind === 'issue' ? (e.resolved ? 'text-ok' : 'text-bad') : 'text-accent')} />
                    <div className="min-w-0 flex-1">
                      <div className={cn('text-[13px] font-medium', e.resolved && e.kind === 'issue' && 'text-mute line-through')}>{e.title}</div>
                      {e.body && <div className="selectable mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-dim">{e.body}</div>}
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-mute">
                        <GitBranch size={11} /> <span className="font-mono">{e.branch}</span>
                        {e.nodeId && <span className="rounded bg-white/[.06] px-1 font-mono">{e.nodeId}</span>}
                        <span>· {timeAgo(e.createdAt)} ago</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => setEditing(e)} className="h-7 rounded-md px-2 text-[12px] text-dim hover:bg-white/[.06] hover:text-ink">Edit</button>
                      <button onClick={() => setToDelete(e)} aria-label="Delete" className="grid size-7 place-items-center rounded-md text-mute hover:bg-bad/10 hover:text-bad">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-[2px]" onMouseDown={() => setEditing(null)}>
          <div className="cm-in w-[520px] rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="text-[15px] font-semibold">{editing.id ? 'Edit' : 'New'} {editing.kind ?? tab}</div>
            <TextField className="mt-4" label="Title" autoFocus value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            <TextArea className="mt-3" label="Details" minRows={5} maxRows={14} value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            <div className="mt-5 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="h-8 rounded-lg px-3 text-dim hover:bg-white/5 hover:text-ink">Cancel</button>
              <button disabled={!editing.title?.trim()} onClick={() => void saveEntry()} className="h-8 rounded-lg bg-ink px-3.5 font-medium text-black disabled:opacity-40">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {toDelete && (
        <ConfirmDialog
          title={`Delete "${toDelete.title}"?`}
          danger
          confirmLabel="Delete"
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await window.cm.deleteBrainEntry(toDelete.id)
            await load()
          }}
        >
          The agent won't find it anymore. A mirrored GitHub issue stays on GitHub.
        </ConfirmDialog>
      )}
    </>
  )
}
