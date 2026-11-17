import { useSyncExternalStore } from 'react'
import type {
  Agent, EngineEvent, FileEntry, Message, Pipeline, PipelineRunState, LicenseStatus, ModelInfo, Project, QueueItem, ProjectFolder, ScheduledRun, Space, UsageSnapshot, Workspace
} from '@shared/types'

export type FilesState = {
  root: string
  entries: Map<string, FileEntry>
  active: Set<string>
  /** path → last change timestamp (for the "just edited" glow) */
  touched: Map<string, number>
  version: number
}

export type View = 'chat' | 'issues' | 'pipelines' | 'agents' | 'brain' | 'settings' | 'recon'
export type SettingsSection = 'general' | 'providers' | 'agents' | 'mcp' | 'github' | 'license' | 'about'
/** Tabs of the right drawer; more icons will join. */
export type RightTab = 'files' | 'agents' | 'schedule' | 'browser'

type State = {
  view: View
  agents: Agent[]
  folders: ProjectFolder[]
  spaces: Space[]
  space: string
  scheduled: ScheduledRun[]
  license: LicenseStatus | null
  queues: Record<string, QueueItem[]>
  models: ModelInfo[]
  /** Which slice of each chat is loaded (long chats load in pages). */
  pages: Record<string, { hasOlder: boolean; hasNewer: boolean; loading: boolean }>
  /** Every user prompt per chat, for the index rail. */
  chatIndex: Record<string, { id: string; seq: number; text: string; at: number }[]>
  /** Temporary screenshots of the agent's browser checks, per branch, while it runs. */
  shots: Record<string, { dataUrl: string; caption: string; at: number }[]>
  cursor: { workspaceId: string; x: number; y: number; click: boolean; label: string; at: number } | null
  licenseDialog: boolean
  mcpDialog: boolean
  settingsSection: SettingsSection
  rightTab: RightTab
  /** Bumped to ask the layout to unfold the right drawer. */
  rightOpenTick: number
  projects: Project[]
  workspaces: Workspace[]
  pipelines: Pipeline[]
  selectedProject: string | null
  selectedWs: string | null
  messages: Record<string, Message[]>
  runs: Record<string, PipelineRunState>
  files: Record<string, FilesState>
  usage: UsageSnapshot
}

let state: State = {
  view: 'chat',
  agents: [],
  folders: [],
  spaces: [],
  scheduled: [],
  license: null,
  queues: {},
  models: [],
  pages: {},
  chatIndex: {},
  shots: {},
  cursor: null,
  licenseDialog: false,
  mcpDialog: false,
  settingsSection: 'general',
  rightTab: (() => {
    try {
      return (localStorage.getItem('cm2.rightTab') as RightTab) || 'files'
    } catch {
      return 'files'
    }
  })(),
  rightOpenTick: 0,
  space: (() => {
    try {
      return localStorage.getItem('cm2.space') || 'personal'
    } catch {
      return 'personal'
    }
  })(),
  projects: [],
  workspaces: [],
  pipelines: [],
  selectedProject: null,
  selectedWs: null,
  messages: {},
  runs: {},
  files: {},
  usage: { claude: { windows: [], updatedAt: null }, codex: { windows: [], updatedAt: null } }
}
const loaded = new Set<string>()
const subs = new Set<() => void>()
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch }
  subs.forEach((f) => f())
}
const subscribe = (f: () => void) => (subs.add(f), () => subs.delete(f))

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state))
}
export const getState = () => state

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i < 0) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

function emptyFiles(): FilesState {
  return { root: '', entries: new Map(), active: new Set(), touched: new Map(), version: 0 }
}

