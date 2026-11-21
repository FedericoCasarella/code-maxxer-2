import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import type { AgentSession, EngineEvent, Message, SendOptions } from '@shared/types'
import { db, migrate, pool } from './db'
import { startLocalDb, stopLocalDb } from './localdb'
import { checkUpdate, installUpdate, snoozeUpdate, startUpdater, updateStatus } from './updater'
import * as orch from './engine/orchestrator'
import { watchWorkspace } from './engine/files'
import {
  applySnapshot, createWorktree, currentBranch, ensureRepo, headOf, listBranches, remoteInfo, removeWorktree, snapshotChanges, worktreeForBranch
} from './engine/git'
import { copySessionTo } from './engine/sessions'
import { fire, publishScheduled, startScheduler } from './engine/scheduler'
import { enableMirror, mirrorFor, startGithubSync, syncProject } from './engine/github'
import { activate, deactivate, licenseStatus, onLicense, recheck, startLicense } from './license'
import { scanSessions } from './engine/sessions'
import { listModels } from './engine/models'
import { configureMcp, mcpInfo, rotateMcpToken, startExternalMcp } from './engine/externalMcp'
import { opencodeBin } from './engine/models'
import { bin, shellEnv } from './engine/bins'
import { promisify } from 'node:util'
import { refitViewport, registerAppAction, setBrowserGuest, setPreviewViewport, startBrowserBridge } from './engine/browser'
import { registerRecon } from './recon'
import { run } from './recon/ssh'
import * as scm from './engine/scm'
import * as plans from './engine/plans'
import { exchange, onEngineEvent, setPlanApprover, startExchange } from './engine/telegram'
import * as learning from './engine/learning'
import * as loops from './engine/loops'
import { log, openLogs, startLogger, watchWindow } from './logger'
import * as language from './engine/language'
import * as automations from './engine/automations'
import { assistPipeline } from './engine/pipelineAssist'
import { projectReport, REPORT_SCHEMA } from './engine/report'
import * as skillstore from './engine/skillstore'
import * as security from './engine/security'
import { prewarmDictation, shutdownDictation, startDictation, stopDictation } from './engine/dictate'
import { saveAttachment } from './engine/attachments'
import { designState, editDesign, startDesign } from './engine/design'
import { LOGIN_NEEDED } from '@shared/types'
import { loginState, setLoginEmitter, startClaudeLogin } from './engine/claudeAuth'
import { devState, setDevEmitter, startDevServer, stopAllDevServers, stopDevServer, stopOrphanPreviews } from './engine/devserver'
import { formatChanged, getProjectSettings, hookEnv, runArchive, runSetup, saveProjectSettings } from './engine/projectSettings'

const avatarFor = (r: { host: string; owner: string } | null) =>
  r && r.host === 'github.com' ? `https://github.com/${encodeURIComponent(r.owner)}.png?size=64` : null
import { getUsage, loadUsage, onUsage, refreshClaudeUsage, refreshCodexUsage, startUsageRefresh } from './engine/usage'

const here = fileURLToPath(new URL('.', import.meta.url))
const MCP_SCRIPT = join(here, 'cm2-mcp.js')
const COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444']

// package.json's productName ("Code-Maxxer", for the .dmg) would move dev data (license, UI state) to a new
// folder: dev keeps its own, the installed app keeps "Code-Maxxer".
if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'code-maxxer-2'))

// Dev aid: CM2_DEBUG_PORT=9333 exposes the renderer over CDP for automated checks.
if (process.env.CM2_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.CM2_DEBUG_PORT)

let win: BrowserWindow | null = null
const emit = (e: EngineEvent) => {
  win?.webContents.send('engine:event', e)
  onEngineEvent(e) // Exchange: the same events go to Telegram
  // Claude says it is not signed in: open the sign-in in the browser right away.
  if (e.type === 'message' && e.message.role === 'assistant' && e.message.done && e.message.error && LOGIN_NEEDED.test(e.message.error) && !loginAsked.has(e.message.id)) {
    loginAsked.add(e.message.id)
    startClaudeLogin()
  }
  // Formatter: like format on save, on the files the agent changed in its turn.
  if (e.type === 'message' && e.message.role === 'assistant' && e.message.done && !e.message.interrupted && !formatted.has(e.message.id)) {
    formatted.add(e.message.id)
    void (async () => {
      const ws = await db.workspace(e.workspaceId)
      const p = ws && (await db.project(ws.projectId))
      if (ws && p) await formatChanged(p, ws)
    })().catch((err) => console.warn('[formatter]', err))
  }
}
const formatted = new Set<string>()
const loginAsked = new Set<string>()

/** The preview of a branch, with its project's settings. */
async function startPreview(wsId: string) {
  const ws = await db.workspace(wsId)
  const p = ws && (await db.project(ws.projectId))
  if (!ws || !p) throw new Error('Unknown branch')
  const s = await getProjectSettings(p.id)
  return startDevServer(wsId, ws.worktreePath, { ...s.preview, env: hookEnv(p, ws) })
}

