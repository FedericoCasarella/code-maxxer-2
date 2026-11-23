/*
 * affectUI Pro – © Florian Höller (adfects), https://www.affectui.com
 * Used in code-maxxer under an affectUI Pro license. This file may not be copied,
 * redistributed or published on its own, outside code-maxxer. Licenses: https://www.affectui.com/pricing
 */
"use client";

import { t } from "@/lib/i18n";
import { Badge } from "./badge";
import { Popover } from "./popover";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Agent Crew (classic) – a lead on top, its sub-agents side by side below it, their own sub-agents hanging under them.
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

/** A way back, drawn under the chain: from where a check fails to the step that runs again. */
export type CrewLoop = { from: string; to: string; label?: string };

export type AgentCrewProps = {
  root: CrewAgent;
  handoffs?: CrewHandoff[];
  /** tree: the lead on top, its sub-agents side by side below. chain: the lead's sub-agents as steps in a row, left to right, the lead itself not drawn. */
  layout?: "tree" | "chain";
  /** chain only: the ways back, as arcs under the row */
  loops?: CrewLoop[];
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


type Pt = [number, number];
type Rect = { l: number; r: number; t: number; b: number; cx: number };

/** Points to a polyline with rounded corners. */
function rounded(pts: Pt[], radius = 10): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const a = Math.hypot(x - px, y - py);
    const b = Math.hypot(nx - x, ny - y);
    const r = Math.min(radius, a / 2, b / 2);
    if (r < 0.5) {
      d += ` L ${x} ${y}`;
      continue;
    }
    d += ` L ${x - ((x - px) / a) * r} ${y - ((y - py) / a) * r} Q ${x} ${y} ${x + ((nx - x) / b) * r} ${y + ((ny - y) / b) * r}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L ${lx} ${ly}`;
}

