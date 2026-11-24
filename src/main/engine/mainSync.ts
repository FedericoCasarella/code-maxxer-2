import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import type { EngineEvent } from '@shared/types'
import { db } from '../db'
import { randomUUID } from 'node:crypto'
import { bin, shellEnv } from './bins'
import { worktreesHome, worktreesOf } from './git'
import { isRunning } from './orchestrator'

const run = promisify(execFile)

/**
 * Each project's own folder follows its default branch on GitHub by itself: what gets merged there (a PR approved in
 * the app, or merged elsewhere) shows up locally without a pull. Fast-forward when it can; when the folder has commits
 * of its own, they are put back on top (rebase, changes not committed set aside and restored); on a conflict nothing
 * changes. A folder on another branch, or with an agent at work, is left alone.
 */
export async function syncMain(projectId: string): Promise<'updated' | 'same' | 'skipped'> {
  const p = await db.project(projectId)
  if (!p || !existsSync(p.path)) return 'skipped'
  const ws = (await db.workspaces()).find((w) => w.projectId === projectId && w.worktreePath === p.path)
  if (ws && isRunning(ws.id)) return 'skipped'
  const git = async (...a: string[]) => (await run(bin('git'), a, { cwd: p.path, env: shellEnv(), maxBuffer: 8 * 1024 * 1024 })).stdout.trim()
  try {
    const base = (await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').catch(() => 'origin/main')).replace(/^origin\//, '')
    if ((await git('branch', '--show-current')) !== base) return 'skipped'
    // A rebase or merge left halfway is the user's to finish
    const gitDir = await git('rev-parse', '--git-dir')
    if (['rebase-merge', 'rebase-apply', 'MERGE_HEAD'].some((f) => existsSync(`${p.path}/${gitDir}/${f}`) || existsSync(`${gitDir}/${f}`))) return 'skipped'
    await git('fetch', '-q', 'origin', base)
    const [ahead, behind] = (await git('rev-list', '--left-right', '--count', `HEAD...origin/${base}`)).split(/\s+/).map(Number)
    if (!behind) return 'same'
    if (!ahead) {
      // Uncommitted changes stay: git refuses only when the update would overwrite them
      await git('merge', '--ff-only', '-q', `origin/${base}`)
      return 'updated'
    }
    try {
      await git('rebase', '--autostash', '-q', `origin/${base}`)
    } catch {
      await git('rebase', '--abort').catch(() => '')
      return 'skipped'
    }
    return 'updated'
  } catch {
    return 'skipped'
  }
}

/**
 * Branches checked out in the app's worktrees folder without a chat (made with git by an agent, e.g. "develop"):
 * each gets its own chat so it shows in the sidebar like any other branch.
 */
export async function adoptWorktrees(projectId: string, emit: (e: EngineEvent) => void): Promise<void> {
  const p = await db.project(projectId)
  if (!p || !existsSync(p.path)) return
  const home = worktreesHome(p.path)
  const chats = (await db.workspaces()).filter((w) => w.projectId === projectId)
  for (const wt of await worktreesOf(p.path)) {
    if (!wt.path.startsWith(home + '/') || chats.some((w) => w.branch === wt.branch || w.worktreePath === wt.path)) continue
    const ws = await db.insertWorkspace({ id: randomUUID(), projectId, name: wt.branch, branch: wt.branch, worktreePath: wt.path, status: 'idle', sessionId: null })
    emit({ type: 'workspace', workspace: ws })
  }
}

let busy = false
/** Every project, one at a time; the sidebar and the files read again when something moved. */
export async function syncAllMains(emit: (e: EngineEvent) => void) {
  if (busy) return
  busy = true
  try {
    for (const p of await db.projects()) {
      if ((await syncMain(p.id)) === 'updated') emit({ type: 'changes' })
      await adoptWorktrees(p.id, emit).catch(() => {})
    }
  } finally {
    busy = false
  }
}

export function startMainSync(emit: (e: EngineEvent) => void) {
  setTimeout(() => void syncAllMains(emit), 20_000)
  setInterval(() => void syncAllMains(emit), 5 * 60_000)
}
