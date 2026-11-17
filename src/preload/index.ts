import { contextBridge, ipcRenderer } from 'electron'
import type { Api, EngineEvent } from '../shared/types'

const api: Api = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: (spaceId) => ipcRenderer.invoke('projects:add', spaceId),
  listSpaces: () => ipcRenderer.invoke('spaces:list'),
  saveSpace: (sp) => ipcRenderer.invoke('spaces:save', sp),
  deleteSpace: (id) => ipcRenderer.invoke('spaces:delete', id),
  updateProject: (id, patch) => ipcRenderer.invoke('projects:update', id, patch),
  removeProject: (id, mode) => ipcRenderer.invoke('projects:remove', id, mode),
  revealPath: (path) => ipcRenderer.invoke('shell:reveal', path),
  openFile: (path) => ipcRenderer.invoke('shell:open', path),
  listFolders: () => ipcRenderer.invoke('folders:list'),
  saveFolder: (f) => ipcRenderer.invoke('folders:save', f),
  deleteFolder: (id) => ipcRenderer.invoke('folders:delete', id),
  listSessions: (scope) => ipcRenderer.invoke('sessions:list', scope),
  resumeSession: (s, how) => ipcRenderer.invoke('sessions:resume', s, how),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  listBranches: (id) => ipcRenderer.invoke('branches:list', id),
  listScheduled: () => ipcRenderer.invoke('scheduled:list'),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),
  recheckLicense: () => ipcRenderer.invoke('license:recheck'),
  deactivateLicense: () => ipcRenderer.invoke('license:deactivate'),
  schedule: (opts, at) => ipcRenderer.invoke('scheduled:add', opts, at),
  updateScheduled: (id, patch) => ipcRenderer.invoke('scheduled:update', id, patch),
  runScheduledNow: (id) => ipcRenderer.invoke('scheduled:now', id),
  openBranch: (projectId, branch) => ipcRenderer.invoke('branches:open', projectId, branch),
  createWorkspace: (projectId, name) => ipcRenderer.invoke('workspaces:create', projectId, name),
  listPipelines: () => ipcRenderer.invoke('pipelines:list'),
  savePipeline: (p) => ipcRenderer.invoke('pipelines:save', p),
  deletePipeline: (id) => ipcRenderer.invoke('pipelines:delete', id),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  saveAgent: (a) => ipcRenderer.invoke('agents:save', a),
  deleteAgent: (id) => ipcRenderer.invoke('agents:delete', id),
  listIssues: () => ipcRenderer.invoke('issues:list'),
  updateIssue: (id, patch) => ipcRenderer.invoke('issues:update', id, patch),
  githubMirror: (id) => ipcRenderer.invoke('github:mirror', id),
  setGithubMirror: (id, enabled) => ipcRenderer.invoke('github:enable', id, enabled),
  syncGithub: (id) => ipcRenderer.invoke('github:sync', id),
  getMessages: (id) => ipcRenderer.invoke('messages:list', id),
  getPipelineRuns: (id) => ipcRenderer.invoke('runs:list', id),
  send: (opts) => ipcRenderer.invoke('agent:send', opts),
  stop: (id) => ipcRenderer.invoke('agent:stop', id),
  watchFiles: (id) => ipcRenderer.invoke('files:watch', id),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  refreshUsage: () => ipcRenderer.invoke('usage:refresh'),
  listBrain: (id) => ipcRenderer.invoke('brain:list', id),
  onEvent: (cb) => {
    const h = (_: unknown, e: EngineEvent) => cb(e)
    ipcRenderer.on('engine:event', h)
    return () => ipcRenderer.removeListener('engine:event', h)
  }
}

contextBridge.exposeInMainWorld('cm', api)
