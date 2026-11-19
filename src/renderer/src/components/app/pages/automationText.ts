import type { Automation, AutomationDraft, AutomationTemplate, RunStatus, Step, Trigger } from '@shared/automations'
import type { Project, Workspace } from '@shared/types'
import { locale, t } from '@/lib/i18n'
import { timeAgo } from '@/lib/utils'
import { relative } from '../ScheduleDialog'

export { relative }

/** Words for automations, shared by the page and the dialog. Every function translates at call time. */

const pad = (n: number) => String(n).padStart(2, '0')
export const clock = (hour: number, minute: number) => `${hour}:${pad(minute)}`

/** Monday first; values are JS weekdays (0 = Sunday). */
export const WEEK = [1, 2, 3, 4, 5, 6, 0]
export const dayName = (d: number, style: 'short' | 'narrow' = 'short') =>
  // 2023-01-01 was a Sunday
  new Date(2023, 0, 1 + d).toLocaleDateString(locale(), { weekday: style })

export function triggerSummary(tr: Trigger): string {
  const all = !tr.kind.startsWith('s') && (!(tr as any).branches || (tr as any).branches.trim() === '*')
  if (tr.kind === 'push') return all ? t('On push · all branches') : t('On push · {branches}', { branches: tr.branches })
  if (tr.kind === 'commit') return all ? t('On new commits · all branches') : t('On new commits · {branches}', { branches: tr.branches })
  const time = clock(tr.hour, tr.minute)
  if (tr.every === 'hourly') return t('Every hour at :{m}', { m: pad(tr.minute) })
  if (tr.every === 'daily') return t('Daily at {time}', { time })
  if (tr.every === 'weekdays') return t('Weekdays at {time}', { time })
  const days = WEEK.filter((d) => tr.days?.includes(d)).map((d) => dayName(d)).join(', ')
  return days ? t('{days} at {time}', { days, time }) : t('Weekly at {time}', { time })
}

export function repeatsLabel(every: Trigger & { kind: 'schedule' }): string {
  return every.every === 'hourly' ? t('Hourly') : every.every === 'daily' ? t('Daily') : every.every === 'weekdays' ? t('Weekdays') : t('Weekly')
}

/** "in 21h"; an event trigger has no time. */
export function nextRunLabel(a: Automation): string {
  if (a.trigger.kind === 'push') return t('On push')
  if (a.trigger.kind === 'commit') return t('On new commits')
  if (!a.enabled || !a.nextRun) return '—'
  return relative(a.nextRun)
}

export const ago = (at: number) => {
  const s = timeAgo(at)
  return s === 'now' ? t('just now') : t('{t} ago', { t: s })
}

export const absolute = (at: number) =>
  new Date(at).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function duration(from: number, to: number | null): string {
  if (!to) return '—'
  const s = Math.max(0, Math.round((to - from) / 1000))
  if (s < 60) return t('{n}s', { n: s })
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? t('{m}m {s}s', { m, s: s % 60 }) : t('{m}m', { m })
  return t('{h}h {m}m', { h: Math.floor(m / 60), m: m % 60 })
}

export const usd = (n: number) => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 3 : 2 }).format(n)

export function statusLabel(s: RunStatus): string {
  return s === 'running' ? t('Running|run') : s === 'success' ? t('Succeeded') : s === 'failed' ? t('Failed|run') : t('Skipped')
}

export const STATUS_TONE: Record<RunStatus, 'info' | 'success' | 'danger' | 'neutral'> = {
  running: 'info', success: 'success', failed: 'danger', skipped: 'neutral'
}
export const STATUS_DOT: Record<RunStatus, string> = {
  running: 'bg-accent animate-pulse', success: 'bg-ok', failed: 'bg-bad', skipped: 'bg-mute'
}

export function stepKindLabel(k: Step['kind']): string {
  return k === 'prompt' ? t('Prompt') : k === 'pipeline' ? t('Pipeline') : k === 'shell' ? t('Shell command') : t('Comment on PR')
}

export const projectLabel = (p: Project | undefined) => (p ? (p.owner ? `${p.owner}/${p.name}` : p.name) : t('No project'))

export function graceLabel(h: number): string {
  return h === 0 ? t('Off') : h === 1 ? t('1 hour') : t('{n} hours', { n: h })
}

export function timeoutLabel(sec: number): string {
  return sec < 60 ? t('{n}s', { n: sec }) : sec < 3600 ? t('{n} min', { n: Math.round(sec / 60) }) : t('{n}h', { n: Math.round(sec / 3600) })
}

export const DEFAULT_MODEL = 'claude-opus-5-5'

/** A blank automation for the dialog. */
export function blankDraft(projectId: string, workspaces: Workspace[]): AutomationDraft {
  const ws = workspaces.find((w) => w.projectId === projectId)
  return {
    projectId,
    name: '',
    enabled: true,
    trigger: { kind: 'schedule', every: 'daily', hour: 9, minute: 0 },
    steps: [{ kind: 'prompt', text: '', model: DEFAULT_MODEL, effort: 'medium', fullAccess: true }],
    location: ws ? { kind: 'workspace', workspaceId: ws.id } : { kind: 'new' },
    session: 'fresh',
    graceHours: 12,
    precheck: { command: '', timeoutSec: 60 }
  }
}

/** A template as a draft for a project (its names are English keys: translated here). */
export function fromTemplate(tpl: AutomationTemplate, projectId: string, workspaces: Workspace[]): AutomationDraft {
  const ws = workspaces.find((w) => w.projectId === projectId)
  const d = structuredClone(tpl.draft)
  return {
    ...d,
    name: t(tpl.name),
    projectId,
    location: d.location === 'workspace' && ws ? { kind: 'workspace', workspaceId: ws.id } : { kind: 'new' }
  }
}

/** What started a run, in the UI language (the engine stores it in English). */
export function causeLabel(cause: string): string {
  if (cause === 'Run now') return t('Run now')
  const ev = cause.match(/^(Push to|New commits on) (.+) · (\w+)$/)
  if (ev) return ev[1] === 'Push to' ? t('Push to {branch} · {sha}', { branch: ev[2], sha: ev[3] }) : t('New commits on {branch} · {sha}', { branch: ev[2], sha: ev[3] })
  const hourly = cause.match(/^Every hour at :(\d\d)$/)
  if (hourly) return t('Every hour at :{m}', { m: hourly[1] })
  const at = cause.match(/^(Every day|Weekdays) at (.+)$/)
  if (at) return at[1] === 'Every day' ? t('Every day at {time}', { time: at[2] }) : t('Weekdays at {time}', { time: at[2] })
  return t(cause)
}
