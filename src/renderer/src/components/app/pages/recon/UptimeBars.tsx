import type { UptimeHour } from '@shared/recon'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { ChartTooltip, ACTIVE_BAR } from '../../ChartTooltip'

const color = (b: UptimeHour) =>
  b.pct === null ? 'rgba(255,255,255,0.06)' : b.pct >= 99.9 ? 'var(--color-ok)' : b.pct >= 95 ? 'var(--color-warn)' : 'var(--color-bad)'

/**
 * The one uptime chart (per hour on an environment, per day on the overview): equal blocks coloured
 * by uptime. Hover a block for uptime, ping and checks; the blocks rise on every mount.
 * `title` is shown with the overall uptime on its right; leave it out when the host card has one.
 */
export function UptimeBars({ buckets, span, title, height = 36 }: { buckets: UptimeHour[]; span: 'hour' | 'day'; title?: string; height?: number }) {
  const data = buckets.map((b) => ({ ...b, v: 1 }))
  const total = buckets.reduce((n, b) => n + b.checks, 0)
  const pct = total ? Math.round((buckets.reduce((n, b) => n + b.checks - b.fails, 0) / total) * 10000) / 100 : null
  return (
    <div className="px-1 pt-1">
      {title && (
        <div className="flex items-baseline justify-between pb-1.5">
          <span className="text-[13px] text-ink">{title}</span>
          {pct !== null && <span className="text-[12px] tabular-nums text-mute">{pct}%</span>}
        </div>
      )}
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={1.5}>
            <Tooltip cursor={false} content={<Tip span={span} />} />
            <Bar dataKey="v" radius={4} activeBar={ACTIVE_BAR} animationDuration={700} animationEasing="ease-out">
              {data.map((b) => (
                <Cell key={b.t} fill={color(b)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function Tip({ active, payload, span }: any) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload as UptimeHour
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const title = span === 'hour' ? `${time(b.t)} – ${time(b.t + 3_600_000)}` : new Date(b.t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const tone = b.pct === null ? undefined : b.pct >= 99.9 ? 'ok' : b.pct >= 95 ? 'warn' : 'bad'
  return (
    <ChartTooltip
      title={title}
      rows={
        b.checks === 0
          ? [{ label: 'No checks', value: '' }]
          : [
              { label: 'Uptime', value: `${b.pct}%`, tone },
              { label: 'Ping', value: b.ms === null ? '—' : `${b.ms} ms` },
              { label: 'Checks', value: b.fails ? `${b.checks} · ${b.fails} failed` : b.checks }
            ]
      }
    />
  )
}
