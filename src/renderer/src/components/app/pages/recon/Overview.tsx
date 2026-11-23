import { useMemo, useState } from 'react'
import { UptimeBars } from './UptimeBars'
import { Activity, AlertTriangle, Clock, Gauge, ShieldCheck } from 'lucide-react'
import type { Incident, Overview } from '@shared/recon'
import { cn, timeAgo, timeAgoLabel } from '@/lib/utils'
import { locale, t } from '@/lib/i18n'
import { StatCard } from '../../../affect/stat-card'
import { TrendChart } from '../../../affect/trend-chart'
import { Card, Dot, fmtDur, fmtPct, INC_STATUS, incLabel, Pill, SEVERITY, STATE } from './ui'
import { Marquee } from '../../Marquee'

/** Recon dashboard: KPIs, uptime ring, 24h latency, daily uptime, downtimes, latest incidents, incident heatmap. */
export function OverviewView({ data, days, onOpenIncident }: { data: Overview; days: number; onOpenIncident?: (i: Incident) => void }) {
  const open = data.incidents.filter((i) => !['resolved', 'cancelled'].includes(i.status)).length
  const avgLatency = useMemo(() => {
    const v = data.latency24h.map((p) => p.ms).filter((x): x is number => x !== null)
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null
  }, [data.latency24h])

  return (
    <div className="grid grid-cols-12 gap-3">
      {/* KPIs */}
      <Kpi className="col-span-3" icon={<ShieldCheck size={14} />} label={t('Uptime · {n}d', { n: days })} value={data.uptime.pctRange} pct sub={t('24h {a} · 7d {b}', { a: fmtPct(data.uptime.pct24h), b: fmtPct(data.uptime.pct7d) })} />
      <Kpi className="col-span-3" icon={<Gauge size={14} />} label={t('Response time')} value={data.latencyNow} unit="ms" sub={avgLatency !== null ? t('24h average {n} ms', { n: avgLatency }) : t('No checks yet')} />
      <Kpi className="col-span-3" icon={<AlertTriangle size={14} />} label={t('Open incidents')} value={open} sub={data.lastIncidentAt ? (timeAgo(data.lastIncidentAt) === 'now' ? t('Last just now') : t('Last {t} ago', { t: timeAgo(data.lastIncidentAt) })) : t('None so far')} tone={open ? 'bad' : undefined} />
      <Kpi
        className="col-span-3"
        icon={<Clock size={14} />}
        label={data.downSince ? t('Down for') : t('Up for')}
        text={
          data.downSince
            ? fmtDur(Date.now() - new Date(data.downSince).getTime())
            : data.downtimes[0]?.ended_at
              ? fmtDur(Date.now() - new Date(data.downtimes[0].ended_at).getTime())
              : data.envs.some((e) => e.last_check_at) ? t('No downtime') : '—'
        }
        sub={data.downtimes.length === 1 ? t('1 downtime recorded') : t('{n} downtimes recorded', { n: data.downtimes.length })}
        tone={data.downSince ? 'bad' : undefined}
      />

      {/* ring + environments */}
      <Card className="col-span-4" title={t('Availability')}>
        <div className="flex items-center gap-5 px-5 pb-5">
          <Ring pct={data.uptime.pctRange} />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {data.envs.length === 0 && <span className="text-[12px] text-mute">{t('No environments yet')}</span>}
            {data.envs.map((e) => (
              <div key={e.id} className="ov-env-row flex items-center gap-2 text-[12.5px]">
                <Dot className={STATE[e.monitor_state].dot} pulse={e.monitor_state === 'down' || e.monitor_state === 'retrying'} />
                <Marquee className="min-w-0 font-medium" delay={300} hoverTarget=".ov-env-row">{e.name}</Marquee>
                <span className={cn('ml-auto text-[11.5px]', STATE[e.monitor_state].text)}>{t(STATE[e.monitor_state].label)}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="col-span-8" title={<><Activity size={13} /> {t('Response time · 24h')}</>} right={avgLatency !== null && <span className="text-[11.5px] tabular-nums text-mute">{t('avg {n} ms', { n: avgLatency })}</span>}>
        <Latency points={data.latency24h} />
      </Card>

      <Card className="col-span-12" title={t('Daily uptime · {n} days', { n: days })}>
        <div className="px-3 pb-3">
          <UptimeBars buckets={data.daily} span="day" height={40} />
        </div>
      </Card>

      <Card className="col-span-5" title={t('Downtimes')}>
        <div className="flex flex-col px-2 pb-2">
          {data.downtimes.length === 0 && <Empty text={t('No downtime recorded')} />}
          {data.downtimes.slice(0, 6).map((d) => {
            const env = data.envs.find((e) => e.id === d.env_id)
            const dur = (d.ended_at ? new Date(d.ended_at).getTime() : Date.now()) - new Date(d.started_at).getTime()
            return (
              <div key={d.id} className="ov-down-row flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] hover:bg-white/[.03]">
                <Dot className={d.ended_at ? 'bg-mute' : 'bg-bad'} pulse={!d.ended_at} />
                <Marquee className="min-w-0" delay={300} hoverTarget=".ov-down-row">{env?.name ?? t('Environment')}</Marquee>
                <span className="text-mute">{new Date(d.started_at).toLocaleString(locale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span className={cn('ml-auto tabular-nums', d.ended_at ? 'text-dim' : 'text-bad')}>{d.ended_at ? fmtDur(dur) : t('ongoing · {d}', { d: fmtDur(dur) })}</span>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="col-span-7" title={t('Latest incidents')}>
        <div className="flex flex-col px-2 pb-2">
          {data.incidents.length === 0 && <Empty text={t('No incidents: all quiet')} />}
          {data.incidents.map((i) => (
            <button key={i.id} onClick={() => onOpenIncident?.(i)} className="ov-inc-row flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[12.5px] hover:bg-white/[.03]">
              <span className="w-8 shrink-0 font-mono text-[11px] text-mute">#{i.number}</span>
              <Marquee className="min-w-0 flex-1" delay={300} hoverTarget=".ov-inc-row">{i.title}</Marquee>
              <Pill className={SEVERITY[i.severity]}>{t(i.severity)}</Pill>
              <Pill className={INC_STATUS[i.status].c}>{incLabel(i.status)}</Pill>
              <span className="w-10 shrink-0 text-right text-[11.5px] text-mute">{timeAgoLabel(i.created_at)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="col-span-12" title={t('Incidents · last 26 weeks')}>
        <Heatmap heat={data.heat} />
      </Card>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="px-2 py-6 text-center text-[12px] text-mute">{text}</div>
}

/** One KPI tile: affectUI's Stat Card. The detail line is its footer. */
function Kpi({ className, icon, label, value, unit, pct, text, sub }: {
  className?: string; icon: React.ReactNode; label: string; value?: number | null; unit?: string; pct?: boolean; text?: string; sub: string; tone?: 'bad'
}) {
  const nf = (n: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: pct ? (n >= 99 ? 2 : 1) : 0 }).format(n)
  return (
    <StatCard
      className={className}
      icon={icon}
      label={label}
      value={text !== undefined ? text : value === null || value === undefined ? '—' : value}
      format={(n) => (pct ? `${nf(n)}%` : unit ? `${nf(n)} ${unit}` : nf(n))}
      footer={<Marquee className="text-[11.5px] text-mute" delay={300}>{sub}</Marquee>}
    />
  )
}

function Ring({ pct }: { pct: number | null }) {
  const r = 46
  const c = 2 * Math.PI * r
  const v = pct ?? 0
  const color = pct === null ? 'rgba(255,255,255,.15)' : v >= 99.5 ? 'var(--color-ok)' : v >= 97 ? 'var(--color-warn)' : 'var(--color-bad)'
  return (
    <div className="relative grid size-[112px] shrink-0 place-items-center">
      <svg viewBox="0 0 112 112" className="absolute inset-0 -rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="9" />
        {pct !== null && v > 0 && <circle cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(c * v) / 100} ${c}`} className="transition-[stroke-dasharray] duration-700" />}
      </svg>
      <div className="text-center leading-tight">
        <div className="text-[18px] font-semibold tabular-nums">{fmtPct(pct)}</div>
        <div className="text-[10.5px] text-mute">{t('uptime')}</div>
      </div>
    </div>
  )
}

/** Response time over the last 24 hours: affectUI's Trend Chart; a check that got no answer leaves a gap. */
function Latency({ points }: { points: { t: number; ms: number | null }[] }) {
  if (!points.some((p) => p.ms !== null)) return <Empty text={t('No checks in the last 24 hours: set a health URL and turn the monitor on')} />
  const time = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="px-4 pb-3">
      <TrendChart
        variant="area"
        height={150}
        zero={false}
        label={t('Response time · 24h')}
        labels={points.map((p) => time(p.t))}
        series={[{ label: t('Response time'), values: points.map((p) => p.ms), color: 'var(--color-accent)' }]}
        format={(n) => `${Math.round(n)} ms`}
      />
    </div>
  )
}

function Heatmap({ heat }: { heat: { day: string; count: number }[] }) {
  const map = new Map(heat.map((h) => [h.day, h.count]))
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const start = new Date(today)
  start.setDate(start.getDate() - 7 * 26 + 1)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7)) // back to Monday
  const weeks: { day: string; count: number; future: boolean }[][] = []
  const d = new Date(start)
  while (d <= today) {
    const w: { day: string; count: number; future: boolean }[] = []
    for (let i = 0; i < 7; i++) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      w.push({ day: key, count: map.get(key) ?? 0, future: d > today })
      d.setDate(d.getDate() + 1)
    }
    weeks.push(w)
  }
  const shade = (c: number) => (c === 0 ? 'bg-white/[.05]' : c === 1 ? 'bg-bad/35' : c <= 3 ? 'bg-bad/60' : 'bg-bad')
  return (
    // Full width: every week is a column that shares the card's width, cells stay square.
    <div className="flex gap-[3px] px-4 pb-4">
      {weeks.map((w, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-[3px]">
          {w.map((c) => (
            <div key={c.day} title={c.future ? '' : c.count === 1 ? t('{day} · 1 incident', { day: c.day }) : t('{day} · {n} incidents', { day: c.day, n: c.count })} className={cn('aspect-square w-full rounded-[3px]', c.future ? 'opacity-0' : shade(c.count))} />
          ))}
        </div>
      ))}
    </div>
  )
}

/** Plausible data for the locked preview. */
export function demoOverview(): Overview {
  const now = Date.now()
  const day = 86_400_000
  return {
    envs: [
      { id: 'p', kind: 'production', name: 'Production', monitor_state: 'up', connection_status: 'profiled', last_check_at: new Date().toISOString() },
      { id: 's', kind: 'staging', name: 'Staging', monitor_state: 'retrying', connection_status: 'verified', last_check_at: new Date().toISOString() }
    ],
    uptime: { pct24h: 100, pct7d: 99.94, pctRange: 99.87 },
    latency24h: Array.from({ length: 96 }, (_, i) => ({ t: now - (96 - i) * 900_000, ms: Math.round(140 + 40 * Math.sin(i / 7) + (i % 13 === 0 ? 120 : 0)) })),
    latencyNow: 152,
    daily: Array.from({ length: 30 }, (_, i) => ({ t: now - (29 - i) * day, pct: i === 11 ? 96.4 : i === 22 ? 99.2 : 100, ms: 180 + ((i * 37) % 90), checks: 1440, fails: i === 11 ? 52 : i === 22 ? 12 : 0 })),
    downtimes: [
      { id: 'd1', env_id: 'p', started_at: new Date(now - 8 * day).toISOString(), ended_at: new Date(now - 8 * day + 1_260_000).toISOString(), incident_id: null },
      { id: 'd2', env_id: 's', started_at: new Date(now - 19 * day).toISOString(), ended_at: new Date(now - 19 * day + 300_000).toISOString(), incident_id: null }
    ],
    lastIncidentAt: new Date(now - 8 * day).toISOString(),
    downSince: null,
    incidents: [
      { id: 'i1', project_id: '', env_id: 'p', number: 4, title: 'Production is down', details: '', severity: 'critical', source: 'monitor', status: 'resolved', summary: null, diagnosis: null, created_at: new Date(now - 8 * day).toISOString(), resolved_at: null },
      { id: 'i2', project_id: '', env_id: 's', number: 3, title: 'Checkout returns 502 on staging', details: '', severity: 'medium', source: 'manual', status: 'needs_info', summary: null, diagnosis: null, created_at: new Date(now - 12 * day).toISOString(), resolved_at: null }
    ],
    heat: [3, 8, 12, 30, 41, 60, 95].map((n, i) => ({ day: new Date(now - n * day).toISOString().slice(0, 10), count: (i % 3) + 1 }))
  }
}
