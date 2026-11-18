import { useEffect, useMemo, useState } from 'react'
import { usePersisted } from '@/lib/persist'
import { ChartTooltip, ACTIVE_BAR } from './ChartTooltip'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChevronDown } from 'lucide-react'
import { HUMAN_MINUTES, type ProjectReport, type ReportPeriod } from '@shared/report'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '../affect/segmented-control'
import { Skeleton } from '../affect/shimmer-loader'
import { EmptyState } from '../affect/empty-state'
import { Marquee } from './Marquee'

/** Calm palette: the accent for the main agent, greys for the others. */
const SHADES = ['var(--color-accent)', '#d4d4d8', '#9a9aa1', '#6f6f76', '#55555b', '#3f3f45', '#b8b8bf']
const GRID = 'rgba(255,255,255,0.06)'
const TICK = { fill: 'var(--color-mute)', fontSize: 10 }

export const fmtMin = (m: number) => {
  const r = Math.round(m)
  if (r < 60) return `${r}m`
  const h = Math.floor(r / 60)
  return r % 60 ? `${h}h ${r % 60}m` : `${h}h`
}
const n = (v: number) => v.toLocaleString()

/** Right drawer: the project's report. How long the agents worked, who did what, how long it would have taken you. */
export function ReportPanel({ workspaceId }: { workspaceId: string | null }) {
  const projectId = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.projectId ?? s.selectedProject)
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  // Recompute when a run in the project ends.
  const runKey = useStore((s) => s.workspaces.filter((w) => w.projectId === projectId).map((w) => w.status).join())
  const [period, setPeriod] = usePersisted<ReportPeriod>('report.period', 30)
  const [report, setReport] = useState<ProjectReport | null>(null)

  useEffect(() => {
    if (!projectId) return
    let live = true
    void window.cm.report.project(projectId, period).then((r) => live && setReport(r))
    return () => {
      live = false
    }
  }, [projectId, period, runKey])
  // A different project or period: show the skeleton, not the old numbers.
  useEffect(() => setReport(null), [projectId, period])

  if (!projectId)
    return (
      <div className="grid h-full min-h-0 flex-1 place-items-center px-4">
        <EmptyState bare title="No project" text="Pick a branch on the left to see its project's report." />
      </div>
    )

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center px-3">
        <span className="text-[11px] font-semibold text-dim">Report</span>
        <Marquee className="ml-auto text-[11px] text-mute" delay={300}>{project?.name}</Marquee>
      </div>
      <div className="px-2 pb-3">
        <SegmentedControl
          fullWidth
          size="sm"
          value={String(period)}
          onChange={(v) => setPeriod(Number(v) as ReportPeriod)}
          aria-label="Period"
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: '0', label: 'All' }
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">{report ? <Body r={report} /> : <LoadingSkeleton />}</div>
    </div>
  )
}