/** Native right-click menu: copy selected text (chat, logs) and cut/paste in fields. */
const MENU_LABELS = {
  en: { cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All' },
  it: { cut: 'Taglia', copy: 'Copia', paste: 'Incolla', selectAll: 'Seleziona tutto' }
}
async function showContextMenu(p: Electron.ContextMenuParams) {
  const hasText = p.selectionText.trim().length > 0
  if (!p.isEditable && !hasText) return
  const lang = await win?.webContents.executeJavaScript('document.documentElement.lang').catch(() => 'en')
  const l = MENU_LABELS[lang === 'it' ? 'it' : 'en']
  const items: Electron.MenuItemConstructorOptions[] = p.isEditable
    ? [
        { role: 'cut', label: l.cut, enabled: p.editFlags.canCut },
        { role: 'copy', label: l.copy, enabled: p.editFlags.canCopy },
        { role: 'paste', label: l.paste, enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: l.selectAll }
      ]
    : [{ role: 'copy', label: l.copy }]
  Menu.buildFromTemplate(items).popup({ window: win ?? undefined })
}

let quitConfirmed = false
let quitSeen = false

function createWindow() {
  win = new BrowserWindow({
    icon: ICON(),
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    backgroundColor: '#111113',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: join(here, '../preload/index.cjs'), sandbox: false, contextIsolation: true, webviewTag: true }
  })
  win.once('ready-to-show', () => win?.show())
  // The X (and ⌘Q) ask first. If the window can't answer (it crashed), it closes as before.
  win.on('close', (e) => {
    if (quitConfirmed || !win || win.webContents.isCrashed()) return
    e.preventDefault()
    quitSeen = false
    void Promise.all(orch.runningIds().map((id) => db.workspace(id))).then((ws) => {
      emit({ type: 'confirm-quit', running: ws.map((w) => w?.branch).filter((b): b is string => !!b) })
      setTimeout(() => {
        if (!quitSeen) (quitConfirmed = true), app.quit()
      }, 1500)
    })
  })
  watchWindow(win.webContents)
  // Full screen hides the traffic lights: the renderer drops the space kept for them.
  const fs = () => void win?.webContents.executeJavaScript(`document.documentElement.classList.toggle('fullscreen', ${!!win?.isFullScreen()})`).catch(() => {})
  win.on('enter-full-screen', fs)
  win.on('leave-full-screen', fs)
  win.webContents.on('did-finish-load', fs)
  win.webContents.on('context-menu', (_e, p) => void showContextMenu(p))
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, '../renderer/index.html'))
}

/**
 * Branch fork requested by the agent: new branch from the current state (uncommitted work carried over),
 * new chat inheriting the old one (messages + forked Claude session), then the prompt runs there.
 */
orch.setForkHandler(async (srcId, fork, opts) => {
  const src = await db.workspace(srcId)
  const p = src && (await db.project(src.projectId))
  if (!src || !p) throw new Error('Source branch not found')
  const base = await headOf(src.worktreePath)
  const changes = await snapshotChanges(src.worktreePath)
  const wt = await createWorktree(p.path, fork.name, { exact: true, base })
  await applySnapshot(wt.path, changes).catch(() => { /* conflicts: leave the tree as it is */ })
  const ws = await db.insertWorkspace({
    id: randomUUID(), projectId: p.id, name: fork.name, branch: wt.branch, worktreePath: wt.path, status: 'idle', sessionId: null
  })
  for (const m of await db.messages(src.id)) await db.saveMessage(ws.id, { ...m, id: randomUUID() })
  void runSetup(p, ws)
  emit({ type: 'workspace', workspace: ws })
  emit({ type: 'select', workspaceId: ws.id })
  // Claude keeps sessions per directory: copy it next to the new worktree, then fork it.
  const forkFrom = src.sessionId && (await copySessionTo(src.sessionId, src.worktreePath, wt.path)) ? src.sessionId : undefined
  void orch.send({ ...opts, workspaceId: ws.id, text: fork.prompt, forkFrom }, emit, MCP_SCRIPT).catch(() => {})
  return { workspaceId: ws.id, branch: wt.branch }
})

const IMAGE_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }

