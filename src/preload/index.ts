import { contextBridge, ipcRenderer } from 'electron'
import type { Api, EngineEvent } from '../shared/types'

const api: Api = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  addProject: () => ipcRenderer.invoke('projects:add'),
  listWorkspaces: () => ipcRenderer.invoke('workspaces:list'),
  createWorkspace: (projectId, name) => ipcRenderer.invoke('workspaces:create', projectId, name),
  listPipelines: () => ipcRenderer.invoke('pipelines:list'),
  savePipeline: (p) => ipcRenderer.invoke('pipelines:save', p),
  deletePipeline: (id) => ipcRenderer.invoke('pipelines:delete', id),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  saveAgent: (a) => ipcRenderer.invoke('agents:save', a),
  deleteAgent: (id) => ipcRenderer.invoke('agents:delete', id),
  listIssues: () => ipcRenderer.invoke('issues:list'),
  updateIssue: (id, patch) => ipcRenderer.invoke('issues:update', id, patch),
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