function Body({ r }: { r: ProjectReport }) {
  const names = useMemo(() => r.agents.map((a) => a.name), [r.agents])
  const color = (name: string) => SHADES[Math.max(0, names.indexOf(name)) % SHADES.length]
  const agentMin = r.agentMs / 60_000
  const speed = agentMin > 0 ? r.humanMin / agentMin : 0
  const unit = r.bucket === 'week' ? 'week' : 'day'
  const chartDays = r.days.map((d) => ({ label: d.label, ...d.byAgent, opened: d.opened, resolved: d.resolved }))
  const maxAgent = Math.max(1, ...r.agents.map((a) => a.ms))

  if (r.kpis.runs === 0 && r.kpis.issuesResolved === 0)
    return (
      <div className="px-4 py-10">
        <EmptyState bare title="Nothing in this period" text="Runs in this project's branches show up here once they end." />
      </div>
    )

  return (
    <div className="space-y-3">
      {/* The headline: time saved, and how it compares */}
      <div className="px-2">
        <section className="rounded-xl border border-line bg-panel px-3.5 py-3">
          <div className="text-[12px] text-mute">Time saved</div>
          <div className="mt-0.5 text-[26px] font-semibold leading-tight tabular-nums text-ink">{fmtMin(r.savedMin)}</div>
          <p className="mt-1 text-[12px] leading-[1.5] text-dim">
            You'd have taken about {fmtMin(r.humanMin)}; the agents worked {fmtMin(agentMin)}
            {speed >= 1.5 ? `, ${speed.toFixed(speed < 10 ? 1 : 0)}× faster` : ''}. Your part: {fmtMin(r.yourMin)} of answers and reviews.
          </p>
        </section>
      </div>

      <Section title={`Work per ${unit}`} hint="Minutes each agent worked">
        <div className="h-[140px] px-1">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartDays} margin={{ top: 6, right: 6, bottom: 0, left: -18 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip cursor={false} content={<ChartTip format={(v: number) => fmtMin(v)} />} />
              {names.map((name, i) => (
                <Bar key={name} dataKey={name} stackId="w" fill={color(name)} activeBar={ACTIVE_BAR} radius={i === names.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Section>

      <Section title="Who worked" hint="Time and the share of the estimate each agent saved you">
        <ul className="space-y-2.5 px-3.5 pb-1">
          {r.agents.map((a) => (
            <li key={a.name}>
              <div className="report-agent-row flex items-center gap-2 text-[12.5px]">
                <span className="size-2 shrink-0 rounded-full" style={{ background: color(a.name) }} />
                <Marquee className="min-w-0 flex-1 text-ink/90" delay={300} hoverTarget=".report-agent-row">{a.name}</Marquee>
                <span className="tabular-nums text-dim">{fmtMin(a.ms / 60_000)}</span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[.06]">
                <div className="h-full rounded-full" style={{ width: `${(a.ms / maxAgent) * 100}%`, background: color(a.name) }} />
              </div>
              <div className="mt-0.5 text-[11px] text-mute">
                saved ~{fmtMin(a.savedMin)}
                {a.tokens ? ` · ${n(a.tokens)} tokens` : ''}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Issues" hint={`Opened and resolved per ${unit}`}>
        <div className="h-[110px] px-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartDays} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={24} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
              <Tooltip cursor={false} content={<ChartTip />} />
              <Area type="linear" dataKey="opened" name="Opened" stroke="#9a9aa1" fill="#9a9aa1" fillOpacity={0.08} strokeWidth={1.5} isAnimationActive={false} />
              <Area type="linear" dataKey="resolved" name="Resolved" stroke="var(--color-accent)" fill="var(--color-accent)" fillOpacity={0.12} strokeWidth={1.5} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div className="flex gap-3 px-3.5 pt-1 text-[11px] text-mute">
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 rounded bg-[#9a9aa1]" /> Opened
          </span>
          <span className="flex items-center gap-1">
            <span className="h-0.5 w-3 rounded bg-accent" /> Resolved
          </span>
        </div>
      </Section>

      <KpiTable r={r} />
      <HowItsCounted r={r} />
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-2">
      <section className="rounded-xl border border-line bg-panel pb-2.5 pt-2.5">
        <div className="px-3.5 pb-2">
          <div className="text-[12.5px] font-medium text-ink">{title}</div>
          {hint && <div className="text-[11px] text-mute">{hint}</div>}
        </div>
        {children}
      </section>
    </div>
  )
}

function ChartTip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p: any) => Number(p.value) > 0)
  if (!rows.length) return null
  return <ChartTooltip title={label} rows={rows.map((p: any) => ({ label: p.name, value: format ? format(Number(p.value)) : p.value, color: p.color ?? p.fill }))} />
}

/** Every number, one row each: label on the left, value on the right. */
function KpiTable({ r }: { r: ProjectReport }) {
  const k = r.kpis
  const rows: [string, string][] = [
    ['Time saved', fmtMin(r.savedMin)],
    ["You'd have taken", fmtMin(r.humanMin)],
    ['Agents worked', fmtMin(r.agentMs / 60_000)],
    ['Your time', fmtMin(r.yourMin)],
    ['Runs', k.runsFailed ? `${n(k.runs)} · ${k.runsFailed} failed` : n(k.runs)],
    ['Issues resolved', n(k.issuesResolved)],
    ['Issues open', n(k.issuesOpen)],
    ['Plans done', `${k.plansDone}/${k.plans}`],
    ['Commits', n(k.commits)],
    ['Files touched', n(k.files)],
    ['Lines added', `+${n(k.linesAdded)}`],
    ['Lines removed', `−${n(k.linesRemoved)}`],
    ['Questions to you', n(k.questions)],
    ['Tokens', n(k.tokens)],
    ['Cost', `$${k.costUsd.toFixed(2)}`],
    ['Cost per run', k.runs ? `$${(k.costUsd / k.runs).toFixed(2)}` : '—']
  ]
  return (
    <section className="pt-1">
      <div className="border-y border-line px-3 py-1.5 text-[12px] font-medium text-ink">Numbers</div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="report-num-row flex items-center gap-3 border-b border-line px-3 py-2 text-[12.5px]">
            <dt className="min-w-0 flex-1 text-dim">
              <Marquee delay={300} hoverTarget=".report-num-row">{label}</Marquee>
            </dt>
            <dd className="shrink-0 tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** The estimate, open to inspection: what each line item counted, and the constants behind it. */
function HowItsCounted({ r }: { r: ProjectReport }) {
  const [open, setOpen] = useState(false)
  const K = HUMAN_MINUTES
  const constants: [string, string][] = [
    ['Line added', `${K.lineAdded} min`],
    ['Line removed', `${K.lineRemoved} min`],
    ['File touched', `${K.file} min`],
    ['QA pass', `${K.qaPass} min`],
    ['Bug found', `${K.bug} min`],
    ['Spec or plan', `${K.spec} min`],
    ['Review', `${K.review} min`],
    ['Ship step', `${K.ship} min`],
    ['Other step', `${K.other} min`],
    ['Your answer', `${K.yourAnswer} min`],
    ['Your review of a run', `${K.yourReview} min`]
  ]
  return (
    <section>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1.5 border-b border-line px-3 py-2 text-left text-[12px] text-dim hover:text-ink" aria-expanded={open}>
        How the estimate is counted
        <ChevronDown size={12} className={cn('ml-auto transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="cm-in">
          {r.items.map((it) => (
            <div key={it.key} className="report-item-row flex items-center gap-3 border-b border-line px-3 py-2 text-[12.5px]">
              <Marquee className="min-w-0 flex-1 text-dim" delay={300} hoverTarget=".report-item-row">
                {it.label} <span className="text-mute">× {n(it.count)}</span>
              </Marquee>
              <span className="shrink-0 tabular-nums text-ink">{fmtMin(it.min)}</span>
            </div>
          ))}
          <p className="px-3 pb-1 pt-2.5 text-[11.5px] leading-[1.5] text-mute">
            Code: lines and files at the rates below, capped per run at 8 hours and at 12× the agent's own time. Generated files (lockfiles, builds, images) don't count.
          </p>
          {constants.map(([label, value]) => (
            <div key={label} className="flex items-center gap-3 px-3 py-1 text-[11.5px]">
              <span className="min-w-0 flex-1 text-mute">{label}</span>
              <span className="tabular-nums text-dim">{value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 px-2" aria-busy="true" aria-label="Loading">
      <Skeleton width="100%" height={104} radius={12} />
      <Skeleton width="100%" height={190} radius={12} />
      <Skeleton width="100%" height={150} radius={12} />
      <div className="space-y-2 pt-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} width="100%" height={14} radius={4} />
        ))}
      </div>
    </div>
  )
}
