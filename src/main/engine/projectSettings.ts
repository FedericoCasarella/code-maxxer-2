import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { matchesGlob, join } from 'node:path'
import { promisify } from 'node:util'
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from '@shared/project'
import type { Project, Workspace } from '@shared/types'
import { db } from '../db'
import { shellEnv } from './bins'

const key = (projectId: string) => `project:${projectId}`

export async function getProjectSettings(projectId: string): Promise<ProjectSettings> {
  const s = await db.getSetting<Partial<ProjectSettings>>(key(projectId))
  const d = DEFAULT_PROJECT_SETTINGS
  return {
    preview: { ...d.preview, ...s?.preview },
    hooks: { ...d.hooks, ...s?.hooks },
    formatter: { ...d.formatter, ...s?.formatter }
  }
}

export async function saveProjectSettings(projectId: string, s: ProjectSettings): Promise<ProjectSettings> {
  await db.setSetting(key(projectId), s)
  return getProjectSettings(projectId)
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