export function AgentCrew({ root, handoffs = [], layout = "tree", loops = [], title, headerRight, onSelect, formatCost = dollars, className }: AgentCrewProps) {
  const all = walk(root);
  const colorOf = new Map(all.map((a, i) => [a.id, a.color ?? PALETTE[i % PALETTE.length]]));
  const parentOf = new Map<string, string>();
  all.forEach((a) => a.children?.forEach((c) => parentOf.set(c.id, a.id)));
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
    const timer = window.setTimeout(() => setLit((x) => (x?.id === h.id ? null : x)), 1700);
    return () => clearTimeout(timer);
  }, [handoffs.map((h) => h.id).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Geometry of every tray, measured, for the connectors.
  const canvas = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // Wider than the chat: it scrolls sideways, and opens on the agent at work
  const activeId = (root.children ?? []).find((k) => k.status === "active")?.id;
  useEffect(() => {
    const sc = scroller.current;
    const node = activeId ? trays.current.get(activeId) : null;
    if (!sc || !node || sc.scrollWidth <= sc.clientWidth) return;
    const x = node.offsetLeft + node.offsetWidth / 2 - sc.clientWidth / 2;
    sc.scrollTo({ left: Math.max(0, x), behavior: "smooth" });
  }, [activeId]);
  const trays = useRef(new Map<string, HTMLDivElement>());
  const [geo, setGeo] = useState<{ w: number; h: number; rects: Map<string, Rect> } | null>(null);
  const ids = all.map((a) => a.id).join("|");
  useLayoutEffect(() => {
    const el = canvas.current;
    if (!el) return;
    // Cards side by side share one height (and their footers too), so every card in a row looks the same
    const even = () => {
      for (const sel of [":scope > .ui-crew__row > .ui-crew__col > .ui-crew__tray > .ui-crew__card", ":scope > .ui-crew__row > .ui-crew__col > .ui-crew__tray > .ui-crew__foot"]) {
        const els = [...el.querySelectorAll<HTMLElement>(sel)];
        els.forEach((x) => (x.style.minHeight = ""));
        const max = Math.max(0, ...els.map((x) => x.offsetHeight));
        els.forEach((x) => (x.style.minHeight = `${max}px`));
      }
    };
    const measure = () => {
      even();
      const base = el.getBoundingClientRect();
      const rects = new Map<string, Rect>();
      trays.current.forEach((node, id) => {
        const r = node.getBoundingClientRect();
        const l = r.left - base.left;
        const tp = r.top - base.top;
        rects.set(id, { l, r: l + r.width, t: tp, b: tp + r.height, cx: l + r.width / 2 });
      });
      setGeo({ w: el.offsetWidth, h: el.offsetHeight, rects });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    trays.current.forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, [ids, open]);

  // The way from a card's parent into it: lead → children over a bus, child → grandchildren down a rail.
  const wayIn = (id: string): Pt[] | null => {
    const pid = parentOf.get(id);
    const g = geo?.rects;
    const p = pid ? g?.get(pid) : undefined;
    const c = g?.get(id);
    if (!pid || !p || !c) return null;
    if (pid === root.id) {
      const kids = root.children ?? [];
      const top = Math.min(...kids.map((k) => g!.get(k.id)?.t ?? Infinity));
      const bus = p.b + (top - p.b) / 2;
      return [[p.cx, p.b], [p.cx, bus], [c.cx, bus], [c.cx, c.t]];
    }
    const x = p.l + 18;
    const y = c.t + 26;
    return [[x, p.b], [x, y], [c.l, y]];
  };
  const chain = layout === "chain";
  const order = (root.children ?? []).map((k) => k.id);
  // Chain: one step to the next, at the height of the cards' titles
  const stepWay = (from: string, to: string): Pt[] | null => {
    const a = geo?.rects.get(from);
    const b = geo?.rects.get(to);
    if (!a || !b) return null;
    const y = Math.min(a.t, b.t) + 34;
    return [[a.r, y], [b.l - 1, y]];
  };
  // Chain: a way back, below everything in the row
  const floor = geo ? Math.max(0, ...[...geo.rects.values()].map((r) => r.b)) + 22 : 0;
  const backWay = (from: string, to: string): Pt[] | null => {
    const a = geo?.rects.get(from);
    const b = geo?.rects.get(to);
    if (!a || !b) return null;
    return [[a.cx, a.b], [a.cx, floor], [b.cx, floor], [b.cx, b.b + 1]];
  };
  const chainPath = (h: CrewHandoff): Pt[] | null => {
    const i = order.indexOf(h.from);
    const j = order.indexOf(h.to);
    if (i < 0 || j < 0) return null;
    if (j === i + 1) return stepWay(h.from, h.to);
    if (j < i) return backWay(h.from, h.to);
    return null;
  };

  // A handoff's path: up from where it left to the shared parent, then down into the card it reaches.
  const lightPath = (h: CrewHandoff): Pt[] | null => {
    if (h.from === h.to) return null;
    const into = wayIn(h.to);
    if (parentOf.get(h.to) === h.from) return into;
    if (parentOf.get(h.from) === h.to) return wayIn(h.from)?.slice().reverse() ?? null;
    if (parentOf.get(h.from) === parentOf.get(h.to)) {
      const out = wayIn(h.from);
      if (!out || !into) return into;
      // Siblings under the lead share the bus: leave by it, skip the lead
      if (parentOf.get(h.to) === root.id) return [out[3], out[2], into[2], into[3]];
      return [...out.slice(1).reverse(), ...into.slice(1)];
    }
    return into;
  };

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

  const card = (a: CrewAgent, size: "lead" | "main" | "small") => (
    <Card
      key={a.id}
      agent={a}
      size={size}
      color={colorOf.get(a.id)!}
      open={open === a.id}
      arrived={lit?.to === a.id ? lit : null}
      onToggle={() => {
        setOpen((o) => (o === a.id ? null : a.id));
        onSelect?.(a);
      }}
      onClose={() => setOpen((o) => (o === a.id ? null : o))}
      onKey={(e) => onKey(e, a.id)}
      trayRef={(e) => (e ? trays.current.set(a.id, e) : trays.current.delete(a.id))}
      cardRef={(e) => (e ? cards.current.set(a.id, e) : cards.current.delete(a.id))}
      formatCost={formatCost}
    />
  );
  const kids = root.children ?? [];
  const light = lit ? (chain && order.includes(lit.to) ? chainPath(lit) : lightPath(lit)) : null;
  const lightColor = lit?.back ? "#ff7a6b" : colorOf.get(parentOf.get(lit?.to ?? "") ?? "") ?? colorOf.get(lit?.from ?? "") ?? "#6e9bff";

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
      <div className="ui-crew__scroll" ref={scroller}>
      <div className="ui-crew__canvas" data-chain={chain || undefined} data-loops={(chain && loops.length > 0) || undefined} ref={canvas} role="tree" aria-label={typeof title === "string" ? title : t("Agents")}>
        {geo && (
          <svg className="ui-crew__wires" width={geo.w} height={geo.h} aria-hidden="true">
            {chain &&
              kids.slice(1).map((k, i) => {
                const pts = stepWay(kids[i].id, k.id);
                if (!pts) return null;
                const [x, y] = pts[1];
                return (
                  <path key={`step-${k.id}`} d={`${rounded(pts)} M ${x - 6} ${y - 4} L ${x} ${y} L ${x - 6} ${y + 4}`} className="ui-crew__wire" data-on={k.status !== "idle" || undefined} style={{ ["--c" as string]: colorOf.get(k.id) }} />
                );
              })}
            {chain &&
              loops.map((l) => {
                const pts = backWay(l.from, l.to);
                if (!pts) return null;
                const [x, y] = pts[3];
                return (
                  <g key={`loop-${l.from}-${l.to}`}>
                    <path d={`${rounded(pts, 12)} M ${x - 4} ${y + 6} L ${x} ${y} L ${x + 4} ${y + 6}`} className="ui-crew__wire ui-crew__wire--back" />
                    {l.label && (
                      <text x={(pts[1][0] + pts[2][0]) / 2} y={floor + 14} textAnchor="middle" className="ui-crew__loop-label">
                        {l.label}
                      </text>
                    )}
                  </g>
                );
              })}
            {all
              .filter((a) => a.id !== root.id && !(chain && parentOf.get(a.id) === root.id))
              .map((a) => {
                const pts = wayIn(a.id);
                const pid = parentOf.get(a.id)!;
                return pts ? (
                  <path key={a.id} d={rounded(pts)} className="ui-crew__wire" data-on={a.status !== "idle" || undefined} style={{ ["--c" as string]: colorOf.get(pid) }} />
                ) : null;
              })}
            {[...(chain ? [] : [root]), ...kids].filter((a) => a.children?.length).map((a) => {
              const r = geo.rects.get(a.id);
              if (!r) return null;
              const x = a.id === root.id ? r.cx : r.l + 18;
              return <circle key={a.id} cx={x} cy={r.b} r={3.5} className="ui-crew__knob" style={{ ["--c" as string]: colorOf.get(a.id) }} />;
            })}
            {light && (
              <path key={lit!.id} d={rounded(light)} pathLength={100} className="ui-crew__light" style={{ ["--c" as string]: lightColor }} />
            )}
          </svg>
        )}
        {!chain && <div className="ui-crew__lead">{card(root, "lead")}</div>}
        {kids.length > 0 && (
          <div className="ui-crew__row" role="group">
            {kids.map((k) => (
              <div key={k.id} className="ui-crew__col">
                {card(k, "main")}
                {(k.children?.length ?? 0) > 0 && (
                  <div className="ui-crew__stack" role="group">
                    {k.children!.map((g) => card(g, "small"))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      <div className="ui-crew__sr" aria-live="polite">
        {lit ? `${all.find((a) => a.id === lit.from)?.name ?? ""} → ${all.find((a) => a.id === lit.to)?.name ?? ""}${lit.label ? `: ${lit.label}` : ""}` : ""}
      </div>
    </div>
  );
}

function Mark({ agent, color }: { agent: CrewAgent; color: string }) {
  if (agent.logo) return <span className="ui-crew__mark">{agent.logo}</span>;
  // A 3×3 pixel pattern per name; the middle dot is always on
  const bits = hash(agent.name) | 16;
  return (
    <span className="ui-crew__mark ui-crew__pixels" style={{ ["--c" as string]: color }} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} data-on={(bits >> i) & 1 || undefined} style={{ animationDelay: `${((i % 3) + Math.floor(i / 3)) * 110}ms` }} />
      ))}
    </span>
  );
}

/** The agents a card started (and theirs): how many, and how many are at work now. */
const crewCount = (a: CrewAgent): { total: number; active: number } => {
  let total = 0;
  let active = 0;
  for (const c of a.children ?? []) {
    const sub = crewCount(c);
    total += 1 + sub.total;
    active += (c.status === "active" ? 1 : 0) + sub.active;
  }
  return { total, active };
};
const crewText = (n: { total: number; active: number }) =>
  n.active ? t("{n} agents · {a} at work", { n: n.total, a: n.active }) : n.total === 1 ? t("1 agent") : t("{n} agents", { n: n.total });

function Card(p: {
  agent: CrewAgent;
  size: "lead" | "main" | "small";
  color: string;
  open: boolean;
  arrived: CrewHandoff | null;
  onToggle: () => void;
  onClose: () => void;
  onKey: (e: KeyboardEvent) => void;
  trayRef: (e: HTMLDivElement | null) => void;
  cardRef: (e: HTMLButtonElement | null) => void;
  formatCost: (n: number) => string;
}) {
  const { agent, size, color } = p;
  const anchor = useRef<HTMLDivElement | null>(null);
  const lastEl = useRef<HTMLButtonElement | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  const pct = agent.context != null ? Math.max(0, Math.min(1, agent.context)) : null;
  const barColor = pct == null ? color : pct >= 0.95 ? "var(--ui-crew-bad)" : pct >= 0.8 ? "var(--ui-crew-warn)" : color;
  const small = size === "small";
  const status = t(agent.statusLabel ?? STATUS_LABEL[agent.status]);
  const label = `${agent.name}: ${status}${agent.activity ? `, ${agent.activity}` : ""}${pct != null ? `, ${t("context {n}%", { n: Math.round(pct * 100) })}` : ""}`;
  const foot = true;
  const crew = crewCount(agent);
  return (
    <div
      ref={(e) => {
        anchor.current = e;
        p.trayRef(e);
      }}
      className="ui-crew__tray" data-size={size} data-status={agent.status} data-open={p.open || undefined} style={{ ["--c" as string]: color }} role="treeitem">
      <button type="button" ref={p.cardRef} className="ui-crew__card" aria-label={label} aria-expanded={p.open} aria-haspopup="dialog" onClick={p.onToggle} onKeyDown={p.onKey}>
        {p.arrived && <span key={p.arrived.id} className="ui-crew__floor" data-edge={small ? "left" : "top"} data-back={p.arrived.back || undefined} aria-hidden="true" />}
        <span className="ui-crew__top">
          <Mark agent={agent} color={color} />
          <span className="ui-crew__names">
            <span className="ui-crew__name">{agent.name}</span>
            {agent.model && <span className="ui-crew__model">{agent.model}</span>}
          </span>
          {crew.total > 0 && (
            // How many agents this step started: a bot and a count, before the status
            <Badge
              className="ui-crew__crew"
              title={crewText(crew)}
              tone={crew.active > 0 ? "info" : "neutral"}
              icon={
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 8V4H8M4 12h2M18 12h2M15 13v2M9 13v2" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                </svg>
              }
            >
              {crew.total}
            </Badge>
          )}
          <span className="ui-crew__pill" data-status={agent.status} data-compact={undefined} title={status}>
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
            {(agent.status === "idle" || agent.status === "paused" || agent.status === "waiting") && <span className="ui-crew__dot" />}
            <span>{status}</span>
          </span>
        </span>
        <span className="ui-crew__activity" title={agent.activity}>
          {agent.activity || " "}
        </span>
        {pct != null ? (
          <span className="ui-crew__ctx">
            <span className="ui-crew__bar">
              <span style={{ transform: `scaleX(${pct})`, background: barColor }} />
            </span>
            <span className="ui-crew__ctxn">
              {tok(Math.round(pct * (agent.contextLimit ?? 0)))} / {tok(agent.contextLimit ?? 0)}
            </span>
          </span>
        ) : null}
      </button>
      {foot && (
        <div className="ui-crew__foot">

          {agent.tools?.slice(0, 4).map((tl) => (
            <span key={tl.name} className="ui-crew__tool" title={tl.name}>
              {tl.logo ?? tl.name.slice(0, 1)}
            </span>
          ))}
          {agent.last ? (
            // Three lines at most; the whole handoff opens in a popover.
            <button type="button" ref={lastEl} className="ui-crew__last ui-crew__last--open" onClick={() => setLastOpen((o) => !o)} aria-expanded={lastOpen}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5v6a4 4 0 0 0 4 4h10M15 11l4 4-4 4" />
              </svg>
              <b>{agent.last.from}</b> <span>{agent.last.text}</span>
            </button>
          ) : (
            <span className="ui-crew__last">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 5v6a4 4 0 0 0 4 4h10M15 11l4 4-4 4" />
              </svg>
              <span>{t("Nothing handed yet")}</span>
            </span>
          )}
          {agent.last && (
            <Popover open={lastOpen} onClose={() => setLastOpen(false)} anchor={lastEl} side="bottom" align="start" width={340} offset={6} title={agent.last.from}>
              <p className="ui-crew__last-full">{agent.last.text}</p>
            </Popover>
          )}
        </div>
      )}
      <Popover open={p.open} onClose={p.onClose} anchor={anchor} side="bottom" align="start" width={340} offset={8} unstyled focusOnOpen={false}>
        <div className="ui-crew ui-crew__pop" style={{ ["--c" as string]: color }}>
          <Details agent={agent} formatCost={p.formatCost} />
        </div>
      </Popover>
    </div>
  );
}

function Details({ agent, formatCost }: { agent: CrewAgent; formatCost: (n: number) => string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (agent.status !== "active" || !agent.started) return;
    const h = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(h);
  }, [agent.status, agent.started]);
  const ms = agent.started ? (agent.ended ?? Date.now()) - agent.started : null;
  const crew = crewCount(agent);
  const usage = [ms != null && dur(ms), agent.cost != null && formatCost(agent.cost), agent.tokens != null && `${tok(agent.tokens)} tok`].filter(Boolean).join(" · ");
  return (
    <div className="ui-crew__details" role="dialog" aria-label={agent.name}>
      {agent.task && (
        <div className="ui-crew__drow">
          <span className="ui-crew__k">{t("Task")}</span>
          <p className="ui-crew__task">{agent.task}</p>
        </div>
      )}
      {agent.model && (
        <div className="ui-crew__drow ui-crew__inline">
          <span className="ui-crew__k">{t("Model")}</span>
          <span className="ui-crew__v">
            {agent.modelLogo}
            {agent.model}
          </span>
        </div>
      )}
      {usage && (
        <div className="ui-crew__drow ui-crew__inline">
          <span className="ui-crew__k">{t("Usage")}</span>
          <span className="ui-crew__v">{usage}</span>
        </div>
      )}
      {crew.total > 0 && (
        <div className="ui-crew__drow ui-crew__inline">
          <span className="ui-crew__k">{t("Agents")}</span>
          <span className="ui-crew__v">{crewText(crew)}</span>
        </div>
      )}
      {agent.tools && agent.tools.length > 0 && (
        <div className="ui-crew__drow ui-crew__inline">
          <span className="ui-crew__k">{t("Tools")}</span>
          <span className="ui-crew__v">{agent.tools.map((x) => x.name).join(", ")}</span>
        </div>
      )}
      {agent.last && (
        <div className="ui-crew__drow">
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
  --ui-crew-tray: #ececec;
  --ui-crew-card: var(--aui-surface, #ffffff);
  --ui-crew-line: var(--aui-border, #e4e4e4);
  --ui-crew-strong: var(--aui-border-strong, #cfcfcf);
  --ui-crew-ink: var(--aui-ink, #171717);
  --ui-crew-dim: #5b5b5b;
  --ui-crew-muted: var(--aui-muted, #8f8f8f);
  --ui-crew-wire: #c9d6f2;
  --ui-crew-track: rgba(0, 0, 0, 0.07);
  --ui-crew-ok: #1f9d5c;
  --ui-crew-warn: #e08a00;
  --ui-crew-bad: #e5484d;
  --ui-crew-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-crew-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  color: var(--ui-crew-ink);
  font-size: 13px;
}
.ui-crew__head { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.ui-crew__title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
.ui-crew__counts { display: flex; gap: 10px; font-size: 12px; color: var(--ui-crew-muted); font-variant-numeric: tabular-nums; }
.ui-crew__working { color: #4d7cff; }
.ui-crew__need { color: var(--ui-crew-warn); }

.ui-crew__scroll { overflow-x: auto; overflow-y: hidden; padding-bottom: 6px; scrollbar-width: thin; }
.ui-crew__canvas { position: relative; display: flex; flex-direction: column; align-items: center; gap: 30px; width: max-content; min-width: 100%; padding: 2px; }
.ui-crew__wires { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; }
.ui-crew__wire { fill: none; stroke: var(--ui-crew-wire); stroke-width: 1.5; transition: stroke 400ms; }
.ui-crew__wire[data-on] { stroke: color-mix(in srgb, var(--c) 70%, transparent); }
.ui-crew__knob { fill: var(--ui-crew-card); stroke: color-mix(in srgb, var(--c) 75%, transparent); stroke-width: 1.5; }
.ui-crew__light {
  fill: none; stroke: var(--c); stroke-width: 2.4; stroke-linecap: round; stroke-dasharray: 16 100;
  filter: drop-shadow(0 0 4px var(--c)); animation: ui-crew-run 1100ms cubic-bezier(0.45, 0, 0.2, 1) both;
}
.ui-crew__lead { position: relative; width: min(280px, 100%); }
.ui-crew__row { position: relative; display: flex; align-items: flex-start; justify-content: center; gap: 14px; }
.ui-crew__canvas[data-chain] .ui-crew__row { gap: 40px; }
.ui-crew__canvas[data-loops] { padding-bottom: 46px; }
.ui-crew__wire--back { stroke: color-mix(in srgb, var(--ui-crew-bad) 55%, transparent); stroke-dasharray: 4 4; }
.ui-crew__loop-label { font-size: 11px; fill: var(--ui-crew-muted); }
.ui-crew__col { position: relative; display: flex; flex-direction: column; gap: 14px; flex: none; width: 264px; }
.ui-crew__stack { display: flex; flex-direction: column; gap: 12px; padding-left: 26px; }
.ui-crew__top { align-items: flex-start; }
.ui-crew__pill { margin-top: 2px; }

.ui-crew__tray {
  position: relative; border-radius: 16px; background: var(--ui-crew-tray); padding: 3px;
  animation: ui-crew-in 420ms var(--ui-crew-ease) both;
}

.ui-crew__card {
  position: relative; overflow: hidden; display: flex; flex-direction: column; gap: 7px; width: 100%; padding: 10px 12px 11px;
  border: 1px solid var(--ui-crew-line); border-radius: 13px; background: var(--ui-crew-card); color: inherit; font: inherit; text-align: left;
  cursor: pointer; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); transition: border-color 300ms, box-shadow 300ms;
}
.ui-crew__card:hover { border-color: var(--ui-crew-strong); }
/* While a node works, the others step back: dimmer, so the one at work stands out */
.ui-crew:has(.ui-crew__tray[data-status="active"]) .ui-crew__tray:not([data-status="active"]):not([data-status="waiting"]) > .ui-crew__card,
.ui-crew:has(.ui-crew__tray[data-status="active"]) .ui-crew__tray:not([data-status="active"]):not([data-status="waiting"]) > .ui-crew__foot { opacity: .45; transition: opacity 200ms ease; }
.ui-crew:has(.ui-crew__tray[data-status="active"]) .ui-crew__tray:not([data-status="active"]):hover > .ui-crew__card,
.ui-crew:has(.ui-crew__tray[data-status="active"]) .ui-crew__tray:not([data-status="active"]):hover > .ui-crew__foot { opacity: 1; }
.ui-crew__tray[data-open] .ui-crew__card { border-color: var(--ui-crew-strong); }
.ui-crew__card:focus-visible { outline: 2px solid var(--ui-crew-focus); outline-offset: 2px; }
/* When an agent starts, a glow in its colour rises from the top and fades away */
.ui-crew__card::before {
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background: linear-gradient(180deg, color-mix(in srgb, var(--c) 26%, transparent), transparent 72%);
}
.ui-crew__tray[data-status="active"] .ui-crew__card::before { animation: ui-crew-glow 1800ms ease-out both; }
@keyframes ui-crew-glow {
  0% { opacity: 0; clip-path: inset(0 0 100% 0); }
  25% { opacity: 1; clip-path: inset(0 0 0 0); }
  100% { opacity: 0; clip-path: inset(0 0 0 0); }
}
.ui-crew__floor { position: absolute; inset: 0; pointer-events: none; animation: ui-crew-floor 1500ms ease-out both; }
.ui-crew__floor[data-edge="top"] { background: linear-gradient(180deg, color-mix(in srgb, var(--c) 34%, transparent), transparent 75%); }
.ui-crew__floor[data-edge="left"] { background: linear-gradient(90deg, color-mix(in srgb, var(--c) 34%, transparent), transparent 75%); }
.ui-crew__floor[data-back] { --c: #ff7a6b; }
.ui-crew__top { position: relative; display: flex; align-items: center; gap: 9px; min-width: 0; }
.ui-crew__mark { display: grid; place-items: center; flex: none; width: 26px; height: 26px; border: 1px solid var(--ui-crew-line); border-radius: 7px; background: var(--ui-crew-card); }
.ui-crew__pixels { grid-template-columns: repeat(3, 3.5px); gap: 2px; place-content: center; }
.ui-crew__pixels i { width: 3.5px; height: 3.5px; border-radius: 1px; background: var(--c); opacity: 0.18; }
.ui-crew__pixels i[data-on] { opacity: 0.95; }
.ui-crew__tray[data-status="active"] .ui-crew__pixels i[data-on] { animation: ui-crew-twinkle 1.3s ease-in-out infinite; }
.ui-crew__names { display: flex; flex-direction: column; flex: 1; min-width: 0; line-height: 1.25; }
.ui-crew__name { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.ui-crew__model { font-size: 11.5px; color: var(--ui-crew-muted); overflow-wrap: anywhere; }
.ui-crew__pill {
  display: inline-flex; align-items: center; gap: 4px; flex: none; height: 20px; padding: 0 7px; border-radius: 999px; font-size: 11px; font-weight: 500;
  background: var(--ui-crew-track); color: var(--ui-crew-muted);
}
.ui-crew__pill[data-compact] { width: 20px; padding: 0; justify-content: center; }
.ui-crew__pill[data-status="active"] { background: color-mix(in srgb, #4d7cff 14%, transparent); color: #3b6cf6; }
.ui-crew__pill[data-status="done"] { background: color-mix(in srgb, var(--ui-crew-ok) 14%, transparent); color: var(--ui-crew-ok); }
.ui-crew__pill[data-status="failed"] { background: color-mix(in srgb, var(--ui-crew-bad) 14%, transparent); color: var(--ui-crew-bad); }
.ui-crew__pill[data-status="waiting"] { background: color-mix(in srgb, var(--ui-crew-warn) 14%, transparent); color: var(--ui-crew-warn); }
.ui-crew__pill svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.ui-crew__dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.ui-crew__ring { width: 9px; height: 9px; border-radius: 50%; border: 1.6px solid currentColor; border-right-color: transparent; animation: ui-crew-spin 800ms linear infinite; }
.ui-crew__activity { position: relative; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; font-size: 12.5px; line-height: 1.45; color: var(--ui-crew-dim); overflow-wrap: anywhere; scrollbar-width: thin; }
.ui-crew__tray[data-status="active"] .ui-crew__activity {
  background: linear-gradient(90deg, var(--ui-crew-dim) 30%, var(--ui-crew-ink) 50%, var(--ui-crew-dim) 70%) 0 0 / 250% 100%;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: ui-crew-shimmer 2.2s linear infinite;
}
.ui-crew__ctx { position: relative; display: flex; align-items: center; gap: 10px; margin-top: auto; }
.ui-crew__bar { position: relative; flex: 1; height: 3px; border-radius: 3px; background: var(--ui-crew-track); overflow: hidden; }
.ui-crew__bar span { position: absolute; inset: 0; transform-origin: left; transition: transform 700ms var(--ui-crew-ease), background 300ms; }
.ui-crew__ctxn { flex: none; font-size: 11px; color: var(--ui-crew-muted); font-variant-numeric: tabular-nums; }
.ui-crew__foot { display: flex; align-items: flex-start; box-sizing: border-box; flex-wrap: wrap; gap: 4px; min-width: 0; padding: 6px 8px 5px; font-size: 11.5px; color: var(--ui-crew-muted); }
.ui-crew__crew { flex: none; margin-right: -3px; }
.ui-crew__crew svg { fill: none; stroke: var(--color-accent); color: var(--color-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ui-crew__tool { display: grid; place-items: center; flex: none; width: 16px; height: 16px; color: var(--ui-crew-dim); font-size: 10px; text-transform: uppercase; }
.ui-crew__tool svg { width: 12px; height: 12px; }
.ui-crew__last { display: block; flex: 1; min-width: 0; margin-left: 4px; line-height: 1.45; overflow-wrap: anywhere; }
.ui-crew__last svg { display: inline-block; vertical-align: -1px; margin-right: 3px; width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ui-crew__last b { color: var(--ui-crew-dim); font-weight: 600; }
.ui-crew__last--open {
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden;
  padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: start; cursor: pointer; transition: color 160ms ease;
}
.ui-crew__last--open:hover, .ui-crew__last--open[aria-expanded="true"] { color: var(--ui-crew-ink); }
.ui-crew__last--open:hover b, .ui-crew__last--open[aria-expanded="true"] b { color: var(--ui-crew-ink); }
.ui-crew__last-full { margin: 0; max-height: 320px; overflow-y: auto; font-size: 12.5px; line-height: 1.55; white-space: pre-line; overflow-wrap: anywhere; scrollbar-width: thin; }
.ui-crew__details {
  display: flex; flex-direction: column; gap: 10px; max-height: min(420px, 60vh); overflow-y: auto; padding: 12px 13px; border: 1px solid var(--ui-crew-strong);
  border-radius: 14px; background: var(--ui-crew-tray); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35); scrollbar-width: thin;
}
.ui-crew__drow { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ui-crew__inline { flex-direction: row; align-items: baseline; gap: 10px; }
.ui-crew__k { flex: none; font-size: 11.5px; color: var(--ui-crew-muted); }
.ui-crew__inline .ui-crew__k { width: 74px; }
.ui-crew__v { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; }
.ui-crew__task { margin: 0; font-size: 12.5px; line-height: 1.5; color: var(--ui-crew-dim); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 160px; overflow-y: auto; }
.ui-crew__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@keyframes ui-crew-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-crew-pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@keyframes ui-crew-run { from { stroke-dashoffset: 16; } to { stroke-dashoffset: -100; } }
@keyframes ui-crew-floor { 0% { opacity: 0; } 18% { opacity: 1; } 100% { opacity: 0; } }
@keyframes ui-crew-twinkle { 0%, 100% { opacity: 0.95; } 50% { opacity: 0.3; } }
@keyframes ui-crew-spin { to { transform: rotate(360deg); } }
@keyframes ui-crew-shimmer { from { background-position: 100% 0; } to { background-position: -150% 0; } }
@media (prefers-reduced-motion: reduce) {
  .ui-crew__tray, .ui-crew__details { animation: none; }
  .ui-crew__light, .ui-crew__floor { display: none; }
  .ui-crew__pixels i, .ui-crew__ring, .ui-crew__activity { animation: none !important; }
}

:where(.dark, [data-theme="dark"]) .ui-crew {
  --ui-crew-tray: #232327;
  --ui-crew-card: #18181b;
  --ui-crew-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-crew-strong: var(--aui-border-strong, rgba(255, 255, 255, 0.18));
  --ui-crew-ink: var(--aui-ink, #ededed);
  --ui-crew-dim: #a1a1aa;
  --ui-crew-muted: var(--aui-muted, #8f8f8f);
  --ui-crew-wire: rgba(120, 150, 220, 0.35);
  --ui-crew-track: rgba(255, 255, 255, 0.08);
  --ui-crew-ok: #4fc38a;
  --ui-crew-warn: #f5a524;
  --ui-crew-bad: #ff6b6b;
  --ui-crew-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
}
:where(.dark, [data-theme="dark"]) .ui-crew__pill[data-status="active"] { color: #8ab4ff; }
:where(.dark, [data-theme="dark"]) .ui-crew__working { color: #8ab4ff; }
`;
