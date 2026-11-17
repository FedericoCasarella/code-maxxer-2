import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import type { AgentSession, Workspace } from '@shared/types'

// Claude Code keeps one JSONL per session under ~/.claude/projects/<cwd with non-alphanumerics as '-'>.
const ROOT = join(homedir(), '.claude', 'projects')
const dirFor = (cwd: string) => join(ROOT, cwd.replace(/[^a-zA-Z0-9]/g, '-'))
const MAX_FILES_PER_DIR = 40

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .filter((c: any) => c?.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n')
  return ''
}
// Skip harness noise (command wrappers, reminders) when picking human-readable turns.
const isNoise = (t: string) => !t.trim() || /^<(command-|local-command|system-reminder|bash-)/.test(t.trim())
const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n).trimEnd() + '…' : t)

async function parse(file: string, ws: Workspace, mtime: number): Promise<AgentSession | null> {
  let title = ''
  let firstPrompt = ''
  let model: string | null = null
  let messages = 0
  const latest: AgentSession['latest'] = []
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line) continue
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type === 'summary' && ev.summary) title = ev.summary
    if (ev.type !== 'user' && ev.type !== 'assistant') continue
    if (ev.isMeta || ev.isSidechain) continue
    const t = textOf(ev.message?.content)
    if (ev.type === 'assistant' && ev.message?.model) model = ev.message.model
    if (isNoise(t)) continue
    messages++
    const role = ev.type === 'user' ? 'user' : 'agent'
    if (role === 'user' && !firstPrompt) firstPrompt = t
    latest.push({ role, text: clip(t.replace(/\s+/g, ' '), 320) })
    if (latest.length > 3) latest.shift()
  }
  if (!messages) return null
  const id = file.split('/').pop()!.replace(/\.jsonl$/, '')
  return {
    id, workspaceId: ws.id, projectId: ws.projectId,
    title: title || clip(firstPrompt.replace(/\s+/g, ' '), 80) || 'Untitled session',
    provider: 'claude', model, messages, updatedAt: mtime,
    firstPrompt: clip(firstPrompt, 600), latest, file, cwd: ws.worktreePath
  }
}

export async function scanSessions(workspaces: Workspace[]): Promise<{ sessions: AgentSession[]; scanned: number }> {
  let scanned = 0
  const out: AgentSession[] = []
  const seen = new Set<string>()
  for (const ws of workspaces) {
    const dir = dirFor(ws.worktreePath)
    if (seen.has(dir)) continue
    seen.add(dir)
    let names: string[]
    try {
      names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
    } catch {
      continue
    }
    const files = await Promise.all(
      names.map(async (n) => ({ f: join(dir, n), m: (await stat(join(dir, n))).mtimeMs }))
    )
    files.sort((a, b) => b.m - a.m)
    scanned += files.length
    const parsed = await Promise.all(files.slice(0, MAX_FILES_PER_DIR).map((x) => parse(x.f, ws, x.m).catch(() => null)))
    for (const s of parsed) if (s) out.push(s)
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return { sessions: out, scanned }
}

/** Copy a session file next to another directory so `claude --resume <id>` finds it there. */
export async function copySessionTo(id: string, fromCwd: string, toCwd: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false
  const { copyFile, mkdir } = await import('node:fs/promises')
  try {
    await mkdir(dirFor(toCwd), { recursive: true })
    await copyFile(join(dirFor(fromCwd), `${id}.jsonl`), join(dirFor(toCwd), `${id}.jsonl`))
    return true
  } catch {
    return false
  }
}
