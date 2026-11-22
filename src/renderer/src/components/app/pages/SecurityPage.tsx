import { useEffect, useMemo, useRef, useState } from 'react'
import { ChartTooltip, ACTIVE_BAR } from '../ChartTooltip'
import { ProjectPicker, usePickedProject } from '../ProjectPicker'
import { SwitchCallout } from '../SwitchCallout'
import { usePersisted } from '@/lib/persist'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ArrowDown, ArrowRight, ArrowUp, Ban, Server, CalendarClock, Check, RotateCcw, ShieldCheck, Wrench, ChevronDown, ChartColumn, ChartSpline, Minus, ShieldAlert, ShieldHalf, X,
  CircleCheck,
} from 'lucide-react'
import type { FindingStatus, SecDashboard, SecFinding, SecSchedule, SecSeverity, SecTarget, TargetState } from '@shared/security'
import { actions, useStore } from '@/lib/store'
import { cn, timeAgo } from '@/lib/utils'
import { PageHeader } from '../PageHeader'
import { ProBadge, ProGate } from '../ProGate'
import { SegmentedControl } from '../../affect/segmented-control'
import { ToggleGroup } from '../../affect/toggle-group'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { Button } from '../../affect/button'
import { Popover } from '../../affect/popover'
import { Switch } from '../../affect/switch'
import { TimePicker } from '../../affect/time-picker'
import { Pagination } from '../../affect/pagination'
import { Spinner } from '../../affect/spinner'
import { Skeleton } from '../../affect/shimmer-loader'
import { EmptyState } from '../../affect/empty-state'
import { Select } from '../../affect/select'
import { Accordion } from '../../affect/smart-recommendation'
import { Marquee } from '../Marquee'
import { Badge } from '../../affect/badge'
import { t, t as tr } from '@/lib/i18n'

const TARGET_LABEL: Record<SecTarget, string> = { software: 'Software integrity', production: 'Production', staging: 'Staging' }
const TARGET_SHORT: Record<SecTarget, string> = { software: 'Software', production: 'Production', staging: 'Staging' }
const SEV_LABEL: Record<SecSeverity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' }
const STATUS_LABEL: Record<FindingStatus, string> = { open: 'Open', resolved: 'Resolved', accepted: 'Risk accepted', false_positive: 'False positive' }
const ago = (at: number) => {
  const s = timeAgo(at)
  return s === 'now' ? t('just now') : t('{t} ago', { t: s })
}
const PAGE = 8

type Props = { leftCollapsed: boolean; onExpandLeft: () => void }

/** Cyber Security (Pro): integrity of the software and of production / staging, what was found, and what needs attention. */
export function SecurityPage({ leftCollapsed, onExpandLeft }: Props) {
  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <ShieldHalf size={14} className="text-accent" />
        <span className="font-medium text-ink">Cyber Security</span>
        <ProBadge />
      </PageHeader>
      <ProGate
        feature="Cyber Security"
        description={t('Integrity scores for your code, production and staging, with the issues an agent found and fixes it can apply.')}
        preview={
          <div className="h-full overflow-hidden px-6 pt-5">
            <Dashboard data={demo()} days={30} onDays={() => {}} preview />
          </div>
        }
      >
        {() => <Security />}
      </ProGate>
    </>
  )
}

function Security() {
  const space = useStore((s) => s.space)
  const projects = useStore((s) => s.projects).filter((x) => x.spaceId === space)
  const selected = useStore((s) => s.selectedProject)
  const [pid, setPid] = usePickedProject()
  const [days, setDays] = usePersisted('security.days', 30)
  const [data, setData] = useState<SecDashboard | null>(null)

  useEffect(() => setData(null), [pid, days])
  useEffect(() => {
    if (!pid) return
    let live = true
    const load = () => void window.cm.security.dashboard(pid, days).then((d) => live && setData(d))
    load()
    const off = window.cm.onEvent((e) => e.type === 'security' && e.projectId === pid && load())
    return () => {
      live = false
      off()
    }
  }, [pid, days])

  if (!pid)
    return (
      <div className="grid flex-1 place-items-center">
        <EmptyState title={t('No project')} text={t('Add a project to scan it.')} />
      </div>
    )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1040px] px-6 pb-10 pt-5">
        <div className="mb-3">
          <ProjectPicker value={pid} onChange={(v) => v && setPid(v)} />
        </div>
        {data ? <Dashboard data={data} days={days} onDays={setDays} projectName={projects.find((p) => p.id === pid)?.name} /> : <Loading />}
      </div>
    </div>
  )
}

