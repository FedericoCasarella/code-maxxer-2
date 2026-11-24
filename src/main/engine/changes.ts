import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import type { ChangeRequest, EngineEvent } from '@shared/types'
import { db, pool } from '../db'
import { bin, shellEnv } from './bins'

const run = promisify(execFile)

/*
 * One change request per message: the commits an agent made for one request of the user (a plain turn or a whole
 * pipeline run) wait here for the user's OK. Approving pushes them (up to that request's last commit) and opens –
 * or updates – the branch's pull request on GitHub. Agents never push on their own (see pushGate).
 */

let ready: Promise<unknown> | null = null
const ensure = () =>
  (ready ??= pool.query(`
    create table if not exists change_requests (
      id text primary key, workspace_id text not null references workspaces(id) on delete cascade,
      message_id text, title text not null, base_sha text not null, head_sha text not null,
      commits jsonb not null default '[]', stat text not null default '', status text not null default 'pending',
      pr_number int, pr_url text, error text,
      created_at timestamptz not null default now(), decided_at timestamptz
    )`))

const git = async (cwd: string, ...args: string[]) => (await run(bin('git'), args, { cwd, env: shellEnv() })).stdout.trim()
const gh = async (cwd: string, ...args: string[]) => (await run(bin('gh'), args, { cwd, env: shellEnv() })).stdout.trim()

/**
 * The PR's public title: written by a small model from the commits, never the user's own words (those stay in the app).
 * Falls back to the first commit's subject.
 */
