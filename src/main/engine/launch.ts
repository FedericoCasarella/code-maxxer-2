import { execFile } from 'node:child_process'
import { db } from '../db'
import { bin, shellEnv } from './bins'

/*
 * How to start a project for its preview, worked out once by a small agent that reads the project (and the repos
 * linked to the chat): which services to run (site, admin, API, database…), from which folder, with which command,
 * and the pages each one serves. Saved per project; found again on demand.
 */

export type LaunchService = {
  name: string
  /** '' for the project itself, else the name of a linked project */
  project: string
  /** Folder relative to that project's root */
  dir: string
  /** Run first when the folder has no node_modules (e.g. pnpm install) */
  install: string
  command: string
  pages: { label: string; url: string }[]
}
export type LaunchPlan = { services: LaunchService[]; notes: string; at: number }

const key = (projectId: string) => `launch:${projectId}`
export const savedPlan = (projectId: string) => db.getSetting<LaunchPlan>(key(projectId))
export const forgetPlan = (projectId: string) => db.setSetting(key(projectId), null)

export async function detectPlan(projectId: string, root: string, linked: { name: string; path: string }[]): Promise<LaunchPlan> {
  const prompt =
    'You work out how to start a software project on this computer for a live preview, like a developer opening it for the first time. ' +
    `The project is in the current folder${linked.length ? `; these repos work with it: ${linked.map((l) => `${l.name} (${l.path})`).join(', ')}` : ''}. ` +
    'Read its README, CLAUDE.md/AGENTS.md, package.json scripts (root and workspaces), docker-compose, env examples and config files to find every part the user wants to see running: ' +
    'the public site or frontend, an admin, the backend/API it needs, a database container. ' +
    'Rules: local development only; each command keeps running in the foreground (a dev server, or a script that starts several parts together); ' +
    "prefer the project's own script that starts everything at once when there is one, as a single service listing all its pages; " +
    'never deploy, publish, push, migrate a remote database, delete data or stop containers; no interactive prompts. ' +
    'Pages: the local URLs (http://localhost:port/path) the user opens, from config, env defaults or the script itself; the public site first. ' +
    'Leave out tools nobody looks at (health checks) unless they are the only page. Reply with JSON only, no code fences:\n' +
    '{"services": [{"name": "short name, e.g. Site", "project": "" or the linked project name, "dir": "folder relative to that project, \\".\\" for its root", ' +
    '"install": "install command when dependencies are missing, e.g. pnpm install, or empty", "command": "the command", ' +
    '"pages": [{"label": "Site", "url": "http://localhost:4321"}]}], "notes": "one plain sentence: what starts"}'
  const out = await new Promise<string>((ok, fail) => {
    const child = execFile(
      bin('claude'),
      [
        '-p', '--model', 'sonnet', '--output-format', 'text', '--tools', 'Read,Glob,Grep', '--strict-mcp-config',
        '--setting-sources', 'project,local', '--disable-slash-commands', '--no-session-persistence',
        ...linked.flatMap((l) => ['--add-dir', l.path])
      ],
      { cwd: root, env: shellEnv(), maxBuffer: 4 * 1024 * 1024, timeout: 240_000 },
      (err, stdout, stderr) => (err ? fail(new Error(String(stderr || stdout || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 220) || 'The launch check stopped.')) : ok(String(stdout)))
    )
    child.stdin?.end(prompt)
  })
  const v: any = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1))
  const names = new Set(['', ...linked.map((l) => l.name)])
  const services: LaunchService[] = (Array.isArray(v.services) ? v.services : [])
    .filter((s: any) => s && typeof s.command === 'string' && s.command.trim())
    .slice(0, 6)
    .map((s: any) => ({
      name: String(s.name ?? 'App').slice(0, 30),
      project: names.has(String(s.project ?? '')) ? String(s.project ?? '') : '',
      dir: String(s.dir ?? '.').replace(/^\/+/, '').replace(/\.\.+/g, '') || '.',
      install: String(s.install ?? '').slice(0, 200),
      command: s.command.slice(0, 400),
      pages: (Array.isArray(s.pages) ? s.pages : [])
        .filter((p: any) => p && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(String(p.url ?? '')))
        .slice(0, 6)
        .map((p: any) => ({ label: String(p.label ?? s.name ?? 'Page').slice(0, 30), url: String(p.url).replace(/\/$/, '') }))
    }))
  if (!services.length) throw new Error("Couldn't work out how to start this project.")
  const plan: LaunchPlan = { services, notes: String(v.notes ?? '').slice(0, 300), at: Date.now() }
  await db.setSetting(key(projectId), plan)
  return plan
}
