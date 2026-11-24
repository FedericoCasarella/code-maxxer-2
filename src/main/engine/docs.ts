/**
 * Documentation (Pro): a user manual for each project, committed in the repo under docs/manual/.
 * Folders are sections, .md files are pages (numbered prefixes give the order), images live in docs/manual/images/.
 * An agent writes it the first time and, with the switch on, updates it after every pipeline run on that branch,
 * explaining things simply (for a 13-year-old) with screenshots it takes in the built-in browser.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join, posix, relative, resolve, sep } from 'node:path'
import { BrowserWindow, dialog, shell } from 'electron'
import type { DocsExportLabels, DocsNode, DocsRevision, DocsState } from '@shared/docs'
import type { SendOptions, Workspace } from '@shared/types'
import { db } from '../db'
import { languageRule } from './language'
import { listModels } from './models'
import { shellEnv } from './bins'

export const MANUAL = join('docs', 'manual')
const key = (projectId: string) => `docs:${projectId}`

let sendRun: ((o: SendOptions) => void) | null = null
let newBranch: ((projectId: string, name: string, branch: string) => Promise<Workspace>) | null = null
export const setDocsWiring = (send: (o: SendOptions) => void, create: (projectId: string, name: string, branch: string) => Promise<Workspace>) => {
  sendRun = send
  newBranch = create
}

export const isEnabled = async (projectId: string) => (await db.getSetting<boolean>(key(projectId))) === true
export const setEnabled = (projectId: string, on: boolean) => db.setSetting(key(projectId), on)

/** "02-first-steps" → "First steps"; a page's own title is its first "# " line. */
const pretty = (name: string) => {
  const s = name.replace(/\.md$/i, '').replace(/^\d+[-_. ]*/, '').replace(/[-_]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : name
}
const titleOf = (file: string) => readFileSync(file, 'utf8').match(/^#\s+(.+)$/m)?.[1]?.trim()

function walk(root: string, dir: string): DocsNode[] {
  let names: string[] = []
  try {
    names = readdirSync(dir).filter((n) => !n.startsWith('.') && n !== 'images').sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  } catch {
    return []
  }
  const out: DocsNode[] = []
  for (const n of names) {
    const full = join(dir, n)
    const id = relative(root, full).split(sep).join('/')
    if (statSync(full).isDirectory()) {
      const children = walk(root, full)
      if (children.length) out.push({ id, label: pretty(n), children })
    } else if (extname(n).toLowerCase() === '.md') out.push({ id, label: titleOf(full) ?? pretty(n) })
  }
  return out
}

/**
 * The checkout the manual is read from: the project's own folder when it has one, else the branch that last wrote it
 * (the agent writes and commits it on a branch, so until that branch is merged the manual only lives there).
 */
async function repoOf(projectId: string): Promise<string> {
  const p = await db.project(projectId)
  if (!p) throw new Error('Project not found')
  if (existsSync(join(p.path, MANUAL))) return p.path
  const branch = (await db.workspaces())
    .filter((w) => w.projectId === projectId && w.worktreePath && w.worktreePath !== p.path && existsSync(join(w.worktreePath, MANUAL)))
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0]
  return branch?.worktreePath ?? p.path
}
const rootOf = async (projectId: string) => join(await repoOf(projectId), MANUAL)
/** A file inside the manual folder, or an error: nothing outside it is read. */
function inside(root: string, rel: string): string {
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) throw new Error('Outside the manual')
  return full
}

export async function docsState(projectId: string): Promise<DocsState> {
  const root = await rootOf(projectId)
  const p = await db.project(projectId)
  const main = (await db.workspaces()).find((w) => w.projectId === projectId && w.worktreePath === p?.path)
  return { projectId, enabled: await isEnabled(projectId), exists: existsSync(root), tree: walk(root, root), mainWsId: main?.id ?? null }
}
export async function readPage(projectId: string, rel: string): Promise<string> {
  return readFileSync(inside(await rootOf(projectId), rel), 'utf8')
}
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' }
/** An image of the manual, as a data URL the page can show. */
export async function readAsset(projectId: string, rel: string): Promise<string | null> {
  const full = inside(await rootOf(projectId), rel)
  const mime = MIME[extname(full).toLowerCase()]
  if (!mime || !existsSync(full)) return null
  return `data:${mime};base64,${readFileSync(full).toString('base64')}`
}

const STYLE =
  'HOW TO WRITE: for a 13-year-old (Italian "terza media" level). Short sentences, everyday words, one step per line. ' +
  'When a technical word is unavoidable, explain it in a few words the first time. Talk to the reader ("click", "you see"). ' +
  'Describe only what the user sees and does in the app, never the code.'
