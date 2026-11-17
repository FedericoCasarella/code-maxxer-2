import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, File, FileCode2, FileJson, FileText, FileType, Folder, FolderOpen, Image, Radio, Search, X } from 'lucide-react'
import { actions, useStore, type FilesState } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Spinner } from '../affect/spinner'
import { EmptyState } from '../affect/empty-state'

const RECENT_MS = 8000
const ROW = 22
const INDENT = 12

type Node = { name: string; path: string; dir: boolean; children: Node[] }

function buildTree(f: FilesState): Node[] {
  const root: Node[] = []
  const dirs = new Map<string, Node>()
  const ensure = (path: string): Node[] => {
    if (!path) return root
    const hit = dirs.get(path)
    if (hit) return hit.children
    const i = path.lastIndexOf('/')
    const parent = ensure(i < 0 ? '' : path.slice(0, i))
    const node: Node = { name: path.slice(i + 1), path, dir: true, children: [] }
    dirs.set(path, node)
    parent.push(node)
    return node.children
  }
  for (const e of f.entries.values()) {
    if (e.dir) {
      ensure(e.path)
      continue
    }
    const i = e.path.lastIndexOf('/')
    ensure(i < 0 ? '' : e.path.slice(0, i)).push({ name: e.path.slice(i + 1), path: e.path, dir: false, children: [] })
  }
  const sort = (l: Node[]) => {
    l.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) : a.dir ? -1 : 1))
    l.forEach((n) => n.dir && sort(n.children))
  }
  sort(root)
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

export function fileIcon(name: string) {
  const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
  if (['ts', 'tsx'].includes(ext)) return <FileCode2 size={13} className="text-[#4d9fff]" />
  if (['js', 'jsx', 'mjs', 'cjs'].includes(ext)) return <FileCode2 size={13} className="text-[#e8c547]" />
  if (ext === 'json') return <FileJson size={13} className="text-[#e3a34a]" />
  if (['md', 'mdx', 'txt'].includes(ext)) return <FileText size={13} className="text-[#7fa6c9]" />
  if (['css', 'scss'].includes(ext)) return <FileType size={13} className="text-[#d36bc6]" />
  if (['html', 'svg'].includes(ext)) return <FileCode2 size={13} className="text-[#e3734a]" />
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'].includes(ext)) return <Image size={13} className="text-[#a78bfa]" />
  if (['py', 'rs', 'go', 'swift', 'java', 'rb', 'sh'].includes(ext)) return <FileCode2 size={13} className="text-[#4fc3a1]" />
  return <File size={13} className="text-mute" />
}

/** Highlight the matched part of a name. */
function Hl({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q)
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <span className="rounded-[2px] bg-accent/30 text-ink">{text.slice(i, i + q.length)}</span>
      {text.slice(i + q.length)}
    </>
  )
}

