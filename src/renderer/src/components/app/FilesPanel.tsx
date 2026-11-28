import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ClipboardPaste, Copy, Trash2, File, FileCode2, FileJson, FileText, FileType, FilePlus, Folder, FolderOpen, FolderPlus, Image, PenLine, Radio, Scissors, Search, X } from 'lucide-react'
import { actions, useStore, type FilesState } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Spinner } from '../affect/spinner'
import { EmptyState } from '../affect/empty-state'
import { TreeView, type TreeNode } from '../affect/tree-view'
import { TextField } from '../affect/text-field'
import { Marquee } from './Marquee'
import { ContextMenu, type ContextMenuItem } from '../affect/context-menu'
import { PromptDialog } from './PromptDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { t } from '@/lib/i18n'

const RECENT_MS = 8000
/** Copied or cut in the files panel, waiting for Paste (one at a time, like Finder) */
let clip: { workspaceId: string; path: string; cut: boolean } | null = null
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
  // Dropping files from Finder: the folder under the pointer ('' = the root), opened after a moment over it
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [dropError, setDropError] = useState<string | null>(null)
  const hover = useRef<{ dir: string; timer: ReturnType<typeof setTimeout> } | null>(null)
  // What you dropped yourself is not agent activity: no "Active now", no M
  const dropped = useRef<{ path: string; at: number }[]>([])
  const mine = (path: string) => dropped.current.some((d) => Date.now() - d.at < RECENT_MS * 2 && (path === d.path || path.startsWith(d.path + '/')))
  const isDir = (id: string) => !!files?.entries.get(id)?.dir
  const dirAt = (target: EventTarget | null): string => {
    const id = (target as HTMLElement | null)?.closest?.<HTMLElement>('[role="treeitem"]')?.dataset.id
    if (!id) return ''
    return isDir(id) ? id : id.includes('/') ? id.slice(0, id.lastIndexOf('/')) : ''
  }
  const endDrag = () => {
    if (hover.current) clearTimeout(hover.current.timer)
    hover.current = null
    setDropDir(null)
  }
  const onDragOver = (e: React.DragEvent) => {
    if (!workspaceId || !e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const dir = dirAt(e.target)
    if (dir !== dropDir) setDropDir(dir)
    if (hover.current?.dir === dir) return
    if (hover.current) clearTimeout(hover.current.timer)
    hover.current = {
      dir,
      timer: setTimeout(() => dir && !q && setOpen((o) => new Set([...o, ...ancestors(dir), dir])), 600)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    if (!workspaceId || !e.dataTransfer.files.length) return
    e.preventDefault()
    const dir = dirAt(e.target)
    endDrag()
    setDropError(null)
    // A failure shows above the tree, never silently (e.g. an app started before this feature)
    Promise.resolve()
      .then(() => [...e.dataTransfer.files].map((f) => window.cm.pathForFile(f)).filter(Boolean))
      .then((paths) => (paths.length ? window.cm.dropFiles(workspaceId, dir, paths) : { copied: 0, error: t('These files are not on disk.') }))
      .then((r) => {
        if (r.added?.length) dropped.current = [...dropped.current.filter((d) => Date.now() - d.at < RECENT_MS * 2), ...r.added.map((path) => ({ path, at: Date.now() }))]
        if (r.error) setDropError(r.error)
        else if (dir) setOpen((o) => new Set([...o, ...ancestors(dir), dir]))
      })
      .catch((err) => setDropError(String(err?.message ?? err)))
  }
  useEffect(() => endDrag, [])

  // Right-click menu: rename, copy, cut, paste
  const [renaming, setRenaming] = useState<string | null>(null)
  // A new file or folder being named, and the folder it goes in ('' = the branch's root)
  const [creating, setCreating] = useState<{ dir: string; folder: boolean } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [hasClip, setHasClip] = useState(!!clip && clip.workspaceId === workspaceId)
  useEffect(() => setHasClip(!!clip && clip.workspaceId === workspaceId), [workspaceId])
  const reveal = (path: string) => {
    const up = ancestors(path)
    if (up.length) setOpen((o) => new Set([...o, ...up]))
    setSelected(path)
  }
  const run = (op: Parameters<typeof window.cm.fileOp>[1]) => {
    if (!workspaceId) return Promise.resolve()
    setDropError(null)
    dropped.current = [...dropped.current, { path: op.path, at: Date.now() }]
    return window.cm.fileOp(workspaceId, op).then((to) => {
      if (!to) return
      dropped.current = [...dropped.current, { path: to, at: Date.now() }]
      // Renamed or moved: the open tabs follow the file
      if (op.kind === 'rename' || op.kind === 'move') actions.movedPath(workspaceId, op.path, to)
      reveal(to)
      if (op.kind === 'newFile') actions.openEditor(workspaceId, { kind: 'file', path: to })
    })
  }
  const fail = (e: unknown) => setDropError(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
  const menuItems = (target: HTMLElement): ContextMenuItem[] => {
    const id = target.closest<HTMLElement>('[role="treeitem"]')?.dataset.id ?? ''
    const into = dirAt(target)
    const paste: ContextMenuItem = {
      label: into ? t('Paste into {name}', { name: into.split('/').pop() ?? into }) : t('Paste'),
      icon: <ClipboardPaste size={16} />,
      disabled: !hasClip,
      onSelect: () => {
        if (!clip || clip.workspaceId !== workspaceId) return
        const c = clip
        if (c.cut) {
          clip = null
          setHasClip(false)
        }
        void run({ kind: c.cut ? 'move' : 'copy', path: c.path, dir: into }).catch(fail)
      }
    }
    const create: ContextMenuItem[] = [
      { label: t('New file'), icon: <FilePlus size={16} />, onSelect: () => setCreating({ dir: into, folder: false }) },
      { label: t('New folder'), icon: <FolderPlus size={16} />, divider: true, onSelect: () => setCreating({ dir: into, folder: true }) }
    ]
    if (!id) return [...create, paste]
    const take = (cut: boolean) => () => {
      clip = { workspaceId: workspaceId!, path: id, cut }
      setHasClip(true)
    }
    return [
      ...create,
      { label: t('Rename'), icon: <PenLine size={16} />, onSelect: () => setRenaming(id) },
      { label: t('Copy'), icon: <Copy size={16} />, onSelect: take(false) },
      { label: t('Cut'), icon: <Scissors size={16} />, divider: true, onSelect: take(true) },
      { ...paste, divider: true },
      { label: t('Delete'), icon: <Trash2 size={16} />, danger: true, shortcut: '⌘⌫', onSelect: () => setDeleting(id) }
    ]
  }

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
  const keep = useMemo(() => {
    const k = new Set<string>()
    if (q && files)
      for (const e of files.entries.values())
        if (e.path.toLowerCase().includes(q)) {
          k.add(e.path)
          ancestors(e.path).forEach((a) => k.add(a))
        }
    return k
  }, [q, files?.version])

  const items = useMemo(() => {
    const conv = (list: Node[]): TreeNode[] =>
      list
        .filter((n) => !q || keep.has(n.path))
        .map((n) => {
          const active = !n.dir && !!files?.active.has(n.path)
          const recent = !n.dir && !active && !mine(n.path) && now - (files?.touched.get(n.path) ?? 0) < RECENT_MS
          return {
            id: n.path,
            label: n.name,
            icon: active ? <Spinner size={11} className="text-accent" /> : n.dir ? <Folder size={14} className="text-[#c9a86a]" /> : fileIcon(n.name),
            openIcon: n.dir ? <FolderOpen size={14} className="text-[#c9a86a]" /> : undefined,
            meta: active ? <span className="text-[10px] text-accent">{t('editing')}</span> : recent ? <span className="text-[10.5px] font-semibold text-accent">M</span> : undefined,
            children: n.dir ? conv(n.children) : undefined
          }
        })
    return conv(tree)
  }, [tree, q, keep, files?.version, now])

  const live = useMemo(() => {
    if (!files) return []
    const set = new Set(files.active)
    for (const [p, at] of files.touched) if (now - at < RECENT_MS && files.entries.has(p) && !mine(p)) set.add(p)
    return [...set]
  }, [files?.version, now])

  const fileCount = files ? [...files.entries.values()].filter((e) => !e.dir).length : 0

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-3">
        <span className="text-[11px] font-semibold text-dim">{t('Files')}</span>
        {files && files.active.size > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-px text-[10px] text-accent">
            <Radio size={9} style={{ animation: 'cm-pulse 1.2s infinite' }} /> {t('live')}
          </span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-mute">{fileCount}</span>
      </div>

      {workspaceId && (
        <div className="px-2">
          <TextField
            size="sm"
            prefix={<Search size={12} />}
            clearable
            aria-label={t('Filter files')}
            ref={filterRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQuery('')}
            placeholder={`${t('Filter files')}  ⌘P`}
          />
        </div>
      )}

      {live.length > 0 && files && !q && (
        <div className="border-b border-line px-1 pb-1 pt-2">
          <div className="px-2 pb-0.5 text-[10px] font-semibold text-mute">{t('Active now')}</div>
          {live.map((p) => {
            const active = files.active.has(p)
            return (
              <div
                key={p}
                onClick={() => workspaceId && actions.openEditor(workspaceId, { kind: 'file', path: p })}
                style={{ height: ROW }}
                className={cn('files-row flex cursor-default items-center gap-1.5 rounded px-2 font-mono text-[11.5px] hover:bg-white/[.04]', active ? 'cm-file-active text-ink' : 'text-dim')}
              >
                {active ? <Spinner size={10} className="shrink-0 text-accent" /> : <span className="size-1.5 shrink-0 rounded-full bg-accent" />}
                <Marquee className="min-w-0" delay={300} hoverTarget=".files-row">{p}</Marquee>
              </div>
            )
          })}
        </div>
      )}

      {dropError && (
        <div className="flex items-start gap-1.5 px-3 pt-1.5 text-[11.5px] text-bad">
          <span className="min-w-0 flex-1">{dropError}</span>
          <button aria-label={t('Close')} className="shrink-0 text-mute hover:text-ink" onClick={() => setDropError(null)}>
            <X size={12} />
          </button>
        </div>
      )}

      <ContextMenu items={menuItems} aria-label={t('Files')} disabled={!workspaceId || !files}>
      <div
        className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1', dropDir === '' && 'rounded-md bg-accent/[.06] outline outline-1 -outline-offset-1 outline-accent/40')}
        onDragOver={onDragOver}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as globalThis.Node | null) && endDrag()}
        onDrop={onDrop}
        onKeyDown={(e) => {
          // ⌘⌫ on the selected file or folder: to the Trash, like Finder
          if (e.metaKey && e.key === 'Backspace' && selected && files?.entries.has(selected)) {
            e.preventDefault()
            setDeleting(selected)
          }
        }}
      >
        {dropDir && <style>{`.ui-tv__item[data-id="${CSS.escape(dropDir)}"] > .ui-tv__row { background: color-mix(in srgb, var(--color-accent) 14%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 45%, transparent); }`}</style>}
        {!workspaceId ? (
          <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
            <EmptyState bare title={t('No branch')} text={t('Pick a branch on the left to watch its files live.')} />
          </div>
        ) : !files ? null : items.length === 0 ? (
          <div className="px-4 py-3 text-[12px] text-mute">{q ? t('No matching files') : t('Empty worktree')}</div>
        ) : (
          <TreeView
            items={items}
            guides
            expanded={q ? [...keep] : [...open]}
            onExpandedChange={(ids) => !q && setOpen(new Set(ids))}
            selected={selected}
            onSelect={(id, node) => {
              setSelected(id)
              if (!node.children && workspaceId) actions.openEditor(workspaceId, { kind: 'file', path: id })
            }}
          />
        )}
      </div>
      </ContextMenu>

      {deleting && (
        <ConfirmDialog
          title={t('Delete {name}?', { name: deleting.split('/').pop() ?? deleting })}
          danger
          confirmLabel={t('Delete')}
          onClose={() => setDeleting(null)}
          onConfirm={() => run({ kind: 'trash', path: deleting })}
        >
          <span className="font-mono text-[12px]">{deleting}</span>
        </ConfirmDialog>
      )}
      {creating && (
        <PromptDialog
          title={creating.dir ? t(creating.folder ? 'New folder in {name}' : 'New file in {name}', { name: creating.dir.split('/').pop() ?? creating.dir }) : t(creating.folder ? 'New folder' : 'New file')}
          initial=""
          confirmLabel={t('Create')}
          onSubmit={(name) => run({ kind: creating.folder ? 'newDir' : 'newFile', path: creating.dir, name })}
          onClose={() => setCreating(null)}
        />
      )}
      {renaming && (
        <PromptDialog
          title={t('Rename {name}', { name: renaming.split('/').pop() ?? renaming })}
          initial={renaming.split('/').pop() ?? renaming}
          confirmLabel={t('Rename')}
          onSubmit={(name) => run({ kind: 'rename', path: renaming, name })}
          onClose={() => setRenaming(null)}
        />
      )}
    </div>
  )
}