function onEvent(e: EngineEvent) {
  switch (e.type) {
    case 'message': {
      const list = state.messages[e.workspaceId] ?? []
      const exists = list.some((m) => m.id === e.message.id)
      // Viewing an older slice: new messages appear when you get back to the bottom.
      if (!exists && state.pages[e.workspaceId]?.hasNewer) break
      const keepSeq = list.find((m) => m.id === e.message.id)?.seq
      set({ messages: { ...state.messages, [e.workspaceId]: upsert(list, keepSeq ? { ...e.message, seq: keepSeq } : e.message) } })
      if (!exists && e.message.role === 'user') {
        const idx = state.chatIndex[e.workspaceId] ?? []
        set({ chatIndex: { ...state.chatIndex, [e.workspaceId]: [...idx, { id: e.message.id, seq: Number.MAX_SAFE_INTEGER, text: e.message.text.slice(0, 140), at: e.message.at }] } })
      }
      break
    }
    case 'pipeline':
      set({ runs: { ...state.runs, [e.state.runId]: e.state } })
      break
    case 'workspace': {
      // Screenshots only live while the run does.
      const shots = e.workspace.status === 'running' ? state.shots : { ...state.shots, [e.workspace.id]: [] }
      set({ workspaces: upsert(state.workspaces, e.workspace), shots })
      break
    }
    case 'browser-open':
      actions.showRight('browser')
      break
    case 'cursor':
      set({ cursor: { workspaceId: e.workspaceId, x: e.x, y: e.y, click: e.click, label: e.label, at: Date.now() } })
      break
    case 'shot':
      set({ shots: { ...state.shots, [e.workspaceId]: [...(state.shots[e.workspaceId] ?? []), { dataUrl: e.dataUrl, caption: e.caption, at: e.at }].slice(-8) } })
      break
    case 'queue':
      set({ queues: { ...state.queues, [e.workspaceId]: e.items } })
      break
    case 'license':
      set({ license: e.status })
      break
    case 'license-dialog':
      set({ licenseDialog: true })
      break
    case 'mcp-dialog':
      set({ view: 'settings' })
      break
    case 'scheduled':
      set({ scheduled: e.runs })
      break
    case 'select':
      void actions.selectWorkspace(e.workspaceId)
      break
    case 'usage':
      set({ usage: e.usage })
      break
    case 'files': {
      const f = state.files[e.workspaceId] ?? emptyFiles()
      const ev = e.event
      if (ev.kind === 'snapshot') {
        f.root = ev.root
        f.entries = new Map(ev.entries.map((x) => [x.path, x]))
      } else if (ev.kind === 'active') {
        if (ev.active) f.active.add(ev.path)
        else f.active.delete(ev.path)
        f.touched.set(ev.path, Date.now())
      } else if (ev.kind === 'unlink') {
        f.entries.delete(ev.path)
      } else {
        f.entries.set(ev.path, { path: ev.path, dir: ev.dir })
        if (!ev.dir) f.touched.set(ev.path, Date.now())
      }
      set({ files: { ...state.files, [e.workspaceId]: { ...f, version: f.version + 1 } } })
      break
    }
  }
}