const recentTitles = new Map<string, { at: number; titles: string }>()
async function publicTitle(cwd: string, commits: { sha: string; subject: string }[], stat: string): Promise<string> {
  const fallback = commits[commits.length - 1]?.subject || 'Changes'
  // The repo's recent PR titles (for the style): asked once per repo every 10 minutes, not per approval
  const ck = (await git(cwd, 'remote', 'get-url', 'origin').catch(() => cwd)) || cwd
  const hit = recentTitles.get(ck)
  const recent = hit && Date.now() - hit.at < 10 * 60_000 ? hit.titles : await gh(cwd, 'pr', 'list', '--state', 'all', '--limit', '8', '--json', 'title', '-q', '.[].title').catch(() => '')
  if (!hit || hit.titles !== recent) recentTitles.set(ck, { at: Date.now(), titles: recent })
  const prompt =
    'Write the title of a public GitHub pull request for these commits. Under 70 characters, plain and professional, ' +
    'describing what changes for the product. Match the language and style of the recent PR titles below if there are any. ' +
    'Reply with the title only: no quotes, no prefix, no preamble.\n\n' +
    (recent ? `Recent PR titles:\n${recent}\n\n` : '') +
    `Commits:\n${commits.map((c) => `- ${c.subject}`).join('\n')}\n\n${stat}`
  const out = await new Promise<string>((ok) => {
    const child = execFile(
      bin('claude'),
      ['-p', '--model', 'haiku', '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--setting-sources', 'project,local', '--disable-slash-commands', '--no-session-persistence'],
      { cwd, env: shellEnv(), maxBuffer: 1024 * 1024, timeout: 60_000 },
      (err, stdout) => ok(err ? '' : String(stdout))
    )
    child.stdin?.end(prompt)
  })
  const title = out.trim().split('\n')[0].replace(/^["'`]+|["'`]+$/g, '').trim()
  return title && title.length <= 100 ? title : fallback
}

/** Where each branch's current request started: HEAD when the user's message came in, and which message. */
const started = new Map<string, { head: string; messageId: string | null; title: string }>()

/** A new request of the user on this branch: remember where HEAD is (kept if one is already open, e.g. a pipeline handover). */
export async function captureStart(wsId: string, cwd: string, messageId: string | null, text: string) {
  if (started.has(wsId) || !existsSync(cwd)) return
  const head = await git(cwd, 'rev-parse', 'HEAD').catch(() => '')
  if (!head) return
  const title = text.replace(/\s+/g, ' ').trim().slice(0, 120) || 'Changes'
  started.set(wsId, { head, messageId, title })
}

/** The request is over: its new commits, if any, become a change request waiting for the user. */
export async function captureEnd(wsId: string, cwd: string, emit: (e: EngineEvent) => void) {
  const s = started.get(wsId)
  started.delete(wsId)
  if (!s || !existsSync(cwd)) return
  const head = await git(cwd, 'rev-parse', 'HEAD').catch(() => '')
  if (!head || head === s.head) return
  const log = await git(cwd, 'log', '--format=%h%x1f%s', `${s.head}..${head}`).catch(() => '')
  const commits = log.split('\n').filter(Boolean).map((l) => {
    const [sha, subject] = l.split('\x1f')
    return { sha, subject }
  })
  if (!commits.length) return
  const stat = await git(cwd, 'diff', '--shortstat', s.head, head).catch(() => '')
  await ensure()
  const id = 'cr_' + randomUUID().slice(0, 8)
  await pool.query(
    'insert into change_requests(id,workspace_id,message_id,title,base_sha,head_sha,commits,stat) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, wsId, s.messageId, s.title, s.head, head, JSON.stringify(commits), stat]
  )
  emit({ type: 'changes' })
}

const rowOf = (r: any): ChangeRequest => ({
  id: r.id, workspaceId: r.workspace_id, messageId: r.message_id, title: r.title, baseSha: r.base_sha, headSha: r.head_sha,
  commits: r.commits, stat: r.stat, status: r.status, prNumber: r.pr_number ?? undefined, prUrl: r.pr_url ?? undefined,
  error: r.error ?? undefined, createdAt: +new Date(r.created_at), decidedAt: r.decided_at ? +new Date(r.decided_at) : undefined,
  project: r.project, branch: r.branch
})

/** Each approved PR's GitHub state, kept 5 minutes: the panel and its dot ask every minute. */
const prState = new Map<string, { at: number; state: string }>()

/** All change requests, newest first; an approved one whose PR got merged reads as merged. */
export async function listChanges(): Promise<ChangeRequest[]> {
  await ensure()
  const r = await pool.query(
    `select c.*, w.branch, p.name project, w.worktree_path, p.path project_path from change_requests c
       join workspaces w on w.id=c.workspace_id join projects p on p.id=w.project_id order by c.created_at desc limit 200`
  )
  const list = r.rows.map(rowOf)
  // Approved ones: is the PR merged by now? (one gh call per PR, done here so the page stays simple)
  const seen = new Map<number, string>()
  const { githubPaused, noteGithubError } = await import('./github')
  for (const [i, row] of r.rows.entries()) {
    const c = list[i]
    if (c.status !== 'approved' || !c.prNumber) continue
    const cwd = row.worktree_path && existsSync(row.worktree_path) ? row.worktree_path : row.project_path
    const key = `${cwd}#${c.prNumber}`
    const cached = prState.get(key)
    const fresh = cached && (Date.now() - cached.at < 5 * 60_000 || githubPaused())
    let state = seen.get(c.prNumber) ?? (fresh ? cached.state : '')
    if (!state && !githubPaused()) {
      state = await gh(cwd, 'pr', 'view', String(c.prNumber), '--json', 'state', '-q', '.state').catch((e) => (noteGithubError(e), cached?.state ?? ''))
      if (state) prState.set(key, { at: Date.now(), state })
    }
    seen.set(c.prNumber, state)
    if (state === 'MERGED') {
      c.status = 'merged'
      await pool.query("update change_requests set status='merged' where id=$1", [c.id])
    } else if (state === 'CLOSED') c.status = 'closed'
  }
  return list
}

/** OK from the user: push up to this request's last commit, then open the branch's PR (or add to the open one). */
export async function approveChange(id: string, emit: (e: EngineEvent) => void, merge = false): Promise<ChangeRequest> {
  await ensure()
  const c = (await pool.query('select * from change_requests where id=$1', [id])).rows[0]
  if (!c) throw new Error('Change request not found')
  if (c.status !== 'pending') throw new Error('Already decided')
  const ws = await db.workspace(c.workspace_id)
  if (!ws?.branch || !existsSync(ws.worktreePath)) throw new Error('The branch folder is gone')
  const cwd = ws.worktreePath
  try {
    // Work done straight on the default branch never goes to it directly: it gets a branch of its own and a PR into it
    const base = (await git(cwd, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').catch(() => '')).replace(/^origin\//, '') || 'main'
    const commits = c.commits as { sha: string; subject: string }[]
    const title = await publicTitle(cwd, commits, c.stat)
    const slug = title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'changes'
    const head = ws.branch === base ? `cm/${slug}-${c.id.slice(3)}` : ws.branch
    emit({ type: 'change-progress', id, step: 'push' })
    // Already there (a later request, or a push from elsewhere, took the branch further): pushing an older commit would be
    // refused as non-fast-forward – nothing to push, go straight to the PR
    await git(cwd, 'fetch', 'origin', head).catch(() => '')
    const onRemote = await git(cwd, 'merge-base', '--is-ancestor', c.head_sha, `origin/${head}`).then(() => true, () => false)
    if (!onRemote) await git(cwd, 'push', 'origin', `${c.head_sha}:refs/heads/${head}`)
    // Already in the base branch (an earlier request of this branch got merged with these commits): nothing to open
    await git(cwd, 'fetch', 'origin', base).catch(() => '')
    if (await git(cwd, 'merge-base', '--is-ancestor', c.head_sha, `origin/${base}`).then(() => true, () => false)) {
      await pool.query("update change_requests set status='merged', error=null, decided_at=now() where id=$1", [id])
      emit({ type: 'changes' })
      return rowOf({ ...(await pool.query('select * from change_requests where id=$1', [id])).rows[0], branch: ws.branch })
    }
    emit({ type: 'change-progress', id, step: 'pr' })
    const open = await gh(cwd, 'pr', 'list', '--head', head, '--state', 'open', '--json', 'number,url', '-q', '.[0] | select(.) | "\\(.number) \\(.url)"').catch(() => '')
    let [num, url] = open.split(' ')
    if (!num) {
      const body = ['Approved in code-maxxer.', '', ...commits.map((x) => `- ${x.subject} (${x.sha})`)].join('\n')
      url = await gh(cwd, 'pr', 'create', '--head', head, '--base', base, '--title', title, '--body', body)
      num = url.match(/\/pull\/(\d+)/)?.[1] ?? ''
    }
    await pool.query("update change_requests set status='approved', pr_number=$2, pr_url=$3, error=null, decided_at=now() where id=$1", [id, num ? Number(num) : null, url || null])
    // "Push and merge": merge it right away; when the base branch's rules hold it back, merge as admin (as the user does)
    if (merge && num) {
      emit({ type: 'change-progress', id, step: 'merge' })
      await gh(cwd, 'pr', 'merge', num, '--merge').catch((e) => {
        const why = String((e as any)?.stderr || (e as Error).message)
        if (!/base branch policy|protected|review|required|not mergeable.*status/i.test(why)) throw e
        return gh(cwd, 'pr', 'merge', num, '--merge', '--admin')
      })
      await pool.query("update change_requests set status='merged' where id=$1", [id])
      // What was just merged shows up in the project's own folder right away
      void import('./mainSync').then((m) => m.syncMain(ws.projectId)).catch(() => {})
    }
  } catch (e) {
    void import('./github').then((g) => g.noteGithubError(e))
    const raw = String((e as any)?.stderr || (e as Error).message)
    const msg = /rate limit/i.test(raw)
      ? 'GitHub rate limit reached: wait a few minutes and try again (nothing was lost, the commits are still here).'
      : raw.trim().split('\n').slice(-3).join('\n')
    await pool.query('update change_requests set error=$2 where id=$1', [id, msg])
    emit({ type: 'changes' })
    throw new Error(msg)
  }
  emit({ type: 'changes' })
  return rowOf({ ...(await pool.query('select * from change_requests where id=$1', [id])).rows[0], branch: ws.branch })
}

/** No from the user: nothing is pushed (the commits stay on the local branch). */
export async function rejectChange(id: string, emit: (e: EngineEvent) => void) {
  await ensure()
  await pool.query("update change_requests set status='rejected', decided_at=now() where id=$1 and status='pending'", [id])
  emit({ type: 'changes' })
}
