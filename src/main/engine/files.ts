import { watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { FileEntry, FileEvent } from '@shared/types'

const IGNORE = new Set(['.git', 'node_modules', 'out', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '.DS_Store', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache'])
const MAX = 4000

async function list(root: string): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const walk = async (dir: string) => {
    if (out.length >= MAX) return
    let ents
    try {
      ents = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (IGNORE.has(e.name) || out.length >= MAX) continue
      const p = join(dir, e.name)
      out.push({ path: relative(root, p).split(sep).join('/'), dir: e.isDirectory() })
      if (e.isDirectory()) await walk(p)
    }
  }
  await walk(root)
  return out
}

/** One live watcher at a time: the workspace shown in the UI. */
let current: { id: string; w: FSWatcher } | null = null

/*
 * One recursive fs.watch: on macOS it's FSEvents, a single descriptor for the whole tree.
 * (chokidar opened one per file: tens of thousands in a big repo, until spawning git failed with EBADF.)
 */
export async function watchWorkspace(id: string, root: string, emit: (e: FileEvent) => void) {
  if (current?.id === id) {
    emit({ kind: 'snapshot', root, entries: await list(root) })
    return
  }
  current?.w.close()
  current = null
  const entries = await list(root)
  emit({ kind: 'snapshot', root, entries })
  const known = new Map(entries.map((e) => [e.path, e.dir]))
  const pending = new Map<string, NodeJS.Timeout>()
  // Settle each path for a moment (editors write in bursts), then say what it became.
  const settle = (path: string) => {
    clearTimeout(pending.get(path))
    pending.set(
      path,
      setTimeout(async () => {
        pending.delete(path)
        const st = await stat(join(root, path)).catch(() => null)
        const was = known.get(path)
        if (!st) {
          if (was === undefined) return
          known.delete(path)
          emit({ kind: 'unlink', path, dir: was })
        } else if (was === undefined) {
          known.set(path, st.isDirectory())
          emit({ kind: 'add', path, dir: st.isDirectory() })
        } else if (!st.isDirectory()) emit({ kind: 'change', path, dir: false })
      }, 120)
    )
  }
  let w: FSWatcher
  try {
    w = watch(root, { recursive: true }, (_event, name) => {
      if (!name) return
      const path = String(name).split(sep).join('/')
      if (path.split('/').some((part) => IGNORE.has(part))) return
      settle(path)
    })
  } catch {
    return
  }
  w.on('error', () => {})
  current = { id, w }
}
