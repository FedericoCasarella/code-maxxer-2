import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import type { FileEntry, FileEvent } from '@shared/types'

const IGNORE = new Set(['.git', 'node_modules', 'out', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage', '.DS_Store'])
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

export async function watchWorkspace(id: string, root: string, emit: (e: FileEvent) => void) {
  if (current?.id === id) {
    emit({ kind: 'snapshot', root, entries: await list(root) })
    return
  }
  await current?.w.close()
  current = null
  emit({ kind: 'snapshot', root, entries: await list(root) })
  const w = watch(root, {
    ignoreInitial: true,
    ignored: (p) => p.split(sep).some((part) => IGNORE.has(part)),
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
  })
  const rel = (p: string) => relative(root, p).split(sep).join('/')
  w.on('add', (p) => emit({ kind: 'add', path: rel(p), dir: false }))
  w.on('addDir', (p) => p !== root && emit({ kind: 'add', path: rel(p), dir: true }))
  w.on('change', (p) => emit({ kind: 'change', path: rel(p), dir: false }))
  w.on('unlink', (p) => emit({ kind: 'unlink', path: rel(p), dir: false }))
  w.on('unlinkDir', (p) => emit({ kind: 'unlink', path: rel(p), dir: true }))
  current = { id, w }
}
