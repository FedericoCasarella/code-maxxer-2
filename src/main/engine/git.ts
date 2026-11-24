import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { bin, shellEnv } from './bins'

const run = promisify(execFile)
const git = async (cwd: string, ...args: string[]) =>
  (await run(bin('git'), args, { cwd, env: shellEnv() })).stdout.trim()

export async function currentBranch(repo: string): Promise<string> {
  try {
    return await git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
  } catch {
    throw new Error(`${repo} is not a git repository`)
  }
}

/**
 * A folder that isn't in a git repository yet becomes one, locally: git init on main and a first commit
 * (branches are worktrees, they need one). Dependencies, builds and env files stay out of it.
 */
export async function ensureRepo(path: string): Promise<void> {
  try {
    await git(path, 'rev-parse', '--show-toplevel')
    return
  } catch { /* not a repository */ }
  await git(path, 'init', '-b', 'main')
  const ignore = join(path, '.gitignore')
  if (!existsSync(ignore)) await writeFile(ignore, ['node_modules/', 'dist/', 'build/', '.env', '.env.*', '.DS_Store', ''].join('\n'))
  await git(path, 'add', '-A')
  const commit = ['commit', '--allow-empty', '-m', 'Initial commit']
  try {
    await git(path, ...commit)
  } catch {
    // No git identity on this machine: a local one, for this commit only
    await git(path, '-c', 'user.name=code-maxxer', '-c', 'user.email=code-maxxer@localhost', ...commit)
  }
}

export const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ws'

/** origin remote → { owner, repo } for github.com / gitlab.com style URLs (ssh or https). */
export async function remoteInfo(repo: string): Promise<{ owner: string; name: string; host: string } | null> {
  let url = ''
  try {
    url = await git(repo, 'remote', 'get-url', 'origin')
  } catch {
    return null
  }
  const m = url.match(/^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  return m ? { host: m[1], owner: m[2], name: m[3] } : null
}

/** Remove a code-maxxer worktree and its cm/ branch (never the main checkout). */
export async function removeWorktree(repo: string, path: string, branch: string): Promise<void> {
  try {
    await git(repo, 'worktree', 'remove', '--force', path)
  } catch { /* already gone */ }
  if (branch.startsWith('cm/')) {
    try {
      await git(repo, 'branch', '-D', branch)
    } catch { /* already gone */ }
  }
}

/** New branch + git worktree under ~/.code-maxxer-2/worktrees/<repo>/<slug>. */
export async function createWorktree(
  repo: string,
  name: string,
  opts: { exact?: boolean; base?: string } = {}
): Promise<{ branch: string; path: string }> {
  const s = slug(name) + '-' + Date.now().toString(36).slice(-4)
  let branch = `cm/${s}`
  if (opts.exact) {
    // The user named the branch: keep it, if git accepts it.
    branch = (await git(repo, 'check-ref-format', '--branch', name.trim().replace(/\s+/g, '-')).catch(() => '')) || branch
  }
  const path = join(homedir(), '.code-maxxer-2', 'worktrees', basename(repo), s)
  await mkdir(join(path, '..'), { recursive: true })
  await git(repo, 'worktree', 'add', '-b', branch, path, opts.base ?? 'HEAD')
  return { branch, path }
}

/** Worktree for a branch that already exists. */
export async function worktreeForBranch(repo: string, branch: string): Promise<string> {
  // Already checked out somewhere (a worktree made outside the app, by hand or by an agent): use that one, git allows one per branch.
  const there = (await worktreesOf(repo)).find((w) => w.branch === branch)
  if (there) return there.path
  const s = slug(branch) + '-' + Date.now().toString(36).slice(-4)
  const path = join(homedir(), '.code-maxxer-2', 'worktrees', basename(repo), s)
  await mkdir(join(path, '..'), { recursive: true })
  await git(repo, 'worktree', 'add', path, branch)
  return path
}

/** The repo's worktrees with the branch each one has checked out (detached ones left out). */
export async function worktreesOf(repo: string): Promise<{ path: string; branch: string }[]> {
  const out = await git(repo, 'worktree', 'list', '--porcelain').catch(() => '')
  return out
    .split('\n\n')
    .map((b) => ({ path: /^worktree (.+)$/m.exec(b)?.[1] ?? '', branch: /^branch refs\/heads\/(.+)$/m.exec(b)?.[1] ?? '' }))
    .filter((w) => w.path && w.branch && existsSync(w.path))
}

/** The folder where the app keeps a repo's worktrees. */
export const worktreesHome = (repo: string) => join(homedir(), '.code-maxxer-2', 'worktrees', basename(repo))

/** Local branches, most recently committed first. */
export async function listBranches(repo: string): Promise<{ name: string; updatedAt: number }[]> {
  const out = await git(repo, 'for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%09%(committerdate:unix)', 'refs/heads')
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [name, t] = l.split('\t')
      return { name, updatedAt: Number(t) * 1000 }
    })
}

export const headOf = (cwd: string) => git(cwd, 'rev-parse', 'HEAD')

/** Snapshot of uncommitted changes as a commit object, without touching the tree ('' if clean). */
export const snapshotChanges = (cwd: string) => git(cwd, 'stash', 'create').catch(() => '')

export async function applySnapshot(cwd: string, sha: string): Promise<void> {
  if (sha) await git(cwd, 'stash', 'apply', sha)
}
