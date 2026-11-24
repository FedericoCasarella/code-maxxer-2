"use client";
/*
 * affectUI Pro – © Florian Höller (adfects), https://www.affectui.com
 * Used in code-maxxer under an affectUI Pro license. This file may not be copied,
 * redistributed or published on its own, outside code-maxxer. Licenses: https://www.affectui.com/pricing
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { t as tr } from "@/lib/i18n";
import { TreeCard, type TreeCardProps } from "./agent-tree";

/*
 * Agent State Machine – one agent as a state diagram, in a single self-contained file. The classic style:
 * rounder card with a hairline border, rounder states, pill tags and buttons, firmer type.
 *   · every state the agent can be in is a card – Planning, Calling tool, Waiting for you, Writing, Done
 *   · every transition is a line from a hollow dot to a filled arrowhead, with a chip counting how often the run took it;
 *     forward to the right, back to an earlier state around underneath, a retry in the same state as a loop on top
 *   · the run starts at a black dot; a final state carries a bullseye
 *   · the current state glows in the agent's blue with its pixel mark twinkling; each card says how long the agent
 *     spent there and how often it came back
 *   · when the agent moves on, a light runs along that transition and its count rolls up
 * Point at a state and its transitions come forward; click a state or a count and its card opens.
 * The styles are injected below, so no extra files are needed.
 */

export type MachineState = {
  id: string;
  label: string;
  /** waiting – needs a person, amber; error – red; final – the run ends here, a bullseye */
  kind?: "normal" | "waiting" | "error" | "final";
  /** A line on what the agent does in it, in its card */
  description?: string;
  /** The color of its icon – by default a quiet grey */
  color?: string;
  /** Its own mark instead of the default glyph (code-maxxer: the pipeline node's role glyph) */
  icon?: ReactNode;
  /** code-maxxer: draw the state as an Agent Tree card (who, model, status, task, time) – the whole diagram switches to card size */
  card?: Omit<TreeCardProps, "name">;
  /** The tools the agent works with in it – small overlapping tiles with their logos on the card */
  tools?: { name: string; logo?: ReactNode }[];
  /** Total time spent in it so far, ms */
  time?: number;
  /** How often the run entered it */
  visits?: number;
  /** Where it sits – by default the first state is column 0 and each state one column after the first one leading to it */
  col?: number;
  row?: number;
};

export type MachineTransition = {
  /** By default from->to */
  id?: string;
  from: string;
  to: string;
  /** What makes the agent move – "needs data", "tool result" */
  label: string;
  /** How often the run took it – 0 draws it dashed */
  count?: number;
  /** In its card: e.g. the last time it fired and why */
  detail?: string;
};

export type AgentStateMachineProps = {
  states: MachineState[];
  transitions: MachineTransition[];
  /** The state the agent is in now – when it changes along a transition, a light runs along it */
  current?: string;
  /** The agent – its pixel mark and name in the header */
  agent?: { id?: string; name: string; model?: string; /** The model maker's logo, before the model */ logo?: ReactNode };
  title?: string;
  /** Show Approve and Reject in the card of the waiting state the agent is in – the card closes after either */
  onApprove?: (state: MachineState) => void;
  onReject?: (state: MachineState) => void;
  /** A click on a state or a count – its card opens; null when it closes */
  onSelect?: (item: { state: MachineState } | { transition: MachineTransition } | null) => void;
  /** Formats the time spent in a state – defaults to 12s / 2m 05s */
  formatTime?: (ms: number) => string;
  /** code-maxxer: leave the header out (shown elsewhere, see AgentStateMachineHead) */
  hideHead?: boolean;
  className?: string;
};

/* ---------- Helpers ---------- */

const took = (ms: number) => {
  const s = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
/** Counts with a thousands separator – 1,284; on a card from 10,000 on short – 12K */
const num = (n: number) => new Intl.NumberFormat("en").format(Math.max(0, Math.round(n)));
const short = (n: number) => (n >= 10_000 ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n) : num(n));
const tid = (t: MachineTransition) => t.id ?? `${t.from}->${t.to}`;
const KIND: Record<NonNullable<MachineState["kind"]>, string> = { normal: "State", waiting: "Waits for a person", error: "Error", final: "Final state" };
const kindLabel = (k: NonNullable<MachineState["kind"]>) => tr(KIND[k]);

/** Twinkle order of a pixel mark – a diagonal wave */
const WAVE = [0, 120, 240, 120, 240, 360, 240, 360, 480];
/** The agent's own pixel mark: a 3×3 pattern, mirrored left to right, from its id – never fewer than five squares */
const pattern = (id: string) => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  for (let k = 0; k < 64; k++) {
    const bits = (h >> (k % 26)) & 63;
    const cells = [0, 1, 2].flatMap((r) => {
      const a = (bits >> (r * 2)) & 1;
      const b = (bits >> (r * 2 + 1)) & 1;
      return [a, b, a];
    });
    if (cells.filter(Boolean).length >= 5) return cells;
    h = (h * 1103515245 + 12345) >>> 0;
  }
  return [1, 0, 1, 0, 1, 0, 1, 0, 1];
};

function Mark({ id, busy }: { id: string; busy?: boolean }) {
  return (
    <span className="ui-asm__mark" data-busy={busy ? "" : undefined} aria-hidden="true">
      {pattern(id).map((on, i) => (
        <i key={i} data-on={on ? "" : undefined} style={{ animationDelay: `${WAVE[i]}ms` }} />
      ))}
    </span>
  );
}

/* Icons: Hugeicons Free (MIT, © Hugeicons, hugeicons.com), redrawn at 12px */
const Glyph = ({ kind, final }: { kind: NonNullable<MachineState["kind"]>; final?: boolean }) => {
  if (kind === "final")
    return (
      <svg className="ui-asm__glyph" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r={final ? 5 : 4} fill="currentColor" />
      </svg>
    );
  if (kind === "waiting")
    return (
      <svg className="ui-asm__glyph" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "error")
    return (
      <svg className="ui-asm__glyph" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
        <path d="M14.5 9.5l-5 5M9.5 9.5l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg className="ui-asm__glyph" width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
};
const CloseIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ---------- The light along a transition ---------- */

/**
 * A short light running once along the transition the agent just took – as thick as the line, full at its head and
 * fading out behind it: several dashes of growing length end at the same head, each faint, so they stack up to full
 * there and thin out towards the tail
 */
const TAIL = 56;
const LAYERS = 8;
function Light({ d }: { d: string }) {
  const refs = useRef<(SVGPathElement | null)[]>([]);
  useLayoutEffect(() => {
    const layer = refs.current.filter(Boolean) as SVGPathElement[];
    if (!layer.length || typeof layer[0].animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const len = layer[0].getTotalLength();
    const ms = Math.max(520, Math.min(1300, len * 4.5));
    const anims = layer.map((el, k) => {
      const l = (TAIL * (k + 1)) / LAYERS;
      el.style.strokeDasharray = `${l} ${len + TAIL * 2}`;
      return el.animate([{ strokeDashoffset: l }, { strokeDashoffset: -(len + TAIL) + l }], { duration: ms, easing: "cubic-bezier(0.45, 0, 0.3, 1)", fill: "both" });
    });
    return () => anims.forEach((a) => a.cancel());
  }, [d]);
  return (
    <g className="ui-asm__light">
      {Array.from({ length: LAYERS }, (_, k) => (
        <path key={k} ref={(el) => void (refs.current[k] = el)} d={d} />
      ))}
    </g>
  );
}

/* ---------- The card: in the top layer, so no edge cuts it ---------- */

function Card({
  anchor,
  bounds,
  label,
  focusIn,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  bounds: { current: HTMLElement | null };
  label: string;
  focusIn?: boolean;
  onClose: (back?: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusIn) (ref.current?.querySelector<HTMLElement>(".ui-asm__btn--primary") ?? ref.current?.querySelector<HTMLElement>(".ui-asm__card-close"))?.focus();
  }, [focusIn]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    try {
      el.showPopover?.();
    } catch {
      /* already open */
    }
    const put = () => {
      const a = anchor.getBoundingClientRect();
      const box = (bounds.current ?? document.body).getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const lo = Math.max(8, box.left);
      const hi = Math.min(window.innerWidth - 8, box.right);
      const left = Math.min(Math.max(a.left + a.width / 2 - w / 2, lo), Math.max(lo, hi - w));
      let top = a.bottom + 8;
      let side = "below";
      if (top + h > window.innerHeight - 8 && a.top - 8 - h > 8) {
        top = a.top - 8 - h;
        side = "above";
      }
      el.style.left = `${Math.round(left)}px`;
      el.style.top = `${Math.round(top)}px`;
      el.dataset.side = side;
    };
    put();
    const ro = new ResizeObserver(put);
    ro.observe(el);
    window.addEventListener("scroll", put, true);
    window.addEventListener("resize", put);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", put, true);
      window.removeEventListener("resize", put);
      try {
        el.hidePopover?.();
      } catch {
        /* already closed */
      }
    };
  }, [anchor, bounds]);
  // A click anywhere else closes it – a state or a count opens its own; Esc closes it from anywhere
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || anchor.contains(t) || t.closest?.(".ui-asm__state, .ui-asm__count")) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(true);
    };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
    };
  }, [anchor, onClose]);
  return (
    <div ref={ref} popover="manual" role="dialog" aria-label={label} className="ui-asm__card">
      {children}
    </div>
  );
}

