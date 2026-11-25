import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { matchesGlob, join } from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from '@shared/project'
import type { Project, Workspace } from '@shared/types'
import { db } from '../db'
import { bin, shellEnv } from './bins'

const run = promisify(execFile)
const key = (projectId: string) => `project:${projectId}`

export async function getProjectSettings(projectId: string): Promise<ProjectSettings> {
  const s = await db.getSetting<Partial<ProjectSettings>>(key(projectId))
  const d = DEFAULT_PROJECT_SETTINGS
  return {
    preview: { ...d.preview, ...s?.preview },
    hooks: { ...d.hooks, ...s?.hooks },
    branches: { ...d.branches, ...s?.branches },
    formatter: { ...d.formatter, ...s?.formatter }
  }
}

export async function saveProjectSettings(projectId: string, s: ProjectSettings): Promise<ProjectSettings> {
  mergedCache.delete(projectId)
  await db.setSetting(key(projectId), s)
  return getProjectSettings(projectId)
}

/** The branches to hide, per project: worked out at most every two minutes (a fetch and one GitHub call). */
const mergedCache = new Map<string, { at: number; ids: string[]; heads: Set<string> }>()

/**
 * With "hide merged branches" on: the project's branches whose PR is merged into the default branch and whose tip is
 * in it (nothing new since the merge). The main checkout never counts. No GitHub, or an error: none.
 */
export async function mergedBranches(projectId: string): Promise<string[]> {
  if (!(await getProjectSettings(projectId)).branches.hideMerged) return []
  // GitHub (fetch, merged PRs) is asked at most every 5 minutes; the local check runs every time, so a merge an
  // agent just made hides its branch at once
  const hit = mergedCache.get(projectId)
  const { githubPaused } = await import('./github')
  const remote = !githubPaused() && !(hit && Date.now() - hit.at < 5 * 60_000)
  let heads = hit?.heads ?? new Set<string>()
  const p = await db.project(projectId)
  if (!p) return []
  const git = async (...a: string[]) => (await run(bin('git'), a, { cwd: p.path, env: shellEnv() })).stdout.trim()
  const ids: string[] = []
  try {
    const base = (await git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD').catch(() => 'origin/main')).replace(/^origin\//, '')
    // The branches a merge into counts: the ones chosen in the settings, else the default branch
    const chosen = (await getProjectSettings(projectId)).branches.mergedInto ?? []
    const targets = chosen.length ? chosen : [base]
    if (remote) await git('fetch', '-q', 'origin', ...targets).catch(() => git('fetch', '-q', 'origin', base).catch(() => ''))
    // Branches with a merged PR (none when the repo isn't on GitHub)
    if (remote)
      heads = new Set(
          (await run(bin('gh'), ['pr', 'list', '--state', 'merged', '--limit', '300', '--json', 'headRefName', '-q', '.[].headRefName'], { cwd: p.path, env: shellEnv() }).catch(() => ({ stdout: '' }))).stdout.split('\n').filter(Boolean)
      )
    // A target branch itself never hides (develop stays even when it is in main)
    for (const w of (await db.workspaces()).filter((x) => x.projectId === projectId && x.worktreePath !== p.path && x.branch !== base && !targets.includes(x.branch))) {
      // Its work is in one of the targets – on GitHub, or merged locally and not pushed yet
      const inRef = async (ref: string) => git('merge-base', '--is-ancestor', w.branch, ref).then(() => true, () => false)
      let merged = false
      for (const tb of targets) if ((await inRef(`origin/${tb}`)) || (await inRef(tb))) (merged = true)
      if (!merged) continue
      // …and it had work of its own: a merged PR, or a tip past where the branch was created (a branch just made
      // from main and never touched is in main too, and stays)
      const tip = await git('rev-parse', w.branch).catch(() => '')
      const created = (await git('reflog', 'show', '--format=%H', w.branch).catch(() => '')).split('\n').filter(Boolean).pop()
      if (heads.has(w.branch) || (tip && created && tip !== created)) ids.push(w.id)
    }
  } catch {
    /* no GitHub or no remote: nothing hidden */
  }
  if (remote || !hit) mergedCache.set(projectId, { at: Date.now(), ids, heads })
  else hit.ids = ids
  return ids
}

/** Env the hooks and the preview command run with. */
export const hookEnv = (p: Pick<Project, 'path' | 'name'>, ws: Pick<Workspace, 'worktreePath' | 'branch'>) => ({
  ...shellEnv(),
  CM_PROJECT_PATH: p.path,
  CM_PROJECT_NAME: p.name,
  CM_WORKTREE_PATH: ws.worktreePath,
  CM_BRANCH: ws.branch
})

/** Run a script with the login shell in `cwd`; resolves with its exit code and the tail of its output. */
export function runScript(script: string, cwd: string, env: NodeJS.ProcessEnv, timeoutMs = 10 * 60_000): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    const child = spawn('/bin/zsh', ['-lc', script], { cwd, env })
    let out = ''
    const add = (d: Buffer) => (out = (out + String(d)).slice(-4000))
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const t = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.on('close', (code) => (clearTimeout(t), res({ code, out })))
    child.on('error', (e) => (clearTimeout(t), res({ code: -1, out: e.message })))
  })
}