function Dashboard({ data, days, onDays, projectName, preview }: { data: SecDashboard; days: number; onDays: (d: number) => void; projectName?: string; preview?: boolean }) {
  const [focus, setFocus] = usePersisted<SecTarget | null>(preview ? 'security.focus.preview' : 'security.focus', null)
  const scanning = data.targets.some((t) => t.running)
  const alerts = data.findings.filter((f) => f.status === 'open' && (f.severity === 'critical' || f.severity === 'high') && (!focus || f.target === focus))

  return (
    <div className="space-y-4">
      {!preview && <ServersNotice targets={data.targets} />}
      {/* Tray: header, the three integrity tiles, the chart with its two breakdowns */}
      <section className="rounded-2xl bg-white/[.035] p-1.5">
        <header className="flex flex-wrap items-center gap-3 px-2.5 pb-2.5 pt-1.5">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-ink">{t('Security')}</div>
          </div>
          <SegmentedControl
            size="sm"
            aria-label={t('Period')}
            value={String(days)}
            onChange={(v) => onDays(Number(v))}
            options={[
              { value: '7', label: t('Week') },
              { value: '30', label: t('Month') },
              { value: '90', label: t('Quarter') }
            ]}
          />
          {!preview && <ScheduleButton projectId={data.projectId} schedule={data.schedule} targets={data.targets} />}
          {!preview && <ScanButton projectId={data.projectId} targets={data.targets} scanning={scanning} />}
        </header>

        <div className="grid grid-cols-3 gap-1.5">
          {data.targets.map((t) => (
            <Tile key={t.target} t={t} active={focus === t.target} dim={!!focus && focus !== t.target} onClick={() => setFocus(focus === t.target ? null : t.target)} />
          ))}
        </div>

        <IssuesChart data={data} focus={focus} />
      </section>

      {alerts.length > 0 && (
        <div className="space-y-2.5">
          {alerts.slice(0, 4).map((f) => (
            <Alert key={f.id} f={f} />
          ))}
        </div>
      )}

      <Findings findings={focus ? data.findings.filter((f) => f.target === focus) : data.findings} preview={preview} />
    </div>
  )
}

/** One integrity score: big number out of 100, change since the previous scan, last scan. */
function Tile({ t, active, dim, onClick }: { t: TargetState; active: boolean; dim: boolean; onClick: () => void }) {
  const delta = t.score !== null && t.previous !== null ? t.score - t.previous : null
  const sub = t.running
    ? tr('Scanning…')
    : !t.connected
      ? tr('Not connected')
      : t.lastScan
        ? t.lastScan.status === 'failed'
          ? tr('Last scan failed · {when}', { when: ago(t.lastScan.startedAt) })
          : tr('Scanned {when}', { when: ago(t.lastScan.finishedAt ?? t.lastScan.startedAt) })
        : tr('Not scanned yet')
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-xl border px-4 py-3 text-left transition-colors',
        active ? 'border-line-strong bg-panel' : 'border-line bg-panel/60 hover:bg-panel',
        dim && 'opacity-60'
      )}
    >
      <div className="text-[12.5px] text-dim">{tr(TARGET_LABEL[t.target])}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={cn('text-[28px] font-semibold leading-none tabular-nums', t.score === null ? 'text-mute' : 'text-ink')}>{t.score ?? '—'}</span>
        <span className="text-[13px] text-mute">/100</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11.5px]">
        {delta !== null && (
          <span
            className={cn(
              'flex items-center gap-0.5 rounded-md px-1.5 py-px tabular-nums',
              delta > 0 ? 'bg-ok/10 text-ok' : delta < 0 ? 'bg-bad/10 text-bad' : 'bg-white/[.06] text-mute'
            )}
          >
            {delta > 0 ? <ArrowUp size={11} /> : delta < 0 ? <ArrowDown size={11} /> : <Minus size={11} />}
            {Math.abs(delta)}
          </span>
        )}
        <span className="flex min-w-0 items-center gap-1 text-mute">
          {t.running && <Spinner size={10} />}
          <Marquee className="min-w-0" delay={300}>{sub}</Marquee>
        </span>
      </div>
    </button>
  )
}

