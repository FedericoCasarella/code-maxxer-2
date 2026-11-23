/*
 * affectUI Pro – © Florian Höller (adfects), https://www.affectui.com
 * Used in code-maxxer under an affectUI Pro license. This file may not be copied,
 * redistributed or published on its own, outside code-maxxer. Licenses: https://www.affectui.com/pricing
 */
import type { CSSProperties } from 'react'

/**
 * The agent's pointer from affectUI's Agent Cursors, on its own: the soft, rounded arrow and the flag with the
 * agent's name, its tags and what it is doing. Free-standing (tip at x/y), for pages that aren't an Agent Cursors document.
 */
export type AgentPointerProps = {
  x: number
  y: number
  name: string
  /** Small tags on the right of the name (the branch, a cost …) */
  tags?: string[]
  /** What the agent is doing: slides out under the name */
  doing?: string
  /** A click: the arrow presses in around its tip */
  press?: boolean
  /** Fading out where it was */
  gone?: boolean
  /** Its ink; defaults to the shared near-black (light in dark mode) */
  color?: string
  className?: string
}

export function AgentPointer({ x, y, name, tags = [], doing, press, gone, color, className }: AgentPointerProps) {
  return (
    <div className={['ui-apt', className].filter(Boolean).join(' ')} aria-hidden="true">
      <div
        className="ui-apt__cursor"
        data-press={press ? '' : undefined}
        data-gone={gone ? '' : undefined}
        style={{ transform: `translate(${x}px, ${y}px)`, ...(color ? ({ ['--ui-apt-c' as string]: color } as CSSProperties) : null) }}
      >
        <svg className="ui-apt__arrow" viewBox="-2.186 -0.256 18.514 22.277">
          <path
            transform="rotate(21.37)"
            d="M13.92 4.07c1.69.66 3.03 1.18 3.94 1.68.46.25.87.53 1.16.86.31.35.51.79.48 1.29-.03.51-.27.92-.62 1.23-.33.3-.77.53-1.25.74-.96.4-2.36.78-4.12 1.26-.56.15-.98.27-1.26.37-.26.1-.38.18-.47.27-.09.09-.17.21-.27.47-.1.28-.22.7-.37 1.26-.48 1.76-.86 3.16-1.26 4.12-.2.49-.44.93-.74 1.25-.32.35-.72.6-1.23.62-.51.03-.94-.17-1.29-.48-.33-.29-.61-.7-.86-1.16-.5-.91-1.02-2.25-1.68-3.94L1.66 7.76C.96 5.99.41 4.59.16 3.51-.09 2.44-.12 1.39.63.63 1.39-.12 2.44-.09 3.51.16c1.08.25 2.48.8 4.25 1.5l6.16 2.41Z"
          />
        </svg>
        <span className="ui-apt__flag">
          <span className="ui-apt__flag-row">
            <span className="ui-apt__flag-name" dir="auto">{name}</span>
            {tags.length > 0 && (
              <span className="ui-apt__flag-tags">
                {tags.map((tag, i) => (
                  <span key={i} className="ui-apt__flag-tag">{tag}</span>
                ))}
              </span>
            )}
          </span>
          <span className="ui-apt__flag-doing" data-on={doing ? '' : undefined}>
            <span>{doing ?? ''}</span>
          </span>
        </span>
      </div>
      <style href="ui-agent-pointer" precedence="default">{CSS}</style>
    </div>
  )
}

const CSS = `
.ui-apt {
  --ui-apt-c: #1f1f22;
  --ui-apt-flag: #141416;
  --ui-apt-flag-ink: #ffffff;
  --ui-apt-flag-soft: rgba(255, 255, 255, 0.14);
  --ui-apt-edge: linear-gradient(90deg, var(--aui-pink, #f06db5), var(--aui-purple, #b98af0) 55%, var(--aui-blue, #4fb0fe));
  --ui-apt-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  position: absolute; inset: 0; z-index: 10; pointer-events: none; container-type: inline-size;
  font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  letter-spacing: -0.006em;
}
:where(.dark, [data-theme="dark"]) .ui-apt { --ui-apt-c: #e4e4e7; --ui-apt-flag: #f4f4f5; --ui-apt-flag-ink: #141416; --ui-apt-flag-soft: rgba(0, 0, 0, 0.08); }
.ui-apt__cursor { position: absolute; top: 0; left: 0; transition: transform 560ms var(--ui-apt-ease), opacity 260ms ease; will-change: transform; animation: ui-apt-pop 300ms var(--ui-apt-ease) both; }
.ui-apt__cursor[data-gone] { opacity: 0; }
.ui-apt__arrow { position: absolute; z-index: 1; top: -0.6px; left: -2.3px; width: 19px; height: 23px; overflow: visible; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.22)); transform-origin: 2px 1px; transition: transform 140ms ease; }
.ui-apt__cursor[data-press] .ui-apt__arrow { transform: scale(0.82); }
.ui-apt__arrow path { fill: var(--ui-apt-c); stroke: #ffffff; stroke-width: 1.4; paint-order: stroke; }
:where(.dark, [data-theme="dark"]) .ui-apt__arrow path { stroke: #1f1f22; }
.ui-apt__flag { position: absolute; top: 21px; left: 14px; display: grid; grid-template-columns: minmax(0, 1fr); width: max-content; max-width: min(260px, calc(100cqw - 16px)); padding: 6px 10px 6px; border-bottom: 1px solid transparent; border-radius: 10px; background: linear-gradient(var(--ui-apt-flag), var(--ui-apt-flag)) padding-box, var(--ui-apt-edge) border-box; box-shadow: 0 8px 18px -8px color-mix(in srgb, var(--aui-pink, #ee3e9e) 50%, transparent), 6px 8px 18px -8px color-mix(in srgb, var(--aui-blue, #0190fe) 50%, transparent), 0 2px 6px -2px rgba(0, 0, 0, 0.3); font-size: 12px; font-weight: 600; line-height: 16px; color: var(--ui-apt-flag-ink); white-space: nowrap; }
.ui-apt__flag-row { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ui-apt__flag-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-apt__flag-tags { display: flex; flex: none; gap: 4px; margin-left: auto; }
.ui-apt__flag-tag { padding: 0 5px; border-radius: 5px; background: var(--ui-apt-flag-soft); font-size: 10.5px; font-weight: 600; line-height: 16px; font-variant-numeric: tabular-nums; }
.ui-apt__flag-doing { display: block; max-height: 0; overflow: hidden; opacity: 0; transition: max-height 320ms var(--ui-apt-ease), opacity 200ms ease, margin-top 320ms var(--ui-apt-ease); }
.ui-apt__flag-doing[data-on] { max-height: 18px; margin-top: 1px; opacity: 0.9; }
.ui-apt__flag-doing > span { display: block; width: max-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; font-weight: 500; white-space: nowrap; }
@keyframes ui-apt-pop { from { opacity: 0; scale: 0.85; } }
@media (prefers-reduced-motion: reduce) { .ui-apt__cursor, .ui-apt__arrow, .ui-apt__flag-doing { transition: none; animation: none; } }
`
