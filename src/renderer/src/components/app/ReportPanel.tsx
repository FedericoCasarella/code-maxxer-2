import { useEffect, useMemo, useState } from 'react'
import { usePersisted } from '@/lib/persist'
import { ChevronDown } from 'lucide-react'
import { HUMAN_MINUTES, type ProjectReport, type ReportPeriod } from '@shared/report'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '../affect/segmented-control'
import { ProjectPicker } from './ProjectPicker'
import { Skeleton } from '../affect/shimmer-loader'
import { EmptyState } from '../affect/empty-state'
import { StatCard } from '../affect/stat-card'
import { KpiChart } from '../affect/kpi-chart'
import { TrendChart } from '../affect/trend-chart'
import { Marquee } from './Marquee'
import { t } from '@/lib/i18n'

/** Calm palette: the accent for the main agent, greys for the others. */
const SHADES = ['var(--color-accent)', '#d4d4d8', '#9a9aa1', '#6f6f76', '#55555b', '#3f3f45', '#b8b8bf']

export const fmtMin = (m: number) => {
  const r = Math.round(m)
  if (r < 60) return `${r}m`
  const h = Math.floor(r / 60)
  return r % 60 ? `${h}h ${r % 60}m` : `${h}h`
}
const n = (v: number) => v.toLocaleString()

/** Right drawer: the project's report. How long the agents worked, who did what, how long it would have taken you. */
export function ReportPanel({ workspaceId }: { workspaceId: string | null }) {
  const own = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.projectId ?? s.selectedProject)
  // Another project picked here wins until you move to another branch (same as the Learning panel).
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => setPicked(null), [own])
  const projectId = picked ?? own
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
        <EmptyState bare title={t('No project')} text={t("Pick a branch on the left to see its project's report.")} />
      </div>
    )

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center px-2 pb-1 pt-2">
        <ProjectPicker className="w-full max-w-none" value={projectId} onChange={(id) => id && setPicked(id)} />
      </div>
      <div className="px-2 pb-3">
        <SegmentedControl
          fullWidth
          size="sm"
          value={String(period)}
          onChange={(v) => setPeriod(Number(v) as ReportPeriod)}
          aria-label={t('Period')}
          options={[
            { value: '7', label: t('7 days') },
            { value: '30', label: t('30 days') },
            { value: '90', label: t('90 days') },
            { value: '0', label: t('All') }
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
  // Up to five agents as their own line, the rest added up as Other
  const top = names.slice(0, 5)
  const lines = [
    ...top.map((name) => ({ label: name, color: color(name), values: r.days.map((d) => (d.byAgent[name] ?? 0)) })),
    ...(names.length > 5 ? [{ label: t('Other'), color: '#55555b', values: r.days.map((d) => names.slice(5).reduce((a, name) => a + (d.byAgent[name] ?? 0), 0)) }] : [])
  ]
  const maxAgent = Math.max(1, ...r.agents.map((a) => a.ms))

  if (r.kpis.runs === 0 && r.kpis.issuesResolved === 0)
    return (
      <div className="px-4 py-10">
        <EmptyState bare title={t('Nothing in this period')} text={t("Runs in this project's branches show up here once they end.")} />
      </div>
    )

  return (
    <div className="space-y-3">
      {/* The headline: time saved, and how it compares */}
      <div className="px-2">
        <StatCard
          label={t('Time saved')}
          value={fmtMin(r.savedMin)}
          footer={
            <p className="text-[12px] leading-[1.5] text-dim">
              {speed >= 1.5
                ? t("You'd have taken about {human}; the agents worked {agent}, {x}× faster. Your part: {you} of answers and reviews.", {
                    human: fmtMin(r.humanMin),
                    agent: fmtMin(agentMin),
                    x: speed.toFixed(speed < 10 ? 1 : 0),
                    you: fmtMin(r.yourMin)
                  })
                : t("You'd have taken about {human}; the agents worked {agent}. Your part: {you} of answers and reviews.", {
                    human: fmtMin(r.humanMin),
                    agent: fmtMin(agentMin),
                    you: fmtMin(r.yourMin)
                  })}
            </p>
          }
        />
      </div>

      <div className="px-2">
        <KpiChart
          title={unit === 'week' ? t('Work per week') : t('Work per day')}
          value={fmtMin(agentMin)}
          labels={r.days.map((d) => d.label)}
          series={lines}
          format={fmtMin}
          footer={t('Minutes each agent worked')}
        />
      </div>

      <Section title={t('Who worked')} hint={t('Time and the share of the estimate each agent saved you')}>
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
                {t('saved ~{t}', { t: fmtMin(a.savedMin) })}
                {a.tokens ? ` · ${t('{n} tokens', { n: n(a.tokens) })}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={t('Issues')} hint={unit === 'week' ? t('Opened and resolved per week') : t('Opened and resolved per day')}>
        <div className="px-2">
          <TrendChart
            variant="area"
            height={110}
            label={t('Issues')}
            labels={r.days.map((d) => d.label)}
            series={[
              { label: t('Opened'), values: r.days.map((d) => d.opened), color: '#9a9aa1' },
              { label: t('Resolved'), values: r.days.map((d) => d.resolved), color: 'var(--color-accent)' }
            ]}
          />
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

/** Every number, one row each: label on the left, value on the right. */
function KpiTable({ r }: { r: ProjectReport }) {
  const k = r.kpis
  const rows: [string, string][] = [
    ['Time saved', fmtMin(r.savedMin)],
    ["You'd have taken", fmtMin(r.humanMin)],
    ['Agents worked', fmtMin(r.agentMs / 60_000)],
    ['Your time', fmtMin(r.yourMin)],
    ['Runs', k.runsFailed ? t('{runs} · {n} failed', { runs: n(k.runs), n: k.runsFailed }) : n(k.runs)],
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
      <div className="border-y border-line px-3 py-1.5 text-[12px] font-medium text-ink">{t('Numbers')}</div>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="report-num-row flex items-center gap-3 border-b border-line px-3 py-2 text-[12.5px]">
            <dt className="min-w-0 flex-1 text-dim">
              <Marquee delay={300} hoverTarget=".report-num-row">{t(label)}</Marquee>
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
        {t('How the estimate is counted')}
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
            {t("Code: lines and files at the rates below, capped per run at 8 hours and at 12× the agent's own time. Generated files (lockfiles, builds, images) don't count.")}
          </p>
          {constants.map(([label, value]) => (
            <div key={label} className="flex items-center gap-3 px-3 py-1 text-[11.5px]">
              <span className="min-w-0 flex-1 text-mute">{t(label)}</span>
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
    <div className="space-y-3 px-2" aria-busy="true" aria-label={t('Loading')}>
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
