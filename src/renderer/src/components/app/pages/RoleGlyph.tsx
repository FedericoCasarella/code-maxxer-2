/** Role colours + a dot-matrix glyph, like agent cards in the handoff pattern. */
export const ROLE_COLOR: Record<string, string> = {
  plan: '#8b7bff', spec: '#4d8dff', build: '#5aa7e8', qa: '#3fbf8f', review: '#e2a33a', security: '#e8666b', ship: '#b07cf0', script: '#9aa3ad', gate: '#e8c33a'
}
const GLYPH: Record<string, number[]> = {
  plan: [0, 1, 2, 3, 4, 5, 6, 7, 8], spec: [1, 3, 4, 5, 7], build: [0, 2, 4, 6, 8], qa: [0, 3, 4, 6, 7, 8],
  review: [1, 3, 5, 7], security: [0, 1, 2, 4, 7], ship: [2, 4, 5, 6, 8], script: [0, 4, 6, 7, 8], gate: [1, 3, 4, 5, 7]
}
export function DotGlyph({ role, size = 14 }: { role: string; size?: number }) {
  const on = new Set(GLYPH[role] ?? GLYPH.plan)
  const c = ROLE_COLOR[role] ?? '#8b7bff'
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={(i % 3) * 4 + 0.5} y={Math.floor(i / 3) * 4 + 0.5} width="3" height="3" rx="0.8" fill={c} opacity={on.has(i) ? 1 : 0.22} />
      ))}
    </svg>
  )
}

