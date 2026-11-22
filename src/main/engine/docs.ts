/**
 * Documentation (Pro): a user manual for each project, committed in the repo under docs/manual/.
 * Folders are sections, .md files are pages (numbered prefixes give the order), images live in docs/manual/images/.
 * An agent writes it the first time and, with the switch on, updates it after every pipeline run on that branch,
 * explaining things simply (for a 13-year-old) with screenshots it takes in the built-in browser.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'
import type { DocsNode, DocsState } from '@shared/docs'
import type { SendOptions, Workspace } from '@shared/types'
import { db } from '../db'
import { languageRule } from './language'
import { listModels } from './models'

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

async function rootOf(projectId: string): Promise<string> {
  const p = await db.project(projectId)
  if (!p) throw new Error('Project not found')
  return join(p.path, MANUAL)
}
/** A file inside the manual folder, or an error: nothing outside it is read. */
function inside(root: string, rel: string): string {
  const full = resolve(root, rel)
  if (full !== root && !full.startsWith(root + sep)) throw new Error('Outside the manual')
  return full
}

export async function docsState(projectId: string): Promise<DocsState> {
  const root = await rootOf(projectId)
  return { projectId, enabled: await isEnabled(projectId), exists: existsSync(root), tree: walk(root, root) }
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
  sendRun(await runOpts(ws.id, await prompt(!exists)))
  return ws.id
}

/** After a pipeline run that ended well: the follow-up that updates the manual on the same branch, when the switch is on. */
export async function afterPipeline(ws: Workspace): Promise<SendOptions | null> {
  if (!(await isEnabled(ws.projectId))) return null
  return runOpts(ws.id, await prompt(false))
}
