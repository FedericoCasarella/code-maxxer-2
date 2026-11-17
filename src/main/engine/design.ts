import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DESIGN_MANIFEST, DESIGN_ROUTE, type DesignManifest, type DesignState } from '@shared/design'
import type { EngineEvent, SendOptions } from '@shared/types'
import { db } from '../db'
import { createWorktree } from './git'
import { listModels } from './models'

type Setup = { origin: 'existing' | 'scratch'; library: string }
const wsKey = (wsId: string) => `design:ws:${wsId}`
const projectKey = (projectId: string) => `design:project:${projectId}`

export function readManifest(root: string): DesignManifest | null {
  try {
    return JSON.parse(readFileSync(join(root, DESIGN_MANIFEST), 'utf8'))
  } catch {
    return null
  }
}

const LIBS: Record<string, { id: string; label: string; deps: string[] }[]> = {
  react: [
    { id: 'shadcn', label: 'shadcn/ui', deps: [] },
    { id: 'mantine', label: 'Mantine', deps: ['@mantine/core'] },
    { id: 'chakra', label: 'Chakra UI', deps: ['@chakra-ui/react'] },
    { id: 'mui', label: 'MUI', deps: ['@mui/material'] }
  ],
  vue: [
    { id: 'shadcn-vue', label: 'shadcn-vue', deps: [] },
    { id: 'vuetify', label: 'Vuetify', deps: ['vuetify'] },
    { id: 'primevue', label: 'PrimeVue', deps: ['primevue'] }
  ],
  svelte: [
    { id: 'shadcn-svelte', label: 'shadcn-svelte', deps: [] },
    { id: 'skeleton', label: 'Skeleton', deps: ['@skeletonlabs/skeleton'] }
  ],
  other: [{ id: 'css', label: 'Plain CSS and tokens', deps: [] }]
}

function detect(root: string): { framework: string; libraries: DesignState['libraries'] } {
  let deps: Record<string, string> = {}
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    deps = { ...pkg.dependencies, ...pkg.devDependencies }
  } catch { /* not a JS project */ }
  const framework = deps.next ? 'next' : deps.react ? 'react' : deps.vue || deps.nuxt ? 'vue' : deps.svelte ? 'svelte' : 'other'
  const fam = framework === 'next' ? 'react' : framework
  const shadcn = existsSync(join(root, 'components.json'))
  const libraries = (LIBS[fam] ?? LIBS.other).map((l) => ({
    id: l.id,
    label: l.label,
    present: l.id.startsWith('shadcn') ? shadcn : l.deps.some((d) => d in deps)
  }))
  // What's already in the project first.
  libraries.sort((a, b) => Number(b.present) - Number(a.present))
  return { framework, libraries }
}

export async function designState(projectId: string): Promise<DesignState> {
  const p = await db.project(projectId)
  if (!p) throw new Error('Project not found')
  const workspaces = (await db.workspaces()).filter((w) => w.projectId === projectId)
  const dsId = await db.getSetting<string>(projectKey(projectId))
  const dsWs = workspaces.find((w) => w.id === dsId) ?? null
  const mainWs = workspaces.find((w) => w.worktreePath === p.path) ?? null
  const onMain = readManifest(p.path)
  const onBranch = dsWs ? readManifest(dsWs.worktreePath) : null
  // Merged into the main checkout: that one is the design system. Otherwise the branch building it.
  const ws = onMain && mainWs ? mainWs : dsWs
  return {
    projectId,
    workspaceId: ws?.id ?? null,
    branch: ws?.branch ?? null,
    manifest: onMain ?? onBranch,
    building: !!dsWs && (dsWs.status === 'running' || !(onMain ?? onBranch)),
    ...detect(p.path)
  }
}

