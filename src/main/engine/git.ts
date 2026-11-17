import { execFile } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
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

export const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'ws'

/** New branch + git worktree under ~/.code-maxxer-2/worktrees/<repo>/<slug>. */
export async function createWorktree(repo: string, name: string): Promise<{ branch: string; path: string }> {
  const s = slug(name) + '-' + Date.now().toString(36).slice(-4)
  const branch = `cm/${s}`
  const path = join(homedir(), '.code-maxxer-2', 'worktrees', basename(repo), s)
  await mkdir(join(path, '..'), { recursive: true })
  await git(repo, 'worktree', 'add', '-b', branch, path, 'HEAD')
  return { branch, path }
}
