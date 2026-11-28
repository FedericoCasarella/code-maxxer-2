import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { shell } from 'electron'
import { db } from '../db'
import { bin, shellEnv } from './bins'
import { remoteInfo, worktreesOf } from './git'
import { isRunning } from './orchestrator'

const run = promisify(execFile)
const git = async (cwd: string, ...a: string[]) => (await run(bin('git'), a, { cwd, env: shellEnv(), maxBuffer: 8 * 1024 * 1024 })).stdout.trim()

export type BranchAction = 'merge' | 'mergeFrom' | 'push' | 'pr' | 'update' | 'github'

const baseOf = async (repo: string) =>
  (await git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').catch(() => 'origin/main')).replace(/^origin\//, '')

/** An error the window can translate: the English sentence (with {placeholders}), its values, git's own words. */
const fail = (key: string, vars: Record<string, string> = {}, detail = '') => new Error(JSON.stringify({ key, vars, detail }))

/** The first line git wrote about why it stopped, without the hints. */
const why = (e: any) =>
  String(e?.stderr || e?.stdout || e?.message || e)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('hint:'))
    .slice(0, 2)
    .join(' ')

/**
 * The branch menu in the sidebar. merge: the branch goes into `target`, locally only (no push) – in the folder where
 * `target` is checked out, or as a fast-forward of the ref when it isn't checked out anywhere; a conflict leaves
 * everything as it was. update: the default branch from GitHub into this one. pr: the branch's PR on GitHub, or the
 * page that opens one. github: the branch's page on GitHub.
 */
export async function branchAction(wsId: string, action: BranchAction, target?: string): Promise<string> {
  const ws = await db.workspace(wsId)
  const p = ws && (await db.project(ws.projectId))
  if (!ws || !p) throw fail('Branch not found')
  const branch = ws.branch
  const remote = await remoteInfo(p.path)
  const web = remote ? `https://${remote.host}/${remote.owner}/${remote.name}` : null

  if (action === 'merge') {
    if (!target || target === branch) throw fail('Choose another branch')
    const chats = (await db.workspaces()).filter((w) => w.projectId === p.id)
    const busy = chats.find((w) => w.branch === target && isRunning(w.id))
    if (busy) throw fail('An agent is working on {branch}: wait until it ends', { branch: target })
    const there = (await worktreesOf(p.path)).find((w) => w.branch === target)
    if (there) {
      try {
        await git(there.path, 'merge', '--no-edit', branch)
      } catch (e) {
        await git(there.path, 'merge', '--abort').catch(() => '')
        throw fail('Merge stopped, nothing changed', {}, why(e))
      }
    } else {
      // Not checked out anywhere: only a fast-forward can move it without a folder
      try {
        await git(p.path, 'fetch', '.', `${branch}:${target}`)
      } catch (e) {
        throw fail('{branch} has commits of its own: open it and merge from there', { branch: target }, why(e))
      }
    }
    return `${branch} → ${target}`
  }

  // mergeFrom: `target` comes into this branch, locally only, in this branch's folder; a conflict leaves it as it was
  if (action === 'mergeFrom') {
    if (!target || target === branch) throw fail('Choose another branch')
    if (isRunning(wsId)) throw fail('An agent is working on {branch}: wait until it ends', { branch })
    try {
      await git(ws.worktreePath, 'merge', '--no-edit', target)
    } catch (e) {
      await git(ws.worktreePath, 'merge', '--abort').catch(() => '')
      throw fail('Merge stopped, nothing changed', {}, why(e))
    }
    return `${target} → ${branch}`
  }

  if (action === 'push') {
    try {
      await git(ws.worktreePath, 'push', '-u', 'origin', branch)
    } catch (e) {
      throw fail('Push failed', {}, why(e))
    }
    return branch
  }

  if (action === 'update') {
    const base = await baseOf(p.path)
    if (base === branch) {
      await git(ws.worktreePath, 'pull', '--ff-only', 'origin', base).catch((e) => {
        throw fail('Update stopped, nothing changed', {}, why(e))
      })
      return base
    }
    await git(ws.worktreePath, 'fetch', '-q', 'origin', base)
    try {
      await git(ws.worktreePath, 'merge', '--no-edit', `origin/${base}`)
    } catch (e) {
      await git(ws.worktreePath, 'merge', '--abort').catch(() => '')
      throw fail('Update stopped, nothing changed', {}, why(e))
    }
    return base
  }

  if (!web) throw fail('This project has no GitHub remote')
  if (action === 'github') {
    await shell.openExternal(`${web}/tree/${encodeURIComponent(branch).replace(/%2F/g, '/')}`)
    return branch
  }
  // pr: the open one, or GitHub's page to open it (title and text written there)
  const url = await run(bin('gh'), ['pr', 'view', branch, '--json', 'url,state', '-q', 'select(.state=="OPEN") | .url'], { cwd: p.path, env: shellEnv() })
    .then((r) => r.stdout.trim())
    .catch(() => '')
  await shell.openExternal(url || `${web}/compare/${await baseOf(p.path)}...${branch}?expand=1`)
  return branch
}
