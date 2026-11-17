import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GithubMirror, IssueStatus } from '@shared/types'
import { db, pool } from '../db'
import { bin, shellEnv } from './bins'
import { remoteInfo } from './git'

/*
 * GitHub mirror of a project's issues: every brain issue becomes a GitHub Issue (label "code-maxxer")
 * on an item of a GitHub Project board ("code-maxxer · <repo>"), with Status following ours:
 *   open → Todo · in_progress → In Progress · resolved / wontfix → Done (issue closed).
 * Two-way for status: a change made on GitHub comes back here when ours didn't move meanwhile.
 * Everything goes through the `gh` CLI and its login.
 */
const run = promisify(execFile)
const gh = async (...args: string[]) => (await run(bin('gh'), args, { env: shellEnv(), maxBuffer: 16 * 1024 * 1024 })).stdout.trim()
const ghJson = async <T>(...args: string[]): Promise<T> => JSON.parse(await gh(...args))

const LABEL = 'code-maxxer'
const TO_GH: Record<IssueStatus, string> = { open: 'Todo', in_progress: 'In Progress', resolved: 'Done', wontfix: 'Done' }

type Board = { number: number; id: string; url: string; statusField: string; options: Record<string, string> }

export async function mirrorFor(projectId: string): Promise<GithubMirror> {
  const cfg = await db.getSetting<GithubMirror>(`gh:${projectId}`)
  return cfg ?? { enabled: false, repo: null, boardUrl: null, boardNumber: null, lastSync: null, error: null, needsScope: false }
}
const saveMirror = (projectId: string, m: GithubMirror) => db.setSetting(`gh:${projectId}`, m)

async function hasProjectScope(): Promise<boolean> {
  const out = await run(bin('gh'), ['auth', 'status'], { env: shellEnv() }).then((r) => r.stdout + r.stderr).catch((e) => String(e.stdout ?? '') + String(e.stderr ?? ''))
  return /Token scopes:.*'project'/.test(out)
}

async function ensureBoard(owner: string, repo: string, m: GithubMirror): Promise<Board | null> {
  if (!(await hasProjectScope())) return null
  const title = `code-maxxer · ${repo}`
  let number = m.boardNumber
  if (!number) {
    const list = await ghJson<{ projects: { number: number; title: string }[] }>('project', 'list', '--owner', owner, '--format', 'json', '--limit', '100')
    number = list.projects.find((p) => p.title === title)?.number ?? null
    if (!number) {
      const created = await ghJson<{ number: number }>('project', 'create', '--owner', owner, '--title', title, '--format', 'json')
      number = created.number
      await gh('project', 'link', String(number), '--owner', owner, '--repo', `${owner}/${repo}`).catch(() => {})
    }
  }
  const view = await ghJson<{ id: string; url: string }>('project', 'view', String(number), '--owner', owner, '--format', 'json')
  const fields = await ghJson<{ fields: { id: string; name: string; options?: { id: string; name: string }[] }[] }>(
    'project', 'field-list', String(number), '--owner', owner, '--format', 'json'
  )
  const status = fields.fields.find((f) => f.name === 'Status')
  if (!status?.options) throw new Error('The board has no Status field')
  return { number, id: view.id, url: view.url, statusField: status.id, options: Object.fromEntries(status.options.map((o) => [o.name, o.id])) }
}

/** Turn the mirror on for a project and do a first sync. */
export async function enableMirror(projectId: string, enabled: boolean): Promise<GithubMirror> {
  const m = await mirrorFor(projectId)
  if (!enabled) {
    const off = { ...m, enabled: false }
    await saveMirror(projectId, off)
    return off
  }
  const p = await db.project(projectId)
  const r = p && (await remoteInfo(p.path))
  if (!r || r.host !== 'github.com') {
    const bad = { ...m, enabled: false, error: 'This project has no GitHub remote (origin).' }
    await saveMirror(projectId, bad)
    return bad
  }
  await gh('label', 'create', LABEL, '--repo', `${r.owner}/${r.name}`, '--color', 'D97757', '--description', 'Found by code-maxxer', '--force').catch(() => {})
  await saveMirror(projectId, { ...m, enabled: true, repo: `${r.owner}/${r.name}`, error: null })
  return syncProject(projectId)
}

const ghStatusToOurs = (state: string, board: string | null, current: IssueStatus): IssueStatus => {
  if (state === 'CLOSED') return current === 'wontfix' ? 'wontfix' : 'resolved'
  if (board === 'In Progress') return 'in_progress'
  if (board === 'Done') return current === 'wontfix' ? 'wontfix' : 'resolved'
  return 'open'
}

