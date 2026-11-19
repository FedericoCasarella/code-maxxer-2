"use client";

import { t } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";

/*
 * Agent Crew – a lead and its sub-agents as one live tree of cards. Every agent stays on screen: what it does now,
 * how full its context is, its tools and the last thing it was handed. Handoffs run as a light along the rounded
 * connectors and light up the card they reach; a click opens the card's details under it.
 * A single self-contained file; the styles are injected below.
 */

export type CrewStatus = "active" | "idle" | "paused" | "waiting" | "done" | "failed";

export type CrewAgent = {
  id: string;
  name: string;
  status: CrewStatus;
  /** One line: what it's doing, or resting, what it did last */
  activity?: string;
  model?: string;
  /** How full its context window is, 0–1, with the window size in tokens */
  context?: number;
  contextLimit?: number;
  tools?: { logo?: ReactNode; name: string }[];
  last?: { from: string; text: string };
  /** In the details */
  task?: string;
  modelLogo?: ReactNode;
  started?: number;
  ended?: number;
  cost?: number;
  tokens?: number;
  /** A mark instead of its pixel pattern */
  logo?: ReactNode;
  /** Its colour (any CSS colour); picked from the palette when missing */
  color?: string;
  /** Short text on the status pill instead of the default */
  statusLabel?: string;
  /** Extra content at the end of the details */
  detail?: ReactNode;
  children?: CrewAgent[];
};

export type CrewHandoff = { id: string; from: string; to: string; label?: string; back?: boolean };

export type AgentCrewProps = {
  root: CrewAgent;
  handoffs?: CrewHandoff[];
  title?: ReactNode;
  /** Right side of the header, instead of the counts */
  headerRight?: ReactNode;
  onSelect?: (agent: CrewAgent) => void;
  formatCost?: (amount: number) => string;
  className?: string;
};

const PALETTE = ["#6e9bff", "#a78bfa", "#2dd4bf", "#f59e0b", "#f472b6", "#4fc38a", "#60a5fa", "#fb923c"];
const STATUS_LABEL: Record<CrewStatus, string> = {
  active: "Working",
  idle: "Idle",
  paused: "Paused",
  waiting: "Needs you",
  done: "Done",
  failed: "Failed",
};

const walk = (a: CrewAgent, out: CrewAgent[] = []) => {
  out.push(a);
  a.children?.forEach((c) => walk(c, out));
  return out;
};
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const tok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n));
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
};
const dollars = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

