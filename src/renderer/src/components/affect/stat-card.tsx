/*
 * affectUI Pro – © Florian Höller (adfects), https://www.affectui.com
 * Used in code-maxxer under an affectUI Pro license. This file may not be copied,
 * redistributed or published on its own, outside code-maxxer. Licenses: https://www.affectui.com/pricing
 */
"use client";

import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

/*
 * Stat Card – one number with its label, how it changed, and room for a chart. One self-contained file.
 *   · the change is colored text with an arrow – green when it went the right way, red when not;
 *     `lowerIsBetter` turns that around for latency, errors or cost
 *   · a number value rolls to its new value when it changes, and up from zero on first view
 *   · `chart` takes any node – a Trend Chart sparkline fits it exactly – below the number or beside it (`layout="inline"`)
 *   · `href` or `onClick` make the whole card a link or a button, while a chart inside it stays hoverable
 *   · `loading` keeps the card's size and shows quiet placeholders instead of numbers
 * The styles are injected below, so no extra files are needed.
 */

export type StatCardProps = {
  label: string;
  /** A number rolls when it changes and is shown through `format`; a string is shown as it is */
  value: number | string;
  /** Formats a number value, e.g. (n) => `$${(n / 1000).toFixed(1)}k` */
  format?: (n: number) => string;
  /** Change in percent against the period before, e.g. 12.4 or -3 */
  change?: number;
  /** Formats the change – "12.4%" by default; gets the absolute value, the arrow shows the direction */
  changeFormat?: (n: number) => string;
  /** Quiet text after the change, e.g. "vs last week" */
  changeLabel?: string;
  /** A rise is bad news – latency, errors, cost – so it shows red and a fall green */
  lowerIsBetter?: boolean;
  /** A 16px icon before the label */
  icon?: ReactNode;
  /** Any chart, e.g. <TrendChart variant="sparkline" … /> */
  chart?: ReactNode;
  /** The chart below the number (stacked) or to its right (inline) */
  layout?: "stacked" | "inline";
  /** The card's last row, e.g. "Updated 2 min ago" */
  footer?: ReactNode;
  /** Placeholders instead of the number, change and chart – the card keeps its size */
  loading?: boolean;
  /** Makes the whole card a link */
  href?: string;
  /** Makes the whole card a button */
  onClick?: () => void;
  /** Extra attributes for that link or button – e.g. role="tab", aria-selected and tabIndex when the cards pick what a chart shows */
  hitProps?: HTMLAttributes<HTMLElement>;
  /** A small control in the top right corner – a menu, a filter; it stays clickable on a link card */
  action?: ReactNode;
  /** One card of a set is picked: false fades this card's content, true or undefined shows it fully */
  selected?: boolean;
  className?: string;
  style?: CSSProperties;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t: number) => 1 - (1 - t) ** 4;

