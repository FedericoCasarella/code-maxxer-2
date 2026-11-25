import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api, EngineEvent } from '../shared/types'
import type { ReconApi } from '../shared/recon'
import type { ScmApi } from '../shared/scm'
import type { DesignApi } from '../shared/design'
import type { LearningApi } from '../shared/learning'
import type { AutomationsApi } from '../shared/automations'
import type { ReportApi } from '../shared/report'
import type { SkillsApi } from '../shared/skills'
import type { SecurityApi } from '../shared/security'
import type { ExchangeApi } from '../shared/exchange'

const api: Omit<Api, 'recon' | 'scm' | 'design' | 'learning' | 'brainAll' | 'automations' | 'report' | 'skills' | 'security' | 'exchange' | 'project' | 'preview' | 'terminal' | 'docs' | 'claudeLogin'> = {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  openLogs: () => ipcRenderer.invoke('logs:open'),
  logError: (where, message) => ipcRenderer.invoke('logs:error', where, message),
  searchProjects: (q, spaceId) => ipcRenderer.invoke('projects:search', q, spaceId),
  addProject: (spaceId) => ipcRenderer.invoke('projects:add', spaceId),
  cloneDefaults: () => ipcRenderer.invoke('projects:cloneDefaults'),
  pickFolder: (from) => ipcRenderer.invoke('projects:pickFolder', from),
  cloneProject: (url, parent, spaceId) => ipcRenderer.invoke('projects:clone', url, parent, spaceId),
  linkProjects: (id, other, on) => ipcRenderer.invoke('projects:link', id, other, on),
  installSkillProposal: (wsId, url) => ipcRenderer.invoke('skills:installProposal', wsId, url),
  acceptAgentProposal: (wsId, proposal) => ipcRenderer.invoke('agents:acceptProposal', wsId, proposal),
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
  quitSeen: () => ipcRenderer.invoke('quit:seen'),
  quitApp: () => ipcRenderer.invoke('quit:confirm'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  snoozeUpdate: () => ipcRenderer.invoke('update:snooze'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),
  recheckLicense: () => ipcRenderer.invoke('license:recheck'),
  deactivateLicense: () => ipcRenderer.invoke('license:deactivate'),
  schedule: (opts, at) => ipcRenderer.invoke('scheduled:add', opts, at),
  updateScheduled: (id, patch) => ipcRenderer.invoke('scheduled:update', id, patch),
  runScheduledNow: (id) => ipcRenderer.invoke('scheduled:now', id),
  openBranch: (projectId, branch) => ipcRenderer.invoke('branches:open', projectId, branch),
  branchAction: (wsId, action, target) => ipcRenderer.invoke('branches:action', wsId, action, target),
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
  assistPipeline: (d, h, m) => ipcRenderer.invoke('pipelines:assist', d, h, m),
  deletePipeline: (id) => ipcRenderer.invoke('pipelines:delete', id),
  decidePipeline: (ws, run, d) => ipcRenderer.invoke('pipelines:decide', ws, run, d),
  decidePush: (id, d) => ipcRenderer.invoke('push:decide', id, d),
  runShots: (runId) => ipcRenderer.invoke('pipelines:shots', runId),
  activeJobs: () => ipcRenderer.invoke('jobs:active'),
  listChanges: () => ipcRenderer.invoke('changes:list'),
  approveChange: (id, merge) => ipcRenderer.invoke('changes:approve', id, merge),
  rejectChange: (id) => ipcRenderer.invoke('changes:reject', id),
  revokePush: (id) => ipcRenderer.invoke('push:revoke', id),
  pushRequests: (ws) => ipcRenderer.invoke('push:list', ws),
  listAgents: () => ipcRenderer.invoke('agents:list'),
  saveAgent: (a) => ipcRenderer.invoke('agents:save', a),
  deleteAgent: (id) => ipcRenderer.invoke('agents:delete', id),
  listIssues: () => ipcRenderer.invoke('issues:list'),
  branchPrs: (ids) => ipcRenderer.invoke('github:branch-prs', ids),
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
  browserReady: (ws, id) => ipcRenderer.invoke('browser:ready', ws, id),
  browserViewport: (ws, preset) => ipcRenderer.invoke('browser:viewport', ws, preset),
  browserRefit: (ws) => ipcRenderer.invoke('browser:refit', ws),
  listQueue: (id) => ipcRenderer.invoke('queue:list', id),
  steer: (id) => ipcRenderer.invoke('queue:steer', id),
  removeQueued: (id) => ipcRenderer.invoke('queue:remove', id),
  editQueued: (id, text) => ipcRenderer.invoke('queue:edit', id, text),
  watchFiles: (id) => ipcRenderer.invoke('files:watch', id),
  imageData: (path) => ipcRenderer.invoke('files:image', path),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  dropFiles: (id, dir, paths) => ipcRenderer.invoke('files:drop', id, dir, paths),
  fileOp: (id, op) => ipcRenderer.invoke('files:op', id, op),
  setting: { get: (k) => ipcRenderer.invoke('setting:get', k), set: (k, v) => ipcRenderer.invoke('setting:set', k, v) },
  repo: { check: (id) => ipcRenderer.invoke('repo:check', id), create: (id, o) => ipcRenderer.invoke('repo:create', id, o) },
  language: { get: () => ipcRenderer.invoke('language:get'), set: (lang) => ipcRenderer.invoke('language:set', lang), ui: (lang) => ipcRenderer.invoke('language:ui', lang), uiGet: () => ipcRenderer.invoke('language:uiGet') },
  listPlans: (id) => ipcRenderer.invoke('plans:list', id),
  startDictation: (locale) => ipcRenderer.invoke('dictate:start', locale),
  stopDictation: (keep) => ipcRenderer.invoke('dictate:stop', keep),
  prewarmDictation: (locale) => ipcRenderer.invoke('dictate:prewarm', locale),
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
  ['envs', 'saveEnv', 'testAccess', 'deleteEnv', 'scan', 'scanAll', 'overview', 'incidents', 'createIncident', 'updateIncident', 'diagnose',
    'cicd', 'saveCicd', 'setSecret', 'deploy', 'cancelDeploy', 'deploys', 'deployLogs', 'deployById'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`recon:${m}`, ...a)])
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