export function AgentCrew({ root, handoffs = [], title, headerRight, onSelect, formatCost = dollars, className }: AgentCrewProps) {
  const all = walk(root);
  const colorOf = new Map(all.map((a, i) => [a.id, a.color ?? PALETTE[i % PALETTE.length]]));
  const [open, setOpen] = useState<string | null>(null);
  const working = all.filter((a) => a.status === "active").length;
  const needYou = all.filter((a) => a.status === "waiting").length;

  // Handoffs present on mount don't run; each new one does, once.
  const seen = useRef(new Set(handoffs.map((h) => h.id)));
  const [lit, setLit] = useState<CrewHandoff | null>(null);
  useEffect(() => {
    const fresh = handoffs.filter((h) => !seen.current.has(h.id));
    fresh.forEach((h) => seen.current.add(h.id));
    const h = fresh[fresh.length - 1];
    if (!h) return;
    setLit(h);
    const timer = window.setTimeout(() => setLit((x) => (x?.id === h.id ? null : x)), 1600);
    return () => clearTimeout(timer);
  }, [handoffs.map((h) => h.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Arrow keys walk the cards in tree order.
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const onKey = (e: KeyboardEvent, id: string) => {
    const i = all.findIndex((a) => a.id === id);
    const go = (j: number) => {
      e.preventDefault();
      cards.current.get(all[Math.max(0, Math.min(all.length - 1, j))].id)?.focus();
    };
    if (e.key === "ArrowDown" || e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape" && open) setOpen(null);
  };

  const ctx = {
    colorOf,
    open,
    toggle: (a: CrewAgent) => {
      setOpen((o) => (o === a.id ? null : a.id));
      onSelect?.(a);
    },
    lit,
    onKey,
    cards,
    formatCost,
  };

  return (
    <div className={["ui-crew", className].filter(Boolean).join(" ")}>
      <style href="ui-agent-crew" precedence="default">
        {css}
      </style>
      {(title || headerRight !== undefined) && (
        <div className="ui-crew__head">
          <div className="ui-crew__title">{title}</div>
          {headerRight ?? (
            <div className="ui-crew__counts">
              {needYou > 0 && <span className="ui-crew__need">{t("{n} need you", { n: needYou })}</span>}
              {working > 0 && <span className="ui-crew__working">{t("{n} working", { n: working })}</span>}
              <span>{all.length === 1 ? t("1 agent") : t("{n} agents", { n: all.length })}</span>
            </div>
          )}
        </div>
      )}
      <ul className="ui-crew__tree" role="tree" aria-label={typeof title === "string" ? title : t("Agents")}>
        <Branch agent={root} depth={0} ctx={ctx} />
      </ul>
      <div className="ui-crew__sr" aria-live="polite">
        {lit ? `${all.find((a) => a.id === lit.from)?.name ?? ""} → ${all.find((a) => a.id === lit.to)?.name ?? ""}${lit.label ? `: ${lit.label}` : ""}` : ""}
      </div>
    </div>
  );
}

type Ctx = {
  colorOf: Map<string, string>;
  open: string | null;
  toggle: (a: CrewAgent) => void;
  lit: CrewHandoff | null;
  onKey: (e: KeyboardEvent, id: string) => void;
  cards: MutableRefObject<Map<string, HTMLButtonElement>>;
  formatCost: (n: number) => string;
};

function Branch({ agent, depth, ctx }: { agent: CrewAgent; depth: number; ctx: Ctx }) {
  const kids = agent.children ?? [];
  return (
    <li role="treeitem" aria-expanded={kids.length ? true : undefined} className="ui-crew__item">
      <Card agent={agent} depth={depth} ctx={ctx} />
      {kids.length > 0 && <Children parent={agent} kids={kids} depth={depth + 1} ctx={ctx} />}
    </li>
  );
}

/** The children of one card, with the connectors from its rail: one rounded elbow per child, drawn in SVG. */
function Children({ parent, kids, depth, ctx }: { parent: CrewAgent; kids: CrewAgent[]; depth: number; ctx: Ctx }) {
  const ul = useRef<HTMLUListElement>(null);
  const [ys, setYs] = useState<number[]>([]);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ul.current;
    if (!el) return;
    const measure = () => {
      const items = [...el.children].filter((c) => c.tagName === "LI") as HTMLElement[];
      // To the middle of each child's header row
      setYs(items.map((li) => li.offsetTop + 26));
      setH(el.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [kids.length]);
  const color = ctx.colorOf.get(parent.id)!;
  // The rail drops from under the parent's mark, each elbow turns into a child card
  const X = 20;
  const R = 10;
  const path = (y: number) => `M ${X} -10 V ${y - R} Q ${X} ${y} ${X + R} ${y} H 36`;
  // The light runs into the card it reaches; when that card is elsewhere, out of the one it left
  const into = ctx.lit ? kids.findIndex((k) => k.id === ctx.lit!.to) : -1;
  const lit = !ctx.lit || ctx.lit.from === ctx.lit.to ? -1 : into >= 0 ? into : kids.findIndex((k) => k.id === ctx.lit!.from);
  const litIntoKid = lit >= 0 && kids[lit].id === ctx.lit!.to;
  return (
    <ul ref={ul} role="group" className="ui-crew__kids">
      <svg className="ui-crew__wires" width={38} height={h + 10} style={{ top: -10 }} aria-hidden="true">
        <g transform="translate(0 10)">
          {ys.map((y, i) => (
            <path key={kids[i].id} d={path(y)} className="ui-crew__wire" data-on={kids[i].status !== "idle" || undefined} style={{ ["--c" as string]: color }} />
          ))}
          {lit >= 0 && ys[lit] != null && (
            <path
              key={ctx.lit!.id}
              d={path(ys[lit])}
              pathLength={100}
              className="ui-crew__light"
              data-reverse={!litIntoKid || undefined}
              style={{ ["--c" as string]: ctx.lit!.back ? "#ff7a6b" : color }}
            />
          )}
        </g>
      </svg>
      {kids.map((k) => (
        <Branch key={k.id} agent={k} depth={depth} ctx={ctx} />
      ))}
    </ul>
  );
}

function Mark({ agent, color }: { agent: CrewAgent; color: string }) {
  if (agent.logo) return <span className="ui-crew__mark">{agent.logo}</span>;
  // A 3×3 pixel pattern per name; the first dot is always on
  const bits = hash(agent.name) | 1;
  return (
    <span className="ui-crew__mark ui-crew__pixels" style={{ ["--c" as string]: color }} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} data-on={(bits >> i) & 1 || i === 4 || undefined} style={{ animationDelay: `${(i % 3) * 110 + Math.floor(i / 3) * 110}ms` }} />
      ))}
    </span>
  );
}

function Card({ agent, depth, ctx }: { agent: CrewAgent; depth: number; ctx: Ctx }) {
  const color = ctx.colorOf.get(agent.id)!;
  const open = ctx.open === agent.id;
  const arrived = ctx.lit?.to === agent.id;
  const pct = agent.context != null ? Math.max(0, Math.min(1, agent.context)) : null;
  const barColor = pct == null ? color : pct >= 0.95 ? "var(--ui-crew-bad)" : pct >= 0.8 ? "var(--ui-crew-warn)" : color;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!open || agent.status !== "active" || !agent.started) return;
    const h = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(h);
  }, [open, agent.status, agent.started]);
  const label = `${agent.name}: ${t(agent.statusLabel ?? STATUS_LABEL[agent.status])}${agent.activity ? `, ${agent.activity}` : ""}${pct != null ? `, ${t("context {n}%", { n: Math.round(pct * 100) })}` : ""}`;
  return (
    <div className="ui-crew__card" data-status={agent.status} data-depth={depth} data-open={open || undefined} style={{ ["--c" as string]: color }}>
      {arrived && <span key={ctx.lit!.id} className="ui-crew__floor" data-back={ctx.lit!.back || undefined} aria-hidden="true" />}
      <button
        type="button"
        ref={(e) => {
          if (e) ctx.cards.current.set(agent.id, e);
          else ctx.cards.current.delete(agent.id);
        }}
        className="ui-crew__face"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => ctx.toggle(agent)}
        onKeyDown={(e) => ctx.onKey(e, agent.id)}
      >
        <span className="ui-crew__top">
          <Mark agent={agent} color={color} />
          <span className="ui-crew__names">
            <span className="ui-crew__name">{agent.name}</span>
            {agent.model && <span className="ui-crew__model">{agent.model}</span>}
          </span>
          <span className="ui-crew__pill" data-status={agent.status}>
            {agent.status === "active" && <span className="ui-crew__ring" />}
            {agent.status === "done" && (
              <svg viewBox="0 0 24 24">
                <path d="M6 12.5l4 4 8-9" />
              </svg>
            )}
            {agent.status === "failed" && (
              <svg viewBox="0 0 24 24">
                <path d="M8 8l8 8M16 8l-8 8" />
              </svg>
            )}
            {t(agent.statusLabel ?? STATUS_LABEL[agent.status])}
          </span>
        </span>
        {agent.activity && (
          <span className="ui-crew__activity" title={agent.activity}>
            {agent.activity}
          </span>
        )}
        {pct != null && (
          <span className="ui-crew__ctx">
            <span className="ui-crew__bar">
              <span style={{ transform: `scaleX(${pct})`, background: barColor }} />
            </span>
            <span className="ui-crew__ctxn">
              {tok(Math.round(pct * (agent.contextLimit ?? 0)))} / {tok(agent.contextLimit ?? 0)}
            </span>
          </span>
        )}
        {(agent.tools?.length || agent.last) && (
          <span className="ui-crew__foot">
            {agent.tools?.slice(0, 4).map((tl) => (
              <span key={tl.name} className="ui-crew__tool" title={tl.name}>
                {tl.logo ?? tl.name.slice(0, 1)}
              </span>
            ))}
            {agent.last && (
              <span className="ui-crew__last">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 5v6a4 4 0 0 0 4 4h10M15 11l4 4-4 4" />
                </svg>
                <b>{agent.last.from}</b> <span>{agent.last.text}</span>
              </span>
            )}
          </span>
        )}
      </button>
      {open && <Details agent={agent} formatCost={ctx.formatCost} />}
    </div>
  );
}