/* ---------- The diagram ---------- */

/* Geometry, px */
const NODE_W = 150;
const NODE_H = 58;
const COL = 196;
const ROW = 116;
const START = 44;
const TOP = 44;
const UNDER = 14;

type Placed = { s: MachineState; col: number; row: number; x: number; y: number };
type Edge = {
  t: MachineTransition;
  id: string;
  from: Placed;
  to: Placed;
  d: string;
  head: string;
  dot: [number, number];
  chip: [number, number];
  kind: "forward" | "down" | "up" | "back" | "self";
};

/** The header line: the agent's mark (it moves while it runs), its name and model, the transitions and where it is. */
function Head({ agentId, state, label, nowLabel, title, agent, moves, hasNodes }: {
  agentId: string; state: string; label: string; nowLabel?: string; title?: ReactNode; agent?: AgentStateMachineProps["agent"]; moves: number; hasNodes: boolean;
}) {
  return (
    <div className="ui-asm__head">
      <span className="ui-asm__who">
        <Mark id={agentId} busy={state === "active"} />
        <b dir="auto">{title ?? agent?.name ?? tr("Agent")}</b>
        {agent?.model ? (
          <span className="ui-asm__model" dir="auto">
            {agent.logo ? (
              <span className="ui-asm__tile" aria-hidden="true">
                {agent.logo}
              </span>
            ) : null}
            <span>{agent.model}</span>
          </span>
        ) : null}
      </span>
      {hasNodes ? (
        <span className="ui-asm__sum">
          <span className="ui-asm__moves">{moves === 1 ? tr("1 transition") : tr("{n} transitions", { n: num(moves) })}</span>
          <span className="ui-asm__state-badge" data-state={state} role="status">
            {state === "active" ? <span className="ui-asm__pulse" aria-hidden="true" /> : null}
            {nowLabel && state === "active" && nowLabel !== label ? `${label} · ${nowLabel}` : label}
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** code-maxxer: the header alone (e.g. in the title of the card that folds the machine), with its own styles. */
export function AgentStateMachineHead({ states, transitions, current, agent, title, className }: Pick<AgentStateMachineProps, "states" | "transitions" | "current" | "agent" | "className"> & { title?: ReactNode }) {
  const now = current ? states.find((x) => x.id === current) : undefined;
  const kind = now?.kind ?? "normal";
  const state = !now ? "idle" : kind === "final" ? "done" : kind === "waiting" ? "waiting" : kind === "error" ? "failed" : "active";
  const label = tr({ idle: "Not started", done: "Done", waiting: "Waiting for you", failed: "Failed", active: "Running" }[state]);
  const moves = transitions.reduce((n, e) => n + Math.max(0, e.count ?? 0), 0);
  return (
    <span className={["ui-asm ui-asm--head", className].filter(Boolean).join(" ")}>
      <style href="ui-agent-state-machine" precedence="default">
        {css}
      </style>
      <Head agentId={agent?.id ?? agent?.name ?? "agent"} state={state} label={label} nowLabel={now?.label} title={title} agent={agent} moves={moves} hasNodes={states.length > 0} />
    </span>
  );
}

export function AgentStateMachine({ states, transitions, current, agent, title, onApprove, onReject, onSelect, formatTime = took, className, hideHead }: AgentStateMachineProps) {
  // Agent Tree cards are bigger than the plain states: the grid grows with them
  const cards = states.some((x) => x.card);
  const NODE_W = cards ? 196 : 150;
  const NODE_H = cards ? 124 : 58;
  const COL = cards ? 268 : 196;
  const ROW = cards ? 196 : 116;
  // The narrowest gap between columns before the diagram scales down: cards need room for their lines and counts
  const MIN_GAP = cards ? 64 : 28;
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const byId = new Map<string, MachineState>();
    states.forEach((s) => !byId.has(s.id) && byId.set(s.id, s));
    const list = [...byId.values()];
    const shown = transitions.filter((t, i, all) => byId.has(t.from) && byId.has(t.to) && all.findIndex((o) => tid(o) === tid(t)) === i);
    // Columns: the first state at 0, every other one column after the first state that leads to it (breadth first)
    const col = new Map<string, number>();
    if (list.length) {
      const first = list[0].id;
      col.set(first, 0);
      const queue = [first];
      while (queue.length) {
        const id = queue.shift()!;
        shown.filter((t) => t.from === id && !col.has(t.to)).forEach((t) => {
          col.set(t.to, col.get(id)! + 1);
          queue.push(t.to);
        });
      }
    }
    // States nothing leads to go after the rest; set columns and rows win
    let spare = Math.max(-1, ...col.values()) + 1;
    list.forEach((s) => !col.has(s.id) && col.set(s.id, spare++));
    list.forEach((s) => s.col !== undefined && Number.isFinite(s.col) && col.set(s.id, Math.max(0, Math.round(s.col))));
    const rows = new Map<string, number>();
    const used = new Map<number, Set<number>>();
    list.forEach((s) => {
      if (s.row === undefined || !Number.isFinite(s.row)) return;
      const r = Math.max(0, Math.round(s.row));
      rows.set(s.id, r);
      (used.get(col.get(s.id)!) ?? used.set(col.get(s.id)!, new Set()).get(col.get(s.id)!)!).add(r);
    });
    list.forEach((s) => {
      if (rows.has(s.id)) return;
      const c = col.get(s.id)!;
      const set = used.get(c) ?? used.set(c, new Set()).get(c)!;
      let r = 0;
      while (set.has(r)) r++;
      set.add(r);
      rows.set(s.id, r);
    });
    const cols = Math.max(0, ...col.values()) + (list.length ? 1 : 0);
    const rowCount = Math.max(0, ...rows.values()) + (list.length ? 1 : 0);
    const loops = shown.some((t) => t.from === t.to);
    // Lines back to an earlier state go over the top where nothing sits above their ends, otherwise under everything –
    // never through a card; the shorter ones inside, so they don't cross
    const at = (id: string) => ({ c: col.get(id)!, r: rows.get(id)! });
    const freeAbove = (id: string) => !list.some((o) => col.get(o.id) === at(id).c && rows.get(o.id)! < at(id).r);
    const span = (t: MachineTransition) => at(t.from).c - at(t.to).c;
    const backAll = shown.filter((t) => at(t.to).c < at(t.from).c).sort((p, q) => span(p) - span(q));
    const overList = backAll.filter((t) => freeAbove(t.from) && freeAbove(t.to));
    const underList = backAll.filter((t) => !overList.includes(t));
    const over = overList.length;
    // Over-the-top lines run above any retry loops and their counts
    const overBase = loops ? 48 : 18;
    const top = Math.max(loops ? TOP : 22, over ? overBase + (over - 1) * 12 + 16 : 0);
    // Room to spare spreads out over the columns; short of room the gaps narrow, then the diagram scales down
    const room = w || 800;
    const natural = START + cols * COL - (COL - NODE_W) + 4;
    const colW = cols > 1 ? Math.max(NODE_W + MIN_GAP, Math.min(COL + 40, COL + (room - natural) / (cols - 1))) : COL;
    const nodes = new Map<string, Placed>(
      list.map((s) => {
        const c = col.get(s.id)!;
        const r = rows.get(s.id)!;
        return [s.id, { s, col: c, row: r, x: START + c * colW, y: top + r * ROW }];
      }),
    );
    // The transitions – forward to the right, down or up within a column, back around underneath, a retry as a loop on top
    const bottom = top + (rowCount - 1) * ROW + NODE_H;
    const backs = underList.length;
    const edges: Edge[] = shown.map((t) => {
      const a = nodes.get(t.from)!;
      const b = nodes.get(t.to)!;
      const r = 4;
      if (a === b) {
        const sx = a.x + NODE_W * 0.68;
        const ex = a.x + NODE_W * 0.32;
        const y = a.y;
        const ty = y - 20;
        return {
          t, id: tid(t), from: a, to: b, kind: "self",
          d: `M${sx} ${y}V${ty + r}Q${sx} ${ty} ${sx - r} ${ty}H${ex + r}Q${ex} ${ty} ${ex} ${ty + r}V${y - 7}`,
          head: `M${ex - 4} ${y - 7}L${ex} ${y - 0.5}L${ex + 4} ${y - 7}Z`,
          dot: [sx, y], chip: [(sx + ex) / 2, ty],
        };
      }
      if (b.col > a.col) {
        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x - 1;
        const y2 = b.y + NODE_H / 2;
        if (Math.abs(y1 - y2) < 1) return { t, id: tid(t), from: a, to: b, kind: "forward", d: `M${x1} ${y1}H${x2 - 6}`, head: `M${x2 - 7} ${y2 - 4}L${x2} ${y2}L${x2 - 7} ${y2 + 4}Z`, dot: [x1, y1], chip: [(x1 + x2) / 2, y1] };
        const s = y2 > y1 ? 1 : -1;
        const gap = colW - NODE_W;
        const mx = b.col - a.col > 1 ? x2 - gap / 2 : x1 + gap / 2;
        return {
          t, id: tid(t), from: a, to: b, kind: "forward",
          d: `M${x1} ${y1}H${mx - r}Q${mx} ${y1} ${mx} ${y1 + s * r}V${y2 - s * r}Q${mx} ${y2} ${mx + r} ${y2}H${x2 - 6}`,
          head: `M${x2 - 7} ${y2 - 4}L${x2} ${y2}L${x2 - 7} ${y2 + 4}Z`,
          dot: [x1, y1], chip: [mx, (y1 + y2) / 2],
        };
      }
      if (b.col === a.col) {
        // Down on the right, up on the left – far enough apart that their counts don't touch
        const x = a.x + NODE_W / 2 + (b.row > a.row ? 18 : -18);
        const down = b.row > a.row;
        const y1 = down ? a.y + NODE_H : a.y;
        const y2 = down ? b.y - 1 : b.y + NODE_H + 1;
        return {
          t, id: tid(t), from: a, to: b, kind: down ? "down" : "up",
          d: `M${x} ${y1}V${down ? y2 - 6 : y2 + 6}`,
          head: down ? `M${x - 4} ${y2 - 7}L${x} ${y2}L${x + 4} ${y2 - 7}Z` : `M${x - 4} ${y2 + 7}L${x} ${y2}L${x + 4} ${y2 + 7}Z`,
          dot: [x, y1], chip: [x, (y1 + y2) / 2],
        };
      }
      // Back to an earlier state over the top: up from the source, along above everything, down into the target
      if (overList.includes(t)) {
        const k = overList.indexOf(t);
        const into = overList.filter((o) => o.to === t.to);
        const sx = a.x + NODE_W / 2 - 14;
        const ex = b.x + NODE_W / 2 + 14 + into.indexOf(t) * 12;
        const y1 = a.y;
        const y2 = b.y - 1;
        const ly = top - overBase - k * 12;
        return {
          t, id: tid(t), from: a, to: b, kind: "back",
          d: `M${sx} ${y1}V${ly + r}Q${sx} ${ly} ${sx - r} ${ly}H${ex + r}Q${ex} ${ly} ${ex} ${ly + r}V${y2 - 6}`,
          head: `M${ex - 4} ${y2 - 7}L${ex} ${y2}L${ex + 4} ${y2 - 7}Z`,
          dot: [sx, y1], chip: [(sx + ex) / 2, ly],
        };
      }
      // Back to an earlier state under everything: down from the source, along the bottom, up into the target
      const k = underList.indexOf(t);
      // Several lines into the same state arrive side by side
      const into = underList.filter((o) => o.to === t.to);
      const sx = a.x + NODE_W / 2 + 14;
      const ex = b.x + NODE_W / 2 - 14 - into.indexOf(t) * 12;
      const y1 = a.y + NODE_H;
      const y2 = b.y + NODE_H + 1;
      const ly = bottom + UNDER + k * 12;
      return {
        t, id: tid(t), from: a, to: b, kind: "back",
        d: `M${sx} ${y1}V${ly - r}Q${sx} ${ly} ${sx - r} ${ly}H${ex + r}Q${ex} ${ly} ${ex} ${ly - r}V${y2 + 6}`,
        head: `M${ex - 4} ${y2 + 7}L${ex} ${y2}L${ex + 4} ${y2 + 7}Z`,
        dot: [sx, y1], chip: [(sx + ex) / 2, ly],
      };
    });
    const width = START + (cols - 1) * colW + NODE_W + 4;
    const height = bottom + (backs ? UNDER + (backs - 1) * 12 + 26 : 22);
    const fit = w && width > w ? w / width : 1;
    const first = list[0] ? nodes.get(list[0].id) : undefined;
    return { nodes, edges, width: list.length ? width : 0, height, top, fit, first };
  }, [states, transitions, w, NODE_W, NODE_H, COL, ROW, MIN_GAP]);

  // When the agent moves along a transition, a light runs along it once
  const prev = useRef(current);
  const [moved, setMoved] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (prev.current !== current && prev.current !== undefined && current !== undefined) {
      const e = layout.edges.find((o) => o.t.from === prev.current && o.t.to === current);
      if (e) setMoved((m) => ({ id: e.id, n: (m?.n ?? 0) + 1 }));
    }
    prev.current = current;
  }, [current, layout.edges]);

  // Pointing at a state brings its transitions forward
  const [hover, setHover] = useState<string | null>(null);
  const [open, setOpen] = useState<{ kind: "state" | "edge"; id: string; el: HTMLElement; kb?: boolean } | null>(null);
  const close = useCallback(
    (back?: boolean) => {
      setOpen((o) => {
        if (back && o) requestAnimationFrame(() => o.el.focus());
        if (o) onSelect?.(null);
        return null;
      });
    },
    [onSelect],
  );
  const focus = open?.kind === "state" ? open.id : hover;

  const now = current ? layout.nodes.get(current) : undefined;
  const state = !now ? "idle" : now.s.kind === "final" ? "done" : now.s.kind === "waiting" ? "waiting" : now.s.kind === "error" ? "failed" : "active";
  const label = tr({ idle: "Not started", done: "Done", waiting: "Waiting for you", failed: "Failed", active: "Running" }[state]);
  const moves = layout.edges.reduce((n, e) => n + Math.max(0, e.t.count ?? 0), 0);
  const agentId = agent?.id ?? agent?.name ?? "agent";

  const openState = open?.kind === "state" ? layout.nodes.get(open.id) : undefined;
  const openEdge = open?.kind === "edge" ? layout.edges.find((e) => e.id === open.id) : undefined;

  return (
    <section ref={root} className={["ui-asm", className].filter(Boolean).join(" ")} aria-label={title ?? tr("{name} – states", { name: agent?.name ?? tr("Agent") })}>
      <style href="ui-agent-state-machine" precedence="default">
        {css}
      </style>

      {hideHead ? null : (
        <Head agentId={agentId} state={state} label={label} nowLabel={now?.s.label} title={title} agent={agent} moves={moves} hasNodes={layout.nodes.size > 0} />
      )}

      <div ref={track} className="ui-asm__track">
        {layout.nodes.size ? (
          <div className="ui-asm__canvas" style={{ width: layout.width, height: layout.height, zoom: layout.fit < 1 ? layout.fit : undefined } as CSSProperties} data-focus={focus ? "" : undefined}>
            {/* The transitions */}
            <svg className="ui-asm__edges" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {layout.first ? (
                <g className="ui-asm__edge" data-state="done">
                  <circle className="ui-asm__start" cx={8} cy={layout.first.y + NODE_H / 2} r={6} />
                  <path d={`M14 ${layout.first.y + NODE_H / 2}H${layout.first.x - 7}`} />
                  <path className="ui-asm__head" d={`M${layout.first.x - 8} ${layout.first.y + NODE_H / 2 - 4}L${layout.first.x - 1} ${layout.first.y + NODE_H / 2}L${layout.first.x - 8} ${layout.first.y + NODE_H / 2 + 4}Z`} />
                </g>
              ) : null}
              {layout.edges.map((e, i) => {
                const n = e.t.count ?? 0;
                const lit = focus ? e.t.from === focus || e.t.to === focus : false;
                return (
                  <g
                    key={e.id}
                    className="ui-asm__edge"
                    data-state={n > 0 ? "done" : "never"}
                    data-lit={lit ? "" : undefined}
                    data-now={moved?.id === e.id && current === e.t.to ? "" : undefined}
                    style={{ "--ui-asm-i": i } as CSSProperties}
                  >
                    <path d={e.d} pathLength={1} />
                    <path className="ui-asm__head" d={e.head} />
                    {moved?.id === e.id ? <Light key={moved.n} d={e.d} /> : null}
                  </g>
                );
              })}
            </svg>

            {/* A hollow dot where each transition leaves its state – on top of the card's edge */}
            <svg className="ui-asm__edges ui-asm__dots" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {layout.edges.map((e) => (
                <circle
                  key={e.id}
                  className="ui-asm__dot"
                  cx={e.dot[0]}
                  cy={e.dot[1]}
                  r={3.25}
                  data-state={(e.t.count ?? 0) > 0 ? "done" : "never"}
                  data-lit={focus && (e.t.from === focus || e.t.to === focus) ? "" : undefined}
                />
              ))}
            </svg>

            {/* The states */}
            {[...layout.nodes.values()].map((p, i) => {
              const kind = p.s.kind ?? "normal";
              const isNow = current === p.s.id;
              const isOpen = open?.kind === "state" && open.id === p.s.id;
              const visits = Math.max(0, p.s.visits ?? 0);
              const meta = [p.s.time !== undefined && Number.isFinite(p.s.time) ? formatTime(p.s.time) : null, visits ? `${short(visits)}×` : null].filter(Boolean).join(" · ");
              return (
                <button
                  key={p.s.id}
                  type="button"
                  className="ui-asm__state"
                  data-kind={kind}
                  data-card={p.s.card ? "" : undefined}
                  data-now={isNow ? "" : undefined}
                  data-seen={visits > 0 || isNow ? "" : undefined}
                  data-dim={focus && focus !== p.s.id && !layout.edges.some((e) => (e.t.from === focus && e.t.to === p.s.id) || (e.t.to === focus && e.t.from === p.s.id)) ? "" : undefined}
                  style={{ left: p.x, top: p.y, ...(p.s.card ? { width: NODE_W, height: NODE_H } : null), "--ui-asm-i": i, "--ui-asm-sc": p.s.color } as CSSProperties}
                  aria-expanded={isOpen}
                  aria-label={`${p.s.label}${isNow ? ` – ${tr("current state")}` : ""}${visits ? `, ${tr("entered {n}×", { n: num(visits) })}` : `, ${tr("not reached yet")}`}${p.s.time !== undefined && Number.isFinite(p.s.time) ? `, ${formatTime(p.s.time)}` : ""}`}
                  onPointerEnter={() => setHover(p.s.id)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(p.s.id)}
                  onBlur={() => setHover(null)}
                  onClick={(ev) => {
                    const el = ev.currentTarget;
                    const next = isOpen ? null : { kind: "state" as const, id: p.s.id, el, kb: ev.detail === 0 };
                    setOpen(next);
                    onSelect?.(next ? { state: p.s } : null);
                  }}
                >
                  {p.s.card ? (
                    <TreeCard name={p.s.label} {...p.s.card} avatar={p.s.card.avatar ?? p.s.icon} meta={p.s.card.meta ?? (meta || undefined)} />
                  ) : (
                  <>
                  <span className="ui-asm__state-top">
                    {p.s.icon ? <span className="ui-asm__glyph" style={{ display: "inline-grid", placeItems: "center" }} aria-hidden="true">{p.s.icon}</span> : isNow && kind === "normal" ? <Mark id={agentId} busy /> : <Glyph kind={kind} final={isNow} />}
                    <span className="ui-asm__state-name" dir="auto">
                      {p.s.label}
                    </span>
                  </span>
                  <span className="ui-asm__state-bottom">
                    <span className="ui-asm__state-meta">{meta || (isNow ? tr("Now") : tr("Not reached"))}</span>
                    {p.s.tools?.length ? (
                      <span className="ui-asm__tiles" aria-hidden="true">
                        {p.s.tools.slice(0, p.s.tools.length > 3 ? 2 : 3).map((t, k) => (
                          <span key={k} className="ui-asm__tile" title={t.name}>
                            {t.logo ?? <b>{Array.from(t.name)[0]?.toUpperCase()}</b>}
                          </span>
                        ))}
                        {p.s.tools.length > 3 ? <span className="ui-asm__tile ui-asm__tile--more">+{p.s.tools.length - 2}</span> : null}
                      </span>
                    ) : null}
                  </span>
                  </>
                  )}
                </button>
              );
            })}

            {/* How often each transition was taken – a small count on its line */}
            {layout.edges.map((e) => {
              const n = Math.max(0, e.t.count ?? 0);
              const isOpen = open?.kind === "edge" && open.id === e.id;
              const from = e.from.s.label;
              const to = e.to.s.label;
              return (
                <button
                  key={e.id}
                  type="button"
                  className="ui-asm__count"
                  data-never={n ? undefined : ""}
                  data-lit={focus && (e.t.from === focus || e.t.to === focus) ? "" : undefined}
                  style={{ left: e.chip[0], top: e.chip[1] }}
                  aria-expanded={isOpen}
                  aria-label={`${e.t.label}: ${from} → ${to}, ${n ? `${num(n)}×` : tr("never")}`}
                  onClick={(ev) => {
                    const el = ev.currentTarget;
                    const next = isOpen ? null : { kind: "edge" as const, id: e.id, el, kb: ev.detail === 0 };
                    setOpen(next);
                    onSelect?.(next ? { transition: e.t } : null);
                  }}
                >
                  <span key={n} className="ui-asm__count-n">
                    {short(n)}×
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="ui-asm__empty">{tr("No states yet")}</p>
        )}
      </div>

      {/* A state's card */}
      {openState && open ? (
        <Card anchor={open.el} bounds={root} label={openState.s.label} focusIn={open.kb} onClose={close}>
          {(() => {
            const kind = openState.s.kind ?? "normal";
            const exits = layout.edges.filter((e) => e.t.from === openState.s.id);
            const visits = Math.max(0, openState.s.visits ?? 0);
            return (
              <>
                <div className="ui-asm__card-top">
                  <span className="ui-asm__chip" data-kind={kind}>
                    {kindLabel(kind)}
                  </span>
                  {current === openState.s.id ? (
                    <span className="ui-asm__chip" data-kind="now">
                      {tr("Now")}
                    </span>
                  ) : null}
                  <button type="button" className="ui-asm__card-close" aria-label={tr("Close")} onClick={() => close(true)}>
                    <CloseIcon />
                  </button>
                </div>
                <p className="ui-asm__card-title" dir="auto">
                  {openState.s.label}
                </p>
                {openState.s.description ? (
                  <p className="ui-asm__card-text" dir="auto">
                    {openState.s.description}
                  </p>
                ) : null}
                {openState.s.tools?.length ? (
                  <ul className="ui-asm__card-tools" aria-label={tr("Tools")}>
                    {openState.s.tools.map((t, k) => (
                      <li key={k}>
                        <span className="ui-asm__tile" aria-hidden="true">
                          {t.logo ?? <b>{Array.from(t.name)[0]?.toUpperCase()}</b>}
                        </span>
                        <span dir="auto">{t.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <dl className="ui-asm__card-stats">
                  <div>
                    <dt>{tr("Time here")}</dt>
                    <dd>{openState.s.time !== undefined && Number.isFinite(openState.s.time) ? formatTime(openState.s.time) : "–"}</dd>
                  </div>
                  <div>
                    <dt>{tr("Entered")}</dt>
                    <dd>{visits ? `${num(visits)}×` : tr("Not yet")}</dd>
                  </div>
                </dl>
                {exits.length ? (
                  <ul className="ui-asm__card-list" aria-label={tr("Leaves to")}>
                    {exits.map((e) => (
                      <li key={e.id}>
                        <span className="ui-asm__card-trigger" dir="auto">
                          {e.t.label}
                        </span>
                        <ArrowIcon />
                        <span className="ui-asm__card-to" dir="auto">
                          {e.to.s.label}
                        </span>
                        <span className="ui-asm__card-n">{num(e.t.count ?? 0)}×</span>
                      </li>
                    ))}
                  </ul>
                ) : kind === "final" ? (
                  <p className="ui-asm__card-muted">{tr("The run ends here")}</p>
                ) : null}
                {kind === "waiting" && current === openState.s.id && (onApprove || onReject) ? (
                  <div className="ui-asm__card-actions">
                    {onReject ? (
                      <button
                        type="button"
                        className="ui-asm__btn"
                        onClick={() => {
                          onReject(openState.s);
                          close(true);
                        }}
                      >
                        {tr("Reject")}
                      </button>
                    ) : null}
                    {onApprove ? (
                      <button
                        type="button"
                        className="ui-asm__btn ui-asm__btn--primary"
                        onClick={() => {
                          onApprove(openState.s);
                          close(true);
                        }}
                      >
                        {tr("Approve")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </>
            );
          })()}
        </Card>
      ) : null}

      {/* A transition's card */}
      {openEdge && open ? (
        <Card anchor={open.el} bounds={root} label={openEdge.t.label} focusIn={open.kb} onClose={close}>
          <div className="ui-asm__card-top">
            <span className="ui-asm__chip">{tr(openEdge.kind === "self" ? "Retry" : openEdge.kind === "back" ? "Back|edge" : "Transition")}</span>
            <button type="button" className="ui-asm__card-close" aria-label={tr("Close")} onClick={() => close(true)}>
              <CloseIcon />
            </button>
          </div>
          <p className="ui-asm__card-title" dir="auto">
            {openEdge.t.label}
          </p>
          <p className="ui-asm__card-route">
            <span dir="auto">{openEdge.from.s.label}</span>
            <ArrowIcon />
            <span dir="auto">{openEdge.to.s.label}</span>
          </p>
          {openEdge.t.detail ? (
            <p className="ui-asm__card-text" dir="auto">
              {openEdge.t.detail}
            </p>
          ) : null}
          <dl className="ui-asm__card-stats">
            <div>
              <dt>{tr("Taken")}</dt>
              <dd>{(openEdge.t.count ?? 0) > 0 ? `${num(openEdge.t.count ?? 0)}×` : tr("Never")}</dd>
            </div>
            <div>
              <dt>{tr("Share of exits")}</dt>
              <dd>
                {(() => {
                  const all = layout.edges.filter((e) => e.t.from === openEdge.t.from).reduce((n, e) => n + Math.max(0, e.t.count ?? 0), 0);
                  return all ? `${Math.round((Math.max(0, openEdge.t.count ?? 0) / all) * 100)}%` : "–";
                })()}
              </dd>
            </div>
          </dl>
        </Card>
      ) : null}
    </section>
  );
}

export default AgentStateMachine;

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-asm */
.ui-asm, .ui-asm__card {
  --ui-asm-card: var(--aui-surface, #ffffff);
  --ui-asm-strong: var(--aui-ink, #000000);
  --ui-asm-ink: var(--aui-ink, rgba(0, 0, 0, 0.88));
  --ui-asm-text: var(--aui-muted, rgba(0, 0, 0, 0.61));
  --ui-asm-muted: var(--aui-muted, rgba(0, 0, 0, 0.45));
  --ui-asm-faint: rgba(0, 0, 0, 0.27);
  --ui-asm-line: var(--aui-border, rgba(0, 0, 0, 0.06));
  --ui-asm-tag: rgba(0, 0, 0, 0.04);
  --ui-asm-box: #ffffff;
  --ui-asm-edge: rgba(0, 0, 0, 0.3);
  --ui-asm-edge-never: rgba(0, 0, 0, 0.16);
  /* The start dot and the lines of the state you point at – a dark grey, never black */
  --ui-asm-edge-strong: rgba(0, 0, 0, 0.5);
  --ui-asm-agent: rgba(0, 96, 226, 0.78);
  --ui-asm-run-fg: #006dcbf2;
  --ui-asm-run-bg: rgba(0, 96, 226, 0.08);
  --ui-asm-ok: #1fa855;
  --ui-asm-ok-fg: #007d2ee0;
  --ui-asm-ok-bg: #00a43319;
  --ui-asm-warn: #e8a200;
  --ui-asm-warn-fg: var(--aui-warning, #b25e00);
  --ui-asm-warn-bg: #ff9c0029;
  --ui-asm-bad: #e5484d;
  --ui-asm-bad-fg: #d72400da;
  --ui-asm-bad-bg: #f52b0018;
  --ui-asm-focus: rgba(0, 96, 226, 0.7);
  --ui-asm-shadow: 0 0 0 0.5px var(--aui-border, rgba(0, 0, 0, 0.06)), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-asm-shadow-on: 0 0 0 0.5px rgba(0, 0, 0, 0.14), 0 1px 1px -1px rgba(0, 0, 0, 0.12), 0 2px 4px 0 rgba(0, 0, 0, 0.06);
  --ui-asm-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-asm-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
}
.ui-asm {
  position: relative;
  box-sizing: border-box;
  display: grid;
  gap: 18px;
  width: 100%;
  padding: 20px 22px 18px;
  border-radius: calc(var(--aui-radius-lg, 10px) + 4px);
  background: var(--aui-surface, var(--ui-asm-card));
  box-shadow: var(--aui-shadow-card, var(--ui-asm-shadow));
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 13px;
  line-height: 20px;
  letter-spacing: -0.15px;
  color: var(--ui-asm-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-asm *, .ui-asm *::before, .ui-asm *::after { box-sizing: border-box; }
.ui-asm p { margin: 0; }
.ui-asm svg { display: block; flex: none; }
.ui-asm b { font-weight: 500; color: var(--ui-asm-strong); }
/* A light reset – :where keeps it below every class, so the buttons' own fills always win */
:where(.ui-asm, .ui-asm__card) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; letter-spacing: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }

/* ----- The header: the agent, how many moves, and where it is now ----- */
.ui-asm__head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-width: 0; }
.ui-asm__who { display: flex; flex: 1 1 0; align-items: center; gap: 8px; min-width: min(160px, 100%); }
.ui-asm__who > b { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__model { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 5px; min-width: 0; max-width: 45%; color: var(--ui-asm-muted); font-size: 12px; white-space: nowrap; }
.ui-asm__model > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-asm__sum { display: inline-flex; align-items: center; gap: 10px; min-width: 0; margin-left: auto; font-size: 12px; line-height: 16px; }
.ui-asm__moves { flex: none; color: var(--ui-asm-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-asm__state-badge { display: inline-flex; align-items: center; gap: 5px; min-width: 0; height: 20px; padding: 0 7px; overflow: hidden; border-radius: 5px; background: var(--ui-asm-tag); color: var(--ui-asm-text); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__state-badge[data-state="active"] { background: var(--ui-asm-run-bg); color: var(--ui-asm-run-fg); }
.ui-asm__state-badge[data-state="waiting"] { background: var(--ui-asm-warn-bg); color: var(--ui-asm-warn-fg); }
.ui-asm__state-badge[data-state="done"] { background: var(--ui-asm-ok-bg); color: var(--ui-asm-ok-fg); }
.ui-asm__state-badge[data-state="failed"] { background: var(--ui-asm-bad-bg); color: var(--ui-asm-bad-fg); }
.ui-asm__pulse { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: ui-asm-pulse 1.6s ease-in-out infinite; }

/* The agent's pixel mark */
.ui-asm__mark { display: grid; grid-template-columns: repeat(3, 3px); grid-auto-rows: 3px; gap: 1.5px; place-content: center; width: 16px; height: 16px; flex: none; }
.ui-asm__mark i { border-radius: 0.75px; background: var(--ui-asm-agent); opacity: 0; }
.ui-asm__mark i[data-on] { opacity: 1; }
.ui-asm__mark[data-busy] i { animation: ui-asm-pixel 1.2s ease-in-out infinite both; }
.ui-asm__mark[data-busy] i:not([data-on]) { opacity: 0.16; }

/* ----- The diagram: never scrolls – the gaps narrow, then it scales down to fit ----- */
.ui-asm__track { min-width: 0; overflow: hidden; }
.ui-asm__canvas { position: relative; direction: ltr; }
.ui-asm__empty { padding: 24px 0; font-size: 13px; color: var(--ui-asm-muted); text-align: center; }

/* The transitions */
.ui-asm__edges { position: absolute; inset: 0; z-index: 1; overflow: visible; pointer-events: none; }
.ui-asm__dots { z-index: 3; }
.ui-asm__edge { color: var(--ui-asm-edge); transition: color 280ms ease, opacity 280ms ease; }
.ui-asm__edge path { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
.ui-asm__edge > path:first-of-type { stroke-dasharray: 1; animation: ui-asm-draw 560ms var(--ui-asm-ease) calc(140ms + var(--ui-asm-i, 0) * 50ms) backwards; }
.ui-asm__edge path.ui-asm__head { fill: currentColor; stroke: none; animation: ui-asm-fade 240ms ease calc(560ms + var(--ui-asm-i, 0) * 50ms) backwards; }
.ui-asm__edge[data-state="never"] { color: var(--ui-asm-edge-never); }
.ui-asm__edge[data-state="never"] > path:first-of-type { stroke-dasharray: 3 4; animation: none; }
.ui-asm__edge[data-now] { color: color-mix(in srgb, var(--ui-asm-agent) 70%, transparent); }
.ui-asm__canvas[data-focus] .ui-asm__edge:not([data-lit]) { opacity: 0.3; }
.ui-asm__canvas[data-focus] .ui-asm__edge[data-lit] { color: var(--ui-asm-edge-strong); }
.ui-asm__start { fill: var(--ui-asm-edge-strong); stroke: none !important; }
.ui-asm__dot { fill: var(--ui-asm-box); stroke: var(--ui-asm-edge); stroke-width: 1.5; transition: stroke 280ms ease, opacity 280ms ease; }
.ui-asm__dot[data-state="never"] { stroke: var(--ui-asm-edge-never); }
.ui-asm__canvas[data-focus] .ui-asm__dot:not([data-lit]) { opacity: 0.3; }
.ui-asm__canvas[data-focus] .ui-asm__dot[data-lit] { stroke: var(--ui-asm-edge-strong); }
/* The light along the transition just taken – full at its head, fading out behind */
.ui-asm__light path { fill: none; stroke: var(--ui-asm-agent); stroke-width: 1.5; stroke-linecap: butt; stroke-opacity: 0.24; stroke-dasharray: 0 1000; filter: drop-shadow(0 0 1.5px color-mix(in srgb, var(--ui-asm-agent) 35%, transparent)); }

/* ----- A state ----- */
.ui-asm__state { position: absolute; z-index: 2; display: grid; align-content: center; gap: 4px; width: 150px; height: 58px; padding: 0 10px 0 11px; border-radius: 9px; background: var(--ui-asm-box); box-shadow: var(--ui-asm-shadow); color: var(--ui-asm-ink); text-align: left; transition: box-shadow 200ms ease, opacity 280ms ease, background-color 300ms ease; animation: ui-asm-in 360ms var(--ui-asm-ease) calc(60ms + var(--ui-asm-i, 0) * 60ms) backwards; }
.ui-asm__state:hover, .ui-asm__state[aria-expanded="true"] { box-shadow: var(--ui-asm-shadow-on); }
/* code-maxxer: a state drawn as an Agent Tree card – the card is the box; the current one keeps the state's ring and sheen */
.ui-asm__state[data-card] { display: block; padding: 0; border-radius: 16px; background: none; box-shadow: none; }
.ui-asm__state[data-card]:hover, .ui-asm__state[data-card][aria-expanded="true"] { box-shadow: var(--ui-asm-shadow-on); }
.ui-asm__state[data-card][data-now] { background: none; }
.ui-asm__state[data-card][data-now]::after { z-index: 1; }
.ui-asm__state[data-card][data-dim] { opacity: 0.45; }
.ui-asm__state:focus-visible { outline: 2px solid var(--ui-asm-focus); outline-offset: 2px; }
.ui-asm__state[data-dim] { opacity: 0.45; }
.ui-asm__state-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ui-asm__state-top > .ui-asm__mark { width: 12px; height: 12px; grid-template-columns: repeat(3, 2.5px); grid-auto-rows: 2.5px; gap: 1px; }
.ui-asm__state-name { min-width: 0; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__state-bottom { display: flex; align-items: center; gap: 6px; min-width: 0; height: 18px; padding-left: 18px; }
.ui-asm__state-meta { flex: 0 0 auto; max-width: 100%; min-width: 0; overflow: hidden; color: var(--ui-asm-muted); font-size: 11px; line-height: 14px; font-variant-numeric: tabular-nums; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__glyph { color: var(--ui-asm-sc, var(--ui-asm-faint)); }
.ui-asm__state[data-seen] .ui-asm__glyph { color: var(--ui-asm-sc, var(--ui-asm-muted)); }
/* The tools it works with there: small white tiles with their logos, lying a little over each other */
.ui-asm__tiles { display: inline-flex; flex: 0 1 auto; min-width: 0; margin-left: auto; padding: 2px 1px 2px 2px; overflow: hidden; }
/* Short of room the tiles give way, never the numbers */
.ui-asm__tile { display: grid; flex: none; place-items: center; width: 18px; height: 18px; border-radius: 5px; background: var(--ui-asm-box); box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.08); }
.ui-asm__tile > svg, .ui-asm__tile > img { width: 11px; height: 11px; }
.ui-asm__tile > b { font-size: 9px; line-height: 1; color: var(--ui-asm-text); }
.ui-asm__tiles > .ui-asm__tile + .ui-asm__tile { margin-left: -5px; }
.ui-asm__tiles > .ui-asm__tile:nth-child(even) { transform: translateY(-1px) rotate(4deg); }
.ui-asm__tiles > .ui-asm__tile:nth-child(odd):not(:first-child) { transform: rotate(-3deg); }
.ui-asm__tile--more { width: auto; min-width: 18px; padding: 0 3px; font-size: 9px; font-weight: 500; color: var(--ui-asm-text); }
.ui-asm__model > .ui-asm__tile { width: 18px; height: 18px; }
.ui-asm__state:not([data-seen]) { color: var(--ui-asm-text); }
/* Where the agent is now: an edge in its blue, a soft wash and a sheen running over it */
.ui-asm__state[data-now] { background: radial-gradient(90% 130% at 0% 0%, color-mix(in srgb, var(--ui-asm-agent) 16%, transparent), transparent 70%), radial-gradient(70% 120% at 100% 100%, color-mix(in srgb, var(--ui-asm-agent) 9%, transparent), transparent 70%), var(--ui-asm-box); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-asm-agent) 55%, transparent), 0 4px 14px -4px color-mix(in srgb, var(--ui-asm-agent) 40%, transparent); color: var(--ui-asm-strong); }
.ui-asm__state[data-now]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--ui-asm-agent) 13%, transparent) 50%, transparent 70%); background-size: 250% 100%; animation: ui-asm-sheen 1.8s ease-in-out infinite; pointer-events: none; }
.ui-asm__state[data-now] .ui-asm__state-meta { color: var(--ui-asm-run-fg); }
.ui-asm__state[data-kind="waiting"][data-now] { background: linear-gradient(var(--ui-asm-warn-bg), var(--ui-asm-warn-bg)), var(--ui-asm-box); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-asm-warn) 60%, transparent); animation: ui-asm-ask 2s ease-in-out infinite; }
.ui-asm__state[data-kind="waiting"][data-now]::after, .ui-asm__state[data-kind="final"][data-now]::after, .ui-asm__state[data-kind="error"][data-now]::after { display: none; }
.ui-asm__state[data-kind="waiting"][data-now] :is(.ui-asm__glyph, .ui-asm__state-meta) { color: var(--ui-asm-warn-fg); }
.ui-asm__state[data-kind="error"][data-now] { background: linear-gradient(var(--ui-asm-bad-bg), var(--ui-asm-bad-bg)), var(--ui-asm-box); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-asm-bad) 55%, transparent); }
.ui-asm__state[data-kind="error"][data-now] :is(.ui-asm__glyph, .ui-asm__state-meta) { color: var(--ui-asm-bad-fg); }
.ui-asm__state[data-kind="final"][data-now] { background: linear-gradient(var(--ui-asm-ok-bg), var(--ui-asm-ok-bg)), var(--ui-asm-box); box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-asm-ok) 45%, transparent); }
.ui-asm__state[data-kind="final"][data-now] :is(.ui-asm__glyph, .ui-asm__state-meta) { color: var(--ui-asm-ok-fg); }

/* How often a transition was taken: a small white tag on the line, it pops when the count goes up */
.ui-asm__count { position: absolute; z-index: 3; display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--ui-asm-box); box-shadow: var(--ui-asm-shadow); color: var(--ui-asm-text); font-size: 11px; font-weight: 500; line-height: 16px; font-variant-numeric: tabular-nums; transform: translate(-50%, -50%); transition: box-shadow 200ms ease, opacity 280ms ease, color 200ms ease; animation: ui-asm-chip 300ms var(--ui-asm-ease) 700ms backwards; }
.ui-asm__count:hover, .ui-asm__count[aria-expanded="true"] { box-shadow: var(--ui-asm-shadow-on); color: var(--ui-asm-ink); }
.ui-asm__count:focus-visible { outline: 2px solid var(--ui-asm-focus); outline-offset: 2px; }
.ui-asm__count[data-never] { color: var(--ui-asm-faint); }
.ui-asm__canvas[data-focus] .ui-asm__count:not([data-lit]) { opacity: 0.35; }
.ui-asm__count-n { display: inline-block; animation: ui-asm-tick 420ms var(--ui-asm-ease); }

/* ----- The card ----- */
.ui-asm__card { position: fixed; inset: auto; margin: 0; border: 0; overflow: visible; display: grid; gap: 8px; width: min(256px, calc(100vw - 24px)); padding: 10px 10px 11px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--aui-overlay, var(--ui-asm-card)); box-shadow: var(--aui-shadow-popover, var(--ui-asm-pop)); color: var(--ui-asm-text); font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); font-size: 12px; line-height: 16px; letter-spacing: -0.15px; text-align: left; -webkit-font-smoothing: antialiased; animation: ui-asm-pop 180ms var(--ui-asm-ease) both; }
.ui-asm__card:not(:popover-open) { display: none; }
.ui-asm__card[data-side="above"] { animation-name: ui-asm-pop-up; }
.ui-asm__card *, .ui-asm__card *::before, .ui-asm__card *::after { box-sizing: border-box; }
.ui-asm__card p { margin: 0; }
.ui-asm__card svg { display: block; flex: none; }
.ui-asm__card-top { display: flex; align-items: center; gap: 4px; min-width: 0; min-height: 20px; }
.ui-asm__card-close { display: grid; place-items: center; flex: none; width: 22px; height: 22px; margin: -2px -4px -2px auto; border-radius: 5px; color: var(--ui-asm-muted); outline: none; }
.ui-asm__card-close:hover { background: var(--ui-asm-tag); color: var(--ui-asm-ink); }
.ui-asm__card-close:focus-visible { outline: 2px solid var(--ui-asm-focus); outline-offset: 2px; }
.ui-asm__card-title { overflow-wrap: anywhere; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--ui-asm-strong); }
.ui-asm__card-text { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.ui-asm__card-muted { color: var(--ui-asm-muted); }
.ui-asm__card-route { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--ui-asm-muted); }
.ui-asm__card-route > span { min-width: 0; overflow: hidden; color: var(--ui-asm-ink); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__chip { max-width: 100%; overflow: hidden; padding: 1px 6px; border-radius: 5px; background: var(--ui-asm-tag); color: var(--ui-asm-text); font-size: 11px; line-height: 16px; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__chip[data-kind="now"] { background: var(--ui-asm-run-bg); color: var(--ui-asm-run-fg); }
.ui-asm__chip[data-kind="waiting"] { background: var(--ui-asm-warn-bg); color: var(--ui-asm-warn-fg); }
.ui-asm__chip[data-kind="error"] { background: var(--ui-asm-bad-bg); color: var(--ui-asm-bad-fg); }
.ui-asm__chip[data-kind="final"] { background: var(--ui-asm-ok-bg); color: var(--ui-asm-ok-fg); }
.ui-asm__card-tools { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.ui-asm__card-tools > li { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--ui-asm-ink); }
.ui-asm__card-tools > li > span[dir] { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__card-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 0; padding-top: 8px; border-top: 0.5px solid var(--ui-asm-line); }
.ui-asm__card-stats div { min-width: 0; }
.ui-asm__card-stats dt { color: var(--ui-asm-muted); font-size: 11px; line-height: 14px; }
.ui-asm__card-stats dd { margin: 0; color: var(--ui-asm-ink); font-weight: 500; font-variant-numeric: tabular-nums; }
.ui-asm__card-list { display: grid; gap: 4px; margin: 0; padding: 8px 0 0; border-top: 0.5px solid var(--ui-asm-line); list-style: none; }
.ui-asm__card-list > li { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--ui-asm-muted); }
.ui-asm__card-trigger { flex: 0 1 auto; min-width: 0; overflow: hidden; color: var(--ui-asm-text); white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__card-to { flex: 0 1 auto; min-width: 0; overflow: hidden; color: var(--ui-asm-ink); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ui-asm__card-actions { display: flex; justify-content: flex-end; gap: 6px; padding-top: 8px; border-top: 0.5px solid var(--ui-asm-line); }
.ui-asm__btn { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: 6px; background: var(--ui-asm-box); box-shadow: var(--ui-asm-shadow); color: var(--ui-asm-strong); font-size: 13px; font-weight: 500; transition: box-shadow 160ms ease, opacity 160ms ease; }
.ui-asm__btn:hover { box-shadow: var(--ui-asm-shadow-on); }
.ui-asm__btn--primary { background: var(--ui-asm-strong); box-shadow: none; color: var(--ui-asm-card); }
.ui-asm__btn--primary:hover { box-shadow: none; opacity: 0.88; }
.ui-asm__btn:focus-visible { outline: 2px solid var(--ui-asm-focus); outline-offset: 2px; }
.ui-asm__card-n { flex: none; margin-left: auto; color: var(--ui-asm-muted); font-variant-numeric: tabular-nums; }

@keyframes ui-asm-in { from { opacity: 0; transform: scale(0.96); } }
@keyframes ui-asm-fade { from { opacity: 0; } }
@keyframes ui-asm-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes ui-asm-chip { from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); } }
@keyframes ui-asm-tick { from { opacity: 0; transform: translateY(5px); } }
@keyframes ui-asm-sheen { from { background-position: 150% 0; } to { background-position: -50% 0; } }
@keyframes ui-asm-pixel { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
@keyframes ui-asm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes ui-asm-ask { 0%, 100% { box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-asm-warn) 60%, transparent); } 50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--ui-asm-warn) 0%, transparent), 0 0 0 1px color-mix(in srgb, var(--ui-asm-warn) 60%, transparent); } }
@keyframes ui-asm-pop { from { opacity: 0; transform: translateY(-3px) scale(0.98); } }
@keyframes ui-asm-pop-up { from { opacity: 0; transform: translateY(3px) scale(0.98); } }

@media (prefers-reduced-motion: reduce) {
  .ui-asm *, .ui-asm *::before, .ui-asm *::after, .ui-asm__card { animation: none !important; transition: none !important; }
  .ui-asm__light { display: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-asm, :where(.dark, [data-theme="dark"]) .ui-asm__card {
  --ui-asm-card: var(--aui-surface, #1c1c1e);
  --ui-asm-strong: var(--aui-ink, #ffffff);
  --ui-asm-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-asm-text: var(--aui-muted, rgba(255, 255, 255, 0.62));
  --ui-asm-muted: var(--aui-muted, rgba(255, 255, 255, 0.46));
  --ui-asm-faint: rgba(255, 255, 255, 0.28);
  --ui-asm-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-asm-tag: rgba(255, 255, 255, 0.07);
  --ui-asm-box: #2c2c2f;
  --ui-asm-edge: rgba(255, 255, 255, 0.32);
  --ui-asm-edge-never: rgba(255, 255, 255, 0.16);
  --ui-asm-edge-strong: rgba(255, 255, 255, 0.56);
  --ui-asm-agent: rgba(77, 141, 255, 0.85);
  --ui-asm-run-fg: #7fb0ff;
  --ui-asm-run-bg: rgba(77, 141, 255, 0.14);
  --ui-asm-ok: #46c878;
  --ui-asm-ok-fg: #6fd398;
  --ui-asm-ok-bg: rgba(70, 200, 120, 0.14);
  --ui-asm-warn: #e6c24d;
  --ui-asm-warn-fg: #ffb35c;
  --ui-asm-warn-bg: rgba(255, 170, 60, 0.16);
  --ui-asm-bad: #ff6369;
  --ui-asm-bad-fg: #ff8f8a;
  --ui-asm-bad-bg: rgba(255, 90, 80, 0.16);
  --ui-asm-focus: rgba(77, 141, 255, 0.8);
  --ui-asm-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-asm-shadow-on: 0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 1px 3px rgba(0, 0, 0, 0.5);
  --ui-asm-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-asm__tile { box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 1px 2px rgba(0, 0, 0, 0.4); }
/* ----- The classic style ----- */
.ui-asm, .ui-asm__card {
  --ui-asm-card: var(--aui-surface, #ffffff);
  --ui-asm-strong: var(--aui-ink, #171717);
  --ui-asm-ink: var(--aui-ink, #171717);
  --ui-asm-text: var(--aui-muted, #6b6b6b);
  --ui-asm-muted: var(--aui-muted, #8a8a8a);
  --ui-asm-line: var(--aui-border, #ececec);
  --ui-asm-tag: #f3f3f3;
  --ui-asm-shadow: 0 0 0 1px var(--ui-asm-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-asm-shadow-on: 0 0 0 1px #d6d6d6, 0 2px 6px rgba(0, 0, 0, 0.06);
  --ui-asm-pop: var(--aui-shadow-popover, 0 0 0 1px var(--ui-asm-line), 0 16px 32px -12px rgba(0, 0, 0, 0.2));
  --ui-asm-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.ui-asm { border-radius: var(--aui-radius-lg, 16px); font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); font-size: 14px; letter-spacing: -0.006em; }
.ui-asm b, .ui-asm__card-title { font-weight: 600; }
.ui-asm__state { border-radius: 14px; }
.ui-asm__state-badge, .ui-asm__chip { border-radius: 999px; padding-left: 8px; padding-right: 8px; }
.ui-asm__tile { border-radius: 6px; }
.ui-asm__card { border-radius: 14px; padding: 12px 12px 13px; }
.ui-asm__btn { border-radius: 999px; padding: 0 14px; }
.ui-asm__btn--primary { font-weight: 600; }
:where(.dark, [data-theme="dark"]) .ui-asm, :where(.dark, [data-theme="dark"]) .ui-asm__card {
  --ui-asm-card: var(--aui-surface, #232326);
  --ui-asm-strong: var(--aui-ink, #ededed);
  --ui-asm-ink: var(--aui-ink, #ededed);
  --ui-asm-text: var(--aui-muted, #a1a1a6);
  --ui-asm-muted: var(--aui-muted, #7c7c82);
  --ui-asm-line: var(--aui-border, #2a2a2e);
  --ui-asm-tag: #2f2f33;
  --ui-asm-box: #2a2a2e;
  --ui-asm-shadow: 0 0 0 1px var(--ui-asm-line), 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-asm-shadow-on: 0 0 0 1px #3a3a40, 0 2px 6px rgba(0, 0, 0, 0.4);
  --ui-asm-pop: var(--aui-shadow-popover, 0 0 0 1px var(--ui-asm-line), 0 16px 32px -12px rgba(0, 0, 0, 0.6));
}
`;
