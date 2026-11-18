import type { ReactNode } from 'react'

/**
 * The one tooltip for every chart: the affectUI Tooltip look (in the dark theme a light label,
 * 8px radius, 12.5px medium text), with a title line and label/value rows.
 * Recharts places it, so it can't be the Tooltip component itself (that one anchors to a trigger).
 */
export type TipRow = { label: ReactNode; value: ReactNode; color?: string; tone?: 'ok' | 'warn' | 'bad' }
const TONE = { ok: '#15803d', warn: '#b45309', bad: '#b91c1c' }

export function ChartTooltip({ title, rows }: { title?: ReactNode; rows: TipRow[] }) {
  return (
    <div
      className="cm-in min-w-[140px] rounded-[8px] px-[9px] py-[5px] text-[12.5px] font-medium leading-[18px] tracking-[-0.005em]"
      style={{ background: '#fafafa', color: '#171717', boxShadow: '0 8px 20px -8px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.06)' }}
    >
      {title && <div style={{ color: 'rgba(0,0,0,.6)' }}>{title}</div>}
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          {r.color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: r.color }} />}
          <span style={{ color: 'rgba(0,0,0,.6)' }}>{r.label}</span>
          <span className="ml-auto pl-3 tabular-nums" style={{ color: r.tone ? TONE[r.tone] : undefined }}>{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/** Hover feedback shared by every chart: no box or band behind the point, the hovered bar just dims. */
export const ACTIVE_BAR = { fillOpacity: 0.75 }
