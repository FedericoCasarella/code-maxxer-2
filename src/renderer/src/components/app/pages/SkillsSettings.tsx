import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileText, Folder, FolderOpen, Puzzle, Trash2 } from 'lucide-react'
import type { LibrarySkill } from '@shared/skills'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { TreeView, type TreeNode } from '../../affect/tree-view'
import { Button } from '../../affect/button'
import { EmptyState } from '../../affect/empty-state'
import { Skeleton } from '../../affect/shimmer-loader'
import { CodeEditor } from '../editor/CodeEditor'
import { ConfirmDialog } from '../ConfirmDialog'
import { Marquee } from '../Marquee'

/** Paths → a tree (folders first). */
function toTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  const dirs = new Map<string, TreeNode>()
  for (const p of paths) {
    const parts = p.split('/')
    let level = root
    parts.forEach((name, i) => {
      const id = parts.slice(0, i + 1).join('/')
      if (i === parts.length - 1) {
        level.push({ id, label: name, icon: <FileText size={14} /> })
        return
      }
      let d = dirs.get(id)
      if (!d) {
        d = { id, label: name, icon: <Folder size={14} />, openIcon: <FolderOpen size={14} />, children: [] }
        dirs.set(id, d)
        level.push(d)
      }
      level = d.children!
    })
  }
  const sort = (l: TreeNode[]) => {
    l.sort((a, b) => Number(!!b.children) - Number(!!a.children) || (a.label === 'SKILL.md' ? -1 : b.label === 'SKILL.md' ? 1 : a.label.localeCompare(b.label)))
    l.forEach((n) => n.children && sort(n.children))
    return l
  }
  return sort(root)
}

/** Settings → Skills: every installed skill, its files in a tree, each file readable and editable. */
export function SkillsSettings() {
  const tick = useStore((s) => s.skillsTick)
  const [skills, setSkills] = useState<LibrarySkill[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const reload = () => void window.cm.skills.list().then((l) => {
    setSkills(l)
    setSelected((cur) => (cur && l.some((x) => x.id === cur) ? cur : l[0]?.id ?? null))
  })
  useEffect(reload, [tick])

  const skill = skills?.find((x) => x.id === selected) ?? null

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[260px] shrink-0 flex-col border-r border-line">
        <div className="px-4 pb-1 pt-3 text-[11.5px] font-medium text-dim">
          Installed skills
          <span className="block text-[11px] font-normal text-mute">Ask a chat: “install this skill https://…”</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!skills ? (
            <div className="space-y-3 p-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} width="100%" height={34} radius={8} />
              ))}
            </div>
          ) : (
            skills.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                className={cn('flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left', selected === s.id ? 'bg-white/[.06]' : 'hover:bg-white/[.03]')}
              >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-line bg-raised text-dim">
                  <Puzzle size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium">{s.name}</span>
                  <Marquee className="text-[11.5px] text-mute" delay={300}>
                    {s.description || 'No description'}
                  </Marquee>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      {skills && skills.length === 0 ? (
        <div className="grid flex-1 place-items-center px-6">
          <EmptyState
            icon={<Puzzle size={20} />}
            title="No skills yet"
            text="In any chat, ask the agent to install a skill from a link (a GitHub folder or a SKILL.md). It shows up here with all its files."
          />
        </div>
      ) : skill ? (
        <SkillDetail key={skill.id} s={skill} onRemoved={reload} />
      ) : (
        <div className="flex-1" />
      )}
    </div>
  )
}

function SkillDetail({ s, onRemoved }: { s: LibrarySkill; onRemoved: () => void }) {
  const [files, setFiles] = useState<string[] | null>(null)
  const [path, setPath] = useState<string | null>(null)
  const [file, setFile] = useState<{ text: string; binary: boolean } | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [expanded, setExpanded] = useState<string[]>([])

  useEffect(() => {
    void window.cm.skills.files(s.id).then((l) => {
      setFiles(l)
      setPath(l.includes('SKILL.md') ? 'SKILL.md' : l[0] ?? null)
      // Folders on the way to every file start open: a skill is small.
      setExpanded([...new Set(l.flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))])
    })
  }, [s.id])
  useEffect(() => {
    if (!path) return
    setFile(null)
    void window.cm.skills.read(s.id, path).then((f) => {
      setFile(f)
      setDraft(f.text)
    })
  }, [s.id, path])

  const tree = useMemo(() => toTree(files ?? []), [files])
  const dirty = !!file && !file.binary && draft !== file.text
  const save = async () => {
    if (!path || !dirty) return
    setSaving(true)
    await window.cm.skills.write(s.id, path, draft).finally(() => setSaving(false))
    setFile({ text: draft, binary: false })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="border-b border-line px-6 pb-3 pt-4">
        <div className="text-[16px] font-semibold text-ink">{s.name}</div>
        {s.description && <p className="mt-1 max-w-[720px] text-[12.5px] leading-[1.55] text-dim">{s.description}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mute">
          <span>{s.files} {s.files === 1 ? 'file' : 'files'}</span>
          {s.agents.length > 0 && <span>Used by {s.agents.map((a) => `@${a}`).join(', ')}</span>}
          {s.chats.length > 0 && <span>Loaded in {s.chats.join(', ')}</span>}
          {s.sourceUrl && (
            <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-ink">
              <ExternalLink size={12} /> Source
            </a>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-[230px] shrink-0 overflow-y-auto border-r border-line p-2">
          {!files ? (
            <div className="space-y-2 p-1">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} width={`${70 - i * 10}%`} height={14} radius={4} />
              ))}
            </div>
          ) : (
            <TreeView
              aria-label="Skill files"
              items={tree}
              guides
              expanded={expanded}
              onExpandedChange={setExpanded}
              selected={path}
              onSelect={(id, node) => !node.children && setPath(id)}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col p-3">
          {!file || !path ? (
            <Skeleton width="100%" height="100%" radius={12} />
          ) : file.binary ? (
            <div className="grid flex-1 place-items-center text-[12.5px] text-mute">{file.text}</div>
          ) : (
            <CodeEditor key={path} className="min-h-0 flex-1" value={draft} onChange={setDraft} filename={path} onSave={() => void save()} />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-6 py-3">
        <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => setRemoving(true)}>
          Delete skill
        </Button>
        <div className="flex-1" />
        {dirty && <span className="text-[12px] text-warn">Unsaved changes</span>}
        <Button variant="ghost" size="sm" disabled={!dirty} onClick={() => file && setDraft(file.text)}>
          Revert
        </Button>
        <Button size="sm" disabled={!dirty} loading={saving} onClick={() => void save()}>
          Save
        </Button>
      </div>
      {removing && (
        <ConfirmDialog
          title={`Delete “${s.name}”?`}
          confirmLabel="Delete"
          danger
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await window.cm.skills.remove(s.id)
            setRemoving(false)
            onRemoved()
          }}
        >
          Its files are removed, chats stop loading it{s.agents.length ? ` and ${s.agents.map((a) => `@${a}`).join(', ')} lose it` : ''}.
        </ConfirmDialog>
      )}
    </div>
  )
}
