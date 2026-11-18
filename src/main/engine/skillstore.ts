import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, normalize, sep } from 'node:path'
import type pg from 'pg'
import type { ChatSkill, Skill } from '@shared/skills'

/*
 * Skills: folders with a SKILL.md (frontmatter name + description, then instructions) and any files it uses.
 * Stored once under ~/.code-maxxer-2/skills/<slug>, attached to chats; custom agents carry a list of them.
 * Shared by the app and the cm2 MCP server (which installs them when the agent is asked to).
 */

export const SKILLS_DIR = join(homedir(), '.code-maxxer-2', 'skills')

export const SKILLS_SCHEMA = `
create table if not exists skills (
  id text primary key, slug text not null unique, name text not null, description text not null default '',
  source_url text, dir text not null, files int not null default 1, created_at timestamptz not null default now()
);
create table if not exists workspace_skills (
  workspace_id text not null references workspaces(id) on delete cascade,
  skill_id text not null references skills(id) on delete cascade,
  added_at timestamptz not null default now(), primary key (workspace_id, skill_id)
);
alter table workspace_skills add column if not exists via_agent text;
alter table agents add column if not exists handle text;
alter table agents add column if not exists skills text[] not null default '{}';
alter table agents add column if not exists source_workspace_id text;
alter table agents add column if not exists custom boolean not null default false;
alter table agents add column if not exists created_at timestamptz not null default now();
create unique index if not exists agents_handle on agents(handle) where handle is not null;
`

export const skillRow = (x: any): Skill => ({
  id: x.id, slug: x.slug, name: x.name, description: x.description, sourceUrl: x.source_url, dir: x.dir,
  files: x.files, at: x.created_at.getTime()
})

export const slugify = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'skill'

