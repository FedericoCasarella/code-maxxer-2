import { contextBridge, ipcRenderer } from 'electron'
import type { Api, EngineEvent } from '../shared/types'
import type { ReconApi } from '../shared/recon'
import type { ScmApi } from '../shared/scm'
import type { DesignApi } from '../shared/design'
import type { LearningApi } from '../shared/learning'
import type { ReportApi } from '../shared/report'
import type { SkillsApi } from '../shared/skills'
import type { SecurityApi } from '../shared/security'
import type { ExchangeApi } from '../shared/exchange'

const api: Omit<Api, 'recon' | 'scm' | 'design' | 'learning' | 'report' | 'skills' | 'security' | 'exchange' | 'project' | 'preview'> = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  searchProjects: (q, spaceId) => ipcRenderer.invoke('projects:search', q, spaceId),
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
  listRuns: () => ipcRenderer.invoke('runs:all'),
  listModels: (force) => ipcRenderer.invoke('models:list', force),
  mcpInfo: () => ipcRenderer.invoke('mcp:info'),
  rotateMcpToken: () => ipcRenderer.invoke('mcp:rotate'),
  configureMcp: (patch) => ipcRenderer.invoke('mcp:configure', patch),
  providersStatus: () => ipcRenderer.invoke('providers:status'),
  ghStatus: () => ipcRenderer.invoke('gh:status'),
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
  getMessagesPage: (id, o) => ipcRenderer.invoke('messages:page', id, o),
  getMessageIndex: (id) => ipcRenderer.invoke('messages:index', id),
  getPipelineRuns: (id) => ipcRenderer.invoke('runs:list', id),
  send: (opts) => ipcRenderer.invoke('agent:send', opts),
  stop: (id) => ipcRenderer.invoke('agent:stop', id),
  browserReady: (id) => ipcRenderer.invoke('browser:ready', id),
  listQueue: (id) => ipcRenderer.invoke('queue:list', id),
  steer: (id) => ipcRenderer.invoke('queue:steer', id),
  removeQueued: (id) => ipcRenderer.invoke('queue:remove', id),
  editQueued: (id, text) => ipcRenderer.invoke('queue:edit', id, text),
  watchFiles: (id) => ipcRenderer.invoke('files:watch', id),
  listPlans: (id) => ipcRenderer.invoke('plans:list', id),
  startDictation: (locale) => ipcRenderer.invoke('dictate:start', locale),
  stopDictation: (keep) => ipcRenderer.invoke('dictate:stop', keep),
  saveAttachment: (id, name, data) => ipcRenderer.invoke('attachments:save', id, name, data),
  boardTasks: () => ipcRenderer.invoke('plans:board'),
  approvePlan: (id, tasks) => ipcRenderer.invoke('plans:approve', id, tasks),
  cancelPlan: (id) => ipcRenderer.invoke('plans:cancel', id),
  updatePlanTask: (id, patch) => ipcRenderer.invoke('plans:task', id, patch),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  refreshUsage: () => ipcRenderer.invoke('usage:refresh'),
  listBrain: (id) => ipcRenderer.invoke('brain:list', id),
  projectBrain: (id) => ipcRenderer.invoke('brain:project', id),
  saveBrainEntry: (pid, e) => ipcRenderer.invoke('brain:save', pid, e),
  deleteBrainEntry: (id) => ipcRenderer.invoke('brain:delete', id),
  readClaudeMd: (pid) => ipcRenderer.invoke('claudemd:read', pid),
  writeClaudeMd: (pid, text) => ipcRenderer.invoke('claudemd:write', pid, text),
  onEvent: (cb) => {
    const h = (_: unknown, e: EngineEvent) => cb(e)
    ipcRenderer.on('engine:event', h)
    return () => ipcRenderer.removeListener('engine:event', h)
  }
}

const recon = Object.fromEntries(
  ['envs', 'saveEnv', 'testAccess', 'deleteEnv', 'scan', 'overview', 'incidents', 'createIncident', 'updateIncident', 'diagnose',
    'cicd', 'saveCicd', 'setSecret', 'deploy', 'cancelDeploy', 'deploys', 'deployLogs'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`recon:${m}`, ...a)])
) as unknown as ReconApi

const scm = Object.fromEntries(
  ['status', 'log', 'commitFiles', 'read', 'write', 'stage', 'unstage', 'discard', 'commit', 'push', 'pull', 'fetch', 'suggestMessage'].map((m) => [
    m,
    (...a: unknown[]) => ipcRenderer.invoke(`scm:${m}`, ...a)
  ])
) as unknown as ScmApi

const design = Object.fromEntries(
  ['state', 'start', 'edit', 'devStart', 'devState'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`design:${m}`, ...a)])
) as unknown as DesignApi

const learning = Object.fromEntries(
  ['state', 'setEnabled', 'decide', 'setStatus', 'remove'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`learning:${m}`, ...a)])
) as unknown as LearningApi

const report: ReportApi = { project: (id, period) => ipcRenderer.invoke('report:project', id, period) }

const skills = Object.fromEntries(
  ['forChat', 'detach', 'body', 'searchAgents', 'list', 'files', 'read', 'write', 'remove'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`skills:${m}`, ...a)])
) as unknown as SkillsApi

const security = Object.fromEntries(
  ['dashboard', 'scan', 'setStatus', 'setSchedule', 'fix'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`security:${m}`, ...a)])
) as unknown as SecurityApi

const exchange = Object.fromEntries(
  ['get', 'save', 'detect', 'test'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`exchange:${m}`, ...a)])
) as unknown as ExchangeApi

const project = {
  settings: (id: string) => ipcRenderer.invoke('project:settings', id),
  save: (id: string, st: unknown) => ipcRenderer.invoke('project:saveSettings', id, st)
}
const preview = Object.fromEntries(['start', 'stop', 'state'].map((m) => [m, (wsId: string) => ipcRenderer.invoke(`preview:${m}`, wsId)]))
contextBridge.exposeInMainWorld('cm', { ...api, recon, scm, design, learning, report, skills, security, exchange, project, preview })
