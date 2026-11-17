import { useEffect, useMemo, useState } from 'react'
import { Brain, FileText, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import type { BrainEntry } from '@shared/types'
import { useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { PageHeader } from '../PageHeader'
import { ConfirmDialog } from '../ConfirmDialog'
import { SegmentedControl } from '../../affect/segmented-control'
import { Select } from '../../affect/select'
import { TextField } from '../../affect/text-field'
import { TextArea } from '../../affect/text-area'
import { Dialog } from '../../affect/dialog'
import { CodeEditor } from '../editor/CodeEditor'
import { Button } from '../../affect/button'
import { EmptyState } from '../../affect/empty-state'
import { Spinner } from '../../affect/spinner'

type Tab = 'claude' | 'lesson' | 'decision' | 'issue'
type Entry = BrainEntry & { branch: string }

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
  const saveMd = async () => {
    if (!md || mdDraft === md.text || saving) return
    setSaving(true)
    await window.cm.writeClaudeMd(pid!, mdDraft)
    await load()
    setSaving(false)
  }
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
      </PageHeader>

      <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-4">
        <Select
          className="w-64"
          size="sm"
          aria-label="Project"
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
        <div className="flex-1" />
        {tab !== 'claude' && (
          <>
<TextField size="sm" className="w-56" prefix={<Search size={13} />} clearable aria-label="Search…" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            {tab !== 'issue' && (
              <button onClick={() => setEditing({ kind: tab, title: '', body: '' })} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
                <Plus size={13} /> New
              </button>
            )}
          </>
        )}
        {tab === 'claude' && md && (
          <>
            {mdDraft !== md.text && <span className="text-[12px] text-warn">Unsaved</span>}
            <Button variant="ghost" size="sm" disabled={mdDraft === md.text} onClick={() => setMdDraft(md.text)}>
              Revert
            </Button>
            <Button size="sm" loading={saving} disabled={mdDraft === md.text} onClick={() => void saveMd()}>
              Save
            </Button>
          </>
        )}
      </div>

      {!pid ? (
        <div className="grid flex-1 place-items-center">
          <EmptyState title="No project" text="Add a project to this workspace first." />
        </div>
      ) : tab === 'claude' ? (
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
          <CodeEditor
            filename="CLAUDE.md"
            className="min-h-0 flex-1"
            value={mdDraft}
            onChange={setMdDraft}
            onSave={() => void saveMd()}
            placeholder={'# Project rules\n\n- How to run the app and the tests\n- Conventions the agent must follow\n- Things it must never do'}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="overflow-hidden rounded-xl border border-line bg-raised/40">
            <table className="w-full table-fixed text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-mute">
                  <th className="w-[28%] px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Details</th>
                  {tab === 'issue' && <th className="w-24 px-4 py-2.5 font-medium">Status</th>}
                  <th className="w-36 px-4 py-2.5 font-medium">Branch</th>
                  <th className="w-20 px-4 py-2.5 font-medium">Step</th>
                  <th className="w-20 px-4 py-2.5 font-medium">Added</th>
                  <th className="w-20 px-2" />
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} onDoubleClick={() => setEditing(e)} className="group border-b border-line align-top last:border-0 hover:bg-white/[.025]">
                    <td className={cn('px-4 py-2.5 font-medium text-ink', e.kind === 'issue' && e.resolved && 'text-mute line-through')}>
                      <div className="line-clamp-2">{e.title}</div>
                    </td>
                    <td className="px-4 py-2.5 text-dim">
                      <div className="selectable line-clamp-2 whitespace-pre-wrap">{e.body || '—'}</div>
                    </td>
                    {tab === 'issue' && (
                      <td className="px-4 py-2.5">
                        <span className={cn('rounded-md px-1.5 py-0.5 text-[11px]', e.resolved ? 'bg-ok/12 text-ok' : 'bg-bad/12 text-bad')}>{e.resolved ? 'Resolved' : 'Open'}</span>
                      </td>
                    )}
                    <td className="truncate px-4 py-2.5 font-mono text-[11.5px] text-dim">{e.branch}</td>
                    <td className="px-4 py-2.5 font-mono text-[11.5px] text-mute">{e.nodeId ?? '—'}</td>
                    <td className="px-4 py-2.5 text-mute">{timeAgo(e.createdAt)}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button onClick={() => setEditing(e)} aria-label="Edit" className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => setToDelete(e)} aria-label="Delete" className="grid size-7 place-items-center rounded-md text-mute hover:bg-bad/10 hover:text-bad">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length === 0 && (
              <div className="py-14">
                <EmptyState bare title={`No ${tab === 'issue' ? 'issues' : tab + 's'} yet`} text="The agent records them as it works; you can add your own." />
              </div>
            )}
          </div>
        </div>
      )}

      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={`${editing.id ? 'Edit' : 'New'} ${editing.kind ?? tab}`}
          width={520}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={!editing.title?.trim()} onClick={() => void saveEntry()}>
                Save
              </Button>
            </>
          }
        >
          <TextField label="Title" autoFocus value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <TextArea className="mt-3" label="Details" minRows={5} maxRows={14} value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
        </Dialog>
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