/* ── Setup script: runs when a branch is created; the agent can wait for it ── */

const setups = new Map<string, Promise<void>>()

export async function runSetup(p: Project, ws: Workspace): Promise<void> {
  const s = await getProjectSettings(p.id)
  if (!s.hooks.setup.trim()) return
  const job = runScript(s.hooks.setup, ws.worktreePath, hookEnv(p, ws)).then(({ code, out }) => {
    if (code !== 0) console.warn(`[setup] ${ws.branch} exited ${code}\n${out}`)
  })
  if (s.hooks.wait) setups.set(ws.id, job.finally(() => setups.delete(ws.id)))
  return job
}

/** Before an agent turn: wait for the branch's setup script when the project asks for it. */
export const awaitSetup = (wsId: string) => setups.get(wsId) ?? Promise.resolve()

/** Before code-maxxer removes a branch's worktree. */
export async function runArchive(p: Project, ws: Workspace): Promise<void> {
  const s = await getProjectSettings(p.id)
  if (!s.hooks.archive.trim()) return
  await runScript(s.hooks.archive, ws.worktreePath, hookEnv(p, ws), 2 * 60_000)
}

/* ── Formatter: after each agent turn, on the files it changed ── */

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

export async function formatChanged(p: Project, ws: Workspace): Promise<void> {
  const s = await getProjectSettings(p.id)
  const cmd = s.formatter.command.trim()
  const globs = s.formatter.globs.split('\n').map((g) => g.trim()).filter(Boolean)
  if (!cmd || !globs.length) return
  const { stdout } = await promisify(execFile)('git', ['status', '--porcelain', '-z', '--untracked-files=all'], { cwd: ws.worktreePath, env: shellEnv() })
  const files = stdout
    .split('\0')
    .filter((l) => l.length > 3 && !l.startsWith('D') && l[1] !== 'D')
    .map((l) => l.slice(3))
    .filter((f) => globs.some((g) => matchesGlob(f, g)))
  for (const rel of files) {
    const abs = join(ws.worktreePath, rel)
    // The command reads the file on stdin and prints the formatted text, like an editor's format on save.
    const line = cmd.replaceAll('${file}', abs).replaceAll('${relativeFile}', rel)
    const { code, out } = await runScript(`${line} < ${sh(abs)} > ${sh(abs)}.cm-fmt && mv ${sh(abs)}.cm-fmt ${sh(abs)} || rm -f ${sh(abs)}.cm-fmt`, ws.worktreePath, hookEnv(p, ws), 60_000)
    if (code !== 0) console.warn(`[formatter] ${rel}: ${out}`)
  }
}
