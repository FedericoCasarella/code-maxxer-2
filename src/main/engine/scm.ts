import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import type { ScmChange, ScmCommit, ScmFileText, ScmRef, ScmStatus, ScmStatusCode } from '@shared/scm'
import { bin, shellEnv } from './bins'

const MAX_BYTES = 2 * 1024 * 1024
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** git in `cwd`; rejects with git's own message. Never prompts for credentials. */
function git(cwd: string, args: string[]): Promise<string>
function git(cwd: string, args: string[], raw: true): Promise<Buffer>
function git(cwd: string, args: string[], raw?: true): Promise<string | Buffer> {
  return new Promise((ok, fail) => {
    execFile(
      bin('git'),
      args,
      { cwd, env: { ...shellEnv(), GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 64 * 1024 * 1024, encoding: raw ? 'buffer' : 'utf8' },
      (err, stdout, stderr) => {
        if (err) fail(new Error(String(stderr || '').trim() || err.message))
        else ok(stdout)
      }
    )
  })
}

/** A path inside the worktree, or an error: the renderer never reaches outside it. */
function inside(root: string, p: string): string {
  const abs = resolve(root, p)
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`Outside the worktree: ${p}`)
  return abs
}

const code = (c: string): ScmStatusCode => (c === 'T' ? 'M' : (c as ScmStatusCode))
const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

async function numstat(root: string, args: string[]): Promise<Map<string, { add?: number; del?: number }>> {
  const out = new Map<string, { add?: number; del?: number }>()
  const t = (await git(root, ['diff', '--numstat', '-z', '-M', ...args]).catch(() => '')).split('\0')
  for (let i = 0; i < t.length; i++) {
    const m = t[i].match(/^(\d+|-)\t(\d+|-)\t(.*)$/s)
    if (!m) continue
    let path = m[3]
    if (!path) {
      path = t[i + 2] ?? ''
      i += 2
    }
    out.set(path, { add: m[1] === '-' ? undefined : Number(m[1]), del: m[2] === '-' ? undefined : Number(m[2]) })
  }
  return out
}

export async function status(root: string): Promise<ScmStatus> {
  const raw = await git(root, ['status', '--porcelain=v1', '-z', '-b', '--untracked-files=all'])
  const t = raw.split('\0')
  const s: ScmStatus = { branch: '', upstream: null, ahead: 0, behind: 0, staged: [], changes: [], conflicts: [] }
  for (let i = 0; i < t.length; i++) {
    const line = t[i]
    if (!line) continue
    if (line.startsWith('## ')) {
      const h = line.slice(3)
      const m = h.match(/^(?:No commits yet on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/)
      s.branch = m?.[1] ?? h
      s.upstream = m?.[2] ?? null
      s.ahead = Number(m?.[3]?.match(/ahead (\d+)/)?.[1] ?? 0)
      s.behind = Number(m?.[3]?.match(/behind (\d+)/)?.[1] ?? 0)
      continue
    }
    const xy = line.slice(0, 2)
    const path = line.slice(3)
    let oldPath: string | undefined
    if (xy[0] === 'R' || xy[0] === 'C') oldPath = t[++i]
    if (xy === '??') s.changes.push({ path, status: 'U' })
    else if (CONFLICT.has(xy)) s.conflicts.push({ path, status: '!' })
    else {
      if (xy[0] !== ' ') s.staged.push({ path, oldPath, status: code(xy[0]) })
      if (xy[1] !== ' ') s.changes.push({ path, status: code(xy[1]) })
    }
  }
  const [wt, ix] = await Promise.all([numstat(root, []), numstat(root, ['--cached'])])
  for (const c of s.changes) Object.assign(c, wt.get(c.path))
  for (const c of s.staged) Object.assign(c, ix.get(c.path))
  // Untracked files: every line is new.
  await Promise.all(
    s.changes
      .filter((c) => c.status === 'U')
      .map(async (c) => {
        try {
          const st = await stat(inside(root, c.path))
          if (st.size > MAX_BYTES) return
          const b = await readFile(inside(root, c.path))
          if (b.subarray(0, 8000).includes(0)) return
          const s = b.toString('utf8')
          c.add = s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0
          c.del = 0
        } catch { /* gone meanwhile */ }
      })
  )
  return s
}

export async function log(root: string, limit = 200): Promise<ScmCommit[]> {
  const raw = await git(root, ['log', '--topo-order', `-n${limit}`, '--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1e', 'HEAD']).catch(() => '')
  return raw
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [sha, parents, author, at, refs, subject] = r.split('\x1f')
      return {
        sha,
        parents: parents ? parents.split(' ') : [],
        author,
        at: Number(at) * 1000,
        refs: refs ? refs.split(', ').filter(Boolean) : [],
        subject: subject ?? ''
      }
    })
}