export function FilesPanel({ workspaceId }: { workspaceId: string | null }) {
  const files = useStore((s) => (workspaceId ? s.files[workspaceId] : undefined))
  const [now, setNow] = useState(Date.now())
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  // ⌘P focuses the filter, like VS Code's quick open.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'p') {
        e.preventDefault()
        filterRef.current?.focus()
      }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [])

  const tree = useMemo(() => (files ? buildTree(files) : []), [files?.version])

  // Reveal folders that contain files being edited.
  useEffect(() => {
    if (!files) return
    const need = [...files.active].flatMap(ancestors).filter((d) => !open.has(d))
    if (need.length) setOpen((o) => new Set([...o, ...need]))
  }, [files?.version])

  // Filtering: keep matches and their ancestors, all expanded.
  const visible = useMemo(() => {
    const keep = new Set<string>()
    if (q && files) {
      for (const e of files.entries.values()) {
        if (e.path.toLowerCase().includes(q)) {
          keep.add(e.path)
          ancestors(e.path).forEach((a) => keep.add(a))
        }
      }
    }
    const rows: { n: Node; depth: number }[] = []
    const walk = (list: Node[], depth: number) => {
      for (const n of list) {
        if (q && !keep.has(n.path)) continue
        rows.push({ n, depth })
        if (n.dir && (q || open.has(n.path))) walk(n.children, depth + 1)
      }
    }
    walk(tree, 0)
    return rows
  }, [tree, open, q, files?.version])

  const live = useMemo(() => {
    if (!files) return []
    const set = new Set(files.active)
    for (const [p, t] of files.touched) if (now - t < RECENT_MS && files.entries.has(p)) set.add(p)
    return [...set]
  }, [files?.version, now])

  const fileCount = files ? [...files.entries.values()].filter((e) => !e.dir).length : 0

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-3">
        <span className="text-[11px] font-semibold text-dim">Files</span>
        {files && files.active.size > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-px text-[10px] text-accent">
            <Radio size={9} style={{ animation: 'cm-pulse 1.2s infinite' }} /> live
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-mute">{fileCount}</span>
      </div>

      {workspaceId && (
        <div className="px-2">
          <label className="flex h-[26px] items-center gap-1.5 rounded-md border border-line bg-raised px-2 focus-within:border-accent/50">
            <Search size={12} className="text-mute" />
            <input
              ref={filterRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
              placeholder="Filter files  ⌘P"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-mute"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-mute hover:text-ink" aria-label="Clear filter">
                <X size={12} />
              </button>
            )}
          </label>
        </div>
      )}

      {live.length > 0 && files && !q && (
        <div className="border-b border-line px-1 pb-1 pt-2">
          <div className="px-2 pb-0.5 text-[10px] font-semibold text-mute">Active now</div>
          {live.map((p) => {
            const active = files.active.has(p)
            return (
              <div
                key={p}
                onClick={() => workspaceId && actions.openEditor(workspaceId, { kind: 'file', path: p })}
                style={{ height: ROW }}
                className={cn('flex cursor-default items-center gap-1.5 rounded px-2 font-mono text-[11.5px] hover:bg-white/[.04]', active ? 'cm-file-active text-ink' : 'text-dim')}
              >
                {active ? <Spinner size={10} className="shrink-0 text-accent" /> : <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
                <span className="min-w-0 truncate">{p}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1" role="tree" aria-label="Workspace files">
        {!workspaceId ? (
          <EmptyState bare title="No branch" text="Pick a branch on the left to watch its files live." />
        ) : !files ? null : visible.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-mute">{q ? 'No matching files' : 'Empty worktree'}</div>
        ) : (
          visible.map(({ n, depth }) => {
            const isOpen = n.dir && (!!q || open.has(n.path))
            const active = !n.dir && files.active.has(n.path)
            const recent = !n.dir && !active && now - (files.touched.get(n.path) ?? 0) < RECENT_MS
            return (
              <div
                key={n.path}
                role="treeitem"
                aria-expanded={n.dir ? isOpen : undefined}
                aria-selected={selected === n.path}
                onClick={() => {
                  setSelected(n.path)
                  if (!n.dir && workspaceId) actions.openEditor(workspaceId, { kind: 'file', path: n.path })
                  if (n.dir && !q)
                    setOpen((o) => {
                      const s = new Set(o)
                      s.has(n.path) ? s.delete(n.path) : s.add(n.path)
                      return s
                    })
                }}
                style={{ height: ROW, paddingLeft: 8 + depth * INDENT }}
                className={cn(
                  'group relative flex cursor-default items-center gap-1 pr-2 text-[12.5px]',
                  selected === n.path ? 'bg-accent/[.13] text-ink outline outline-1 -outline-offset-1 outline-accent/40' : 'hover:bg-white/[.04]',
                  active && 'cm-file-active'
                )}
              >
                {/* indent guides */}
                {Array.from({ length: depth }, (_, d) => (
                  <span key={d} className="absolute inset-y-0 w-px bg-white/[.06] group-hover:bg-white/[.1]" style={{ left: 8 + d * INDENT + 6 }} />
                ))}
                <span className="grid w-3.5 shrink-0 place-items-center text-mute">
                  {n.dir && <ChevronRight size={12} className={cn('transition-transform duration-100', isOpen && 'rotate-90')} />}
                </span>
                <span className="grid w-4 shrink-0 place-items-center">
                  {active ? (
                    <Spinner size={11} className="text-accent" />
                  ) : n.dir ? (
                    isOpen ? <FolderOpen size={13} className="text-[#c9a86a]" /> : <Folder size={13} className="text-[#c9a86a]" />
                  ) : (
                    fileIcon(n.name)
                  )}
                </span>
                <span className={cn('min-w-0 flex-1 truncate', recent || active ? 'text-accent' : n.dir ? 'text-ink/90' : 'text-ink/80')}>
                  <Hl text={n.name} q={q} />
                </span>
                {active ? (
                  <span className="text-[10px] text-accent">editing</span>
                ) : recent ? (
                  <span className="text-[10.5px] font-semibold text-accent">M</span>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