const LAYOUT =
  `WHERE: everything goes in ${MANUAL.split(sep).join('/')}/ of this repository. One folder per area of the app, numbered for the order (01-getting-started, 02-…); ` +
  'one .md page per feature inside it, numbered too (01-login.md). Every page starts with "# Title", then "## " sections (and "### " when needed): the app builds its index from them. ' +
  `Screenshots go in ${MANUAL.split(sep).join('/')}/images/ with clear names and are linked with relative paths (e.g. ![The login page](../images/login.png)).`
const SHOTS =
  'SCREENSHOTS: start the app (the preview, or its dev server), open each screen with browser_navigate, and save it with browser_screenshot and save_to set to the image path. ' +
  'One screenshot where it helps the reader find a button or understand a screen, not on every paragraph. No real personal data or secrets in them.'

async function prompt(first: boolean): Promise<string> {
  return [
    first
      ? 'Write the user manual of this app from scratch: what it is for, how to get started, then every feature the user can use.'
      : 'Update the user manual for what this branch changed (git diff against the default branch): new or changed screens and steps, removed features. Leave the rest as it is; if the manual does not exist yet, write it whole.',
    STYLE,
    LAYOUT,
    SHOTS,
    (await languageRule()).replace('write to the user', 'write the manual'),
    'When done, commit only the manual folder (message "Docs: …") and say in two lines what you added or changed.'
  ].join('\n\n')
}

async function runOpts(wsId: string, text: string): Promise<SendOptions> {
  const o = (await db.getSetting<any>(`opts:${wsId}`)) ?? (await db.getSetting<any>('opts:last'))
  return {
    workspaceId: wsId,
    model: o?.model ?? (await listModels(false))[0]?.id ?? 'claude-opus-5-5',
    effort: o?.effort ?? 'medium',
    mode: { kind: 'direct' },
    fullAccess: o?.fullAccess ?? true,
    text
  }
}

/** Writes or updates the manual now, on a branch of its own: the branch's id. */
export async function writeNow(projectId: string): Promise<string> {
  if (!sendRun || !newBranch) throw new Error('Not ready')
  const exists = existsSync(await rootOf(projectId))
  const stamp = new Date().toISOString().slice(0, 10)
  const ws = await newBranch(projectId, exists ? `Docs update ${stamp}` : 'User manual', `docs/manual-${stamp}-${Date.now().toString(36).slice(-4)}`)
  sendRun({ ...(await runOpts(ws.id, await prompt(!exists))), notice: exists ? 'Updating the user manual' : 'Writing the user manual' })
  return ws.id
}

/** After a pipeline run that ended well: the follow-up that updates the manual on the same branch, when the switch is on. */
export async function afterPipeline(ws: Workspace): Promise<SendOptions | null> {
  if (!(await isEnabled(ws.projectId))) return null
  return { ...(await runOpts(ws.id, await prompt(false))), notice: 'Updating the user manual for the changes of this branch' }
}

// ─── revisions: who changed the manual and when, from git ───

const git = (cwd: string, args: string[]) =>
  new Promise<string>((res) => execFile('git', args, { cwd, maxBuffer: 20_000_000 }, (e, out) => res(e ? '' : String(out))))

/** "github.com/owner/repo" of the project's origin, or null. */
async function githubRepo(cwd: string): Promise<string | null> {
  const url = (await git(cwd, ['remote', 'get-url', 'origin'])).trim()
  return url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] ?? null
}
const avatars = new Map<string, Promise<string | null>>()
/** The GitHub picture of a commit's author: from a noreply address directly, else asked to GitHub once per address. */
function avatarOf(email: string, repo: string | null): Promise<string | null> {
  const noreply = email.match(/^(\d+)\+[^@]+@users\.noreply\.github\.com$/i)
  if (noreply) return Promise.resolve(`https://avatars.githubusercontent.com/u/${noreply[1]}?s=64`)
  if (!repo) return Promise.resolve(null)
  if (!avatars.has(email))
    avatars.set(
      email,
      new Promise((res) =>
        // Any commit of theirs already on GitHub: works for commits not pushed yet too
        execFile('gh', ['api', `repos/${repo}/commits?author=${encodeURIComponent(email)}&per_page=1`, '--jq', '.[0].author.avatar_url // ""'], { env: shellEnv(), timeout: 8000 }, (e, out) =>
          res(e || !String(out).trim() ? null : `${String(out).trim()}${String(out).includes('?') ? '&' : '?'}s=64`)
        )
      )
    )
  return avatars.get(email)!
}