export async function syncProject(projectId: string): Promise<GithubMirror> {
  let m = await mirrorFor(projectId)
  if (!m.enabled || !m.repo) return m
  const full: string = m.repo
  const [owner, repo] = full.split('/')
  try {
    const board = await ensureBoard(owner, repo, m).catch((e) => {
      throw new Error(`Board: ${e.message}`)
    })
    m = { ...m, needsScope: !board, boardUrl: board?.url ?? m.boardUrl, boardNumber: board?.number ?? m.boardNumber }

    const rows = (
      await pool.query(
        `select b.* from brain_entries b join workspaces w on w.id=b.workspace_id
         where w.project_id=$1 and b.kind='issue' order by b.created_at`,
        [projectId]
      )
    ).rows

    // Current GitHub state of mirrored issues, and board status per issue url.
    const ghIssues = await ghJson<{ number: number; state: string; url: string }[]>(
      'issue', 'list', '--repo', full, '--label', LABEL, '--state', 'all', '--limit', '500', '--json', 'number,state,url'
    )
    const byNumber = new Map(ghIssues.map((i) => [i.number, i]))
    const boardStatus = new Map<string, { item: string; status: string | null }>()
    if (board) {
      const items = await ghJson<{ items: { id: string; status?: string; content?: { url?: string } }[] }>(
        'project', 'item-list', String(board.number), '--owner', owner, '--format', 'json', '--limit', '1000'
      )
      for (const it of items.items) if (it.content?.url) boardStatus.set(it.content.url, { item: it.id, status: it.status ?? null })
    }

    for (const row of rows) {
      let status: IssueStatus = row.status
      let number: number | null = row.gh_number
      let url: string | null = row.gh_url
      if (!number) {
        const body = `${row.body || ''}\n\n---\n_Recorded by code-maxxer${row.node_id ? ` in the **${row.node_id}** step` : ''}._`
        url = await gh('issue', 'create', '--repo', full, '--title', row.title, '--body', body, '--label', LABEL)
        number = Number(url.split('/').pop())
        await pool.query('update brain_entries set gh_number=$2, gh_url=$3, gh_synced=$4 where id=$1', [row.id, number, url, 'open'])
        row.gh_synced = 'open'
      } else {
        // Pull: GitHub moved and we didn't → adopt GitHub's status.
        const remote = byNumber.get(number)
        const theirs = remote ? ghStatusToOurs(remote.state, boardStatus.get(remote.url)?.status ?? null, status) : status
        if (theirs !== row.gh_synced && status === row.gh_synced) {
          status = theirs
          await db.updateIssue(row.id, { status })
        }
      }
      // Push: our status → issue open/closed + board column.
      if (status !== row.gh_synced) {
        const closed = status === 'resolved' || status === 'wontfix'
        if (closed) await gh('issue', 'close', String(number), '--repo', full, '--reason', status === 'wontfix' ? 'not planned' : 'completed').catch(() => {})
        else await gh('issue', 'reopen', String(number), '--repo', full).catch(() => {})
      }
      if (board && url) {
        let item = boardStatus.get(url)?.item
        if (!item) item = (await ghJson<{ id: string }>('project', 'item-add', String(board.number), '--owner', owner, '--url', url, '--format', 'json')).id
        const want = TO_GH[status]
        if (boardStatus.get(url)?.status !== want && board.options[want]) {
          await gh('project', 'item-edit', '--id', item, '--project-id', board.id, '--field-id', board.statusField, '--single-select-option-id', board.options[want])
        }
      }
      if (status !== row.gh_synced) await pool.query('update brain_entries set gh_synced=$2 where id=$1', [row.id, status])
    }
    m = { ...m, lastSync: Date.now(), error: null }
  } catch (e: any) {
    m = { ...m, error: String(e.stderr || e.message).trim().split('\n').slice(-2).join(' ') }
  }
  await saveMirror(projectId, m)
  return m
}

let timer: NodeJS.Timeout | null = null
/** Every 2 minutes, sync every project that has the mirror on. */
export function startGithubSync(onChange: () => void) {
  if (timer) return
  const tick = async () => {
    for (const p of await db.projects()) {
      const m = await mirrorFor(p.id)
      if (m.enabled) {
        await syncProject(p.id)
        onChange()
      }
    }
  }
  timer = setInterval(() => void tick().catch(() => {}), 120_000)
  void tick().catch(() => {})
}