function Details({ agent, formatCost }: { agent: CrewAgent; formatCost: (n: number) => string }) {
  const ms = agent.started ? (agent.ended ?? Date.now()) - agent.started : null;
  const usage = [ms != null && dur(ms), agent.cost != null && formatCost(agent.cost), agent.tokens != null && `${tok(agent.tokens)} tok`].filter(Boolean).join(" · ");
  return (
    <div className="ui-crew__details" role="dialog" aria-label={agent.name}>
      {agent.task && (
        <div className="ui-crew__row">
          <span className="ui-crew__k">{t("Task")}</span>
          <p className="ui-crew__task">{agent.task}</p>
        </div>
      )}
      {agent.model && (
        <div className="ui-crew__row ui-crew__inline">
          <span className="ui-crew__k">{t("Model")}</span>
          <span className="ui-crew__v">
            {agent.modelLogo}
            {agent.model}
          </span>
        </div>
      )}
      {usage && (
        <div className="ui-crew__row ui-crew__inline">
          <span className="ui-crew__k">{t("Usage")}</span>
          <span className="ui-crew__v">{usage}</span>
        </div>
      )}
      {agent.tools && agent.tools.length > 0 && (
        <div className="ui-crew__row ui-crew__inline">
          <span className="ui-crew__k">{t("Tools")}</span>
          <span className="ui-crew__v">{agent.tools.map((x) => x.name).join(", ")}</span>
        </div>
      )}
      {agent.last && (
        <div className="ui-crew__row">
          <span className="ui-crew__k">{t("Last handed")}</span>
          <p className="ui-crew__task">
            <b>{agent.last.from}</b> · {agent.last.text}
          </p>
        </div>
      )}
      {agent.detail}
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-crew {
  --ui-crew-bg: var(--aui-surface, #ffffff);
  --ui-crew-card: var(--aui-subtle, #fafafa);
  --ui-crew-line: var(--aui-border, #e7e7e7);
  --ui-crew-strong: var(--aui-border-strong, #cfcfcf);
  --ui-crew-ink: var(--aui-ink, #171717);
  --ui-crew-dim: #525252;
  --ui-crew-muted: var(--aui-muted, #8f8f8f);
  --ui-crew-wire: rgba(0, 0, 0, 0.12);
  --ui-crew-track: rgba(0, 0, 0, 0.07);
  --ui-crew-ok: #1f9d5c;
  --ui-crew-warn: #e08a00;
  --ui-crew-bad: #e5484d;
  --ui-crew-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-crew-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  color: var(--ui-crew-ink);
  font-size: 13px;
}
.ui-crew__head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.ui-crew__title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
.ui-crew__counts { display: flex; gap: 10px; font-size: 12px; color: var(--ui-crew-muted); font-variant-numeric: tabular-nums; }
.ui-crew__working { color: #6e9bff; }
.ui-crew__need { color: var(--ui-crew-warn); }
.ui-crew__tree, .ui-crew__kids { list-style: none; margin: 0; padding: 0; }
.ui-crew__kids { position: relative; display: flex; flex-direction: column; gap: 10px; margin-top: 10px; padding-left: 36px; }
.ui-crew__item { position: relative; }
.ui-crew__wires { position: absolute; left: 0; overflow: visible; pointer-events: none; }
.ui-crew__wire { fill: none; stroke: var(--ui-crew-wire); stroke-width: 1.5; transition: stroke 400ms; }
.ui-crew__wire[data-on] { stroke: color-mix(in srgb, var(--c) 55%, transparent); }
.ui-crew__light {
  fill: none; stroke: var(--c); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 18 100;
  filter: drop-shadow(0 0 4px var(--c)); animation: ui-crew-run 900ms cubic-bezier(0.45, 0, 0.2, 1) both;
}
.ui-crew__light[data-reverse] { animation-direction: reverse; }
.ui-crew__card {
  position: relative; overflow: hidden; border: 1px solid var(--ui-crew-line); border-radius: 16px; background: var(--ui-crew-card);
  transition: border-color 300ms, box-shadow 300ms; animation: ui-crew-in 420ms var(--ui-crew-ease) both;
}
.ui-crew__card[data-status="active"] { border-color: color-mix(in srgb, var(--c) 45%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 10%, transparent); }
.ui-crew__card[data-status="failed"] { border-color: color-mix(in srgb, var(--ui-crew-bad) 45%, transparent); }
.ui-crew__card[data-status="waiting"] { border-color: color-mix(in srgb, var(--ui-crew-warn) 45%, transparent); }
.ui-crew__card[data-status="idle"] .ui-crew__face { opacity: 0.62; }
.ui-crew__card[data-open] { border-color: var(--ui-crew-strong); }
.ui-crew__floor {
  position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, color-mix(in srgb, var(--c) 30%, transparent), transparent 70%);
  animation: ui-crew-floor 1400ms ease-out both;
}
.ui-crew__floor[data-back] { background: linear-gradient(90deg, rgba(255, 122, 107, 0.28), transparent 70%); }
.ui-crew__face {
  position: relative; display: flex; flex-direction: column; gap: 8px; width: 100%; padding: 11px 13px; border: 0; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer; transition: opacity 300ms;
}
.ui-crew__face:focus-visible { outline: 2px solid var(--ui-crew-focus); outline-offset: -2px; border-radius: 15px; }
.ui-crew__top { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ui-crew__mark { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border: 1px solid var(--ui-crew-line); border-radius: 9px; background: var(--ui-crew-bg); }
.ui-crew__pixels { grid-template-columns: repeat(3, 4px); gap: 2.5px; place-content: center; }
.ui-crew__pixels i { width: 4px; height: 4px; border-radius: 1px; background: var(--c); opacity: 0.16; }
.ui-crew__pixels i[data-on] { opacity: 0.95; }
.ui-crew__card[data-status="active"] .ui-crew__pixels i[data-on] { animation: ui-crew-twinkle 1.3s ease-in-out infinite; }
.ui-crew__names { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.25; }
.ui-crew__name { font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: clip; }
.ui-crew__model { font-size: 12px; color: var(--ui-crew-muted); white-space: nowrap; }
.ui-crew__pill {
  display: inline-flex; align-items: center; gap: 5px; flex: none; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 500;
  background: var(--ui-crew-track); color: var(--ui-crew-muted);
}
.ui-crew__pill[data-status="active"] { background: color-mix(in srgb, #6e9bff 16%, transparent); color: #8ab4ff; }
.ui-crew__pill[data-status="done"] { background: color-mix(in srgb, var(--ui-crew-ok) 14%, transparent); color: var(--ui-crew-ok); }
.ui-crew__pill[data-status="failed"] { background: color-mix(in srgb, var(--ui-crew-bad) 14%, transparent); color: var(--ui-crew-bad); }
.ui-crew__pill[data-status="waiting"] { background: color-mix(in srgb, var(--ui-crew-warn) 14%, transparent); color: var(--ui-crew-warn); }
.ui-crew__pill svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.ui-crew__ring { width: 9px; height: 9px; border-radius: 50%; border: 1.6px solid currentColor; border-right-color: transparent; animation: ui-crew-spin 800ms linear infinite; }
.ui-crew__activity { display: block; font-size: 12.5px; color: var(--ui-crew-dim); white-space: nowrap; overflow: hidden; text-overflow: clip; mask-image: linear-gradient(90deg, #000 88%, transparent); }
.ui-crew__card[data-status="active"] .ui-crew__activity {
  color: var(--ui-crew-ink);
  background: linear-gradient(90deg, var(--ui-crew-dim) 30%, var(--ui-crew-ink) 50%, var(--ui-crew-dim) 70%) 0 0 / 250% 100%;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: ui-crew-shimmer 2.2s linear infinite;
}
.ui-crew__ctx { display: flex; align-items: center; gap: 10px; }
.ui-crew__bar { position: relative; flex: 1; height: 3px; border-radius: 3px; background: var(--ui-crew-track); overflow: hidden; }
.ui-crew__bar span { position: absolute; inset: 0; transform-origin: left; transition: transform 700ms var(--ui-crew-ease), background 300ms; }
.ui-crew__ctxn { flex: none; font-size: 11.5px; color: var(--ui-crew-muted); font-variant-numeric: tabular-nums; }
.ui-crew__foot { display: flex; align-items: center; gap: 5px; min-width: 0; font-size: 12px; color: var(--ui-crew-muted); }
.ui-crew__tool { display: grid; place-items: center; flex: none; width: 18px; height: 18px; border: 1px solid var(--ui-crew-line); border-radius: 5px; background: var(--ui-crew-bg); font-size: 10px; text-transform: uppercase; }
.ui-crew__tool svg { width: 11px; height: 11px; }
.ui-crew__last { display: flex; align-items: center; gap: 5px; min-width: 0; margin-left: 3px; white-space: nowrap; overflow: hidden; mask-image: linear-gradient(90deg, #000 88%, transparent); }
.ui-crew__last svg { width: 12px; height: 12px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ui-crew__last b { color: var(--ui-crew-dim); font-weight: 600; }
.ui-crew__details {
  display: flex; flex-direction: column; gap: 9px; margin: 0 8px 8px; padding: 11px 12px; border: 1px solid var(--ui-crew-line); border-radius: 12px;
  background: var(--ui-crew-bg); animation: ui-crew-pop 260ms var(--ui-crew-ease) both;
}
.ui-crew__row { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ui-crew__inline { flex-direction: row; align-items: baseline; gap: 10px; }
.ui-crew__k { flex: none; width: 92px; font-size: 11.5px; color: var(--ui-crew-muted); }
.ui-crew__v { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; }
.ui-crew__task { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ui-crew-dim); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow-y: auto; }
.ui-crew__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@keyframes ui-crew-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-crew-pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@keyframes ui-crew-run { from { stroke-dashoffset: 18; } to { stroke-dashoffset: -100; } }
@keyframes ui-crew-floor { 0% { opacity: 0; } 18% { opacity: 1; } 100% { opacity: 0; } }
@keyframes ui-crew-twinkle { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.3; } }
@keyframes ui-crew-spin { to { transform: rotate(360deg); } }
@keyframes ui-crew-shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) {
  .ui-crew__card, .ui-crew__details, .ui-crew__floor, .ui-crew__light { animation: none; }
  .ui-crew__light, .ui-crew__floor { display: none; }
  .ui-crew__pixels i, .ui-crew__ring, .ui-crew__activity { animation: none !important; }
}

:where(.dark, [data-theme="dark"]) .ui-crew {
  --ui-crew-bg: var(--aui-surface, #1c1c1f);
  --ui-crew-card: #18181b;
  --ui-crew-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-crew-strong: var(--aui-border-strong, rgba(255, 255, 255, 0.18));
  --ui-crew-ink: var(--aui-ink, #ededed);
  --ui-crew-dim: #a1a1aa;
  --ui-crew-muted: var(--aui-muted, #8f8f8f);
  --ui-crew-wire: rgba(255, 255, 255, 0.13);
  --ui-crew-track: rgba(255, 255, 255, 0.08);
  --ui-crew-ok: #4fc38a;
  --ui-crew-warn: #f5a524;
  --ui-crew-bad: #ff6b6b;
  --ui-crew-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
}
`;