const automations = Object.fromEntries(
  ['list', 'runs', 'save', 'setEnabled', 'remove', 'runNow'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`automations:${m}`, ...a)])
) as unknown as AutomationsApi

const brainAll = Object.fromEntries(
  ['state', 'decideRule', 'setRuleStatus', 'removeRule', 'decideAgent', 'sweep'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`brainAll:${m}`, ...a)])
)
const learning = Object.fromEntries(
  ['state', 'setEnabled', 'decide', 'custom', 'setStatus', 'remove', 'retry', 'undoTweak'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`learning:${m}`, ...a)])
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
  save: (id: string, st: unknown) => ipcRenderer.invoke('project:saveSettings', id, st),
  merged: (id: string) => ipcRenderer.invoke('project:mergedBranches', id)
}
const docs = Object.fromEntries(['state', 'setEnabled', 'page', 'asset', 'write', 'exportMarkdown', 'exportPdf', 'revisions'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`docs:${m}`, ...a)]))
const terminal = Object.fromEntries(['open', 'write', 'resize', 'close'].map((m) => [m, (...a: unknown[]) => ipcRenderer.invoke(`terminal:${m}`, ...a)]))
const preview = Object.fromEntries(['start', 'stop', 'state', 'redetect'].map((m) => [m, (wsId: string) => ipcRenderer.invoke(`preview:${m}`, wsId)]))
const claudeLogin = { start: () => ipcRenderer.invoke('claudeLogin:start'), state: () => ipcRenderer.invoke('claudeLogin:state') }
contextBridge.exposeInMainWorld('cm', { ...api, recon, scm, design, learning, brainAll, automations, report, skills, security, exchange, project, preview, terminal, docs, claudeLogin })