export const actions = {
  async init() {
    window.cm.onEvent(onEvent)
    const [projects, workspaces, pipelines, usage, agents, folders, spaces] = await Promise.all([
      window.cm.listProjects(), window.cm.listWorkspaces(), window.cm.listPipelines(), window.cm.getUsage(),
      window.cm.listAgents(), window.cm.listFolders(), window.cm.listSpaces()
    ])
    void window.cm.listScheduled().then((scheduled) => set({ scheduled }))
    void window.cm.licenseStatus().then((license) => set({ license }))
    void actions.reloadModels()
    const space = spaces.some((x) => x.id === state.space) ? state.space : spaces[0]?.id ?? 'personal'
    set({ projects, workspaces, pipelines, usage, agents, folders, spaces, space, selectedProject: projects.find((p) => p.spaceId === space)?.id ?? null })
  },
  async reloadModels(force = false) {
    set({ models: await window.cm.listModels(force) })
  },
  openSettings(section?: SettingsSection) {
    set({ view: 'settings', ...(section ? { settingsSection: section } : {}) })
  },
  setSettingsSection(section: SettingsSection) {
    set({ settingsSection: section })
  },
  openMcpDialog(open: boolean) {
    set({ mcpDialog: open })
  },
  openLicenseDialog(open: boolean) {
    set({ licenseDialog: open })
  },
  setLicense(license: LicenseStatus) {
    set({ license })
  },
  showRight(tab: RightTab) {
    try {
      localStorage.setItem('cm2.rightTab', tab)
    } catch { /* ignore */ }
    set({ rightTab: tab, rightOpenTick: state.rightOpenTick + 1 })
  },
  setRightTab(tab: RightTab) {
    try {
      localStorage.setItem('cm2.rightTab', tab)
    } catch { /* ignore */ }
    set({ rightTab: tab })
  },
  /** Switch the top-level workspace: its projects fill the sidebar. */
  switchSpace(id: string) {
    try {
      localStorage.setItem('cm2.space', id)
    } catch { /* ignore */ }
    const first = state.projects.find((p) => p.spaceId === id)
    set({ space: id, selectedWs: null, view: 'chat', selectedProject: first?.id ?? null })
  },
  async saveSpace(sp: Space) {
    await window.cm.saveSpace(sp)
    set({ spaces: await window.cm.listSpaces() })
  },
  async newSpace(name: string) {
    const id = `s_${Math.random().toString(36).slice(2, 8)}`
    const colors = ['#d97757', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#eab308']
    await actions.saveSpace({ id, name, color: colors[state.spaces.length % colors.length], sort: state.spaces.length })
    actions.switchSpace(id)
  },
  async deleteSpace(id: string) {
    await window.cm.deleteSpace(id)
    const spaces = await window.cm.listSpaces()
    set({ spaces })
    if (state.space === id && spaces[0]) actions.switchSpace(spaces[0].id)
  },
  async reloadProjects() {
    const [projects, workspaces, folders] = await Promise.all([window.cm.listProjects(), window.cm.listWorkspaces(), window.cm.listFolders()])
    const selectedWs = workspaces.some((w) => w.id === state.selectedWs) ? state.selectedWs : null
    set({ projects, workspaces, folders, selectedWs })
  },
  async newFolder(name: string) {
    await window.cm.saveFolder({ id: `f_${Math.random().toString(36).slice(2, 8)}`, name, sort: state.folders.length, collapsed: false, spaceId: state.space })
    await actions.reloadProjects()
  },
  async saveFolder(f: ProjectFolder) {
    set({ folders: state.folders.map((x) => (x.id === f.id ? f : x)) })
    await window.cm.saveFolder(f)
  },
  async deleteFolder(id: string) {
    await window.cm.deleteFolder(id)
    await actions.reloadProjects()
  },
  async moveProject(id: string, folderId: string | null) {
    set({ projects: state.projects.map((p) => (p.id === id ? { ...p, folderId } : p)) })
    await window.cm.updateProject(id, { folderId })
  },
  async renameProject(id: string, name: string) {
    set({ projects: state.projects.map((p) => (p.id === id ? { ...p, name } : p)) })
    await window.cm.updateProject(id, { name })
  },
  async removeProject(id: string, mode: 'forget' | 'delete') {
    await window.cm.removeProject(id, mode)
    if (state.selectedProject === id) set({ selectedProject: null })
    await actions.reloadProjects()
  },
  /** ⌘⇧↑/↓: step through workspaces in sidebar order. */
  stepWorkspace(dir: 1 | -1) {
    const order = state.projects.filter((p) => p.spaceId === state.space).flatMap((p) => state.workspaces.filter((w) => w.projectId === p.id))
    if (!order.length) return
    const i = order.findIndex((w) => w.id === state.selectedWs)
    const next = order[(i < 0 ? 0 : i + dir + order.length) % order.length]
    void actions.selectWorkspace(next.id)
  },
  async addProject() {
    try {
      const p = await window.cm.addProject(state.space)
      if (!p) return
      const [projects, workspaces] = await Promise.all([window.cm.listProjects(), window.cm.listWorkspaces()])
      set({ projects, workspaces, selectedProject: p.id })
      const local = workspaces.find((w) => w.projectId === p.id)
      if (local) await actions.selectWorkspace(local.id)
    } catch (e: any) {
      alert(e.message)
    }
  },
  async createWorkspace(projectId: string, name: string) {
    const ws = await window.cm.createWorkspace(projectId, name)
    set({ workspaces: upsert(state.workspaces, ws) })
    await actions.selectWorkspace(ws.id)
    return ws
  },
  selectProject(id: string) {
    set({ selectedProject: id })
  },
  goHome() {
    set({ selectedWs: null, view: 'chat' })
  },
  setView(view: View) {
    set({ view })
  },
  async reloadPipelines() {
    set({ pipelines: await window.cm.listPipelines() })
  },
  async reloadAgents() {
    set({ agents: await window.cm.listAgents() })
  },
  async selectWorkspace(id: string) {
    const ws = state.workspaces.find((w) => w.id === id)
    set({ selectedWs: id, view: 'chat', selectedProject: ws?.projectId ?? state.selectedProject })
    if (!loaded.has(id)) {
      loaded.add(id)
      const [page, runs, index] = await Promise.all([
        window.cm.getMessagesPage(id, { limit: 40 }), window.cm.getPipelineRuns(id), window.cm.getMessageIndex(id)
      ])
      const r = { ...state.runs }
      for (const x of runs) if (!r[x.runId]) r[x.runId] = x
      // Live events that arrived meanwhile win over the stored copy.
      let merged = page.messages
      for (const live of state.messages[id] ?? []) merged = upsert(merged, live)
      set({
        messages: { ...state.messages, [id]: merged }, runs: r,
        pages: { ...state.pages, [id]: { hasOlder: page.hasOlder, hasNewer: false, loading: false } },
        chatIndex: { ...state.chatIndex, [id]: index }
      })
    }
    void window.cm.watchFiles(id)
    void window.cm.listQueue(id).then((items) => set({ queues: { ...state.queues, [id]: items } }))
  },
  /** Scrolled near the top: prepend the previous page. */
  async loadOlder(id: string) {
    const pg = state.pages[id]
    const list = state.messages[id] ?? []
    const first = list.find((m) => m.seq !== undefined)?.seq
    if (!pg?.hasOlder || pg.loading || first === undefined) return
    set({ pages: { ...state.pages, [id]: { ...pg, loading: true } } })
    const page = await window.cm.getMessagesPage(id, { before: first, limit: 40 })
    set({
      messages: { ...state.messages, [id]: [...page.messages, ...(state.messages[id] ?? [])] },
      pages: { ...state.pages, [id]: { ...state.pages[id], hasOlder: page.hasOlder, loading: false } }
    })
  },
  /** Scrolled to the bottom of an older slice: append the next page. */
  async loadNewer(id: string) {
    const pg = state.pages[id]
    const list = state.messages[id] ?? []
    const last = [...list].reverse().find((m) => m.seq !== undefined)?.seq
    if (!pg?.hasNewer || pg.loading || last === undefined) return
    set({ pages: { ...state.pages, [id]: { ...pg, loading: true } } })
    const page = await window.cm.getMessagesPage(id, { after: last, limit: 60 })
    set({
      messages: { ...state.messages, [id]: [...(state.messages[id] ?? []), ...page.messages] },
      pages: { ...state.pages, [id]: { ...state.pages[id], hasNewer: page.hasNewer, loading: false } }
    })
  },
  /** Index click on a prompt that isn't loaded: load the slice around it. */
  async loadAround(id: string, seq: number) {
    const page = await window.cm.getMessagesPage(id, { around: seq, limit: 60 })
    set({
      messages: { ...state.messages, [id]: page.messages },
      pages: { ...state.pages, [id]: { hasOlder: page.hasOlder, hasNewer: page.hasNewer, loading: false } }
    })
  },
  async loadLatest(id: string) {
    const page = await window.cm.getMessagesPage(id, { limit: 40 })
    set({
      messages: { ...state.messages, [id]: page.messages },
      pages: { ...state.pages, [id]: { hasOlder: page.hasOlder, hasNewer: false, loading: false } }
    })
  },
  async refreshUsage() {
    set({ usage: await window.cm.refreshUsage() })
  }
}