const ACCENT = 'var(--color-accent)'
const GRID = 'rgba(255,255,255,0.06)'
const TICK = { fill: 'var(--color-mute)', fontSize: 11 }

/** Issues found per day, with the open ones by category and by target underneath. */
function IssuesChart({ data, focus }: { data: SecDashboard; focus: SecTarget | null }) {
  const [kind, setKind] = usePersisted<'line' | 'bar'>('security.chart', 'line')
  const series = data.days
  const total = series.reduce((a, d) => a + d.total, 0)
  const byTarget = focus ? data.byTarget.filter((x) => x.name === TARGET_SHORT[focus]) : data.byTarget
  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 px-4 pb-1 pt-3">
        <span className="flex items-center gap-1.5 text-[12.5px] text-ink">
          <span className="h-0.5 w-3 rounded bg-accent" /> {t('Issues found')}
        </span>
        <span className="text-[12px] tabular-nums text-mute">{t('{n} in this period', { n: total })}</span>
        <span className="flex-1" />
        <ToggleGroup
          type="single"
          size="sm"
          variant="tray"
          value={kind}
          onChange={(v) => v && setKind(v as 'line' | 'bar')}
          items={[
            { value: 'line', icon: <ChartSpline size={14} />, ariaLabel: t('Line chart') },
            { value: 'bar', icon: <ChartColumn size={14} />, ariaLabel: t('Bar chart') }
          ]}
        />
      </div>
      <div className="h-[220px] px-2 pb-2">
        <ResponsiveContainer key={kind} width="100%" height="100%">
          {kind === 'line' ? (
            <AreaChart data={series} margin={{ top: 12, right: 14, bottom: 0, left: -14 }}>
              <defs>
                <linearGradient id="sec-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ACCENT} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 4" />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              <Tooltip cursor={false} content={<DayTip />} />
              <Area
                type="monotone" dataKey="total" stroke={ACCENT} strokeWidth={2} fill="url(#sec-fill)" animationDuration={700} animationEasing="ease-out"
                dot={{ r: 3, fill: 'var(--color-panel)', stroke: ACCENT, strokeWidth: 1.5 }} activeDot={{ r: 4 }}
              />
            </AreaChart>
          ) : (
            <BarChart data={series} margin={{ top: 12, right: 14, bottom: 0, left: -14 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="3 4" />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
              <Tooltip cursor={false} content={<DayTip />} />
              <Bar dataKey="total" fill={ACCENT} activeBar={ACTIVE_BAR} radius={[3, 3, 0, 0]} animationDuration={600} animationEasing="ease-out" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 border-t border-line">
        <Breakdown title={t('By category')} rows={data.byCategory} />
        <Breakdown title={t('By target')} rows={byTarget} className="border-l border-line" />
      </div>
    </div>
  )
}

function DayTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const rows = (['critical', 'high', 'medium', 'low'] as const).filter((k) => d[k] > 0)
  return <ChartTooltip title={label} rows={[{ label: t('Issues found'), value: d.total }, ...rows.map((k) => ({ label: t(SEV_LABEL[k]), value: d[k] }))]} />
}

/** A short ranked list: the bar behind each row is its share. */
function Breakdown({ title, rows, className }: { title: string; rows: { name: string; count: number }[]; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className={cn('px-3 pb-3 pt-3', className)}>
      <div className="flex items-center px-1 pb-2 text-[12.5px]">
        <span className="font-medium text-ink">{title}</span>
        <span className="ml-auto text-mute">{t('Open issues')}</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-1 py-2 text-[12px] text-mute">{t('Nothing open.')}</div>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.name} className="sec-bar-row relative flex h-8 items-center px-2 text-[12.5px]">
              <span className="cm-grow absolute inset-y-0 left-0 rounded-md bg-accent/[.09] transition-[width] duration-500" style={{ width: `${(r.count / max) * 100}%` }} />
              <Marquee className="relative min-w-0 flex-1 text-ink/90" delay={300} hoverTarget=".sec-bar-row">{r.name}</Marquee>
              <span className="relative tabular-nums text-ink">{r.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** A serious open issue: title, where it is, the severity up top; the description inside. */
function Alert({ f }: { f: SecFinding }) {
  return (
    <section className="cm-in rounded-2xl bg-white/[.035] p-1">
      <header className="flex items-center gap-2 px-2.5 pb-1.5 pt-1">
        <ShieldAlert size={14} className={SEV_TEXT[f.severity]} />
        <span className="shrink-0 text-[13px] font-semibold text-ink">{f.title}</span>
        <Marquee className="min-w-0 flex-1 text-[12.5px] text-mute" delay={300}>
          {t(TARGET_SHORT[f.target])}
          {f.location ? ` · ${f.location}` : ''}
        </Marquee>
        <SeverityPill s={f.severity} />
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] rounded-xl border border-line bg-panel text-[12.5px]">
        <div className="px-3.5 py-2.5">
          <div className="text-[11.5px] text-mute">{t('Description')}</div>
          <div className="mt-0.5 leading-[1.5] text-ink/90">{f.detail || f.title}</div>
        </div>
        <div className="border-l border-line px-3.5 py-2.5">
          <div className="text-[11.5px] text-mute">{t('Category')}</div>
          <div className="mt-0.5 whitespace-nowrap text-ink/90">{f.category}</div>
        </div>
        <div className="border-l border-line px-3.5 py-2.5">
          <div className="text-[11.5px] text-mute">{t('Found')}</div>
          <div className="mt-0.5 whitespace-nowrap text-ink/90">{ago(f.firstSeen)}</div>
        </div>
      </div>
    </section>
  )
}

/** Severity as an affectUI badge: low green, medium yellow, high and critical red (critical pulses). */
// Icons and dots take the same color as the severity badge on their row
const SEV_TEXT: Record<SecSeverity, string> = { critical: 'text-bad', high: 'text-bad', medium: 'text-warn', low: 'text-ok', info: 'text-mute' }
const SEV_BG: Record<SecSeverity, string> = { critical: 'bg-bad', high: 'bg-bad', medium: 'bg-warn', low: 'bg-ok', info: 'bg-white/25' }
const SEV_TONE: Record<SecSeverity, 'success' | 'warning' | 'danger' | 'neutral'> = { low: 'success', medium: 'warning', high: 'danger', critical: 'danger', info: 'neutral' }
function SeverityPill({ s }: { s: SecSeverity }) {
  return (
    <Badge tone={SEV_TONE[s]} dot live={s === 'critical'} className="shrink-0">
      {t(SEV_LABEL[s])}
    </Badge>
  )
}

/** Everything the scans found, paginated: open first; each row opens to the detail and what to do. */
function Findings({ findings, preview }: { findings: SecFinding[]; preview?: boolean }) {
  const [show, setShow] = usePersisted<'open' | 'all'>('security.show', 'open')
  const [page, setPage] = useState(1)
  const [openId, setOpenId] = useState<string | null>(null)
  const list = show === 'open' ? findings.filter((f) => f.status === 'open') : findings
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  useEffect(() => setPage(1), [show, findings.length])
  const rows = list.slice((Math.min(page, pages) - 1) * PAGE, Math.min(page, pages) * PAGE)

  return (
    <section className="rounded-2xl bg-white/[.035] p-1">
      <header className="flex items-center gap-2 px-2.5 pb-1.5 pt-1">
        <span className="text-[12.5px] font-medium text-dim">{t('Analysis')}</span>
        <span className="text-[12px] tabular-nums text-mute">{list.length}</span>
        <span className="flex-1" />
        <SegmentedControl
          size="sm"
          aria-label={t('Show')}
          value={show}
          onChange={(v) => setShow(v as 'open' | 'all')}
          options={[
            { value: 'open', label: t('Open|findings') },
            { value: 'all', label: t('All') }
          ]}
        />
      </header>
      {list.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel px-4 py-8">
          <EmptyState bare title={show === 'open' ? t('Nothing open') : t('No scans yet')} text={show === 'open' ? t('No issue needs attention right now.') : t('Run a scan to see what it finds.')} />
        </div>
      ) : (
        <div className="space-y-0.5">
          {rows.map((f, i) => (
            <div key={`${page}:${show}:${f.id}`} className="cm-row-in" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
              <FindingRow f={f} open={openId === f.id} onToggle={() => setOpenId(openId === f.id ? null : f.id)} preview={preview} />
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="flex justify-end px-1.5 pb-1 pt-2">
          <Pagination page={Math.min(page, pages)} onPageChange={setPage} pageCount={pages} compact />
        </div>
      )}
    </section>
  )
}

function StatusIcon({ f }: { f: SecFinding }) {
  if (f.status === 'resolved') return <Check size={14} className="text-mute" />
  if (f.status === 'accepted') return <Minus size={14} className="text-mute" />
  if (f.status === 'false_positive') return <X size={14} className="text-mute" />
  return <span className={cn('size-2 rounded-full', SEV_BG[f.severity])} />
}

function FindingRow({ f, open, onToggle, preview }: { f: SecFinding; open: boolean; onToggle: () => void; preview?: boolean }) {
  const set = (s: FindingStatus) => void window.cm.security.setStatus(f.id, s)
  return (
    <Accordion
      stacked
      className={cn('transition-opacity', f.status !== 'open' && !open && 'opacity-55 hover:opacity-80')}
      open={open}
      onOpenChange={onToggle}
      icon={
        <span className="grid w-4 shrink-0 place-items-center">
          <StatusIcon f={f} />
        </span>
      }
      title={
        <Marquee className={cn('text-[13.5px]', f.status === 'open' ? 'text-ink' : 'text-dim')} delay={300}>
          {f.title}
        </Marquee>
      }
      meta={
        <span className="flex items-center gap-2 whitespace-nowrap">
          <span>{t(TARGET_SHORT[f.target])}</span>
          {f.status === 'open' ? <SeverityPill s={f.severity} /> : <span className="text-dim">{t(STATUS_LABEL[f.status])}</span>}
          <span>· {ago(f.status === 'open' ? f.lastSeen : f.resolvedAt ?? f.lastSeen)}</span>
        </span>
      }
    >
        <div className="px-1.5 pb-2 pt-0.5 text-[12.5px]">
          {f.detail && <p className="leading-[1.55] text-dim">{f.detail}</p>}
          <div className="mt-3 overflow-hidden rounded-lg border border-line">
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] divide-x divide-line">
              <Field label={t('Where')}>
                <Where f={f} />
              </Field>
              <Field label={t('Category')}>{f.category}</Field>
              <Field label={t('Seen')}>
                {t('first {first} · last {last}', { first: ago(f.firstSeen), last: ago(f.lastSeen) })}
              </Field>
            </div>
            <div className="border-t border-line">
              <Field label={t('How to fix')}>
                <span className="selectable">{f.remediation || '—'}</span>
              </Field>
            </div>
          </div>
          {!preview && (
            <div className="mt-3 flex flex-wrap justify-end gap-1.5">
              {f.status === 'open' ? (
                <>
                  <Button size="sm" variant="ghost" iconRight={<Ban size={13} />} onClick={() => set('false_positive')}>
                    {t('False positive')}
                  </Button>
                  <Button size="sm" variant="ghost" iconRight={<ShieldCheck size={13} />} onClick={() => set('accepted')}>
                    {t('Accept risk')}
                  </Button>
                  <Button size="sm" variant="secondary" iconRight={<Check size={13} />} onClick={() => set('resolved')}>
                    {t('Mark resolved')}
                  </Button>
                  <Button size="sm" iconRight={<Wrench size={13} />} onClick={() => void window.cm.security.fix(f.id).then((ws) => actions.selectWorkspace(ws))}>
                    {t('Fix in chat')}
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="secondary" iconRight={<RotateCcw size={13} />} onClick={() => set('open')}>
                  {t('Reopen')}
                </Button>
              )}
            </div>
          )}
        </div>
    </Accordion>
  )
}

/** Production or staging without a connected server: what that means, and where to fix it. */
function ServersNotice({ targets }: { targets: TargetState[] }) {
  const missing = targets.filter((x) => x.target !== 'software' && !x.connected).map((x) => TARGET_SHORT[x.target].toLowerCase())
  if (!missing.length) return null
  const many = missing.length === 2
  const which = many ? t('production and staging') : t(missing[0])
  return (
    <div role="status" className="cm-in flex items-center gap-4 rounded-xl border border-warn/25 bg-warn/[.06] px-4 py-3.5">
      <Server size={18} className="shrink-0 text-warn" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[13.5px] font-semibold text-ink">{many ? t('Connect your {which} servers', { which }) : t('Connect your {which} server', { which })}</div>
        <p className="text-[12.5px] leading-[1.5] text-dim">
          {many
            ? t('Right now only the code is checked. Add the {which} servers in Recon (SSH access), then you can scan them from here.', { which })
            : t('Right now only the code is checked. Add the {which} server in Recon (SSH access), then you can scan it from here.', { which })}
        </p>
      </div>
      <Button size="sm" variant="secondary" iconRight={<ArrowRight size={13} />} onClick={() => actions.openReconEnvironments()}>
        {t('Connect in Recon')}
      </Button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="text-[11.5px] text-mute">{label}</div>
      <div className="mt-0.5 leading-[1.5] text-ink/90">{children}</div>
    </div>
  )
}

/** "file:line" of a software finding opens the file in the editor and shows it in the Files tree. */
function Where({ f }: { f: SecFinding }) {
  const ws = useStore((s) => {
    const p = s.projects.find((x) => x.id === f.projectId)
    return s.workspaces.find((w) => w.projectId === f.projectId && w.worktreePath === p?.path) ?? s.workspaces.find((w) => w.projectId === f.projectId)
  })
  const path = f.location.replace(/:\d+(?:[-:]\d+)*$/, '').split(',')[0].trim()
  if (!f.location) return <>—</>
  if (f.target !== 'software' || !ws || !path || /\s/.test(path))
    return <span className="selectable break-words font-mono text-[12px]">{f.location}</span>
  return (
    <button
      onClick={async () => {
        await actions.selectWorkspace(ws.id)
        actions.openEditor(ws.id, { kind: 'file', path })
        actions.showRight('files')
      }}
      title={t('Open the file')}
      className="break-all text-left font-mono text-[12px] text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    >
      {f.location}
    </button>
  )
}

function ScanButton({ projectId, targets, scanning }: { projectId: string; targets: TargetState[]; scanning: boolean }) {
  const ready = targets.filter((x) => x.connected && !x.running).map((x) => x.target)
  const go = (list: SecTarget[]) => void window.cm.security.scan(projectId, list)
  return (
    <DropdownMenu
      align="end"
      width={220}
      items={[
        { label: t('Everything'), description: t('Software and the connected servers'), disabled: !ready.length, onSelect: () => go(ready) },
        ...targets.map((x, i) => ({
          divider: i === 0,
          label: t(TARGET_SHORT[x.target]),
          description: x.connected ? undefined : t('Connect it in Recon first'),
          disabled: !x.connected || x.running,
          onSelect: () => go([x.target])
        }))
      ]}
      trigger={({ triggerProps }) => (
        // Primary, without its outer 1px ring: same footprint as the Schedule button next to it.
        <Button {...triggerProps} size="sm" loading={scanning} iconRight={<ChevronDown size={13} />} style={{ boxShadow: '0 1px 2px rgba(0,0,0,.4)' }}>
          {scanning ? t('Scanning') : t('Scan now')}
        </Button>
      )}
    />
  )
}

const DAYS: { value: string; label: string; day: number }[] = [
  { value: '1', label: 'Mon', day: 1 },
  { value: '2', label: 'Tue', day: 2 },
  { value: '3', label: 'Wed', day: 3 },
  { value: '4', label: 'Thu', day: 4 },
  { value: '5', label: 'Fri', day: 5 },
  { value: '6', label: 'Sat', day: 6 },
  { value: '0', label: 'Sun', day: 0 }
]

/** Repeat scans: which weekdays, at what time, on what. */
function ScheduleButton({ projectId, schedule, targets }: { projectId: string; schedule: SecSchedule; targets: TargetState[] }) {
  const anchor = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [s, setS] = useState(schedule)
  useEffect(() => setS(schedule), [schedule])
  const save = (next: SecSchedule) => {
    setS(next)
    void window.cm.security.setSchedule(projectId, next)
  }
  const summary = useMemo(() => {
    if (!s.enabled) return t('Schedule')
    const d = DAYS.filter((x) => s.days.includes(x.day)).map((x) => t(x.label))
    return `${d.length === 7 ? t('Daily') : d.length === 5 && !s.days.includes(0) && !s.days.includes(6) ? t('Weekdays') : d.join(', ')} · ${s.time}`
  }, [s])
  return (
    <div ref={anchor}>
      <Button size="sm" variant="secondary" iconRight={<CalendarClock size={13} />} onClick={() => setOpen(!open)} style={{ borderColor: 'rgba(255,255,255,.16)' }}>
        {summary}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side="bottom" align="end" width={392} title={t('Scheduled scans')}>
        <div className="space-y-3.5">
          <SwitchCallout title={t('Repeat scans')} description={t('While the app is open')} checked={s.enabled} onChange={(on) => save({ ...s, enabled: on })} />
          <div className={cn('space-y-3.5', !s.enabled && 'pointer-events-none opacity-50')}>
            <div>
              <div className="pb-1.5 text-[12px] text-dim">{t('On')}</div>
              <ToggleGroup
                type="multiple"
                size="sm"
                value={s.days.map(String)}
                onChange={(v) => save({ ...s, days: v.map(Number) })}
                items={DAYS.map((d) => ({ value: d.value, label: t(d.label) }))}
              />
            </div>
            <div>
              <div className="pb-1.5 text-[12px] text-dim">{t('At')}</div>
              <TimePicker value={s.time} onChange={(v) => v && save({ ...s, time: v })} step={30} hourCycle={24} />
            </div>
            <div>
              <div className="pb-1.5 text-[12px] text-dim">{t('Scan')}</div>
              <ToggleGroup
                type="multiple"
                value={s.targets}
                onChange={(v) => save({ ...s, targets: v as SecTarget[] })}
                items={targets.map((x) => ({
                  value: x.target,
                  label: t(TARGET_SHORT[x.target]),
                  icon: s.targets.includes(x.target) ? <CircleCheck className="text-ok" /> : undefined,
                  disabled: !x.connected
                }))}
              />
            </div>
          </div>
        </div>
      </Popover>
    </div>
  )
}

function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label={t('Loading')}>
      <Skeleton width="100%" height={430} radius={16} />
      <Skeleton width="100%" height={110} radius={16} />
      <Skeleton width="100%" height={260} radius={16} />
    </div>
  )
}

/** What the page looks like with data, behind the Pro gate. */
function demo(): SecDashboard {
  const now = Date.now()
  const days = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now - (29 - i) * 86_400_000)
    const total = Math.max(0, Math.round(3 + Math.sin(i / 3) * 2 + (i % 7 === 0 ? 3 : 0)))
    return { day: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), total, critical: i % 9 === 0 ? 1 : 0, high: 1, medium: Math.max(0, total - 2), low: 0 }
  })
  const f = (id: string, target: SecTarget, severity: SecSeverity, title: string, detail: string, category: string): SecFinding => ({
    id, projectId: 'demo', target, severity, category, title, detail, location: 'src/api/users.ts:42', remediation: '', status: 'open', firstSeen: now - 3_600_000, lastSeen: now, resolvedAt: null, scanId: null
  })
  return {
    projectId: 'demo',
    targets: [
      { target: 'software', score: 82, previous: 74, connected: true, lastScan: null, running: false, open: 4 },
      { target: 'production', score: 91, previous: 91, connected: true, lastScan: null, running: false, open: 1 },
      { target: 'staging', score: 67, previous: 72, connected: true, lastScan: null, running: false, open: 3 }
    ],
    days,
    byCategory: [{ name: 'Injection', count: 3 }, { name: 'Config', count: 2 }, { name: 'Secrets', count: 1 }],
    byTarget: [{ name: 'Software', count: 4 }, { name: 'Staging', count: 3 }, { name: 'Production', count: 1 }],
    findings: [
      f('a', 'software', 'critical', 'SQL built from user input', 'The search endpoint concatenates the query string into SQL, so anyone can read the users table.', 'Injection'),
      f('b', 'staging', 'high', 'SSH accepts passwords', 'PasswordAuthentication is on and root can log in: brute force is one dictionary away.', 'Config'),
      f('c', 'software', 'medium', 'CORS allows any origin', 'Access-Control-Allow-Origin is * with credentials.', 'Config')
    ],
    schedule: { enabled: false, days: [1, 2, 3, 4, 5], time: '03:00', targets: ['software'] }
  }
}