/** Files a commit changed, against its first parent. */
export async function commitFiles(root: string, sha: string): Promise<ScmChange[]> {
  const parents = (await git(root, ['rev-list', '--parents', '-n1', sha])).trim().split(' ').slice(1)
  const base = parents[0] ?? EMPTY_TREE
  const t = (await git(root, ['diff', '--name-status', '-z', '-M', base, sha])).split('\0')
  const out: ScmChange[] = []
  for (let i = 0; i < t.length; i++) {
    const st = t[i]
    if (!st) continue
    if (st[0] === 'R' || st[0] === 'C') {
      out.push({ status: code(st[0]), oldPath: t[i + 1], path: t[i + 2] })
      i += 2
    } else {
      out.push({ status: code(st[0]), path: t[i + 1] })
      i += 1
    }
  }
  const n = await numstat(root, [base, sha])
  for (const c of out) Object.assign(c, n.get(c.path))
  return out
}

const text = (b: Buffer): ScmFileText =>
  b.length > MAX_BYTES
    ? { text: '', binary: false, tooLarge: true, missing: false }
    : b.subarray(0, 8000).includes(0)
      ? { text: '', binary: true, tooLarge: false, missing: false }
      : { text: b.toString('utf8'), binary: false, tooLarge: false, missing: false }

const MISSING: ScmFileText = { text: '', binary: false, tooLarge: false, missing: true }

export async function read(root: string, path: string, ref: ScmRef = 'worktree'): Promise<ScmFileText> {
  const abs = inside(root, path)
  if (ref === 'worktree') {
    try {
      const st = await stat(abs)
      if (st.size > MAX_BYTES) return { text: '', binary: false, tooLarge: true, missing: false }
      return text(await readFile(abs))
    } catch {
      return MISSING
    }
  }
  try {
    return text(await git(root, ['show', `${ref === 'index' ? '' : ref}:${path}`], true))
  } catch {
    return MISSING
  }
}

export async function write(root: string, path: string, body: string): Promise<void> {
  const abs = inside(root, path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, body, 'utf8')
}

const paths = (root: string, p: string[]) => (p.forEach((x) => inside(root, x)), ['--', ...p])

export async function stage(root: string, p: string[] | 'all') {
  await git(root, p === 'all' ? ['add', '-A'] : ['add', '-A', ...paths(root, p)])
}

export async function unstage(root: string, p: string[] | 'all') {
  const hasHead = await git(root, ['rev-parse', '--verify', 'HEAD']).then(() => true, () => false)
  const target = p === 'all' ? ['--', '.'] : paths(root, p)
  await git(root, hasHead ? ['restore', '--staged', ...target] : ['rm', '-r', '--cached', '-q', ...target])
}

/** Throw away working-tree edits; untracked files are deleted. */
export async function discard(root: string, p: string[]) {
  const untracked = new Set(
    (await git(root, ['ls-files', '--others', '--exclude-standard', '-z', ...paths(root, p)])).split('\0').filter(Boolean)
  )
  for (const f of untracked) await rm(inside(root, f), { force: true })
  const tracked = p.filter((f) => !untracked.has(f))
  if (tracked.length) await git(root, ['restore', ...paths(root, tracked)])
}

export async function commit(root: string, message: string, opts: { all?: boolean } = {}) {
  if (!message.trim()) throw new Error('Write a commit message first')
  if (opts.all) await git(root, ['add', '-A'])
  await git(root, ['commit', '-m', message])
}

export async function push(root: string) {
  const up = await git(root, ['rev-parse', '--abbrev-ref', '@{upstream}']).then(() => true, () => false)
  await git(root, up ? ['push'] : ['push', '-u', 'origin', 'HEAD'])
}

export const pull = (root: string) => git(root, ['pull', '--ff-only']).then(() => undefined)
export const fetch = (root: string) => git(root, ['fetch', '--prune']).then(() => undefined)

/** A commit message from a small model, from the staged diff (all changes when nothing is staged). */
export async function suggestMessage(root: string): Promise<string> {
  let diff = await git(root, ['diff', '--cached', '--stat', '--patch', '-M'])
  if (!diff.trim()) {
    const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'])).trim()
    diff = (await git(root, ['diff', '--stat', '--patch', '-M'])) + (untracked ? `\n\nNew files:\n${untracked}` : '')
  }
  if (!diff.trim()) throw new Error('Nothing to commit')
  const recent = await git(root, ['log', '-8', '--format=%s']).catch(() => '')
  const prompt =
    'Write a git commit message for this diff. Match the style of the recent commits below (language, tone, prefix or not). ' +
    'First line under 72 characters, imperative. Add a short body only if the change needs explaining. ' +
    'Reply with the message only: no quotes, no code fences, no preamble.\n\n' +
    `Recent commits:\n${recent}\n\nDiff:\n${diff.slice(0, 60_000)}`
  const out = await new Promise<string>((ok, fail) => {
    const child = execFile(
      bin('claude'),
      ['-p', '--model', 'haiku', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project,local', '--disable-slash-commands', '--no-session-persistence'],
      { cwd: root, env: shellEnv(), maxBuffer: 4 * 1024 * 1024, timeout: 90_000 },
      (err, stdout, stderr) => (err ? fail(new Error(String(stderr || '').trim() || err.message)) : ok(String(stdout)))
    )
    child.stdin?.end(prompt)
  })
  return out.trim().replace(/^```\w*\n?|```$/g, '').trim()
}
