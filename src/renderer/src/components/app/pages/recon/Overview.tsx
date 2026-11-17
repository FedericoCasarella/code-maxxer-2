import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, Clock, Gauge, ShieldCheck } from 'lucide-react'
import type { Incident, Overview } from '@shared/recon'
import { cn, timeAgo } from '@/lib/utils'
import { NumberTicker } from '../../../affect/number-ticker'
import { Card, Dot, fmtDur, fmtPct, INC_STATUS, Pill, SEVERITY, STATE } from './ui'

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
      <Kpi className="col-span-3" icon={<ShieldCheck size={14} />} label={`Uptime · ${days}d`} value={data.uptime.pctRange} pct sub={`24h ${fmtPct(data.uptime.pct24h)} · 7d ${fmtPct(data.uptime.pct7d)}`} />
      <Kpi className="col-span-3" icon={<Gauge size={14} />} label="Response time" value={data.latencyNow} unit="ms" sub={avgLatency !== null ? `24h average ${avgLatency} ms` : 'No checks yet'} />
      <Kpi className="col-span-3" icon={<AlertTriangle size={14} />} label="Open incidents" value={open} sub={data.lastIncidentAt ? `Last ${timeAgo(data.lastIncidentAt)} ago` : 'None so far'} tone={open ? 'bad' : undefined} />
      <Kpi
        className="col-span-3"
        icon={<Clock size={14} />}
        label={data.downSince ? 'Down for' : 'Up for'}
        text={
          data.downSince
            ? fmtDur(Date.now() - new Date(data.downSince).getTime())
            : data.downtimes[0]?.ended_at
              ? fmtDur(Date.now() - new Date(data.downtimes[0].ended_at).getTime())
              : data.envs.some((e) => e.last_check_at) ? 'No downtime' : '—'
        }
        sub={`${data.downtimes.length} downtime${data.downtimes.length === 1 ? '' : 's'} recorded`}
        tone={data.downSince ? 'bad' : undefined}
      />

      {/* ring + environments */}
      <Card className="col-span-4" title="Availability">
        <div className="flex items-center gap-5 px-5 pb-5">
          <Ring pct={data.uptime.pctRange} />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {data.envs.length === 0 && <span className="text-[12px] text-mute">No environments yet</span>}
            {data.envs.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-[12.5px]">
                <Dot className={STATE[e.monitor_state].dot} pulse={e.monitor_state === 'down' || e.monitor_state === 'retrying'} />
                <span className="truncate font-medium">{e.name}</span>
                <span className={cn('ml-auto text-[11.5px]', STATE[e.monitor_state].text)}>{STATE[e.monitor_state].label}</span>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card className="col-span-8" title={<><Activity size={13} /> Response time · 24h</>} right={avgLatency !== null && <span className="text-[11.5px] tabular-nums text-mute">avg {avgLatency} ms</span>}>
        <Latency points={data.latency24h} />
      </Card>

      <Card className="col-span-12" title={`Daily uptime · ${days} days`} right={<Legend />}>
        <Daily days={data.daily} />
      </Card>

      <Card className="col-span-5" title="Downtimes">
        <div className="flex flex-col px-2 pb-2">
          {data.downtimes.length === 0 && <Empty text="No downtime recorded" />}
          {data.downtimes.slice(0, 6).map((d) => {
            const env = data.envs.find((e) => e.id === d.env_id)
            const dur = (d.ended_at ? new Date(d.ended_at).getTime() : Date.now()) - new Date(d.started_at).getTime()
            return (
              <div key={d.id} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] hover:bg-white/[.03]">
                <Dot className={d.ended_at ? 'bg-mute' : 'bg-bad'} pulse={!d.ended_at} />
                <span className="truncate">{env?.name ?? 'Environment'}</span>
                <span className="text-mute">{new Date(d.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                <span className={cn('ml-auto tabular-nums', d.ended_at ? 'text-dim' : 'text-bad')}>{d.ended_at ? fmtDur(dur) : `ongoing · ${fmtDur(dur)}`}</span>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="col-span-7" title="Latest incidents">
        <div className="flex flex-col px-2 pb-2">
          {data.incidents.length === 0 && <Empty text="No incidents: all quiet" />}
          {data.incidents.map((i) => (
            <button key={i.id} onClick={() => onOpenIncident?.(i)} className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-left text-[12.5px] hover:bg-white/[.03]">
              <span className="w-8 shrink-0 font-mono text-[11px] text-mute">#{i.number}</span>
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              <Pill className={SEVERITY[i.severity]}>{i.severity}</Pill>
              <Pill className={INC_STATUS[i.status].c}>{INC_STATUS[i.status].label}</Pill>
              <span className="w-10 shrink-0 text-right text-[11.5px] text-mute">{timeAgo(i.created_at)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="col-span-12" title="Incidents · last 26 weeks">
        <Heatmap heat={data.heat} />
      </Card>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="px-2 py-6 text-center text-[12px] text-mute">{text}</div>
}

function Kpi({ className, icon, label, value, unit, pct, text, sub, tone }: {
  className?: string; icon: React.ReactNode; label: string; value?: number | null; unit?: string; pct?: boolean; text?: string; sub: string; tone?: 'bad'
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-raised/50 px-4 py-3.5', className)}>
      <div className="flex items-center gap-1.5 text-[12px] text-mute">
        {icon} {label}
      </div>
      <div className={cn('mt-2 text-[26px] font-semibold tabular-nums leading-none tracking-tight', tone === 'bad' && 'text-bad')}>
        {text !== undefined ? (
          text
        ) : value === null || value === undefined ? (
          '—'
        ) : (
          <>
            <NumberTicker value={value} format={pct ? { maximumFractionDigits: value >= 99 ? 2 : 1 } : { maximumFractionDigits: 0 }} />
            <span className="ml-0.5 text-[15px] font-medium text-mute">{pct ? '%' : unit}</span>
          </>
        )}
      </div>
      <div className="mt-2 truncate text-[11.5px] text-mute">{sub}</div>
    </section>
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
        <div className="text-[10.5px] text-mute">uptime</div>
      </div>
    </div>
  )
}

function Latency({ points }: { points: { t: number; ms: number | null }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 640
  const H = 150
  const now = Date.now()
  const from = now - 24 * 3600_000
  const vals = points.filter((p) => p.ms !== null) as { t: number; ms: number }[]
  if (!vals.length) return <Empty text="No checks in the last 24 hours: set a health URL and turn the monitor on" />
  const max = Math.max(50, ...vals.map((p) => p.ms)) * 1.15
  const x = (t: number) => ((t - from) / (now - from)) * W
  const y = (ms: number) => H - (ms / max) * H
  const line = vals.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.ms).toFixed(1)}`).join(' ')
  const area = `${line} L${x(vals[vals.length - 1].t).toFixed(1)},${H} L${x(vals[0].t).toFixed(1)},${H} Z`
  const h = hover !== null ? vals[hover] : null
  return (
    <div className="relative overflow-hidden px-4 pb-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-[150px] w-full overflow-visible"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const t = from + ((e.clientX - r.left) / r.width) * (now - from)
          let best = 0
          vals.forEach((p, i) => Math.abs(p.t - t) < Math.abs(vals[best].t - t) && (best = i))
          setHover(best)
        }}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="lat" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--color-accent)" stopOpacity=".28" />
            <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,.05)" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={area} fill="url(#lat)" />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {vals.length < 40 && vals.map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.ms)} r="2.5" fill="var(--color-accent)" vectorEffect="non-scaling-stroke" />)}
        {h && <line x1={x(h.t)} x2={x(h.t)} y1="0" y2={H} stroke="rgba(255,255,255,.25)" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 rounded-md border border-line-strong bg-raised px-2 py-1 text-[11px] shadow" style={x(h.t) / W > 0.75 ? { right: `calc(${100 - (x(h.t) / W) * 100}% + 8px)` } : { left: `calc(${(x(h.t) / W) * 100}% + 8px)` }}>
          <span className="font-medium tabular-nums">{h.ms} ms</span>
          <span className="ml-1.5 text-mute">{new Date(h.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10.5px] text-mute">
        <span>24h ago</span>
        <span>12h</span>
        <span>now</span>
      </div>
    </div>
  )
}

const dayColor = (p: number | null) =>
  p === null ? 'bg-white/[.06]' : p >= 99.9 ? 'bg-ok' : p >= 99 ? 'bg-ok/60' : p >= 95 ? 'bg-warn' : 'bg-bad'

function Legend() {
  return (
    <span className="flex items-center gap-2.5 text-[11px] text-mute">
      {[['bg-ok', '≥99.9%'], ['bg-warn', '≥95%'], ['bg-bad', '<95%'], ['bg-white/[.08]', 'no data']].map(([c, l]) => (
        <span key={l} className="flex items-center gap-1">
          <span className={cn('size-2 rounded-sm', c)} /> {l}
        </span>
      ))}
    </span>
  )
}

function Daily({ days }: { days: { day: string; pct: number | null }[] }) {
  return (
    <div className="px-4 pb-4">
      <div className="flex h-10 items-stretch gap-[3px]">
        {days.map((d) => (
          <div key={d.day} title={`${d.day} · ${fmtPct(d.pct)}`} className={cn('min-w-[3px] flex-1 rounded-[3px] transition-opacity hover:opacity-70', dayColor(d.pct))} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10.5px] text-mute">
        <span>{days[0]?.day}</span>
        <span>today</span>
      </div>
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
    <div className="flex items-end gap-4 overflow-x-auto px-4 pb-4">
      <div className="flex gap-[3px]">
        {weeks.map((w, i) => (
          <div key={i} className="flex flex-col gap-[3px]">
            {w.map((c) => (
              <div key={c.day} title={c.future ? '' : `${c.day} · ${c.count} incident${c.count === 1 ? '' : 's'}`} className={cn('size-[13px] rounded-[3px]', c.future ? 'opacity-0' : shade(c.count))} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 pb-0.5 text-[10.5px] text-mute">
        Less {[0, 1, 2, 4].map((c) => <span key={c} className={cn('size-[11px] rounded-[3px]', shade(c))} />)} More
      </div>
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
    daily: Array.from({ length: 30 }, (_, i) => ({ day: new Date(now - (29 - i) * day).toISOString().slice(0, 10), pct: i === 11 ? 96.4 : i === 22 ? 99.2 : 100 })),
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
