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

/** GitHub's mark (lucide dropped brand icons). */
export function Github({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

/** OpenAI-style mark for Codex / GPT models. */
export function OpenAIGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="#e8e8e8" strokeWidth="1.7" strokeLinejoin="round">
        {[0, 60, 120, 180, 240, 300].map((r) => (
          <path key={r} d="M12 12V5.2a3.3 3.3 0 0 1 5.6-2.3" transform={`rotate(${r} 12 12)`} strokeLinecap="round" />
        ))}
      </g>
    </svg>
  )
}

/** OpenCode mark: a terminal window. */
export function OpenCodeGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" fill="#2a2a2e" stroke="#cfcfd4" strokeWidth="1.6" />
      <path d="M7.5 10l2.5 2-2.5 2M12.5 14.5h4" stroke="#cfcfd4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ProviderLogo({ provider, size = 14 }: { provider: 'claude' | 'codex' | 'opencode'; size?: number }) {
  return provider === 'claude' ? <ClaudeGlyph size={size} /> : provider === 'codex' ? <OpenAIGlyph size={size} /> : <OpenCodeGlyph size={size} />
}