/** Native app menu: License lives here, outside the UI. */
function buildMenu() {
  const isMac = process.platform === 'darwin'
  const licenseItems: Electron.MenuItemConstructorOptions[] = [
    { label: 'Activate License…', click: () => emit({ type: 'license-dialog' }) },
    { label: 'Check License Now', click: () => void recheck() },
    { type: 'separator' },
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => emit({ type: 'mcp-dialog' }) }
  ]
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const }, { type: 'separator' as const }, ...licenseItems, { type: 'separator' as const },
            { role: 'hide' as const }, { role: 'hideOthers' as const }, { role: 'unhide' as const }, { type: 'separator' as const }, { role: 'quit' as const }
          ]
        }]
      : []),
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [...(isMac ? [] : licenseItems), { label: 'code-maxxer on GitHub', click: () => void shell.openExternal('https://github.com/FedericoCasarella/code-maxxer-2') }] }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function handlers() {
  ipcMain.handle('projects:list', () => db.projects())
  ipcMain.handle('projects:search', async (_e, q: string, spaceId: string | null) => {
    const like = `%${String(q ?? '').toLowerCase()}%`
    const r = await pool.query(
      `select id from projects where ($2::text is null or space_id = $2)
       and (lower(name) like $1 or lower(coalesce(owner,'')) like $1 or lower(path) like $1)
       order by (lower(name) like $3) desc, sort, created_at limit 30`,
      [like, spaceId, `${String(q ?? '').toLowerCase()}%`]
    )
    const all = await db.projects()
    return r.rows.map((x) => all.find((p) => p.id === x.id)).filter(Boolean)
  })
  ipcMain.handle('projects:add', async (_e, spaceId: string | null) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Add project' })
    if (r.canceled || !r.filePaths[0]) return null
    await ensureRepo(r.filePaths[0])
    return registerProject(r.filePaths[0], spaceId)
  })
  // Clone dialog: where the repo goes. Defaults next to the latest project.
  ipcMain.handle('projects:cloneDefaults', async () => {
    const ps = await db.projects()
    const last = ps[ps.length - 1]
    return { parent: last ? dirname(last.path) : join(app.getPath('home'), 'code') }
  })
  ipcMain.handle('projects:pickFolder', async (_e, from?: string) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'], defaultPath: from, title: 'Clone into' })
    return r.canceled ? null : (r.filePaths[0] ?? null)
  })
  ipcMain.handle('projects:clone', async (_e, url: string, parent: string, spaceId: string | null) => {
    const u = String(url).trim()
    if (!/^(https?:\/\/|git@|ssh:\/\/)\S+$|^[\w.-]+\/[\w.-]+$/.test(u)) throw new Error('Not a repository link')
    const name = u.replace(/\.git$/, '').replace(/\/+$/, '').split(/[/:]/).pop() || 'repo'
    const target = join(parent, name)
    if (existsSync(target)) throw new Error(`${target} already exists`)
    await mkdir(parent, { recursive: true })
    // GitHub links go through gh (private repos with the user's login); anything else through git.
    const gh = /github\.com[/:]|^[\w.-]+\/[\w.-]+$/.test(u)
    const r = gh
      ? await run(bin('gh'), ['repo', 'clone', u, target], { env: shellEnv(), timeoutMs: 600_000 })
      : await run(bin('git'), ['clone', u, target], { env: shellEnv(), timeoutMs: 600_000 })
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || 'Clone failed')
    return registerProject(target, spaceId)
  })
  async function registerProject(path: string, spaceId: string | null) {
    const branch = await currentBranch(path)
    const n = (await db.projects()).length
    // Named after the repo, like Orca; owner avatar from GitHub when the remote is there.
    const remote = await remoteInfo(path)
    const p = await db.insertProject({
      id: randomUUID(), name: remote?.name ?? basename(path), path, color: COLORS[n % COLORS.length],
      owner: remote?.owner ?? null, avatarUrl: avatarFor(remote), spaceId
    })
    // The repo checkout itself is the first workspace ("local"), like a main checkout.
    if (!(await db.workspaces()).some((w) => w.projectId === p.id && w.worktreePath === path)) {
      const ws = await db.insertWorkspace({
        id: randomUUID(), projectId: p.id, name: 'local', branch, worktreePath: path, status: 'idle', sessionId: null
      })
      emit({ type: 'workspace', workspace: ws })
    }
    return p
  }
  ipcMain.handle('projects:update', async (_e, id: string, patch) => {
    // "github": back to the remote owner's avatar
    if (patch.avatarUrl === 'github') {
      const p = await db.project(id)
      patch = { ...patch, avatarUrl: p ? avatarFor(await remoteInfo(p.path).catch(() => null)) : null }
    }
    await db.updateProject(id, patch)
    return db.project(id)
  })
  ipcMain.handle('project:settings', (_e, id: string) => getProjectSettings(id))
  ipcMain.handle('project:saveSettings', (_e, id: string, s) => saveProjectSettings(id, s))
  ipcMain.handle('claudeLogin:start', () => startClaudeLogin())
  ipcMain.handle('claudeLogin:state', () => loginState())
  ipcMain.handle('preview:start', (_e, wsId: string) => startPreview(wsId))
  ipcMain.handle('preview:stop', (_e, wsId: string) => stopDevServer(wsId))
  ipcMain.handle('preview:state', (_e, wsId: string) => devState(wsId))
  ipcMain.handle('projects:remove', async (_e, id: string, mode: 'forget' | 'delete') => {
    const p = await db.project(id)
    if (!p) return
    if (mode === 'delete') {
      // Only what code-maxxer created: its worktrees and cm/ branches. The repository itself is never touched.
      for (const w of (await db.workspaces()).filter((x) => x.projectId === id && x.worktreePath !== p.path)) {
        orch.stop(w.id)
        stopDevServer(w.id)
        await runArchive(p, w).catch(() => {})
        await removeWorktree(p.path, w.worktreePath, w.branch)
      }
    }
    await db.deleteProject(id)
  })
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:open', (_e, path: string) => shell.openPath(path))
  ipcMain.handle('spaces:list', () => db.spaces())
  ipcMain.handle('spaces:save', (_e, sp) => db.saveSpace(sp))
  ipcMain.handle('spaces:delete', (_e, id: string) => db.deleteSpace(id))
  ipcMain.handle('folders:list', () => db.folders())
  ipcMain.handle('folders:save', (_e, f) => db.saveFolder(f))
  ipcMain.handle('folders:delete', (_e, id: string) => db.deleteFolder(id))
  ipcMain.handle('sessions:list', async (_e, scope: { kind: 'workspace' | 'project' | 'space'; id?: string }) => {
    const all = await db.workspaces()
    const inSpace = new Set((await db.projects()).filter((p) => p.spaceId === scope.id).map((p) => p.id))
    const list =
      scope.kind === 'workspace' ? all.filter((w) => w.id === scope.id)
      : scope.kind === 'project' ? all.filter((w) => w.projectId === scope.id)
      : all.filter((w) => inSpace.has(w.projectId))
    return scanSessions(list)
  })
  ipcMain.handle('sessions:resume', async (_e, s: AgentSession, how: 'worktree' | 'terminal') => {
    if (!/^[0-9a-f-]{36}$/i.test(s.id)) throw new Error('Bad session id')
    if (how === 'worktree') {
      // The next prompt in this workspace continues that Claude session.
      emit({ type: 'workspace', workspace: await db.updateWorkspace(s.workspaceId, { sessionId: s.id }) })
      return
    }
    const ws = await db.workspace(s.workspaceId)
    if (!ws) return
    const sh = `cd '${ws.worktreePath.replace(/'/g, `'\\''`)}' && claude --resume ${s.id}`
    const as = `tell application "Terminal" to do script "${sh.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    execFile('osascript', ['-e', as, '-e', 'tell application "Terminal" to activate'])
  })
  ipcMain.handle('workspaces:list', () => db.workspaces())
  registerRecon(ipcMain, emit)
  plans.setPlanEmitter(emit)
  // Lessons imported by the agent (MCP): refresh the Learning panel.
  registerAppAction('learning_changed', async (_ws, a) => (emit({ type: 'learning', projectId: String(a?.projectId ?? '') }), { text: 'ok' }))
  learning.setLearningEmitter(emit)
  loops.setLoopsEmitter(emit)
  // Lessons proposed before the current rules: no repeats, technical ones become the agent's notes.
  setTimeout(() => void learning.tidyAll(), 5000)
  ipcMain.handle('skills:forChat', (_e, wsId: string) => skillstore.chatSkills(pool, wsId))
  ipcMain.handle('skills:detach', async (_e, wsId: string, skillId: string) => {
    await pool.query('delete from workspace_skills where workspace_id=$1 and skill_id=$2', [wsId, skillId])
  })
  ipcMain.handle('skills:body', async (_e, skillId: string) => {
    const r = await pool.query('select * from skills where id=$1', [skillId])
    return r.rows[0] ? skillstore.skillBody(skillstore.skillRow(r.rows[0])) : ''
  })
  const skillDir = async (id: string) => {
    const r = await pool.query('select dir from skills where id=$1', [id])
    if (!r.rows[0]) throw new Error('Skill not found')
    return r.rows[0].dir as string
  }
  ipcMain.handle('skills:list', () => skillstore.allSkills(pool))
  ipcMain.handle('skills:files', async (_e, id: string) => skillstore.skillFiles(await skillDir(id)))
  ipcMain.handle('skills:read', async (_e, id: string, path: string) => skillstore.readSkillFile(await skillDir(id), path))
  ipcMain.handle('skills:write', async (_e, id: string, path: string, text: string) => skillstore.writeSkillFile(pool, id, await skillDir(id), path, text))
  ipcMain.handle('skills:remove', async (_e, id: string) => {
    await skillstore.removeSkill(pool, id)
    emit({ type: 'agents' })
  })
  ipcMain.handle('skills:searchAgents', async (_e, q: string) => {
    const like = `%${String(q ?? '').toLowerCase()}%`
    const r = await pool.query(
      `select id from agents where custom and handle is not null and (lower(handle) like $1 or lower(name) like $1 or lower(description) like $1)
       order by (lower(handle) like $2) desc, created_at desc limit 20`,
      [like, `${String(q ?? '').toLowerCase()}%`]
    )
    const all = await db.agents()
    return r.rows.map((x) => all.find((a) => a.id === x.id)).filter(Boolean)
  })
  ipcMain.handle('report:project', (_e, projectId: string, period: 0 | 7 | 30 | 90) => projectReport(projectId, period))
  ipcMain.handle('learning:state', (_e, projectId: string) => learning.learningState(projectId))
  ipcMain.handle('learning:setEnabled', (_e, projectId: string, on: boolean) => learning.setEnabled(projectId, on))
  ipcMain.handle('learning:decide', (_e, id: string, keep: boolean) => learning.decide(id, keep))
  ipcMain.handle('learning:custom', (_e, id: string, text: string) => learning.custom(id, String(text ?? '')))
  ipcMain.handle('learning:setStatus', (_e, id: string, status: 'active' | 'retired') => learning.setStatus(id, status))
  ipcMain.handle('logs:open', () => openLogs())
  ipcMain.handle('logs:error', (_e, where: string, message: string) => log('error', `window ${where}:`, message))
  ipcMain.handle('learning:remove', (_e, id: string) => learning.remove(id))
  ipcMain.handle('learning:undoTweak', (_e, id: string) => loops.undoTweak(id))
  // Plain on/off app settings the renderer may read and change.
  const OPEN_SETTINGS = new Set(['context:compact', 'model:smallTasks', 'notify:desktop', 'notify:sound'])
  ipcMain.handle('setting:get', (_e, k: string) => (OPEN_SETTINGS.has(k) ? db.getSetting(k) : null))
  ipcMain.handle('setting:set', (_e, k: string, v: unknown) => (OPEN_SETTINGS.has(k) ? db.setSetting(k, v) : undefined))
  ipcMain.handle('language:get', async () => ({ models: await language.modelLanguage(), options: language.LANGUAGES }))
  ipcMain.handle('language:set', (_e, lang: string) => language.setModelLanguage(lang))
  ipcMain.handle('language:ui', (_e, lang: string) => language.setUiLanguage(lang))
  for (const m of ['list', 'runs', 'save', 'setEnabled', 'remove', 'runNow'] as const)
    ipcMain.handle(`automations:${m}`, (_e, ...a: unknown[]) => (automations[m] as (...x: unknown[]) => unknown)(...a))
  registerAppAction('automations_changed', async () => (emit({ type: 'automations' }), { text: 'ok' }))
  // The orchestrator manages automations from chat.
  // Multi-repo work: the chat links another repo (a project of the sidebar, or a repo inside its folder) and works on a twin branch there.
  // Multi-repo work: a chat links another repo (a project of the sidebar, or a repo inside its folder) and works on a twin branch there.
  async function linkProject(wsId: string, x: { project?: string; path?: string }): Promise<{ text: string; error?: boolean }> {
    const lead = await db.workspace(wsId)
    if (!lead) return { text: 'Unknown chat', error: true }
    if (lead.linkedTo) return { text: 'This branch already works for another chat: link from that chat.', error: true }
    const me = await db.project(lead.projectId)
    const all = await db.projects()
    const want = String(x.project ?? '').trim().toLowerCase()
    let target = want ? all.find((p) => p.id === x.project || p.name.toLowerCase() === want) : undefined
    if (!target && x.path) {
      const path = String(x.path).replace(/\/+$/, '')
      target = all.find((p) => p.path.replace(/\/+$/, '') === path)
      if (!target) {
        if (!existsSync(join(path, '.git'))) return { text: `${path} is not a git repository.`, error: true }
        // A repo inside the folder that isn't a project yet: it becomes one, next to this one.
        target = await registerProject(path, me?.spaceId ?? null)
        await db.updateProject(target.id, { folderId: me?.folderId ?? null })
      }
    }
    if (!target) return { text: `No project "${x.project ?? x.path}". See mcp__cm2__projects_list, or pass the repo's path.`, error: true }
    if (target.id === lead.projectId) return { text: 'That is the project this chat already works on.', error: true }
    const twins = await db.linkedWorkspaces(lead.id)
    let twin = twins.find((w) => w.projectId === target!.id)
    if (!twin) {
      const wss = (await db.workspaces()).filter((w) => w.projectId === target!.id)
      if (lead.name === 'local') {
        // The chat works on its main checkout: so does the twin.
        twin = wss.find((w) => w.worktreePath === target!.path)
        if (!twin) {
          twin = await db.insertWorkspace({ id: randomUUID(), projectId: target.id, name: 'local', branch: await currentBranch(target.path), worktreePath: target.path, status: 'idle', sessionId: null })
        }
        twin = await db.linkWorkspace(twin.id, lead.id)
      } else {
        // Same branch name as the chat: its earlier twin if there was one, else a new worktree.
        const earlier = wss.find((w) => w.branch === lead.branch && !w.linkedTo)
        if (earlier) twin = await db.linkWorkspace(earlier.id, lead.id)
        else {
          const free = !(await listBranches(target.path).catch(() => [])).some((b) => b.name === lead.branch)
          const path = free ? (await createWorktree(target.path, lead.branch, { exact: true })).path : await worktreeForBranch(target.path, lead.branch)
          twin = await db.insertWorkspace({ id: randomUUID(), projectId: target.id, name: lead.name, branch: lead.branch, worktreePath: path, status: 'idle', sessionId: null, linkedTo: lead.id })
          void runSetup(target, twin)
        }
      }
    }
    emit({ type: 'workspace', workspace: twin })
    return { text: `Linked ${target.name}: work in ${twin.worktreePath} (branch ${twin.branch}). Commit there separately, in that repo.` }
  }
  registerAppAction('project_link', (wsId, x) => linkProject(wsId, x))
  ipcMain.handle('projects:link', async (_e, id: string, other: string, on: boolean) => {
    await db.linkProjects(id, other, on)
    return db.projects()
  })
  registerAppAction('automation_list', async (wsId) => {
    const ws = await db.workspace(wsId)
    const all = (await automations.list()).filter((a) => a.projectId === ws?.projectId)
    if (!all.length) return { text: 'No automations in this project.' }
    return { text: all.map((a) => `${a.id} · ${a.name} · ${automations.describe(a.trigger)} · ${a.steps.map((s) => s.kind).join(' → ')} · ${a.enabled ? 'active' : 'paused'}${a.lastRun ? ` · last run ${a.lastRun.status}` : ''}`).join('\n') }
  })
  registerAppAction('automation_save', async (wsId, x) => {
    const ws = await db.workspace(wsId)
    if (!ws) return { text: 'Unknown branch', error: true }
    const last = (await db.getSetting<{ model?: string; effort?: string }>(`opts:${wsId}`)) ?? {}
    const steps = (Array.isArray(x.steps) ? x.steps : []).map((s: any) =>
      s.kind === 'prompt' ? { kind: 'prompt', text: String(s.text ?? ''), model: s.model ?? last.model ?? 'claude-opus-5-5', effort: s.effort ?? last.effort ?? 'medium', fullAccess: s.fullAccess ?? true }
      : s.kind === 'pipeline' ? { kind: 'pipeline', pipelineId: String(s.pipelineId ?? ''), text: String(s.text ?? ''), model: s.model ?? last.model ?? 'claude-opus-5-5' }
      : s.kind === 'shell' ? { kind: 'shell', command: String(s.command ?? ''), timeoutSec: Number(s.timeoutSec ?? 600) }
      : { kind: 'pr_comment', text: String(s.text ?? '') }
    )
    if (!steps.length) return { text: 'An automation needs at least one step.', error: true }
    const a = await automations.save({
      projectId: ws.projectId, name: String(x.name ?? 'Automation'), enabled: x.enabled ?? true, trigger: x.trigger, steps,
      location: x.where === 'new_branch' ? { kind: 'new' } : { kind: 'workspace', workspaceId: ws.id },
      session: x.session === 'reuse' ? 'reuse' : 'fresh', graceHours: Number(x.grace_hours ?? 12),
      precheck: { command: String(x.precheck ?? ''), timeoutSec: 60 }
    }, x.id)
    return { text: `Saved "${a.name}" (${a.id}): ${automations.describe(a.trigger)}${a.nextRun ? `, next run ${new Date(a.nextRun).toLocaleString()}` : ''}. It shows in the Automations page.` }
  })
  registerAppAction('automation_run', async (_ws, x) => (await automations.runNow(String(x.id)), { text: 'Started. Its run shows in the Automations page.' }))
  registerAppAction('automation_pause', async (_ws, x) => (await automations.setEnabled(String(x.id), !!x.enabled), { text: x.enabled ? 'Resumed.' : 'Paused.' }))
  ipcMain.handle('learning:retry', (_e, id: string) => void learning.retry(id))
  // Source control: every call names a workspace; git runs in its worktree.
  const scmRoot = async (id: string) => {
    const ws = await db.workspace(id)
    if (!ws) throw new Error('Unknown branch')
    return ws.worktreePath
  }
  for (const [name, fn] of Object.entries(scm)) {
    ipcMain.handle(`scm:${name}`, async (_e, id: string, ...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(await scmRoot(id), ...args))
  }
  // No repository yet: check, and create one (local, optionally on GitHub with gh).
  ipcMain.handle('repo:check', async (_e, id: string) => {
    const root = await scmRoot(id)
    const repo = await scm.isRepo(root)
    const gh = await new Promise<string | null>((ok) =>
      execFile(bin('gh'), ['api', 'user', '--jq', '.login'], { env: shellEnv() }, (err, out) => ok(err ? null : String(out).trim() || null))
    )
    return { isRepo: repo, folder: basename(root), githubUser: gh }
  })
  ipcMain.handle('repo:create', async (_e, id: string, o: { name: string; description: string; visibility: 'private' | 'public'; github: boolean }) => {
    const ws = await db.workspace(id)
    if (!ws) throw new Error('Unknown branch')
    const root = ws.worktreePath
    if (!(await scm.isRepo(root))) await scm.initRepo(root)
    if (!o.github) return { url: null }
    const name = o.name.trim().replace(/\s+/g, '-')
    const args = ['repo', 'create', name, `--${o.visibility}`, '--source', root, '--remote', 'origin', '--push']
    if (o.description.trim()) args.push('--description', o.description.trim())
    const out = await new Promise<string>((ok, fail) =>
      execFile(bin('gh'), args, { cwd: root, env: shellEnv() }, (err, stdout, stderr) =>
        err ? fail(new Error(String(stderr || err.message).trim().split('\n').pop())) : ok(String(stdout) + String(stderr))
      )
    )
    // The project now has an owner on GitHub: its avatar and name follow.
    const remote = await remoteInfo(root).catch(() => null)
    if (remote) await pool.query('update projects set owner=$2, avatar_url=$3 where id=$1', [ws.projectId, remote.owner, avatarFor(remote)])
    return { url: out.match(/https:\/\/github\.com\/\S+/)?.[0] ?? null }
  })
  ipcMain.handle('license:status', () => licenseStatus())
  ipcMain.handle('quit:seen', () => void (quitSeen = true))
  ipcMain.handle('quit:confirm', () => void ((quitConfirmed = true), app.quit()))
  ipcMain.handle('update:status', () => updateStatus())
  ipcMain.handle('update:check', () => checkUpdate())
  ipcMain.handle('update:install', () => installUpdate())
  ipcMain.handle('update:snooze', () => snoozeUpdate())
  ipcMain.handle('license:activate', (_e, key: string) => activate(key))
  ipcMain.handle('license:recheck', () => recheck())
  ipcMain.handle('license:deactivate', () => deactivate())
  ipcMain.handle('scheduled:list', () => publishScheduled(emit))
  ipcMain.handle('scheduled:add', async (_e, opts: SendOptions, at: number) => {
    const { workspaceId, text, ...rest } = opts
    await db.addScheduled({ id: 'sr_' + randomUUID().slice(0, 8), workspaceId, text, at, opts: rest, source: 'user' })
    await publishScheduled(emit)
  })
  ipcMain.handle('scheduled:update', async (_e, id: string, patch: { at?: number; status?: 'cancelled' }) => {
    await db.updateScheduled(id, patch)
    await publishScheduled(emit)
  })
  ipcMain.handle('scheduled:now', (_e, id: string) => fire(id, emit, MCP_SCRIPT))
  ipcMain.handle('branches:list', async (_e, wsId: string) => {
    const ws = await db.workspace(wsId)
    const p = ws && (await db.project(ws.projectId))
    if (!ws || !p) return []
    const chats = (await db.workspaces()).filter((w) => w.projectId === p.id)
    return (await listBranches(p.path)).map((b) => ({
      ...b, workspaceId: chats.find((w) => w.branch === b.name)?.id ?? null, current: b.name === ws.branch
    }))
  })
  ipcMain.handle('branches:open', async (_e, projectId: string, branch: string) => {
    const chats = (await db.workspaces()).filter((w) => w.projectId === projectId)
    const hit = chats.find((w) => w.branch === branch)
    if (hit) return hit
    const p = await db.project(projectId)
    if (!p) throw new Error('Project not found')
    const path = await worktreeForBranch(p.path, branch)
    const ws = await db.insertWorkspace({ id: randomUUID(), projectId, name: branch, branch, worktreePath: path, status: 'idle', sessionId: null })
    emit({ type: 'workspace', workspace: ws })
    return ws
  })
  ipcMain.handle('workspaces:create', (_e, projectId: string, name: string) => newWorkspace(projectId, name))
  ipcMain.handle('pipelines:list', () => db.pipelines())
  ipcMain.handle('runs:all', () => db.allRuns())
  ipcMain.handle('models:list', (_e, force?: boolean) => listModels(force))
  ipcMain.handle('mcp:info', () => ({ ...mcpInfo }))
  ipcMain.handle('mcp:configure', (_e, patch) => configureMcp(patch))
  ipcMain.handle('providers:status', async () => {
    const v = async (cmd: string) => {
      try {
        return (await promisify(execFile)(cmd, ['--version'], { env: shellEnv(), timeout: 8000 })).stdout.trim().split('\n')[0]
      } catch {
        return null
      }
    }
    return [
      { id: 'claude', name: 'Claude Code', path: bin('claude'), version: await v(bin('claude')) },
      { id: 'codex', name: 'Codex', path: bin('codex'), version: await v(bin('codex')) },
      { id: 'opencode', name: 'OpenCode', path: opencodeBin(), version: await v(opencodeBin()) }
    ]
  })
  ipcMain.handle('gh:status', async () => {
    try {
      const r = await promisify(execFile)(bin('gh'), ['auth', 'status'], { env: shellEnv() }).catch((e: any) => ({ stdout: e.stdout ?? '', stderr: e.stderr ?? '' }))
      const out = `${r.stdout}${r.stderr}`
      return { account: out.match(/account (\S+)/)?.[1] ?? null, scopes: out.match(/Token scopes: (.+)/)?.[1]?.replace(/'/g, '') ?? null }
    } catch {
      return { account: null, scopes: null }
    }
  })
  ipcMain.handle('mcp:rotate', async () => {
    await rotateMcpToken()
    return { ...mcpInfo }
  })
  ipcMain.handle('pipelines:save', (_e, p) => db.savePipeline(p))
  ipcMain.handle('pipelines:assist', async (_e, d, h, m) => assistPipeline(d, await db.agents(), h, m))
  ipcMain.handle('pipelines:delete', (_e, id: string) => db.deletePipeline(id))
  ipcMain.handle('agents:list', () => db.agents())
  ipcMain.handle('agents:save', (_e, a) => db.saveAgent(a))
  ipcMain.handle('agents:delete', (_e, id: string) => db.deleteAgent(id))
  // A skill the agent found online (skill_propose), approved on its card: installed and loaded in that chat.
  ipcMain.handle('skills:installProposal', async (_e, wsId: string, url: string) => {
    const sk = await skillstore.storeSkill(pool, await skillstore.fetchSkill(String(url)))
    await skillstore.attach(pool, wsId, sk.id)
    emit({ type: 'skills', workspaceId: wsId })
    return { id: sk.id, name: sk.name }
  })
  // An agent the chat proposed (agent_propose), accepted on its card: saved like agent_save, with the chat's skills.
  ipcMain.handle('agents:acceptProposal', async (_e, wsId: string, a: any) => {
    const handle = skillstore.slugify(String(a.handle || a.name))
    const here = await skillstore.chatSkills(pool, wsId)
    const wanted: string[] = Array.isArray(a.skills) && a.skills.length ? a.skills.map(String) : here.map((x: any) => x.id)
    const ids = (await pool.query('select id from skills where id = any($1) or slug = any($2) or lower(name) = any($3)', [wanted, wanted.map(skillstore.slugify), wanted.map((x) => x.toLowerCase())])).rows.map((x) => x.id)
    const prev = (await pool.query('select id from agents where handle=$1', [handle])).rows[0]
    const id = prev?.id ?? 'ag_' + randomUUID().slice(0, 8)
    await pool.query(
      `insert into agents(id, name, role, description, instructions, built_in, handle, skills, source_workspace_id, custom)
       values($1,$2,'build',$3,$4,false,$5,$6,$7,true)
       on conflict (id) do update set name=excluded.name, description=excluded.description, instructions=excluded.instructions, skills=excluded.skills`,
      [id, String(a.name), String(a.description), String(a.instructions), handle, ids, wsId]
    )
    emit({ type: 'agents' })
    return { id, handle, updated: !!prev }
  })
  ipcMain.handle('issues:list', () => db.issues())
  ipcMain.handle('issues:update', async (_e, id: string, patch) => {
    await db.updateIssue(id, patch)
    // Push the change to GitHub right away when that project is mirrored.
    const pid = (await pool.query('select w.project_id from brain_entries b join workspaces w on w.id=b.workspace_id where b.id=$1', [id])).rows[0]?.project_id
    if (pid && (await mirrorFor(pid)).enabled) void syncProject(pid)
  })
  ipcMain.handle('github:mirror', (_e, projectId: string) => mirrorFor(projectId))
  ipcMain.handle('github:enable', (_e, projectId: string, enabled: boolean) => enableMirror(projectId, enabled))
  ipcMain.handle('github:sync', (_e, projectId: string) => syncProject(projectId))
  ipcMain.handle('messages:list', (_e, id: string) => db.messages(id))
  ipcMain.handle('messages:page', (_e, id: string, o) => db.messagesPage(id, o ?? {}))
  ipcMain.handle('messages:index', (_e, id: string) => db.messageIndex(id))
  ipcMain.handle('runs:list', (_e, id: string) => db.runs(id))
  ipcMain.handle('brain:list', (_e, id: string) => db.brain(id))
  ipcMain.handle('brain:project', (_e, id: string) => db.projectBrain(id))
  ipcMain.handle('brain:save', (_e, pid: string, entry) => db.saveBrainEntry(pid, entry))
  ipcMain.handle('brain:delete', (_e, id: string) => db.deleteBrainEntry(id))
  // CLAUDE.md at the project root: Claude Code reads it at the start of every run.
  ipcMain.handle('claudemd:read', async (_e, pid: string) => {
    const p = await db.project(pid)
    if (!p) throw new Error('Project not found')
    const path = join(p.path, 'CLAUDE.md')
    try {
      return { path, text: await readFile(path, 'utf8'), exists: true }
    } catch {
      return { path, text: '', exists: false }
    }
  })
  ipcMain.handle('claudemd:write', async (_e, pid: string, text: string) => {
    const p = await db.project(pid)
    if (!p) throw new Error('Project not found')
    await writeFile(join(p.path, 'CLAUDE.md'), text, 'utf8')
  })
  ipcMain.handle('agent:send', (_e, opts: SendOptions) => {
    // Fire and forget: progress arrives as engine events.
    orch.send(opts, emit, MCP_SCRIPT).catch((err: Error) => {
      const m: Message = {
        id: randomUUID(), role: 'assistant', blocks: [], at: Date.now(), done: true, error: err.message
      }
      emit({ type: 'message', workspaceId: opts.workspaceId, message: m })
    })
  })
  ipcMain.handle('agent:stop', (_e, id: string) => orch.stop(id))
  ipcMain.handle('browser:ready', (_e, id: number | null) => setBrowserGuest(id))
  ipcMain.handle('browser:viewport', (_e, preset: string | null) => setPreviewViewport(preset))
  ipcMain.handle('browser:refit', () => refitViewport())
  ipcMain.handle('queue:list', (_e, id: string) => orch.listQueue(id))
  ipcMain.handle('queue:steer', (_e, id: string) => orch.steer(id))
  ipcMain.handle('queue:remove', (_e, id: string) => orch.removeQueued(id))
  ipcMain.handle('queue:edit', (_e, id: string, text: string) => orch.editQueued(id, text))
  ipcMain.handle('files:watch', async (_e, id: string) => {
    const ws = await db.workspace(id)
    if (ws) await watchWorkspace(id, ws.worktreePath, (event) => emit({ type: 'files', workspaceId: id, event }))
  })
  // Images the agent read (screenshots, assets): shown inline in the chat.
  ipcMain.handle('files:image', async (_e, path: string) => {
    const mime = IMAGE_MIME[path.toLowerCase().split('.').pop() ?? '']
    if (!mime) return null
    const b = await readFile(path).catch(() => null)
    return b && b.length <= 12 * 1024 * 1024 ? `data:${mime};base64,${b.toString('base64')}` : null
  })
  ipcMain.handle('dictate:start', (_e, locale: string) => startDictation(locale, emit))
  ipcMain.handle('dictate:stop', (_e, keep: boolean) => stopDictation(keep))
  ipcMain.handle('dictate:prewarm', (_e, locale: string) => prewarmDictation(locale))
  ipcMain.handle('attachments:save', (_e, id: string, name: string, data: ArrayBuffer) => saveAttachment(id, name, data))
  setDevEmitter(emit)
  setLoginEmitter(emit)
  const sendNow = (o: SendOptions) => void orch.send(o, emit, MCP_SCRIPT).catch(() => {})
  security.setSecurityWiring(emit, sendNow)
  security.registerSecurityActions(registerAppAction)
  ipcMain.handle('security:dashboard', (_e, pid: string, days: number) => security.dashboard(pid, days))
  ipcMain.handle('security:scan', (_e, pid: string, targets: any[]) => security.scan(pid, targets))
  ipcMain.handle('security:setStatus', (_e, id: string, status: any) => security.setStatus(id, status))
  ipcMain.handle('security:setSchedule', (_e, pid: string, sch: any) => security.setSchedule(pid, sch))
  ipcMain.handle('security:fix', (_e, id: string) => security.fix(id))
  ipcMain.handle('design:state', (_e, projectId: string) => designState(projectId))
  ipcMain.handle('design:start', (_e, projectId: string, origin: 'existing' | 'scratch', library: string) => startDesign(projectId, origin, library, emit, sendNow))
  ipcMain.handle('design:edit', (_e, projectId: string, request: string) => editDesign(projectId, request, sendNow))
  ipcMain.handle('design:devState', (_e, wsId: string) => devState(wsId))
  ipcMain.handle('design:devStart', async (_e, wsId: string) => {
    const ws = await db.workspace(wsId)
    if (!ws) throw new Error('Unknown branch')
    return startPreview(wsId)
  })
  ipcMain.handle('plans:list', (_e, id: string) => plans.listPlans(id))
  ipcMain.handle('plans:board', () => plans.boardTasks())
  ipcMain.handle('plans:cancel', (_e, id: string) => plans.cancel(id))
  ipcMain.handle('plans:task', (_e, id: string, patch: any) => plans.updateTask(id, patch))
  ipcMain.handle('plans:approve', (_e, id: string, tasks?: { id: string; title: string }[]) => approvePlan(id, tasks))
  ipcMain.handle('exchange:get', () => exchange.get())
  ipcMain.handle('exchange:save', (_e, p: any) => exchange.save(p))
  ipcMain.handle('exchange:detect', (_e, token?: string) => exchange.detect(token))
  ipcMain.handle('exchange:test', () => exchange.test())
}

/** Approve a plan, then the agent goes on with the branch's last settings (app and Telegram). */
async function approvePlan(id: string, tasks?: { id: string; title: string }[]) {
    const p = await plans.approve(id, tasks)
    // Same settings the branch last ran with.
    const o = await db.getSetting<Pick<SendOptions, 'model' | 'effort' | 'fullAccess'>>(`opts:${p.workspaceId}`)
    const models = await listModels(false)
    const opts: SendOptions = {
      workspaceId: p.workspaceId,
      text: `Approved the plan "${p.title}". Go ahead.`,
      model: o?.model ?? models[0]?.id ?? 'claude-opus-5-5',
      effort: o?.effort ?? 'medium',
      mode: { kind: 'direct' },
      fullAccess: o?.fullAccess ?? false
    }
    orch.send(opts, emit, MCP_SCRIPT).catch(() => {})
}

function moreHandlers() {
  ipcMain.handle('usage:get', () => getUsage())
  ipcMain.handle('usage:refresh', async () => {
    await Promise.all([refreshCodexUsage(), orch.anyRunning() ? null : refreshClaudeUsage()])
    return getUsage()
  })
}

/** A new branch (worktree) in a project, set up and shown in the sidebar. */
async function newWorkspace(projectId: string, name: string) {
  const p = await db.project(projectId)
  if (!p) throw new Error('Project not found')
  const wt = await createWorktree(p.path, name)
  const ws = await db.insertWorkspace({
    id: randomUUID(), projectId, name, branch: wt.branch, worktreePath: wt.path, status: 'idle', sessionId: null
  })
  void runSetup(p, ws)
  emit({ type: 'workspace', workspace: ws })
  return ws
}

/** The code-maxxer logo: Dock icon on macOS (in dev too), window icon elsewhere. */
const ICON = () => join(app.getAppPath(), 'resources', 'icon', 'icon.png')

app.whenReady().then(async () => {
  startLogger()
  // Previews a previous run left running would hold their ports (and show the wrong app)
  stopOrphanPreviews()
  if (process.platform === 'darwin') app.dock?.setIcon(ICON())
  try {
    await startLocalDb()
    await migrate()
    await pool.query(learning.LEARNING_SCHEMA)
    await pool.query(loops.LOOPS_SCHEMA)
    await pool.query(automations.AUTOMATIONS_SCHEMA)
    await pool.query(REPORT_SCHEMA)
    await pool.query(skillstore.SKILLS_SCHEMA)
    await pool.query(security.SECURITY_SCHEMA)
  } catch (e: any) {
    log('error', 'database', e?.stack ?? e)
    dialog.showErrorBox(
      'Database not reachable',
      app.isPackaged ? `${e.message}\n\nQuit Code-Maxxer and open it again.` : `${e.message}\n\nStart it with: npm run db:up (container cm2-postgres on 127.0.0.1:5477)`
    )
    app.quit()
    return
  }
  // Backfill repo name/owner for projects added before remotes were read.
  for (const p of await db.projects()) {
    if (p.owner) continue
    const r = await remoteInfo(p.path).catch(() => null)
    if (r) await db.insertProject({ ...p, name: r.name, owner: r.owner, avatarUrl: avatarFor(r), spaceId: null })
  }
  await loadUsage()
  onUsage((usage) => emit({ type: 'usage', usage }))
  await startBrowserBridge(emit)
  await startExternalMcp({ emit, script: MCP_SCRIPT }).catch((e) => console.error('[mcp] external server:', e.message))
  startLicense()
  startUpdater((update) => emit({ type: 'update', update }))
  onLicense((status) => emit({ type: 'license', status }))
  buildMenu()
  handlers()
  moreHandlers()
  createWindow()
  setPlanApprover((id) => approvePlan(id))
  // A run ended or the agent asks something: desktop notification and the old code-maxxer sound,
  // while you're not looking at the app (each can be turned off in Settings).
  orch.setAlertHandler(async (a) => {
    if (win?.isFocused()) return
    const ws = await db.workspace(a.workspaceId)
    if (!ws) return
    const p = await db.project(ws.projectId)
    if ((await db.getSetting<boolean>('notify:sound')) !== false) emit({ type: 'notify-sound' })
    if ((await db.getSetting<boolean>('notify:desktop')) === false || !Notification.isSupported()) return
    const where = `${p?.name ?? ''} · ${ws.branch}`
    const it = (await db.getSetting<string>('language:ui')) === 'it'
    const word = a.kind === 'question' ? (it ? 'Domanda' : 'Question') : a.kind === 'error' ? (it ? 'Run interrotta' : 'Run stopped') : it ? 'Run finita' : 'Run finished'
    const title = `${word} · ${where}`
    const n = new Notification({ title, body: a.text || ' ', silent: true })
    n.on('click', () => {
      if (win?.isMinimized()) win.restore()
      win?.show()
      win?.focus()
      emit({ type: 'open-workspace', workspaceId: ws.id })
    })
    n.show()
  })
  void startExchange(emit, MCP_SCRIPT).catch((e) => console.error('[exchange]', e.message))
  startScheduler(emit, MCP_SCRIPT)
  void orch.resumeCutRuns(emit, MCP_SCRIPT).catch((e) => console.warn('[resume]', e.message))
  automations.startAutomations({ emit, mcpScript: MCP_SCRIPT, createWorkspace: newWorkspace })
  security.startSecuritySchedule()
  startGithubSync(() => {})
  startUsageRefresh(() => orch.anyRunning())
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

let dbStopped = false
app.on('will-quit', (e) => {
  stopAllDevServers()
  shutdownDictation()
  // The installed app's own Postgres shuts down cleanly before the app goes
  if (app.isPackaged && !dbStopped) {
    e.preventDefault()
    dbStopped = true
    void pool.end().catch(() => {}).finally(() => void stopLocalDb().finally(() => app.quit()))
  }
})

// Closing the window quits the app (Mac included): nothing keeps running in the Dock.
app.on('window-all-closed', () => app.quit())
