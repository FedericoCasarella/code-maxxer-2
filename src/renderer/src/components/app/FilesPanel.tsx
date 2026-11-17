import { useEffect, useMemo, useState } from 'react'
import { File, Folder, FolderOpen, Radio } from 'lucide-react'
import { useStore, type FilesState } from '@/lib/store'
import { cn } from '@/lib/utils'
import { TreeView, type TreeNode } from '../affect/tree-view'
import { Spinner } from '../affect/spinner'
import { EmptyState } from '../affect/empty-state'

const RECENT_MS = 8000

function buildTree(f: FilesState, now: number): TreeNode[] {
  type N = TreeNode & { children?: N[]; _dir: boolean }
  const root: N[] = []
  const dirs = new Map<string, N>()
  const ensureDir = (path: string): N[] => {
    if (!path) return root
    const hit = dirs.get(path)
    if (hit) return hit.children!
    const i = path.lastIndexOf('/')
    const parent = ensureDir(i < 0 ? '' : path.slice(0, i))
    const node: N = { id: path, label: path.slice(i + 1), icon: <Folder size={14} />, openIcon: <FolderOpen size={14} />, children: [], _dir: true }
    dirs.set(path, node)
    parent.push(node)
    return node.children!
  }
  const sorted = [...f.entries.values()].sort((a, b) => a.path.localeCompare(b.path))
  for (const e of sorted) {
    if (e.dir) {
      ensureDir(e.path)
      continue
    }
    const i = e.path.lastIndexOf('/')
    const parent = ensureDir(i < 0 ? '' : e.path.slice(0, i))
    const active = f.active.has(e.path)
    const recent = !active && now - (f.touched.get(e.path) ?? 0) < RECENT_MS
    parent.push({
      id: e.path,
      label: e.path.slice(i + 1),
      icon: active ? <Spinner size={13} className="text-accent" /> : <File size={14} className={recent ? 'text-accent' : undefined} />,
      meta: active ? <span className="text-[10.5px] text-accent">editing</span> : recent ? <span className="size-1.5 rounded-full bg-accent inline-block" /> : undefined,
      _dir: false
    })
  }
  const sortRec = (list: N[]) => {
    list.sort((a, b) => (a._dir === b._dir ? a.label.localeCompare(b.label) : a._dir ? -1 : 1))
    list.forEach((n) => n.children && sortRec(n.children))
  }
  sortRec(root)
  return root
}

const ancestors = (p: string) => {
  const out: string[] = []
  let i = p.indexOf('/')
  while (i >= 0) {
    out.push(p.slice(0, i))
    i = p.indexOf('/', i + 1)
  }
  return out
}

export function FilesPanel({ workspaceId }: { workspaceId: string | null }) {
  const files = useStore((s) => (workspaceId ? s.files[workspaceId] : undefined))
  const [now, setNow] = useState(Date.now())
  const [expanded, setExpanded] = useState<string[]>([])

  // Re-render while something is fresh so the glow fades out.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const items = useMemo(() => (files ? buildTree(files, now) : []), [files?.version, now])
  const live = useMemo(() => {
    if (!files) return []
    const set = new Set(files.active)
    for (const [p, t] of files.touched) if (now - t < RECENT_MS && files.entries.has(p)) set.add(p)
    return [...set]
  }, [files?.version, now])

  // Reveal folders that contain files being edited.
  useEffect(() => {
    if (!files) return
    const need = [...files.active].flatMap(ancestors).filter((d) => !expanded.includes(d))
    if (need.length) setExpanded((e) => [...new Set([...e, ...need])])
  }, [files?.version])

  return (
    <aside className="flex w-[280px] shrink-0 flex-col bg-bg">
      <div className="drag flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-[12.5px] font-medium">Files</span>
        {files && files.active.size > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10.5px] text-accent">
            <Radio size={10} style={{ animation: 'cm-pulse 1.2s infinite' }} /> live
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-mute">{files ? [...files.entries.values()].filter((e) => !e.dir).length : 0}</span>
      </div>

      {live.length > 0 && files && (
        <div className="border-b border-line px-2 py-2">
          <div className="px-2 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-mute">Active now</div>
          {live.map((p) => {
            const active = files.active.has(p)
            return (
              <div
                key={p}
                className={cn('cm-in flex h-7 items-center gap-2 rounded-md px-2 font-mono text-[11.5px]', active ? 'cm-file-active text-ink' : 'text-dim')}
              >
                {active ? <Spinner size={11} className="text-accent" /> : <span className="size-1.5 rounded-full bg-accent" />}
                <span className="min-w-0 truncate">{p}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {!workspaceId ? (
          <EmptyState bare title="No workspace" text="Pick a branch on the left to watch its files live." />
        ) : !files ? null : (
          <TreeView
            items={items}
            expanded={expanded}
            onExpandedChange={setExpanded}
            guides
            aria-label="Workspace files"
            emptyText="Empty worktree"
          />
        )}
      </div>
    </aside>
  )
}