/** 1284 → "1,284", 2.5e9 → "2.5B" – a readable default for a bare number */
const plain = (n: number) =>
  Math.abs(n) >= 1e6
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 0 }).format(n);
/** 12.4%, 12,400%, and small changes keep their digits – 0.04% instead of a misleading 0% */
const percent = (n: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: n >= 100 ? 0 : n < 1 ? 2 : 1 }).format(n)}%`;

/** A formatter that throws or returns nothing still gives readable text */
const safe = (format: (n: number) => string, n: number, fallback = plain) => {
  try {
    const s = format(n);
    return s == null || s === "" ? fallback(n) : String(s);
  } catch {
    return fallback(n);
  }
};

/** Rolls a number from where it was to where it is now – from zero on first view */
function useRoll(target: number | null, duration = 720) {
  const [shown, setShown] = useState<number | null>(() => (target === null || reduced() ? target : 0));
  const from = useRef(shown ?? 0);
  const now = useRef(shown);
  now.current = shown;
  useEffect(() => {
    if (target === null || reduced()) return setShown(target);
    from.current = now.current ?? 0;
    if (from.current === target) return;
    const start = performance.now();
    let frame = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      setShown(from.current + (target - from.current) * easeOut(p));
      if (p < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return shown;
}

const Arrow = ({ up }: { up: boolean }) => (
  <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true" style={up ? undefined : { transform: "scaleY(-1)" }}>
    <path d="M4 1.2 7.2 6.4H.8L4 1.2Z" fill="currentColor" />
  </svg>
);

export function StatCard({
  label,
  value,
  format = plain,
  change,
  changeFormat = percent,
  changeLabel,
  lowerIsBetter = false,
  icon,
  chart,
  layout = "stacked",
  footer,
  loading = false,
  href,
  onClick,
  hitProps,
  action,
  selected,
  className,
  style,
}: StatCardProps) {
  const num = finite(value) ? value : null;
  const rolled = useRoll(loading ? null : num);
  // A missing value – empty, NaN, Infinity – reads as a quiet dash, never as "NaN"
  const text = num !== null ? safe(format, rolled ?? num) : typeof value !== "string" || value === "" ? "—" : value;
  // The real value for screen readers, not a number on its way
  const spoken = num !== null ? safe(format, num) : text;

  const hasChange = finite(change);
  const trend = !hasChange ? null : change > 0 ? "up" : change < 0 ? "down" : "flat";
  const good = trend === "flat" || trend === null ? null : (trend === "up") !== lowerIsBetter;
  const changeText = hasChange ? safe(changeFormat, Math.abs(change), percent) : "";
  const spokenChange = !hasChange
    ? ""
    : trend === "flat"
      ? `unchanged ${changeLabel ?? ""}`
      : `${trend === "up" ? "up" : "down"} ${changeText} ${changeLabel ?? ""}`;

  const Hit = href ? "a" : onClick ? "button" : null;

  return (
    <>
      <style href="ui-stat-card" precedence="default">
        {css}
      </style>
      <section
        className={["ui-stat", className].filter(Boolean).join(" ")}
        data-layout={layout}
        data-link={Hit ? "" : undefined}
        data-loading={loading || undefined}
        data-dim={selected === false || undefined}
        style={style}
        aria-busy={loading || undefined}
      >
        {Hit && (
          // The whole card is the target – it lies under the content, and a chart above it stays hoverable
          <Hit
            className="ui-stat__hit"
            {...hitProps}
            {...(href ? { href } : { type: "button" as const, onClick })}
            aria-label={`${label}: ${loading ? "loading" : `${spoken}${spokenChange ? `, ${spokenChange}` : ""}`}`}
          />
        )}
        <div className="ui-stat__body">
          <div className="ui-stat__text">
            {action && <div className="ui-stat__action">{action}</div>}
            <p className="ui-stat__label" title={label} dir="auto">
              {icon && (
                <span className="ui-stat__icon" aria-hidden="true">
                  {icon}
                </span>
              )}
              <span>{label}</span>
            </p>
            {loading ? (
              <>
                {/* Placeholders sit in the same lines as the real value and change – nothing moves when they arrive */}
                <p className="ui-stat__value">
                  <span className="ui-stat__skel ui-stat__skel--value" />
                </p>
                {(change !== undefined || changeLabel) && (
                  <p className="ui-stat__meta">
                    <span className="ui-stat__skel ui-stat__skel--change" />
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="ui-stat__value">
                  <span aria-hidden={num !== null || undefined}>{text}</span>
                  {num !== null && <span className="ui-stat__sr">{spoken}</span>}
                </p>
                {(hasChange || changeLabel) && (
                  <p className="ui-stat__meta">
                    {hasChange && (
                      <span className="ui-stat__change" data-good={good === null ? undefined : good ? "" : "no"}>
                        {trend !== "flat" && <Arrow up={trend === "up"} />}
                        <span aria-hidden="true">{changeText}</span>
                        <span className="ui-stat__sr">{spokenChange}</span>
                      </span>
                    )}
                    {changeLabel && (
                      <span className="ui-stat__vs" title={changeLabel} dir="auto" aria-hidden={hasChange || undefined}>
                        {changeLabel}
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
          </div>
          {(chart || loading) && <div className="ui-stat__chart">{loading ? <span className="ui-stat__skel ui-stat__skel--chart" /> : chart}</div>}
        </div>
        {footer && (
          <div className="ui-stat__footer" dir="auto">
            {footer}
          </div>
        )}
      </section>
    </>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-stat */
.ui-stat {
  --ui-stat-card: var(--aui-surface, #ffffff);
  --ui-stat-ink: var(--aui-ink, #171717);
  --ui-stat-muted: var(--aui-muted, #8f8f8f);
  --ui-stat-line: var(--aui-border, #ebebeb);
  --ui-stat-skel: #f0f0f0;
  --ui-stat-sheen: rgba(255, 255, 255, 0.8);
  --ui-stat-good: var(--aui-success, #1e8a4f);
  --ui-stat-bad: var(--aui-red, #f04438);
  --ui-stat-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-stat-shadow: 0 1px 2px rgba(0, 0, 0, 0.03), 0 8px 24px rgba(0, 0, 0, 0.035);
  --ui-stat-shadow-hover: 0 1px 2px rgba(0, 0, 0, 0.04), 0 12px 32px rgba(0, 0, 0, 0.07);
  --ui-stat-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  box-sizing: border-box;
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--ui-stat-card);
  border: 1px solid var(--ui-stat-line);
  border-radius: calc(var(--aui-radius-lg, 16px) + 4px);
  box-shadow: var(--ui-stat-shadow);
  font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 14px;
  line-height: 20px;
  color: var(--ui-stat-ink);
  -webkit-font-smoothing: antialiased;
  font-variant-numeric: tabular-nums;
  transition: box-shadow 200ms ease, transform 200ms var(--ui-stat-ease);
}
.ui-stat *, .ui-stat *::before, .ui-stat *::after { box-sizing: border-box; }

/* A link or button card: the target lies under the content; the ring goes around the whole card */
.ui-stat__hit {
  position: absolute;
  inset: 0;
  z-index: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: none;
  cursor: pointer;
  outline: none;
}
.ui-stat[data-link]:hover { box-shadow: var(--ui-stat-shadow-hover); transform: translateY(-1px); }
.ui-stat:has(.ui-stat__hit:focus-visible) {
  outline: 2px solid var(--ui-stat-focus);
  outline-offset: 2px;
}
.ui-stat[data-link] .ui-stat__body,
.ui-stat[data-link] .ui-stat__footer { position: relative; z-index: 1; pointer-events: none; }
.ui-stat[data-link] .ui-stat__chart,
.ui-stat[data-link] .ui-stat__action { pointer-events: auto; }

/* One of a set is picked: the others fade, no ring */
.ui-stat__body > *, .ui-stat__footer { transition: opacity 260ms ease; }
.ui-stat[data-dim] .ui-stat__body > *, .ui-stat[data-dim] .ui-stat__footer { opacity: 0.45; }
.ui-stat[data-dim][data-link]:hover .ui-stat__body > *, .ui-stat[data-dim][data-link]:hover .ui-stat__footer { opacity: 0.75; }

.ui-stat__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  row-gap: 16px;
  padding: 20px 20px 20px;
}
.ui-stat[data-layout="inline"] .ui-stat__body {
  grid-template-columns: minmax(0, 1fr) minmax(0, 44%);
  column-gap: 20px;
  align-items: end;
}
.ui-stat__text { position: relative; min-width: 0; }
/* The corner control floats top right; the label leaves room for it */
.ui-stat__action { float: right; margin: -4px -6px 0 8px; }

.ui-stat__label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: var(--ui-stat-muted);
}
.ui-stat__label > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-stat__icon { display: inline-flex; flex: none; width: 16px; height: 16px; color: var(--ui-stat-muted); }
.ui-stat__icon svg { width: 16px; height: 16px; }

.ui-stat__value {
  margin: 6px 0 0;
  font-size: 28px;
  font-weight: 500;
  line-height: 34px;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.ui-stat__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-stat-muted);
}
/* The change: colored text with an arrow – green when it went the right way, red when not, gray when flat */
.ui-stat__change {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  font-size: 14px;
  font-weight: 450;
  color: var(--ui-stat-muted);
  white-space: nowrap;
}
.ui-stat__change[data-good=""] { color: var(--ui-stat-good); }
.ui-stat__change[data-good="no"] { color: var(--ui-stat-bad); }
.ui-stat__change svg { width: 8px; height: 8px; }
.ui-stat__vs { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ui-stat__chart { min-width: 0; }

.ui-stat__footer {
  overflow-wrap: anywhere;
  margin-top: auto;
  padding: 0 20px 18px;
  font-size: 13px;
  line-height: 18px;
  color: var(--ui-stat-muted);
}

/* Loading: placeholders at the size of what they stand for, a slow sheen running over them */
.ui-stat__skel {
  position: relative;
  display: block;
  overflow: hidden;
  border-radius: 6px;
  background: var(--ui-stat-skel);
}
.ui-stat__skel::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, var(--ui-stat-sheen), transparent);
  transform: translateX(-100%);
  animation: ui-stat-sheen 1600ms ease-in-out infinite;
}
.ui-stat__skel--value,
.ui-stat__skel--change { display: inline-block; vertical-align: middle; }
.ui-stat__skel--value { width: 112px; height: 28px; }
.ui-stat__skel--change { width: 132px; height: 16px; }
/* The chart placeholder is a sparkline's height – set --ui-stat-skel-h for a taller chart */
.ui-stat__skel--chart { width: 100%; height: var(--ui-stat-skel-h, 44px); }

.ui-stat__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@keyframes ui-stat-sheen {
  to { transform: translateX(100%); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-stat { transition: none; }
  .ui-stat[data-link]:hover { transform: none; }
  .ui-stat__skel::after { animation: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-stat {
  --ui-stat-card: var(--aui-surface, #232326);
  --ui-stat-ink: var(--aui-ink, #ededed);
  --ui-stat-muted: var(--aui-muted, #8f8f8f);
  --ui-stat-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-stat-skel: rgba(255, 255, 255, 0.06);
  --ui-stat-sheen: rgba(255, 255, 255, 0.06);
  --ui-stat-good: var(--aui-green, #5fc88a);
  --ui-stat-bad: var(--aui-red, #ff6b5f);
  --ui-stat-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-stat-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
  --ui-stat-shadow-hover: 0 1px 2px rgba(0, 0, 0, 0.45), 0 12px 32px rgba(0, 0, 0, 0.5);
}
`;
