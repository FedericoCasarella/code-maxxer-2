import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EngineEvent, Message, SendOptions } from '@shared/types'
import { db, migrate } from './db'
import * as orch from './engine/orchestrator'
import { watchWorkspace } from './engine/files'
import { createWorktree, currentBranch } from './engine/git'
import { getUsage, loadUsage, onUsage, refreshCodexUsage } from './engine/usage'

const here = fileURLToPath(new URL('.', import.meta.url))
const MCP_SCRIPT = join(here, 'cm2-mcp.js')
const COLORS = ['#f97316', '#3b82f6', '#22c55e', '#a855f7', '#ec4899', '#eab308', '#14b8a6', '#ef4444']

// Dev aid: CM2_DEBUG_PORT=9333 exposes the renderer over CDP for automated checks.
if (process.env.CM2_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.CM2_DEBUG_PORT)

let win: BrowserWindow | null = null
const emit = (e: EngineEvent) => win?.webContents.send('engine:event', e)

function createWindow() {
  win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 640,
    show: false,
    backgroundColor: '#111113',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: { preload: join(here, '../preload/index.cjs'), sandbox: false, contextIsolation: true }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(here, '../renderer/index.html'))
}

function handlers() {
  ipcMain.handle('projects:list', () => db.projects())
  ipcMain.handle('projects:add', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: 'Add project (git repository)' })
    if (r.canceled || !r.filePaths[0]) return null
    const path = r.filePaths[0]
    const branch = await currentBranch(path)
    const n = (await db.projects()).length
    const p = await db.insertProject({ id: randomUUID(), name: basename(path), path, color: COLORS[n % COLORS.length] })
    // The repo checkout itself is the first workspace ("local"), like a main checkout.
    if (!(await db.workspaces()).some((w) => w.projectId === p.id && w.worktreePath === path)) {
      const ws = await db.insertWorkspace({
        id: randomUUID(), projectId: p.id, name: 'local', branch, worktreePath: path, status: 'idle', sessionId: null
      })
      emit({ type: 'workspace', workspace: ws })
    }
    return p
  })
  ipcMain.handle('workspaces:list', () => db.workspaces())
  ipcMain.handle('workspaces:create', async (_e, projectId: string, name: string) => {
    const p = await db.project(projectId)
    if (!p) throw new Error('Project not found')
    const wt = await createWorktree(p.path, name)
    const ws = await db.insertWorkspace({
      id: randomUUID(), projectId, name, branch: wt.branch, worktreePath: wt.path, status: 'idle', sessionId: null
    })
    emit({ type: 'workspace', workspace: ws })
    return ws
  })
  ipcMain.handle('pipelines:list', () => db.pipelines())
  ipcMain.handle('pipelines:save', (_e, p) => db.savePipeline(p))
  ipcMain.handle('pipelines:delete', (_e, id: string) => db.deletePipeline(id))
  ipcMain.handle('agents:list', () => db.agents())
  ipcMain.handle('agents:save', (_e, a) => db.saveAgent(a))
  ipcMain.handle('agents:delete', (_e, id: string) => db.deleteAgent(id))
  ipcMain.handle('issues:list', () => db.issues())
  ipcMain.handle('issues:update', (_e, id: string, patch) => db.updateIssue(id, patch))
  ipcMain.handle('messages:list', (_e, id: string) => db.messages(id))
  ipcMain.handle('runs:list', (_e, id: string) => db.runs(id))
  ipcMain.handle('brain:list', (_e, id: string) => db.brain(id))
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
  ipcMain.handle('files:watch', async (_e, id: string) => {
    const ws = await db.workspace(id)
    if (ws) await watchWorkspace(id, ws.worktreePath, (event) => emit({ type: 'files', workspaceId: id, event }))
  })
  ipcMain.handle('usage:get', () => getUsage())
  ipcMain.handle('usage:refresh', () => refreshCodexUsage())
}

app.whenReady().then(async () => {
  try {
    await migrate()
  } catch (e: any) {
    dialog.showErrorBox(
      'Database not reachable',
      `${e.message}\n\nStart it with: npm run db:up (container cm2-postgres on 127.0.0.1:5477)`
    )
    app.quit()
    return
  }
  await loadUsage()
  onUsage((usage) => emit({ type: 'usage', usage }))
  handlers()
  createWindow()
  void refreshCodexUsage()
  setInterval(() => void refreshCodexUsage(), 5 * 60_000)
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
