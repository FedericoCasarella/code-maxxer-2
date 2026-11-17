// Small provider glyphs (generic marks, not brand assets).

export function ClaudeGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <g stroke="#d97757" strokeWidth="2.6" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return <line key={i} x1={12 + Math.cos(a) * 3} y1={12 + Math.sin(a) * 3} x2={12 + Math.cos(a) * 10} y2={12 + Math.sin(a) * 10} />
        })}
      </g>
    </svg>
  )
}

export function CodexGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" stroke="#d4d4d8" strokeWidth="1.8" />
      <path d="M8.5 10l2.5 2-2.5 2M12.5 15h3" stroke="#d4d4d8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** code-maxxer mark: a loop arrow around a node — the product is loops. */
export function CmLogo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="46" height="46" rx="13" fill="#1c1c1f" stroke="rgba(255,255,255,.1)" />
      <path d="M34 17a12 12 0 1 0 2.4 9.5" stroke="#d97757" strokeWidth="3" strokeLinecap="round" />
      <path d="M35.5 10.5 35 17.5l-7-.8" stroke="#d97757" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="24" r="4" fill="#ededed" />
    </svg>
  )
}
