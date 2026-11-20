import { useEffect, useMemo, useState } from 'react'
import { ProjectPicker, usePickedProject } from '../ProjectPicker'
import { usePersisted } from '@/lib/persist'
import { AlignLeft, Brain, CircleDot, Clock, FileText, GitBranch, Pencil, Plus, Search, Trash2, Type, Workflow } from 'lucide-react'
import type { BrainEntry } from '@shared/types'
import { useStore } from '@/lib/store'
import { cn, timeAgo, timeAgoLabel } from '@/lib/utils'
import { t } from '@/lib/i18n'
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
import { DataTable, period } from '../../affect/data-table'
import { Spinner } from '../../affect/spinner'
import { Marquee } from '../Marquee'

type Tab = 'claude' | 'lesson' | 'decision' | 'issue'
type Entry = BrainEntry & { branch: string }

const EMPTY: Record<string, string> = { lesson: 'No lessons yet', decision: 'No decisions yet', issue: 'No issues yet' }
const NEW: Record<string, string> = { lesson: 'New lesson', decision: 'New decision', issue: 'New issue' }
const EDIT: Record<string, string> = { lesson: 'Edit lesson', decision: 'Edit decision', issue: 'Edit issue' }

/** Everything the agent knows about a project, editable: CLAUDE.md, lessons, decisions, issues. */
export function BrainPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  const space = useStore((s) => s.space)
  const projects = useStore((s) => s.projects).filter((p) => p.spaceId === space)
  const selectedProject = useStore((s) => s.selectedProject)
  const [pid, setPid] = usePickedProject()
  const [tab, setTab] = usePersisted<Tab>('brain.tab', 'claude')
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
        <ProjectPicker value={pid} onChange={(v) => v && setPid(v)} />
        <SegmentedControl
          size="sm"
          value={tab}
          onChange={setTab}
          aria-label={t('Section')}
          options={[
            { value: 'claude', label: 'CLAUDE.md', icon: <FileText size={13} /> },
            { value: 'lesson', label: t('Lessons'), count: count('lesson') },
            { value: 'decision', label: t('Decisions'), count: count('decision') },
            { value: 'issue', label: t('Issues'), count: count('issue') }
          ]}
        />
        <div className="flex-1" />
        {tab !== 'claude' && (
          <>
<TextField size="sm" className="w-56" prefix={<Search size={13} />} clearable aria-label={t('Search…')} placeholder={t('Search…')} value={q} onChange={(e) => setQ(e.target.value)} />
            {tab !== 'issue' && (
              <button onClick={() => setEditing({ kind: tab, title: '', body: '' })} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
                {t('New')} <Plus size={13} />
              </button>
            )}
          </>
        )}
        {tab === 'claude' && md && (
          <>
            {mdDraft !== md.text && <span className="text-[12px] text-warn">{t('Unsaved')}</span>}
            <Button variant="ghost" size="sm" disabled={mdDraft === md.text} onClick={() => setMdDraft(md.text)}>
              {t('Revert')}
            </Button>
            <Button size="sm" loading={saving} disabled={mdDraft === md.text} onClick={() => void saveMd()}>
              {t('Save')}
            </Button>
          </>
        )}
      </div>

      {!pid ? (
        <div className="grid flex-1 place-items-center">
          <EmptyState title={t('No project')} text={t('Add a project to this workspace first.')} />
        </div>
      ) : tab === 'claude' ? (
        <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
          <CodeEditor
            filename="CLAUDE.md"
            className="min-h-0 flex-1"
            value={mdDraft}
            onChange={setMdDraft}
            onSave={() => void saveMd()}
            placeholder={t('# Project rules\n\n- How to run the app and the tests\n- Conventions the agent must follow\n- Things it must never do')}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <DataTable<Entry>
            key={tab}
            rows={list}
            rowKey={(e) => e.id}
            onRowDoubleClick={(e) => setEditing(e)}
            rowClassName="brain-row group"
            empty={
              <div className="py-14">
                <EmptyState bare title={t(EMPTY[tab])} text={t('The agent records them as it works; you can add your own.')} />
              </div>
            }
            columns={[
              {
                id: 'title', label: t('Title'), icon: <Type />, width: '26%', filter: 'text', wrap: true, value: (e) => e.title,
                render: (e) => <div className={cn('line-clamp-2 font-medium text-ink', e.kind === 'issue' && e.resolved && 'text-mute line-through')}>{e.title}</div>
              },
              {
                id: 'body', label: t('Details'), icon: <AlignLeft />, filter: 'text', wrap: true, value: (e) => e.body,
                render: (e) => <div className="selectable line-clamp-2 whitespace-pre-wrap text-dim">{e.body || '—'}</div>
              },
              ...(tab === 'issue'
                ? [{
                    id: 'status', label: t('Status'), icon: <CircleDot />, width: 130, filter: 'options' as const,
                    value: (e: Entry) => (e.resolved ? t('Resolved') : t('Open|status')),
                    render: (e: Entry) => <span className={cn('rounded-md px-1.5 py-0.5 text-[11px]', e.resolved ? 'bg-ok/12 text-ok' : 'bg-bad/12 text-bad')}>{e.resolved ? t('Resolved') : t('Open|status')}</span>
                  }]
                : []),
              {
                id: 'branch', label: 'Branch', icon: <GitBranch />, width: 170, filter: 'options', value: (e) => e.branch,
                render: (e) => <Marquee delay={300} hoverTarget=".brain-row" className="font-mono text-[11.5px] text-dim">{e.branch}</Marquee>
              },
              {
                id: 'step', label: t('Step'), icon: <Workflow />, width: 120, filter: 'options', value: (e) => e.nodeId ?? '',
                render: (e) => <span className="font-mono text-[11.5px] text-mute">{e.nodeId ?? '—'}</span>
              },
              {
                id: 'added', label: t('Added'), icon: <Clock />, width: 130, filter: 'options', value: (e) => Date.parse(e.createdAt), filterValue: (e) => period(Date.parse(e.createdAt)),
                render: (e) => <span className="text-mute">{timeAgoLabel(e.createdAt)}</span>
              },
              {
                id: 'actions', label: '', width: 84, stopRowClick: true,
                render: (e) => (
                  <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button onClick={() => setEditing(e)} aria-label={t('Edit')} className="grid size-7 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => setToDelete(e)} aria-label={t('Delete')} className="grid size-7 place-items-center rounded-md text-mute hover:bg-bad/10 hover:text-bad">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )
              }
            ]}
          />
        </div>
      )}

      {editing && (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={t((editing.id ? EDIT : NEW)[editing.kind ?? tab])}
          width={520}
          footer={
            <>
              <Button variant="secondary" size="sm" onClick={() => setEditing(null)}>
                {t('Cancel')}
              </Button>
              <Button size="sm" disabled={!editing.title?.trim()} onClick={() => void saveEntry()}>
                {t('Save')}
              </Button>
            </>
          }
        >
          <TextField label={t('Title')} autoFocus value={editing.title ?? ''} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <TextArea className="mt-3" label={t('Details')} minRows={5} maxRows={14} value={editing.body ?? ''} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
        </Dialog>
      )}
      {toDelete && (
        <ConfirmDialog
          title={t('Delete "{title}"?', { title: toDelete.title })}
          danger
          confirmLabel={t('Delete')}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            await window.cm.deleteBrainEntry(toDelete.id)
            await load()
          }}
        >
          {t("The agent won't find it anymore. A mirrored GitHub issue stays on GitHub.")}
        </ConfirmDialog>
      )}
    </>
  )
}