/** name/description from a SKILL.md's frontmatter (falls back to the first heading). */
export function frontmatter(md: string): { name: string; description: string } {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/)
  const get = (k: string) => {
    const line = m?.[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
    return line.replace(/^["'>|]\s*|["']$/g, '').trim()
  }
  const name = get('name') || md.match(/^#\s+(.+)$/m)?.[1]?.trim() || ''
  return { name, description: get('description') }
}

type Fetched = { files: { path: string; body: Buffer }[]; source: string }
const MAX_FILES = 60
const MAX_BYTES = 4 * 1024 * 1024

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { headers: { 'User-Agent': 'code-maxxer', Accept: 'application/vnd.github+json, text/plain, */*' }, redirect: 'follow' })
  if (!r.ok) throw new Error(`${url} answered ${r.status}`)
  return r
}

/** Every file under a GitHub folder (contents API), size-capped. */
async function githubFolder(owner: string, repo: string, ref: string, path: string): Promise<Fetched['files']> {
  const out: Fetched['files'] = []
  let bytes = 0
  const walk = async (p: string) => {
    const r = await get(`https://api.github.com/repos/${owner}/${repo}/contents/${p}?ref=${encodeURIComponent(ref)}`)
    const list: any[] = await r.json()
    for (const it of Array.isArray(list) ? list : [list]) {
      if (out.length >= MAX_FILES || bytes > MAX_BYTES) return
      if (it.type === 'dir') await walk(it.path)
      else if (it.type === 'file' && it.download_url) {
        const body = Buffer.from(await (await get(it.download_url)).arrayBuffer())
        bytes += body.length
        out.push({ path: it.path.slice(path ? path.length + 1 : 0), body })
      }
    }
  }
  await walk(path)
  return out
}

/**
 * Fetch a skill from a link: a GitHub folder (…/tree/<ref>/<path>), a SKILL.md on GitHub (…/blob/…) or raw,
 * a repo root (its SKILL.md, or the only skill under skills/), or any URL that serves a SKILL.md.
 */
export async function fetchSkill(url: string): Promise<Fetched> {
  const u = new URL(url.trim())
  if (u.hostname === 'github.com') {
    const [owner, repo, kind, ref, ...rest] = u.pathname.replace(/^\/|\/$/g, '').split('/')
    if (!owner || !repo) throw new Error('Not a GitHub repository link')
    const path = rest.join('/')
    if (kind === 'blob') {
      const dir = path.replace(/\/?[^/]+$/, '')
      return { files: await githubFolder(owner, repo, ref, dir), source: url }
    }
    if (kind === 'tree') return { files: await githubFolder(owner, repo, ref, path), source: url }
    // Repo root: the default branch, then a SKILL.md at the root or a single skill folder.
    const meta = await (await get(`https://api.github.com/repos/${owner}/${repo}`)).json()
    const branch = meta.default_branch ?? 'main'
    const tree = await (await get(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`)).json()
    const skills = (tree.tree ?? []).filter((t: any) => /(^|\/)SKILL\.md$/i.test(t.path)).map((t: any) => t.path as string)
    if (skills.includes('SKILL.md')) return { files: await githubFolder(owner, repo, branch, ''), source: url }
    if (skills.length === 1) return { files: await githubFolder(owner, repo, branch, dirname(skills[0])), source: url }
    if (!skills.length) throw new Error('No SKILL.md in that repository')
    throw new Error(`That repository has ${skills.length} skills. Pick one and pass its folder link:\n${skills.slice(0, 30).map((p: string) => `https://github.com/${owner}/${repo}/tree/${branch}/${dirname(p)}`).join('\n')}`)
  }
  const r = await get(u.toString())
  const body = Buffer.from(await r.arrayBuffer())
  const text = body.toString('utf8')
  if (!/^---\s*\n[\s\S]*?\n---/.test(text) && !/^#\s/m.test(text)) throw new Error('That link does not serve a SKILL.md (markdown with name and description)')
  return { files: [{ path: 'SKILL.md', body }], source: url }
}

/** Save a fetched skill (same slug → replaced in place) and return it. */
export async function storeSkill(pool: pg.Pool, f: Fetched, nameHint?: string): Promise<Skill> {
  const md = f.files.find((x) => /^SKILL\.md$/i.test(x.path))
  if (!md) throw new Error('No SKILL.md found at that link')
  const fm = frontmatter(md.body.toString('utf8'))
  const name = fm.name || nameHint || 'skill'
  const slug = slugify(name)
  const dir = join(SKILLS_DIR, slug)
  for (const file of f.files) {
    const target = normalize(join(dir, file.path))
    if (!target.startsWith(dir + sep)) continue // no paths outside the skill folder
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.body)
  }
  const r = await pool.query(
    `insert into skills(id, slug, name, description, source_url, dir, files) values($1,$2,$3,$4,$5,$6,$7)
     on conflict (slug) do update set name=excluded.name, description=excluded.description, source_url=excluded.source_url, files=excluded.files
     returning *`,
    ['sk_' + Math.random().toString(36).slice(2, 10), slug, name, fm.description, f.source, dir, f.files.length]
  )
  return skillRow(r.rows[0])
}

/** Write a skill the agent authored itself (e.g. the instructions of a custom agent). */
export async function writeSkill(pool: pg.Pool, name: string, description: string, body: string): Promise<Skill> {
  const md = `---\nname: ${name}\ndescription: ${description.replace(/\n/g, ' ')}\n---\n\n${body.trim()}\n`
  return storeSkill(pool, { files: [{ path: 'SKILL.md', body: Buffer.from(md) }], source: '' }, name)
}

export async function attach(pool: pg.Pool, workspaceId: string, skillId: string, viaAgent: string | null = null) {
  await pool.query('insert into workspace_skills(workspace_id, skill_id, via_agent) values($1,$2,$3) on conflict do nothing', [workspaceId, skillId, viaAgent])
}

export async function chatSkills(pool: pg.Pool, workspaceId: string): Promise<ChatSkill[]> {
  const r = await pool.query(
    `select s.*, ws.added_at, ws.via_agent from workspace_skills ws join skills s on s.id=ws.skill_id
     where ws.workspace_id=$1 order by ws.added_at`,
    [workspaceId]
  )
  return r.rows.map((x) => ({ ...skillRow(x), via: x.via_agent ? 'agent' : 'chat', agent: x.via_agent ?? undefined, addedAt: x.added_at.getTime() }))
}

export const skillBody = (s: Skill) => readFile(join(s.dir, 'SKILL.md'), 'utf8').catch(() => '')

/** For the system prompt: names and one line each; the agent reads the file when the work calls for it. */
export function skillsRule(skills: Skill[], heading = 'SKILLS loaded in this chat'): string {
  if (!skills.length) return ''
  return (
    `${heading} (read the SKILL.md with the Read tool before doing work it covers, and follow it; files it mentions are in the same folder):\n` +
    skills.map((s) => `- ${s.name}: ${s.description || 'no description'} → ${join(s.dir, 'SKILL.md')}`).join('\n')
  )
}