/** The setup protocol, only in the design-system branch's system prompt (other chats never carry it). */
export async function designProtocol(wsId: string): Promise<string> {
  const s = await db.getSetting<Setup>(wsKey(wsId))
  if (!s) return ''
  const common =
    `DESIGN SYSTEM BRANCH. This chat builds the project's design system with ${s.library}. ` +
    `Deliverables: (1) ONE showcase page at the hidden route ${DESIGN_ROUTE}, dev only (guard it, e.g. import.meta.env.DEV or the framework's equivalent, so it never ships), ` +
    'with a light/dark toggle that also reads ?theme=light|dark, and one titled section with an id anchor per group; ' +
    '(2) real tokens (colors, typography, spacing, radii, shadows) in one tokens file used by the components; ' +
    '(3) reusable components the rest of the app imports (buttons in every variant/size/state, form fields with errors, cards, navigation, alerts, badges, tooltips, dialogs, empty state, tables); ' +
    `(4) the manifest ${DESIGN_MANIFEST} (schema 1: framework, library, route, page_file, tokens_file, origin, colors/typography/spacing/radii as {name,value,note} with the REAL values, sections [{id,title}], principles [plain rules for the agents]). ` +
    'If the library is missing, install and configure it; leave no broken imports. ' +
    'Work as a plan: call mcp__cm2__plan_propose with these tasks: Foundations (tokens), Controls (buttons, forms), Surfaces (cards, navigation), Feedback (alerts, badges, tooltips, dialogs, empty state, tables), Manifest and rules. One commit per task (feat(design): …). ' +
    `When done, tell the user to open the Design System page to see it.`
  if (s.origin === 'existing')
    return (
      common +
      ' ORIGIN: the existing codebase. Photograph it, don\'t replace it: read the CSS variables, theme and components already there, ' +
      'reuse the common components, and where things disagree pick the prevalent version and write the choice in the principles. Ask nothing about taste; plan right away.'
    )
  return (
    common +
    ' ORIGIN: from scratch. BEFORE planning, ask the user with mcp__cm2__ask_user (two answers each, they can also reply freely): ' +
    'first call: character (e.g. Clean and minimal / Warm and friendly), base theme (Dark / Light), color approach (One strong accent / Calm greys), density (Compact / Airy); ' +
    'second call: typography (Geometric sans / Serif titles), shapes (Small radius / Pills), and whether they have references (I\'ll attach them / Your call). ' +
    'Use their answers (and any attached images, read them) to pick an AA-accessible palette, then plan.'
  )
}

/** For every other chat: a short pointer, not the whole design system. */
export function designRule(worktree: string): string {
  const m = readManifest(worktree)
  if (!m) return ''
  return (
    `DESIGN SYSTEM: this project has one (${m.library}; showcase ${m.route}; tokens ${m.tokens_file}; manifest ${DESIGN_MANIFEST}). ` +
    'Before UI work call mcp__cm2__design_read. Never invent colors, fonts, spacing or components: use the tokens and the components from the design system. ' +
    'For a bigger or more complex new component, ask the user with mcp__cm2__ask_user whether to add it to the design system first (add it to the showcase page and the manifest, then use it); small one-offs need no question.'
  )
}

export async function startDesign(
  projectId: string, origin: Setup['origin'], library: string, emit: (e: EngineEvent) => void, send: (o: SendOptions) => void
): Promise<string> {
  const p = await db.project(projectId)
  if (!p) throw new Error('Project not found')
  const lib = detect(p.path).libraries.find((l) => l.id === library)?.label ?? library
  const existing = await db.getSetting<string>(projectKey(projectId))
  let ws = existing ? (await db.workspaces()).find((w) => w.id === existing) : undefined
  if (!ws) {
    const wt = await createWorktree(p.path, 'cm/design-system', { exact: true }).catch(() => createWorktree(p.path, 'design-system'))
    ws = await db.insertWorkspace({ id: randomUUID(), projectId, name: 'Design system', branch: wt.branch, worktreePath: wt.path, status: 'idle', sessionId: null })
    emit({ type: 'workspace', workspace: ws })
    await db.setSetting(projectKey(projectId), ws.id)
  }
  await db.setSetting(wsKey(ws.id), { origin, library: lib } satisfies Setup)
  send({
    ...(await defaultOpts()),
    workspaceId: ws.id,
    text:
      origin === 'existing'
        ? `Build the design system from what's already in the codebase, with ${lib}.`
        : `Create a design system from scratch with ${lib}. Ask me how it should look first.`
  })
  return ws.id
}

export async function editDesign(projectId: string, request: string, send: (o: SendOptions) => void): Promise<string> {
  const id = await db.getSetting<string>(projectKey(projectId))
  const ws = id ? await db.workspace(id) : null
  if (!ws) throw new Error('This project has no design-system branch yet')
  send({ ...(await defaultOpts(ws.id)), workspaceId: ws.id, text: request })
  return ws.id
}

/** The settings the user last sent with (model, effort, access). */
async function defaultOpts(wsId?: string): Promise<Omit<SendOptions, 'workspaceId' | 'text'>> {
  const o = (wsId && (await db.getSetting<any>(`opts:${wsId}`))) || (await db.getSetting<any>('opts:last'))
  return {
    model: o?.model ?? (await listModels(false))[0]?.id ?? 'claude-opus-5-5',
    effort: o?.effort ?? 'medium',
    mode: { kind: 'direct' },
    fullAccess: o?.fullAccess ?? true
  }
}