/** The commits that changed one page (or the whole manual): newest first, with who made them. */
export async function revisions(projectId: string, rel?: string): Promise<DocsRevision[]> {
  const base = await repoOf(projectId)
  const root = join(base, MANUAL)
  const target = (rel ? relative(base, inside(root, rel)) : MANUAL).split(sep).join('/')
  const repo = await githubRepo(base)
  // --name-only: the file's path at each commit (a page can be renamed)
  const out = await git(base, ['log', ...(rel ? ['--follow'] : []), '--name-only', '--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s', '--', target])
  const list = out
    .split('\x1e')
    .filter((c) => c.trim())
    .map((c) => {
      const [head, ...files] = c.split('\n')
      const [sha, author, email, date, message] = head.split('\x1f')
      return { sha, author, email, date, message, path: files.find((f) => f.trim())?.trim() ?? target }
    })
  return Promise.all(
    list.map(async (r) => ({ ...r, avatar: await avatarOf(r.email, repo), url: repo ? `https://github.com/${repo}/commit/${r.sha}` : null }))
  )
}
const day = (iso: string) => iso.slice(0, 10)

// ─── export ───

const pagesOf = (nodes: DocsNode[]): string[] => nodes.flatMap((n) => (n.children ? pagesOf(n.children) : [n.id]))
/** GitHub's anchor for a title, so links between pages still work in the single file. */
const anchor = (title: string) => title.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-')

async function saveAs(name: string, ext: string, label: string): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: label, extensions: [ext] }] })
  return r.canceled || !r.filePath ? null : r.filePath
}

/** The whole manual as one Markdown file, its images in an images/ folder next to it: the saved path, or null if cancelled. */
export async function exportMarkdown(projectId: string, labels: DocsExportLabels): Promise<string | null> {
  const root = await rootOf(projectId)
  const pages = pagesOf(walk(root, root))
  if (!pages.length) throw new Error('The manual is empty')
  const name = (await db.project(projectId))?.name ?? 'manual'
  const file = await saveAs(`${name} - manual.md`, 'md', 'Markdown')
  if (!file) return null
  const titles = new Map(pages.map((p) => [p, titleOf(join(root, p)) ?? pretty(basename(p))]))
  const folder = `${basename(file, extname(file))} images`
  const images = join(dirname(file), folder)
  const parts = []
  for (const p of pages) {
    const dir = posix.dirname(p)
    const last = (await revisions(projectId, p))[0]
    const text = readFileSync(join(root, p), 'utf8')
      .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/g, (all, bang: string, text: string, href: string, rest: string) => {
        if (/^[a-z]+:|^#/i.test(href)) return all
        const target = posix.normalize(posix.join(dir === '.' ? '' : dir, href.replace(/#.*$/, '')))
        if (bang) {
          const src = join(root, target)
          if (!existsSync(src) || target.startsWith('..')) return all
          mkdirSync(images, { recursive: true })
          const out = target.replace(/^images\//, '').split('/').join('-')
          copyFileSync(src, join(images, out))
          return `![${text}](${encodeURI(folder)}/${out}${rest})`
        }
        return titles.has(target) ? `[${text}](#${anchor(titles.get(target)!)})` : all
      })
      .trim()
    // Under the page's title: when it was last revised, and by whom
    const note = `_${labels.lastRevision}: ${last ? `${day(last.date)} · ${last.author}` : labels.notCommitted}_`
    parts.push(/^#\s.+$/m.test(text) ? text.replace(/^(#\s.+)$/m, `$1\n\n${note}`) : `${note}\n\n${text}`)
  }
  // The manual's history first: every change, newest first
  const history = await revisions(projectId)
  const table = history.length
    ? `## ${labels.history}\n\n| ${labels.date} | ${labels.author} | ${labels.change} |\n| --- | --- | --- |\n` +
      history.map((r) => `| ${day(r.date)} | ${r.author} | ${r.message.replace(/\|/g, '\\|')} |`).join('\n')
    : ''
  writeFileSync(file, [table, ...parts].filter(Boolean).join('\n\n---\n\n') + '\n')
  shell.showItemInFolder(file)
  return file
}

/** The manual as a PDF, from the HTML the page renders (pages in order, images inline): the saved path, or null if cancelled. */
export async function exportPdf(projectId: string, html: string): Promise<string | null> {
  const name = (await db.project(projectId))?.name ?? 'manual'
  const file = await saveAs(`${name} - manual.pdf`, 'pdf', 'PDF')
  if (!file) return null
  const dir = mkdtempSync(join(tmpdir(), 'cm2-docs-'))
  const page = join(dir, 'manual.html')
  writeFileSync(page, html)
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false } })
  try {
    await win.loadFile(page)
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } })
    writeFileSync(file, pdf)
    shell.showItemInFolder(file)
    return file
  } finally {
    win.destroy()
    rmSync(dir, { recursive: true, force: true })
  }
}
