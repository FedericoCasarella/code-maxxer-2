"use client";
/*
 * affectUI Pro – © Florian Höller (adfects), https://www.affectui.com
 * Used in code-maxxer under an affectUI Pro license. This file may not be copied,
 * redistributed or published on its own, outside code-maxxer. Licenses: https://www.affectui.com/pricing
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { t as tr } from "@/lib/i18n";

/*
 * Agent Loop – a run of agents working in steps, in a single self-contained file. The classic style:
 * rounder card with a hairline border, rounder steps, pill tags, firmer type.
 *   · every step is a card in one row – Plan, Build, QA, Review, Security – with the agent's pixel mark, its
 *     model's logo, its status, a line on what it did, the time and the tokens
 *   · the running step takes a soft wash of the agent's blue and fills a progress bar with a glowing leading edge
 *   · every time the run went back – QA back to Build – is an arc underneath with a count
 *   · short blue sparks run along the lines the run has taken, fading from the head to the tail; when the run goes
 *     back, one runs back along that arc at once and its count rolls up
 *   · under the row sit the run's artifacts – browser screenshots and logs – each tied to the step that made it
 * Point at a step and its loops and artifacts come forward; click a step, a count or an artifact and its card opens.
 * Short of room (a phone) the steps stack and the arcs run down the right side.
 * The styles are injected below, so no extra files are needed.
 */

export type LoopStatus = "queued" | "running" | "done" | "failed";

export type LoopStep = {
  id: string;
  label: string;
  status: LoopStatus;
  /** The agent doing it – its pixel mark comes from its id (by default the step's id) */
  agent?: { id?: string; name?: string; /** Its pixel mark's color – by default one per step from a quiet palette */ color?: string };
  /** The model it runs on, with the maker's logo before it */
  model?: string;
  logo?: ReactNode;
  /** One line on what it did, or is doing */
  summary?: string;
  /** Time spent on it so far, ms – all runs together */
  time?: number;
  tokens?: number;
  /** 0–1 while running; left out, the bar sweeps */
  progress?: number;
  /** The tools it works with – small overlapping tiles with their logos on the card, by name in its card */
  tools?: { name: string; logo?: ReactNode }[];
};

export type LoopBack = {
  /** By default from->to */
  id?: string;
  /** The step that sent the run back … */
  from: string;
  /** … and the earlier step it went back to – the same step is a retry */
  to: string;
  /** How often the run went back this way */
  count: number;
  /** What made it go back – "tests failed", "changes requested" */
  label?: string;
  /** Why, one per time, oldest first – listed in its card */
  reasons?: string[];
};

export type LoopArtifact = {
  id: string;
  title: string;
  /** A screenshot shows an image (src) or your own preview; a log shows its last lines */
  kind: "screenshot" | "log";
  /** The step that made it */
  step?: string;
  status?: "pass" | "fail" | "pending";
  src?: string;
  preview?: ReactNode;
  /** Log lines – ones starting with ✗, FAIL or error read red, ✓, PASS or ok green */
  lines?: string[];
  /** A line under the title in its card – the viewport, the duration */
  meta?: string;
  /** Where it comes from – the browser, the CI – a small logo before its title */
  logo?: ReactNode;
};

export type AgentLoopProps = {
  steps: LoopStep[];
  loops?: LoopBack[];
  artifacts?: LoopArtifact[];
  title?: string;
  /** Next to the title – the repo, the branch */
  subtitle?: string;
  /** Before the subtitle – e.g. the GitHub logo for a repo */
  logo?: ReactNode;
  /** By default 1 + every time the run went back */
  iteration?: number;
  /** A step, a loop or an artifact opened – null when its card closes */
  onSelect?: (item: { step: LoopStep } | { loop: LoopBack } | { artifact: LoopArtifact } | null) => void;
  /** Anything else under the artifacts – open issues, actions */
  children?: ReactNode;
  /** Formats a time – 12s, 2m 05s by default */
  formatTime?: (ms: number) => string;
  className?: string;
};

/* ---------- Helpers ---------- */

const took = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};
const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const num = (n: number) => new Intl.NumberFormat("en").format(Math.max(0, Math.round(n)));
/** Tokens short – 840, 48K, 1.2M */
const tok = (n: number) => (n >= 1000 ? new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: n >= 10_000 ? 0 : 1 }).format(Math.max(0, n)) : num(n));
const lid = (l: LoopBack) => l.id ?? `${l.from}->${l.to}`;
const STATUS: Record<LoopStatus, string> = { queued: tr("Queued"), running: tr("Running"), done: tr("Done"), failed: tr("Failed") };
const tone = (line: string) => (/^\s*(✗|×|fail|err)/i.test(line) ? "bad" : /^\s*(✓|pass|ok\b)/i.test(line) ? "ok" : undefined);

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

/** One color per agent, so you can tell them apart – purple, green, orange, blue, pink, teal, amber, cyan */
const COLORS = ["#a651f0", "#3fb873", "#f28a2e", "#0190fe", "#ee3e9e", "#13b3a0", "#e8b000", "#14b3f0"];
function Mark({ id, busy, color }: { id: string; busy?: boolean; color?: string }) {
  return (
    <span className="ui-alp__mark" data-busy={busy ? "" : undefined} aria-hidden="true" style={color ? ({ "--ui-alp-mark": color } as CSSProperties) : undefined}>
      {pattern(id).map((on, i) => (
        <i key={i} data-on={on ? "" : undefined} style={{ animationDelay: `${WAVE[i]}ms` }} />
      ))}
    </span>
  );
}

/* Icons: Hugeicons Free (MIT, © Hugeicons, hugeicons.com), redrawn at 12px */
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
/** A step's status, quiet and grey like Linear's: a dashed ring waiting, a check done, a cross failed – running has its bar */
const StatusIcon = ({ status }: { status: LoopStatus }) =>
  status === "running" ? null : (
    <svg className="ui-alp__icon" data-status={status} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {status === "queued" ? (
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeDasharray="3.5 3.2" />
      ) : (
        <>
          <circle cx="12" cy="12" r="10" fill="currentColor" />
          <path d={status === "done" ? "M7.5 12.5l3 3 6-6.5" : "M9 9l6 6M15 9l-6 6"} stroke="var(--ui-alp-box)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );

/* ---------- Sparks along the lines ---------- */

/**
 * Short blue streaks running along the lines the run has taken – a line on the line, full at its head and fading to
 * nothing at its tail. A few run now and then on their own, more often into the step at work; when the run goes
 * back, one runs back along that arc at once
 */
const POOL = 4;
const TAIL = 46;
type SparkLine = { id: string; w: number };
function Sparks({ svg, lines, burst }: { svg: { current: SVGSVGElement | null }; lines: SparkLine[]; burst: { id: string; n: number } | null }) {
  const uid = "ui-alp-sp" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const grads = useRef<(SVGLinearGradientElement | null)[]>([]);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  // The last slot is kept for the spark that answers the run going back
  const sparks = useRef(Array.from({ length: POOL + 1 }, () => ({ id: "", start: Infinity, dur: 1000 }))).current;
  useEffect(() => {
    if (!burst) return;
    sparks[POOL] = { id: burst.id, start: performance.now(), dur: 0 };
  }, [burst, sparks]);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const pick = () => {
      const list = linesRef.current;
      const total = list.reduce((n, l) => n + l.w, 0);
      let r = Math.random() * total;
      return list.find((l) => (r -= l.w) < 0)?.id ?? "";
    };
    const now0 = performance.now();
    sparks.forEach((sp, k) => k < POOL && Object.assign(sp, { id: "", start: now0 + 400 + Math.random() * 2400 }));
    let frame = 0;
    const tick = (now: number) => {
      sparks.forEach((sp, k) => {
        const path = paths.current[k];
        const grad = grads.current[k];
        if (!path || !grad) return;
        if (now < sp.start) return void (path.style.opacity = "0");
        if (!sp.id && k < POOL) sp.id = pick();
        const line = sp.id ? svg.current?.querySelector<SVGPathElement>(`[data-spark="${CSS.escape(sp.id)}"]`) : null;
        const len = line?.getTotalLength() ?? 0;
        if (!line || len < 4) {
          path.style.opacity = "0";
          if (k < POOL) Object.assign(sp, { id: "", start: now + 600 + Math.random() * 1200 });
          else sp.start = Infinity;
          return;
        }
        // Its speed follows the length of the line – 0.7 to 1.5 s
        if (!sp.dur) sp.dur = Math.max(700, Math.min(1500, len * 4));
        const p = (now - sp.start) / sp.dur;
        if (p >= 1) {
          path.style.opacity = "0";
          if (k < POOL) Object.assign(sp, { id: "", start: now + 500 + Math.random() * 2000, dur: 0 });
          else sp.start = Infinity;
          return;
        }
        const tail = Math.min(TAIL, len * 0.6);
        const run = p * (len + tail);
        const head = Math.min(len, run);
        const from = Math.max(0, Math.min(len, run - tail));
        if (head - from < 0.5) return void (path.style.opacity = "0");
        const pts = Array.from({ length: 10 }, (_, j) => line.getPointAtLength(from + ((head - from) * j) / 9));
        path.setAttribute("d", "M" + pts.map((q) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" L"));
        const a = pts[0];
        const z = pts[pts.length - 1];
        grad.setAttribute("x1", a.x.toFixed(1));
        grad.setAttribute("y1", a.y.toFixed(1));
        grad.setAttribute("x2", z.x.toFixed(1));
        grad.setAttribute("y2", z.y.toFixed(1));
        path.style.opacity = String(Math.max(0, Math.min(1, p / 0.08, (1 - p) / 0.1)));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [svg, sparks]);
  return (
    <g className="ui-alp__sparks">
      <defs>
        {sparks.map((_, k) => (
          <linearGradient key={k} id={`${uid}-${k}`} gradientUnits="userSpaceOnUse" ref={(el) => void (grads.current[k] = el)}>
            <stop offset="0" style={{ stopColor: "var(--ui-alp-spark)", stopOpacity: 0 }} />
            <stop offset="1" style={{ stopColor: "var(--ui-alp-spark)", stopOpacity: 1 }} />
          </linearGradient>
        ))}
      </defs>
      {sparks.map((_, k) => (
        <path key={k} className="ui-alp__spark" stroke={`url(#${uid}-${k})`} ref={(el) => void (paths.current[k] = el)} style={{ opacity: 0 }} />
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
  wide,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  bounds: { current: HTMLElement | null };
  label: string;
  focusIn?: boolean;
  wide?: boolean;
  onClose: (back?: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusIn) ref.current?.querySelector<HTMLElement>(".ui-alp__card-close")?.focus();
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
  // A click anywhere else closes it – a step, a count or an artifact opens its own; Esc closes it from anywhere
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || anchor.contains(t) || t.closest?.(".ui-alp__step, .ui-alp__count, .ui-alp__art")) return;
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
    <div ref={ref} popover="manual" role="dialog" aria-label={label} className="ui-alp__card" data-wide={wide ? "" : undefined}>
      {children}
    </div>
  );
}

/* An artifact's picture – the screenshot, or the log's last lines */
function Thumb({ a, lines = 6 }: { a: LoopArtifact; lines?: number }) {
  if (a.status === "pending") return <span className="ui-alp__thumb" data-pending="" aria-hidden="true" />;
  if (a.kind === "log")
    return (
      <span className="ui-alp__thumb ui-alp__thumb--log" aria-hidden="true">
        <span className="ui-alp__log">
          {(a.lines ?? []).slice(-lines).map((l, i) => (
            <span key={i} data-tone={tone(l)} dir="auto">
              {l || " "}
            </span>
          ))}
        </span>
      </span>
    );
  return (
    <span className="ui-alp__thumb" aria-hidden="true">
      {a.src ? <img src={a.src} alt="" loading="lazy" /> : a.preview}
    </span>
  );
}

/* ---------- The loop ---------- */

/* Geometry, px */
const NODE_H = 92;
const GAP = 18;
const MIN_W = 124;
const MAX_W = 260;
const LEVEL = 26;
/** Room around the cards inside the track – for their edges, shadows and focus rings */
const PAD = 6;
/** Room between a card and the lines that leave or reach it */
const EDGE = 6;
/** Narrower than this, the steps stack */
const STACK = 560;

type Box = { s: LoopStep; i: number; x: number; y: number; w: number };
type Arc = { l: LoopBack; id: string; from: Box; to: Box; d: string; head: string; chip: [number, number]; room: number };
type Link = { i: number; head: string };

export function AgentLoop({ steps, loops = [], artifacts = [], title = tr("Agent loop"), subtitle, logo, iteration, onSelect, children, formatTime = took, className }: AgentLoopProps) {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    // The track pads the cards on every side so their edges, shadows and focus rings are never cut
    const ro = new ResizeObserver(() => setW(el.clientWidth - 2 * PAD));
    ro.observe(el);
    setW(el.clientWidth - 2 * PAD);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    const seen = new Set<string>();
    const list = steps.filter((s) => !seen.has(s.id) && seen.add(s.id));
    const at = new Map(list.map((s, i) => [s.id, i]));
    // Only loops back to an earlier step (or the same one), once each – the shorter ones inside, so they don't cross
    const ids = new Set<string>();
    const shown = loops
      .filter((l) => at.has(l.from) && at.has(l.to) && at.get(l.to)! <= at.get(l.from)! && !ids.has(lid(l)) && ids.add(lid(l)))
      .sort((p, q) => at.get(p.from)! - at.get(p.to)! - (at.get(q.from)! - at.get(q.to)!) || at.get(p.to)! - at.get(q.to)!);
    const n = list.length;
    const L = shown.length;
    const room = w || 900;
    const stacked = room < STACK;
    const r = 5;
    let boxes: Box[];
    let width: number;
    let height: number;
    let arcs: Arc[];
    let links: Link[];
    if (!stacked) {
      // One row: the cards share the width; short of room it scales down to fit
      // Short of room the gaps narrow first, down to 14px
      const gap = n > 1 ? Math.max(14, Math.min(GAP, (room - n * MIN_W) / (n - 1))) : GAP;
      const nodeW = n ? Math.max(MIN_W, Math.min(MAX_W, (room - (n - 1) * gap) / n)) : 0;
      boxes = list.map((s, i) => ({ s, i, x: i * (nodeW + gap), y: 0, w: nodeW }));
      width = n ? n * nodeW + (n - 1) * gap : 0;
      // Between two cards just an arrowhead, in the middle of the gap
      links = boxes.slice(1).map((b, k) => {
        const x = (boxes[k].x + nodeW + b.x) / 2;
        const y = NODE_H / 2;
        return { i: k, head: `M${x - 2.5} ${y - 4}L${x + 3} ${y}L${x - 2.5} ${y + 4}Z` };
      });
      // Underneath: down from the step that sent it back, along, up into the step it went back to
      arcs = shown.map((l, k) => {
        const a = boxes[at.get(l.from)!];
        const b = boxes[at.get(l.to)!];
        const outs = shown.filter((o) => o.from === l.from);
        const ins = shown.filter((o) => o.to === l.to);
        const sx = a.x + nodeW / 2 + 14 + outs.indexOf(l) * 10;
        const ex = b.x + nodeW / 2 - 14 - ins.indexOf(l) * 10;
        const y = NODE_H + EDGE;
        const ly = NODE_H + 30 + k * LEVEL;
        return {
          l, id: lid(l), from: a, to: b,
          d: `M${sx} ${y}V${ly - r}Q${sx} ${ly} ${sx - r} ${ly}H${ex + r}Q${ex} ${ly} ${ex} ${ly - r}V${y + 6}`,
          head: `M${ex - 3.5} ${y + 6}L${ex} ${y}L${ex + 3.5} ${y + 6}Z`,
          chip: [(sx + ex) / 2, ly], room: Math.max(0, sx - ex - 16),
        };
      });
      height = NODE_H + (L ? 30 + (L - 1) * LEVEL + 14 : 2);
    } else {
      // Stacked: the cards one under the other, the arcs down the right side
      const side = L ? 32 + (L - 1) * 22 + 22 : 0;
      const nodeW = Math.max(160, room - side);
      const G = 22;
      boxes = list.map((s, i) => ({ s, i, x: 0, y: i * (NODE_H + G), w: nodeW }));
      width = nodeW + side;
      links = boxes.slice(1).map((b, k) => {
        const x = 28;
        const y = (boxes[k].y + NODE_H + b.y) / 2;
        return { i: k, head: `M${x - 4} ${y - 2.5}L${x} ${y + 3}L${x + 4} ${y - 2.5}Z` };
      });
      arcs = shown.map((l, k) => {
        const a = boxes[at.get(l.from)!];
        const b = boxes[at.get(l.to)!];
        const outs = shown.filter((o) => o.from === l.from);
        const ins = shown.filter((o) => o.to === l.to);
        const sy = a.y + NODE_H / 2 + 12 + outs.indexOf(l) * 9;
        const ey = b.y + NODE_H / 2 - 12 - ins.indexOf(l) * 9;
        const x = nodeW + EDGE;
        const lx = nodeW + 26 + k * 22;
        return {
          l, id: lid(l), from: a, to: b,
          d: `M${x} ${sy}H${lx - r}Q${lx} ${sy} ${lx} ${sy - r}V${ey + r}Q${lx} ${ey} ${lx - r} ${ey}H${x + 6}`,
          head: `M${x + 6} ${ey - 3.5}L${x} ${ey}L${x + 6} ${ey + 3.5}Z`,
          chip: [lx, (sy + ey) / 2], room: 0,
        };
      });
      height = n ? n * NODE_H + (n - 1) * G : 0;
    }
    const fit = !stacked && w && width > w ? w / width : 1;
    return { boxes, arcs, links, width, height, fit, stacked };
  }, [steps, loops, w]);

  // How often each step ran: once, plus every time the run went back over it
  const runs = useMemo(() => {
    const m = new Map<string, number>();
    layout.boxes.forEach((b) => {
      const back = layout.arcs.reduce((n, a) => n + (a.to.i <= b.i && b.i <= a.from.i ? Math.max(0, a.l.count) : 0), 0);
      // A step waiting to run again hasn't had that run yet
      m.set(b.s.id, b.s.status === "queued" ? back : 1 + back);
    });
    return m;
  }, [layout]);

  // Sparks run along the lines the run has taken – most often into the step at work; when the run goes back, or the
  // next step starts, one runs along that line at once
  const svg = useRef<SVGSVGElement>(null);
  const running = layout.boxes.find((b) => b.s.status === "running");
  const sparkLines = useMemo<SparkLine[]>(
    () => [
      ...layout.arcs.filter((a) => a.l.count > 0).map((a) => ({ id: a.id, w: 1 })),
    ],
    [layout],
  );
  const prevRun = useRef<number | undefined>(running?.i);
  const prevCounts = useRef(new Map(layout.arcs.map((a) => [a.id, a.l.count])));
  const [burst, setBurst] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    const before = prevCounts.current;
    const up = layout.arcs.find((a) => (before.get(a.id) ?? a.l.count) < a.l.count);
    if (up) setBurst((o) => ({ id: up.id, n: (o?.n ?? 0) + 1 }));
    prevRun.current = running?.i;
    prevCounts.current = new Map(layout.arcs.map((a) => [a.id, a.l.count]));
  }, [layout.arcs, running]);

  // Pointing at a step brings its loops and artifacts forward; pointing at a count, its two steps
  const [hover, setHover] = useState<{ step?: string; loop?: string } | null>(null);
  const [open, setOpen] = useState<{ kind: "step" | "loop" | "art"; id: string; el: HTMLElement; kb?: boolean } | null>(null);
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
  const focusStep = open?.kind === "step" ? open.id : hover?.step;
  const focusLoop = open?.kind === "loop" ? layout.arcs.find((a) => a.id === open.id) : hover?.loop ? layout.arcs.find((a) => a.id === hover.loop) : undefined;
  const litArc = (a: Arc) => (focusStep ? a.l.from === focusStep || a.l.to === focusStep : focusLoop ? a === focusLoop : false);
  const dimStep = (b: Box) => (focusLoop ? b.s.id !== focusLoop.l.from && b.s.id !== focusLoop.l.to : false);
  const focused = !!(focusStep || focusLoop);

  // The run as a whole
  const failed = layout.boxes.find((b) => b.s.status === "failed");
  const all = layout.boxes.length;
  const doneAll = all > 0 && layout.boxes.every((b) => b.s.status === "done");
  const state = failed ? "failed" : running ? "active" : doneAll ? "done" : layout.boxes.some((b) => b.s.status === "done") ? "paused" : "idle";
  const badge = { failed: `${tr("Failed")} · ${failed?.s.label}`, active: `${tr("Running")} · ${running?.s.label}`, done: tr("Done"), paused: tr("Paused"), idle: tr("Not started") }[state];
  const backs = layout.arcs.reduce((n, a) => n + Math.max(0, a.l.count), 0);
  const iter = ok(iteration) ? Math.max(1, Math.round(iteration)) : 1 + backs;
  const time = layout.boxes.reduce((n, b) => n + (ok(b.s.time) ? Math.max(0, b.s.time) : 0), 0);
  const tokens = layout.boxes.reduce((n, b) => n + (ok(b.s.tokens) ? Math.max(0, b.s.tokens) : 0), 0);
  const stepLabel = (id?: string) => layout.boxes.find((b) => b.s.id === id)?.s.label;

  // Arrow keys move between the steps
  const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onStepKey = (e: ReactKeyboardEvent, i: number) => {
    const next = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: all - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    stepRefs.current[Math.max(0, Math.min(all - 1, next))]?.focus();
  };

  const openStep = open?.kind === "step" ? layout.boxes.find((b) => b.s.id === open.id) : undefined;
  const openArc = open?.kind === "loop" ? layout.arcs.find((a) => a.id === open.id) : undefined;
  const openArt = open?.kind === "art" ? artifacts.find((a) => a.id === open.id) : undefined;
  const toggle = (kind: "step" | "loop" | "art", id: string, el: HTMLElement, kb: boolean, item: Parameters<NonNullable<AgentLoopProps["onSelect"]>>[0]) => {
    const isOpen = open?.kind === kind && open.id === id;
    setOpen(isOpen ? null : { kind, id, el, kb });
    onSelect?.(isOpen ? null : item);
  };

  return (
    <section ref={root} className={["ui-alp", className].filter(Boolean).join(" ")} aria-label={title}>
      <style href="ui-agent-loop" precedence="default">
        {css}
      </style>

      <div className="ui-alp__head">
        <span className="ui-alp__title">
          <b dir="auto">{title}</b>
          {subtitle ? (
            <span className="ui-alp__sub" dir="auto">
              {logo ? (
                <span className="ui-alp__tile" aria-hidden="true">
                  {logo}
                </span>
              ) : null}
              <span>{subtitle}</span>
            </span>
          ) : null}
        </span>
        {all ? (
          <span className="ui-alp__sum">
            <span className="ui-alp__nums">
              <span>{tr("Iteration {n}", { n: num(iter) })}</span>
              {time ? <span>{formatTime(time)}</span> : null}
              {tokens ? <span>{tr("{n} tokens", { n: tok(tokens) })}</span> : null}
            </span>
            <span className="ui-alp__badge" data-state={state} role="status">
              {state === "active" ? <span className="ui-alp__pulse" aria-hidden="true" /> : null}
              {badge}
            </span>
          </span>
        ) : null}
      </div>

      <div ref={track} className="ui-alp__track">
        {all ? (
          <div
            className="ui-alp__canvas"
            data-stacked={layout.stacked ? "" : undefined}
            data-focus={focused ? "" : undefined}
            style={{ width: layout.width, height: layout.height, zoom: layout.fit < 1 ? layout.fit : undefined } as CSSProperties}
          >
            <svg ref={svg} className="ui-alp__lines" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
              {/* From one step to the next */}
              {layout.links.map((k) => {
                const reached = layout.boxes[k.i + 1].s.status !== "queued";
                return (
                  <g key={`l${k.i}`} className="ui-alp__link" data-state={reached ? "done" : "never"} style={{ "--ui-alp-i": k.i } as CSSProperties}>
                    <path className="ui-alp__head" d={k.head} />
                  </g>
                );
              })}
              {/* Back to an earlier step */}
              {layout.arcs.map((a, i) => (
                <g key={a.id} className="ui-alp__arc" data-state={a.l.count > 0 ? "done" : "never"} data-lit={litArc(a) ? "" : undefined} style={{ "--ui-alp-i": i + layout.links.length } as CSSProperties}>
                  <path d={a.d} pathLength={1} data-spark={a.id} />
                  <path className="ui-alp__head" d={a.head} />
                </g>
              ))}
              <Sparks svg={svg} lines={sparkLines} burst={burst} />
            </svg>

            {/* The steps */}
            {layout.boxes.map((b) => {
              const s = b.s;
              const n = runs.get(s.id) ?? 0;
              const isOpen = open?.kind === "step" && open.id === s.id;
              // On the card only the tokens – the time is in its card and the header
              const meta = ok(s.tokens) ? tr("{n} tokens", { n: tok(s.tokens) }) : "";
              const p = ok(s.progress) ? Math.max(0, Math.min(1, s.progress)) : undefined;
              return (
                <button
                  key={s.id}
                  ref={(el) => void (stepRefs.current[b.i] = el)}
                  type="button"
                  className="ui-alp__step"
                  data-status={s.status}
                  data-dim={dimStep(b) ? "" : undefined}
                  style={{ left: b.x, top: b.y, width: b.w, "--ui-alp-i": b.i } as CSSProperties}
                  aria-expanded={isOpen}
                  aria-label={`${s.label}, step ${b.i + 1} of ${all}: ${STATUS[s.status]}${s.model ? `, ${s.model}` : ""}${s.summary ? `. ${s.summary}` : ""}${ok(s.time) ? `. ${formatTime(s.time)}` : ""}${meta ? `, ${meta}` : ""}${n > 1 ? `, ran ${num(n)} times` : ""}${s.tools?.length ? `. Tools: ${s.tools.map((t) => t.name).join(", ")}` : ""}`}
                  onPointerEnter={() => setHover({ step: s.id })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ step: s.id })}
                  onBlur={() => setHover(null)}
                  onKeyDown={(e) => onStepKey(e, b.i)}
                  onClick={(e) => toggle("step", s.id, e.currentTarget, e.detail === 0, { step: s })}
                >
                  <span className="ui-alp__step-top">
                    <Mark id={s.agent?.id ?? s.id} busy={s.status === "running"} color={s.agent?.color ?? (all > 1 ? COLORS[b.i % COLORS.length] : undefined)} />
                    <span className="ui-alp__step-name" dir="auto">
                      {s.label}
                    </span>
                    {s.model || s.logo ? (
                      <span className="ui-alp__step-model" dir="auto" title={s.model}>
                        {s.logo ? (
                          <span className="ui-alp__tile" aria-hidden="true">
                            {s.logo}
                          </span>
                        ) : null}
                        {s.model ? <span>{s.model}</span> : null}
                      </span>
                    ) : null}
                    <StatusIcon status={s.status} />
                  </span>
                  <span className="ui-alp__step-sum" dir="auto">
                    {s.summary ?? (s.status === "queued" ? tr("Waiting for its turn") : " ")}
                  </span>
                  <span className="ui-alp__step-meta">
                    <span>{meta || "–"}</span>
                    {s.tools?.length ? (
                      <span className="ui-alp__tiles" aria-hidden="true">
                        {s.tools.slice(0, s.tools.length > 3 ? 2 : 3).map((t, k) => (
                          <span key={k} className="ui-alp__tile" title={t.name}>
                            {t.logo ?? <b>{Array.from(t.name)[0]?.toUpperCase()}</b>}
                          </span>
                        ))}
                        {s.tools.length > 3 ? <span className="ui-alp__tile ui-alp__tile--more">+{s.tools.length - 2}</span> : null}
                      </span>
                    ) : null}
                  </span>
                  {s.status === "running" ? (
                    <span className="ui-alp__bar" data-sweep={p === undefined ? "" : undefined} aria-hidden="true">
                      <i style={{ width: p === undefined ? undefined : `${Math.max(4, p * 100)}%` }} />
                    </span>
                  ) : null}
                </button>
              );
            })}

            {/* How often the run went back – a count on each arc */}
            {layout.arcs.map((a) => {
              const n = Math.max(0, a.l.count);
              const isOpen = open?.kind === "loop" && open.id === a.id;
              const words = a.l.label && !layout.stacked && a.room > 70;
              return (
                <button
                  key={a.id}
                  type="button"
                  className="ui-alp__count"
                  data-never={n ? undefined : ""}
                  data-lit={litArc(a) ? "" : undefined}
                  style={{ left: a.chip[0], top: a.chip[1], maxWidth: words ? a.room : undefined }}
                  aria-expanded={isOpen}
                  aria-label={`${a.l.label ? `${a.l.label}: ` : ""}${a.from.s.label} back to ${a.to.s.label}, ${n ? `${num(n)} ${n === 1 ? "time" : "times"}` : "never"}`}
                  onPointerEnter={() => setHover({ loop: a.id })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ loop: a.id })}
                  onBlur={() => setHover(null)}
                  onClick={(e) => toggle("loop", a.id, e.currentTarget, e.detail === 0, { loop: a.l })}
                >
                  {words ? (
                    <span className="ui-alp__count-label" dir="auto">
                      {a.l.label}
                    </span>
                  ) : null}
                  <span key={n} className="ui-alp__count-n">
                    {num(n)}×
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="ui-alp__empty">{tr("No steps yet")}</p>
        )}
      </div>

      {/* What the run made – screenshots and logs */}
      {artifacts.length ? (
        <div className="ui-alp__arts">
          <p className="ui-alp__arts-head">
            <span>{tr("Artifacts")}</span>
            <span>{num(artifacts.length)}</span>
          </p>
          <ul className="ui-alp__arts-grid">
            {artifacts.map((a, i) => {
              const from = stepLabel(a.step);
              const dim = focusStep ? a.step !== focusStep : focusLoop ? a.step !== focusLoop.l.from && a.step !== focusLoop.l.to : false;
              const isOpen = open?.kind === "art" && open.id === a.id;
              return (
                <li key={a.id} style={{ "--ui-alp-i": i } as CSSProperties}>
                  <button
                    type="button"
                    className="ui-alp__art"
                    data-dim={dim ? "" : undefined}
                    data-status={a.status}
                    aria-expanded={isOpen}
                    aria-label={`${a.title}${from ? `, from ${from}` : ""}${a.status === "pending" ? ", pending" : a.status ? `, ${a.status === "pass" ? "passed" : "failed"}` : ""}`}
                    onClick={(e) => toggle("art", a.id, e.currentTarget, e.detail === 0, { artifact: a })}
                  >
                    <span className="ui-alp__art-pic">
                      <Thumb a={a} lines={4} />
                      {a.status && a.status !== "pending" ? (
                        <span className="ui-alp__status ui-alp__art-badge" data-status={a.status === "pass" ? "done" : "failed"}>
                          {a.status === "pass" ? tr("Pass") : tr("Fail")}
                        </span>
                      ) : null}
                    </span>
                    <span className="ui-alp__art-foot">
                      {a.logo ? (
                        <span className="ui-alp__tile" aria-hidden="true">
                          {a.logo}
                        </span>
                      ) : null}
                      <span className="ui-alp__art-title" dir="auto">
                        {a.title}
                      </span>
                    </span>
                    <span className="ui-alp__art-step" dir="auto">
                      {a.status === "pending" ? tr("Pending") : a.kind === "log" ? tr("Log") : tr("Screenshot")}
                      {from ? ` · ${from}` : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {children ? <div className="ui-alp__slot">{children}</div> : null}

      {/* A step's card */}
      {openStep && open ? (
        <Card anchor={open.el} bounds={root} label={openStep.s.label} focusIn={open.kb} onClose={close}>
          <div className="ui-alp__card-top">
            <span className="ui-alp__status" data-status={openStep.s.status}>
              {STATUS[openStep.s.status]}
            </span>
            <span className="ui-alp__card-muted">
              {tr("Step {n} of {all}", { n: openStep.i + 1, all })}
            </span>
            <button type="button" className="ui-alp__card-close" aria-label={tr("Close")} onClick={() => close(true)}>
              <CloseIcon />
            </button>
          </div>
          <p className="ui-alp__card-title" dir="auto">
            {openStep.s.label}
          </p>
          {openStep.s.model || openStep.s.agent?.name ? (
            <p className="ui-alp__card-who" dir="auto">
              <Mark id={openStep.s.agent?.id ?? openStep.s.id} busy={openStep.s.status === "running"} color={openStep.s.agent?.color ?? (all > 1 ? COLORS[openStep.i % COLORS.length] : undefined)} />
              {openStep.s.agent?.name && openStep.s.agent.name !== openStep.s.label ? <span>{openStep.s.agent.name}</span> : null}
              {openStep.s.logo ? (
                <span className="ui-alp__tile" aria-hidden="true">
                  {openStep.s.logo}
                </span>
              ) : null}
              {openStep.s.model ? <span className="ui-alp__card-muted">{openStep.s.model}</span> : null}
            </p>
          ) : null}
          {openStep.s.summary ? (
            <p className="ui-alp__card-text" dir="auto">
              {openStep.s.summary}
            </p>
          ) : null}
          {openStep.s.tools?.length ? (
            <ul className="ui-alp__card-tools" aria-label={tr("Tools")}>
              {openStep.s.tools.map((t, k) => (
                <li key={k}>
                  <span className="ui-alp__tile" aria-hidden="true">
                    {t.logo ?? <b>{Array.from(t.name)[0]?.toUpperCase()}</b>}
                  </span>
                  <span dir="auto">{t.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <dl className="ui-alp__card-stats">
            <div>
              <dt>{tr("Time|spent")}</dt>
              <dd>{ok(openStep.s.time) ? formatTime(openStep.s.time) : "–"}</dd>
            </div>
            <div>
              <dt>{tr("Tokens")}</dt>
              <dd>{ok(openStep.s.tokens) ? num(openStep.s.tokens) : "–"}</dd>
            </div>
            <div>
              <dt>{tr("Ran")}</dt>
              <dd>{(runs.get(openStep.s.id) ?? 0) ? `${num(runs.get(openStep.s.id)!)}×` : tr("Not yet")}</dd>
            </div>
          </dl>
          {layout.arcs.some((a) => a.l.from === openStep.s.id || a.l.to === openStep.s.id) ? (
            <ul className="ui-alp__card-list" aria-label={tr("Loops")}>
              {layout.arcs
                .filter((a) => a.l.from === openStep.s.id || a.l.to === openStep.s.id)
                .map((a) => (
                  <li key={a.id}>
                    <span dir="auto">{a.from.s.label}</span>
                    <ArrowIcon />
                    <span dir="auto">{a.to.s.label}</span>
                    <span className="ui-alp__card-n">{num(a.l.count)}×</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      {/* A loop's card */}
      {openArc && open ? (
        <Card anchor={open.el} bounds={root} label={openArc.l.label ?? `${openArc.from.s.label} back to ${openArc.to.s.label}`} focusIn={open.kb} onClose={close}>
          <div className="ui-alp__card-top">
            <span className="ui-alp__chip">{openArc.from === openArc.to ? tr("Retry|loop") : tr("Went back")}</span>
            <span className="ui-alp__card-muted">{openArc.l.count > 0 ? `${num(openArc.l.count)}×` : tr("Never")}</span>
            <button type="button" className="ui-alp__card-close" aria-label={tr("Close")} onClick={() => close(true)}>
              <CloseIcon />
            </button>
          </div>
          {openArc.l.label ? (
            <p className="ui-alp__card-title" dir="auto">
              {openArc.l.label}
            </p>
          ) : null}
          <p className="ui-alp__card-route">
            <span dir="auto">{openArc.from.s.label}</span>
            <ArrowIcon />
            <span dir="auto">{openArc.to.s.label}</span>
          </p>
          {openArc.l.reasons?.length ? (
            <ol className="ui-alp__card-reasons">
              {openArc.l.reasons.map((r, i) => (
                <li key={i}>
                  <span className="ui-alp__card-n">#{i + 1}</span>
                  <span dir="auto">{r}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </Card>
      ) : null}

      {/* An artifact's card */}
      {openArt && open ? (
        <Card anchor={open.el} bounds={root} label={openArt.title} focusIn={open.kb} onClose={close} wide>
          <div className="ui-alp__card-top">
            <span className="ui-alp__chip">{openArt.kind === "log" ? tr("Log") : tr("Screenshot")}</span>
            {openArt.status && openArt.status !== "pending" ? (
              <span className="ui-alp__status" data-status={openArt.status === "pass" ? "done" : "failed"}>
                {openArt.status === "pass" ? tr("Pass") : tr("Fail")}
              </span>
            ) : null}
            <button type="button" className="ui-alp__card-close" aria-label={tr("Close")} onClick={() => close(true)}>
              <CloseIcon />
            </button>
          </div>
          <p className="ui-alp__card-title" dir="auto">
            {openArt.title}
          </p>
          {openArt.meta || stepLabel(openArt.step) ? (
            <p className="ui-alp__card-muted" dir="auto">
              {[stepLabel(openArt.step), openArt.meta].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <Thumb a={openArt} lines={14} />
        </Card>
      ) : null}
    </section>
  );
}

export default AgentLoop;

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-alp */
.ui-alp, .ui-alp__card {
  --ui-alp-card: var(--aui-surface, #ffffff);
  --ui-alp-strong: var(--aui-ink, #000000);
  --ui-alp-ink: var(--aui-ink, rgba(0, 0, 0, 0.88));
  --ui-alp-text: var(--aui-muted, rgba(0, 0, 0, 0.61));
  --ui-alp-muted: var(--aui-muted, rgba(0, 0, 0, 0.45));
  --ui-alp-faint: rgba(0, 0, 0, 0.27);
  --ui-alp-line: var(--aui-border, rgba(0, 0, 0, 0.06));
  --ui-alp-tag: rgba(0, 0, 0, 0.04);
  --ui-alp-box: #ffffff;
  --ui-alp-well: #f8f8f8;
  /* The lines are solid colors, never see-through – so a line and its arrowhead read as one shape */
  --ui-alp-edge: color-mix(in srgb, var(--ui-alp-strong) 30%, var(--ui-alp-card));
  --ui-alp-edge-never: color-mix(in srgb, var(--ui-alp-strong) 16%, var(--ui-alp-card));
  --ui-alp-edge-strong: color-mix(in srgb, var(--ui-alp-strong) 50%, var(--ui-alp-card));
  --ui-alp-agent: rgba(0, 96, 226, 0.78);
  --ui-alp-run-fg: #006dcbf2;
  --ui-alp-run-bg: rgba(0, 96, 226, 0.08);
  --ui-alp-ok: #1fa855;
  --ui-alp-ok-fg: #007d2ee0;
  --ui-alp-ok-bg: #00a43319;
  --ui-alp-bad: #e5484d;
  --ui-alp-bad-fg: #d72400da;
  --ui-alp-bad-bg: #f52b0018;
  --ui-alp-focus: rgba(0, 96, 226, 0.7);
  --ui-alp-shadow: 0 0 0 0.5px var(--aui-border, rgba(0, 0, 0, 0.06)), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-alp-shadow-on: 0 0 0 0.5px rgba(0, 0, 0, 0.14), 0 1px 1px -1px rgba(0, 0, 0, 0.12), 0 2px 4px 0 rgba(0, 0, 0, 0.06);
  --ui-alp-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-alp-spark: #0090fe;
  --ui-alp-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
  --ui-alp-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
}
.ui-alp {
  position: relative;
  box-sizing: border-box;
  display: grid;
  gap: 24px;
  width: 100%;
  padding: 22px 24px 24px;
  border-radius: calc(var(--aui-radius-lg, 10px) + 4px);
  background: var(--aui-surface, var(--ui-alp-card));
  box-shadow: var(--aui-shadow-card, var(--ui-alp-shadow));
  font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 13px;
  line-height: 20px;
  letter-spacing: -0.15px;
  color: var(--ui-alp-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-alp *, .ui-alp *::before, .ui-alp *::after { box-sizing: border-box; }
.ui-alp p { margin: 0; }
.ui-alp svg { display: block; flex: none; }
.ui-alp b { font-weight: 500; color: var(--ui-alp-strong); }
:where(.ui-alp, .ui-alp__card) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; letter-spacing: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }

/* ----- The header: the run, its iteration, time and tokens, and where it is now ----- */
.ui-alp__head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-width: 0; }
.ui-alp__title { display: flex; flex: 1 1 0; align-items: baseline; gap: 8px; min-width: min(160px, 100%); }
.ui-alp__title > b { flex: none; max-width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__sub { display: inline-flex; align-items: center; gap: 6px; min-width: 0; color: var(--ui-alp-muted); font-size: 12px; white-space: nowrap; }
.ui-alp__sub > span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-alp__title { align-items: center; }
.ui-alp__sum { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; min-width: 0; max-width: 100%; margin-left: auto; font-size: 12px; line-height: 16px; }
.ui-alp__nums { display: inline-flex; gap: 10px; min-width: 0; color: var(--ui-alp-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-alp__badge { display: inline-flex; align-items: center; gap: 5px; flex: 0 1 auto; min-width: 0; height: 20px; padding: 0 7px; overflow: hidden; border-radius: 5px; background: var(--ui-alp-tag); color: var(--ui-alp-text); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__badge[data-state="active"] { background: var(--ui-alp-run-bg); color: var(--ui-alp-run-fg); }
.ui-alp__badge[data-state="done"] { background: var(--ui-alp-ok-bg); color: var(--ui-alp-ok-fg); }
.ui-alp__badge[data-state="failed"] { background: var(--ui-alp-bad-bg); color: var(--ui-alp-bad-fg); }
.ui-alp__pulse { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: ui-alp-pulse 1.6s ease-in-out infinite; }

/* The agent's pixel mark */
.ui-alp__mark { display: grid; grid-template-columns: repeat(3, 3px); grid-auto-rows: 3px; gap: 1.5px; place-content: center; width: 16px; height: 16px; flex: none; }
.ui-alp__mark i { border-radius: 0.75px; background: var(--ui-alp-mark, var(--ui-alp-agent)); opacity: 0; }
.ui-alp__mark i[data-on] { opacity: 1; }
.ui-alp__mark[data-busy] i { animation: ui-alp-pixel 1.2s ease-in-out infinite both; }
.ui-alp__mark[data-busy] i:not([data-on]) { opacity: 0.16; }

/* ----- The loop: never scrolls – the cards narrow, then it scales down to fit ----- */
.ui-alp__track { min-width: 0; margin: -6px; padding: 6px; overflow: hidden; }
.ui-alp__canvas { position: relative; direction: ltr; }
.ui-alp__empty { padding: 24px 0; font-size: 13px; color: var(--ui-alp-muted); text-align: center; }

/* The lines: one step to the next, and the arcs back */
.ui-alp__lines { position: absolute; inset: 0; z-index: 1; overflow: visible; pointer-events: none; }
:is(.ui-alp__link, .ui-alp__arc) { color: var(--ui-alp-edge); transition: color 280ms ease, opacity 280ms ease; }
:is(.ui-alp__link, .ui-alp__arc) path { fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: butt; stroke-linejoin: round; }
:is(.ui-alp__link, .ui-alp__arc) > path:first-of-type { stroke-dasharray: 1; animation: ui-alp-draw 560ms var(--ui-alp-ease) calc(160ms + var(--ui-alp-i, 0) * 50ms) backwards; }
:is(.ui-alp__link, .ui-alp__arc) path.ui-alp__head { fill: currentColor; stroke: none; animation: ui-alp-fade 240ms ease calc(560ms + var(--ui-alp-i, 0) * 50ms) backwards; }
:is(.ui-alp__link, .ui-alp__arc)[data-state="never"] { color: var(--ui-alp-edge-never); }
:is(.ui-alp__link, .ui-alp__arc)[data-state="never"] > path:first-of-type { stroke-dasharray: 3 4; animation: none; }
.ui-alp__canvas[data-focus] .ui-alp__arc:not([data-lit]) { opacity: 0.3; }
.ui-alp__canvas[data-focus] .ui-alp__arc[data-lit] { color: var(--ui-alp-edge-strong); }
/* A spark – a line on the line, full at its head and fading to nothing at its tail */
.ui-alp__spark { fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

/* ----- A step: four fixed lines, so nothing jumps as it changes ----- */
.ui-alp__step { position: absolute; z-index: 2; container-type: inline-size; display: grid; grid-template-rows: 20px 18px 18px; align-content: start; gap: 4px; height: 92px; padding: 11px 12px 0; overflow: hidden; border-radius: 10px; background: var(--ui-alp-box); box-shadow: var(--ui-alp-shadow); color: var(--ui-alp-ink); text-align: left; transition: box-shadow 200ms ease, opacity 280ms ease, background-color 300ms ease; animation: ui-alp-in 360ms var(--ui-alp-ease) calc(60ms + var(--ui-alp-i, 0) * 60ms) backwards; }
.ui-alp__step:hover, .ui-alp__step[aria-expanded="true"] { box-shadow: var(--ui-alp-shadow-on); }
.ui-alp__step:focus-visible { outline: 2px solid var(--ui-alp-focus); outline-offset: 2px; }
.ui-alp__step[data-dim] { opacity: 0.45; }
.ui-alp__step-top { display: flex; align-items: center; gap: 7px; min-width: 0; }
.ui-alp__step-top > .ui-alp__mark { width: 14px; height: 14px; grid-template-columns: repeat(3, 3px); grid-auto-rows: 3px; gap: 1px; }
.ui-alp__step-name { flex: 0 0 auto; max-width: calc(100% - 52px); min-width: 0; overflow: hidden; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--ui-alp-strong); white-space: nowrap; text-overflow: ellipsis; }
/* The model: its maker's logo next to the name, its name too where there's room – it gives way before the step's name */
/* It clips a long name, so it keeps 3px of room around its tile – the tile's hairline and shadow are never cut */
.ui-alp__step-model { display: flex; flex: 1 1 0; align-items: center; gap: 5px; min-width: 22px; margin: -3px; padding: 3px; overflow: hidden; color: var(--ui-alp-muted); font-size: 11px; line-height: 16px; }
@container (max-width: 168px) { .ui-alp__step-model > span:not(.ui-alp__tile) { display: none; } }
.ui-alp__step-model > span:last-child:not(.ui-alp__tile) { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__step-sum { min-width: 0; overflow: hidden; color: var(--ui-alp-muted); font-size: 12px; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__step-meta { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--ui-alp-muted); font-size: 11px; line-height: 16px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-alp__step-meta > span:first-child { flex: 0 0 auto; max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* The tools it works with: small white tiles with their logos, lying a little over each other – short of room they give way first */
.ui-alp__tiles { display: inline-flex; flex: 0 1 auto; flex-wrap: wrap; justify-content: flex-end; min-width: 0; height: 24px; margin: -3px -3px -3px auto; padding: 4px 3px 4px 4px; overflow: hidden; }
/* An empty first item: a tile that doesn't fit wraps onto the hidden second line instead of showing cut off */
.ui-alp__tiles::before { content: ""; width: 0; height: 16px; margin-bottom: 8px; }
.ui-alp__tiles > .ui-alp__tile { margin-bottom: 8px; }
.ui-alp__tiles > .ui-alp__tile + .ui-alp__tile { margin-left: -4px; }
.ui-alp__tiles > .ui-alp__tile:nth-child(even) { transform: translateY(-0.5px) rotate(4deg); }
.ui-alp__tiles > .ui-alp__tile:nth-child(odd):not(:first-child) { transform: rotate(-3deg); }
.ui-alp__tile > b { font-size: 9px; line-height: 1; color: var(--ui-alp-text); }
.ui-alp__tile--more { width: auto; min-width: 16px; padding: 0 3px; font-size: 9px; font-weight: 500; color: var(--ui-alp-text); }
.ui-alp__step[data-status="queued"] { background: var(--ui-alp-well); box-shadow: 0 0 0 0.5px var(--ui-alp-line); }
.ui-alp__step[data-status="queued"] :is(.ui-alp__step-name, .ui-alp__step-model) { color: var(--ui-alp-muted); }
.ui-alp__step[data-status="queued"] :is(.ui-alp__mark, .ui-alp__tile) { opacity: 0.45; }
/* The step running now: a soft wash in the agent's blue, a sheen running over it and a light grey shadow lifting it – no blue edge */
.ui-alp__step[data-status="running"] { background: radial-gradient(90% 130% at 0% 0%, color-mix(in srgb, var(--ui-alp-agent) 14%, transparent), transparent 70%), radial-gradient(70% 120% at 100% 100%, color-mix(in srgb, var(--ui-alp-agent) 8%, transparent), transparent 70%), var(--ui-alp-box); box-shadow: var(--ui-alp-shadow-on), 0 4px 10px -4px rgba(0, 0, 0, 0.1); }
.ui-alp__step[data-status="running"]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--ui-alp-agent) 11%, transparent) 50%, transparent 70%); background-size: 250% 100%; animation: ui-alp-sheen 1.8s ease-in-out infinite; pointer-events: none; }
.ui-alp__step[data-status="failed"] { box-shadow: 0 0 0 1px color-mix(in srgb, var(--ui-alp-bad) 50%, transparent); }
/* Its progress: a light tint with a hairline edge, a sheen sweeping over it and a glowing leading edge */
.ui-alp__bar { position: absolute; left: 11px; right: 11px; bottom: 8px; height: 4px; overflow: hidden; border-radius: 2px; background: color-mix(in srgb, var(--ui-alp-agent) 10%, transparent); }
.ui-alp__bar > i { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--ui-alp-agent) 30%, transparent), color-mix(in srgb, var(--ui-alp-agent) 75%, transparent)); box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--ui-alp-agent) 60%, transparent); transition: width 600ms var(--ui-alp-ease); }
.ui-alp__bar > i::before { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.55), transparent); background-size: 50% 100%; background-repeat: no-repeat; animation: ui-alp-shine 1.6s ease-in-out infinite; }
.ui-alp__bar > i::after { content: ""; position: absolute; top: -2px; right: -1px; bottom: -2px; width: 3px; border-radius: 2px; background: var(--ui-alp-agent); box-shadow: 0 0 6px 1px color-mix(in srgb, var(--ui-alp-agent) 70%, transparent); }
.ui-alp__bar[data-sweep] > i { width: 35%; animation: ui-alp-sweep 1.4s ease-in-out infinite; }
.ui-alp__bar[data-sweep] > i::after { display: none; }

/* The status icon – grey; a failed step's is red */
.ui-alp__icon { flex: none; margin-left: auto; padding-left: 2px; box-sizing: content-box; color: var(--ui-alp-muted); }
.ui-alp__icon[data-status="queued"] { color: var(--ui-alp-faint); }
.ui-alp__icon[data-status="failed"] { color: var(--ui-alp-bad); }

/* Status tags – the only color on a card */
.ui-alp__status { flex: none; padding: 0 6px; border-radius: 5px; background: var(--ui-alp-tag); color: var(--ui-alp-text); font-size: 11px; font-weight: 500; line-height: 18px; white-space: nowrap; }
.ui-alp__status[data-status="running"] { background: var(--ui-alp-run-bg); color: var(--ui-alp-run-fg); }
.ui-alp__status[data-status="done"] { background: var(--ui-alp-ok-bg); color: var(--ui-alp-ok-fg); }
.ui-alp__status[data-status="failed"] { background: var(--ui-alp-bad-bg); color: var(--ui-alp-bad-fg); }
.ui-alp__status[data-status="queued"] { background: transparent; box-shadow: inset 0 0 0 0.5px var(--ui-alp-line); color: var(--ui-alp-muted); }

/* The model maker's logo on a small white tile */
.ui-alp__tile { display: grid; flex: none; place-items: center; width: 16px; height: 16px; border-radius: 4px; background: var(--ui-alp-box); box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.1), 0 1px 2px rgba(0, 0, 0, 0.08); }
.ui-alp__tile > svg, .ui-alp__tile > img { width: 10px; height: 10px; }

/* How often the run went back: a small white tag on the arc, it pops when the count goes up */
.ui-alp__count { position: absolute; z-index: 3; display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 7px; border-radius: 10px; background: var(--ui-alp-box); box-shadow: var(--ui-alp-shadow); color: var(--ui-alp-text); font-size: 11px; line-height: 16px; white-space: nowrap; transform: translate(-50%, -50%); transition: box-shadow 200ms ease, opacity 280ms ease, color 200ms ease; animation: ui-alp-chip 300ms var(--ui-alp-ease) 760ms backwards; }
.ui-alp__count:hover, .ui-alp__count[aria-expanded="true"] { box-shadow: var(--ui-alp-shadow-on); color: var(--ui-alp-ink); }
.ui-alp__count:focus-visible { outline: 2px solid var(--ui-alp-focus); outline-offset: 2px; }
.ui-alp__count[data-never] { color: var(--ui-alp-faint); }
.ui-alp__canvas[data-focus] .ui-alp__count:not([data-lit]) { opacity: 0.35; }
.ui-alp__count-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-alp__count-n { display: inline-block; flex: none; color: var(--ui-alp-ink); font-weight: 500; font-variant-numeric: tabular-nums; animation: ui-alp-tick 420ms var(--ui-alp-ease); }
.ui-alp__count[data-never] .ui-alp__count-n { color: inherit; }

/* ----- The artifacts ----- */
.ui-alp__arts { display: grid; gap: 12px; min-width: 0; padding-top: 22px; border-top: 0.5px solid var(--ui-alp-line); }
.ui-alp__arts-head { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--ui-alp-ink); }
.ui-alp__arts-head > span:last-child { color: var(--ui-alp-muted); font-weight: 400; font-variant-numeric: tabular-nums; }
.ui-alp__arts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; margin: 0; padding: 0; list-style: none; }
.ui-alp__arts-grid > li { min-width: 0; animation: ui-alp-in 360ms var(--ui-alp-ease) calc(300ms + var(--ui-alp-i, 0) * 50ms) backwards; }
.ui-alp__art { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; width: 100%; padding: 4px 4px 7px; border-radius: 10px; text-align: left; transition: background-color 160ms ease, opacity 280ms ease; }
.ui-alp__art:hover, .ui-alp__art[aria-expanded="true"] { background: var(--ui-alp-tag); }
.ui-alp__art:focus-visible { outline: 2px solid var(--ui-alp-focus); outline-offset: 2px; }
.ui-alp__art[data-dim] { opacity: 0.4; }
.ui-alp__art-pic { position: relative; display: block; min-width: 0; }
/* Pass or fail sits on the picture's corner, on a solid backing so it reads on any screenshot */
.ui-alp__art-badge { position: absolute; top: 6px; right: 6px; background: linear-gradient(var(--ui-alp-tag), var(--ui-alp-tag)), var(--ui-alp-box); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }
.ui-alp__art-badge[data-status="done"] { background: linear-gradient(var(--ui-alp-ok-bg), var(--ui-alp-ok-bg)), var(--ui-alp-box); }
.ui-alp__art-badge[data-status="failed"] { background: linear-gradient(var(--ui-alp-bad-bg), var(--ui-alp-bad-bg)), var(--ui-alp-box); }
.ui-alp__art-foot { display: flex; align-items: center; gap: 6px; min-width: 0; margin-top: 8px; padding: 0 2px; }
.ui-alp__art-title { flex: 1 1 auto; min-width: 0; overflow: hidden; color: var(--ui-alp-ink); font-size: 12px; font-weight: 500; line-height: 18px; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__art-step { min-width: 0; padding: 0 2px; overflow: hidden; color: var(--ui-alp-muted); font-size: 11px; line-height: 16px; white-space: nowrap; text-overflow: ellipsis; }
/* The picture: a grey well with a white window on it, grey and white like a placeholder – color only in the badge */
.ui-alp__thumb { position: relative; display: block; width: 100%; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 8px; background: var(--ui-alp-well); box-shadow: 0 0 0 0.5px var(--ui-alp-line); }
.ui-alp__thumb > img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
.ui-alp__thumb--log { display: flex; padding: 12px 12px 0; }
.ui-alp__log { display: flex; flex: 1; flex-direction: column; justify-content: flex-end; gap: 1px; min-width: 0; padding: 7px 8px; border-radius: 6px 6px 0 0; background: var(--ui-alp-box); box-shadow: 0 0 0 0.5px var(--ui-alp-line), 0 1px 2px rgba(0, 0, 0, 0.04); font-family: var(--ui-alp-mono); font-size: 8.5px; line-height: 12px; letter-spacing: 0; color: var(--ui-alp-muted); }
.ui-alp__log > span { overflow: hidden; white-space: pre; text-overflow: ellipsis; }
/* In its card the log reads in full, with failing lines red and passing ones green */
.ui-alp__card .ui-alp__log > span[data-tone="bad"] { color: var(--ui-alp-bad-fg); }
.ui-alp__card .ui-alp__log > span[data-tone="ok"] { color: var(--ui-alp-ok-fg); }
.ui-alp__thumb[data-pending] { background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, var(--ui-alp-strong) 5%, transparent) 50%, transparent 70%) var(--ui-alp-well); background-size: 250% 100%; animation: ui-alp-sheen 1.6s ease-in-out infinite; }
.ui-alp__slot { min-width: 0; }

/* ----- The card ----- */
.ui-alp__card { position: fixed; inset: auto; margin: 0; border: 0; overflow: visible; display: grid; gap: 8px; width: min(264px, calc(100vw - 24px)); padding: 10px 10px 11px; border-radius: calc(var(--aui-radius-lg, 10px) - 2px); background: var(--aui-overlay, var(--ui-alp-card)); box-shadow: var(--aui-shadow-popover, var(--ui-alp-pop)); color: var(--ui-alp-text); font-family: var(--aui-font, "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); font-size: 12px; line-height: 16px; letter-spacing: -0.15px; text-align: left; -webkit-font-smoothing: antialiased; animation: ui-alp-pop 180ms var(--ui-alp-ease) both; }
.ui-alp__card[data-wide] { width: min(360px, calc(100vw - 24px)); }
.ui-alp__card:not(:popover-open) { display: none; }
.ui-alp__card[data-side="above"] { animation-name: ui-alp-pop-up; }
.ui-alp__card *, .ui-alp__card *::before, .ui-alp__card *::after { box-sizing: border-box; }
.ui-alp__card p { margin: 0; }
.ui-alp__card svg { display: block; flex: none; }
.ui-alp__card-top { display: flex; align-items: center; gap: 6px; min-width: 0; min-height: 20px; }
.ui-alp__card-close { display: grid; place-items: center; flex: none; width: 22px; height: 22px; margin: -2px -4px -2px auto; border-radius: 5px; color: var(--ui-alp-muted); }
.ui-alp__card-close:hover { background: var(--ui-alp-tag); color: var(--ui-alp-ink); }
.ui-alp__card-close:focus-visible { outline: 2px solid var(--ui-alp-focus); outline-offset: 2px; }
.ui-alp__card-title { overflow-wrap: anywhere; font-size: 13px; line-height: 18px; font-weight: 500; color: var(--ui-alp-strong); }
.ui-alp__card-who { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--ui-alp-ink); }
.ui-alp__card-who > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__card-text { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.ui-alp__card-muted { min-width: 0; overflow: hidden; color: var(--ui-alp-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__card-route { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--ui-alp-muted); }
.ui-alp__card-route > span { min-width: 0; overflow: hidden; color: var(--ui-alp-ink); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__chip { flex: none; padding: 1px 6px; border-radius: 5px; background: var(--ui-alp-tag); color: var(--ui-alp-text); font-size: 11px; line-height: 16px; white-space: nowrap; }
.ui-alp__card-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 0; padding-top: 8px; border-top: 0.5px solid var(--ui-alp-line); }
.ui-alp__card-stats div { min-width: 0; }
.ui-alp__card-stats dt { color: var(--ui-alp-muted); font-size: 11px; line-height: 14px; }
.ui-alp__card-stats dd { margin: 0; overflow: hidden; color: var(--ui-alp-ink); font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__card-list, .ui-alp__card-reasons { display: grid; gap: 4px; margin: 0; padding: 8px 0 0; border-top: 0.5px solid var(--ui-alp-line); list-style: none; }
.ui-alp__card-list > li { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--ui-alp-muted); }
.ui-alp__card-list > li > span[dir] { min-width: 0; overflow: hidden; color: var(--ui-alp-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__card-reasons > li { display: flex; gap: 8px; min-width: 0; color: var(--ui-alp-ink); }
.ui-alp__card-reasons > li > span[dir] { min-width: 0; overflow-wrap: anywhere; }
.ui-alp__card-reasons .ui-alp__card-n { margin-left: 0; }
.ui-alp__card-tools { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.ui-alp__card-tools > li { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--ui-alp-ink); }
.ui-alp__card-tools > li > span[dir] { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-alp__card-n { flex: none; margin-left: auto; color: var(--ui-alp-muted); font-variant-numeric: tabular-nums; }
.ui-alp__card .ui-alp__thumb { margin-top: 2px; }
.ui-alp__card .ui-alp__thumb--log { aspect-ratio: auto; max-height: 240px; }
.ui-alp__card .ui-alp__log { justify-content: flex-start; font-size: 11px; line-height: 16px; color: var(--ui-alp-text); }

@keyframes ui-alp-in { from { opacity: 0; transform: scale(0.96); } }
@keyframes ui-alp-fade { from { opacity: 0; } }
@keyframes ui-alp-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes ui-alp-chip { from { opacity: 0; transform: translate(-50%, -50%) scale(0.85); } }
@keyframes ui-alp-tick { from { opacity: 0; transform: translateY(5px); } }
@keyframes ui-alp-sheen { from { background-position: 150% 0; } to { background-position: -50% 0; } }
@keyframes ui-alp-shine { from { background-position: -100% 0; } to { background-position: 200% 0; } }
@keyframes ui-alp-sweep { from { left: -35%; } to { left: 100%; } }
@keyframes ui-alp-pixel { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
@keyframes ui-alp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes ui-alp-pop { from { opacity: 0; transform: translateY(-3px) scale(0.98); } }
@keyframes ui-alp-pop-up { from { opacity: 0; transform: translateY(3px) scale(0.98); } }

@media (prefers-reduced-motion: reduce) {
  .ui-alp *, .ui-alp *::before, .ui-alp *::after, .ui-alp__card { animation: none !important; transition: none !important; }
  .ui-alp__sparks { display: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-alp, :where(.dark, [data-theme="dark"]) .ui-alp__card {
  --ui-alp-card: var(--aui-surface, #1c1c1e);
  --ui-alp-strong: var(--aui-ink, #ffffff);
  --ui-alp-ink: var(--aui-ink, rgba(255, 255, 255, 0.9));
  --ui-alp-text: var(--aui-muted, rgba(255, 255, 255, 0.62));
  --ui-alp-muted: var(--aui-muted, rgba(255, 255, 255, 0.46));
  --ui-alp-faint: rgba(255, 255, 255, 0.28);
  --ui-alp-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-alp-tag: rgba(255, 255, 255, 0.07);
  --ui-alp-box: #2c2c2f;
  --ui-alp-well: #242427;
  --ui-alp-edge: color-mix(in srgb, var(--ui-alp-strong) 32%, var(--ui-alp-card));
  --ui-alp-edge-never: color-mix(in srgb, var(--ui-alp-strong) 18%, var(--ui-alp-card));
  --ui-alp-edge-strong: color-mix(in srgb, var(--ui-alp-strong) 56%, var(--ui-alp-card));
  --ui-alp-agent: rgba(77, 141, 255, 0.85);
  --ui-alp-run-fg: #7fb0ff;
  --ui-alp-run-bg: rgba(77, 141, 255, 0.14);
  --ui-alp-ok: #46c878;
  --ui-alp-ok-fg: #6fd398;
  --ui-alp-ok-bg: rgba(70, 200, 120, 0.14);
  --ui-alp-bad: #ff6369;
  --ui-alp-bad-fg: #ff8f8a;
  --ui-alp-bad-bg: rgba(255, 90, 80, 0.16);
  --ui-alp-focus: rgba(77, 141, 255, 0.8);
  --ui-alp-spark: #4d8dff;
  --ui-alp-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.4);
  --ui-alp-shadow-on: 0 0 0 0.5px rgba(255, 255, 255, 0.2), 0 1px 3px rgba(0, 0, 0, 0.5);
  --ui-alp-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
:where(.dark, [data-theme="dark"]) .ui-alp__tile { box-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.14), 0 1px 2px rgba(0, 0, 0, 0.4); }
/* ----- The classic style ----- */
.ui-alp, .ui-alp__card {
  --ui-alp-card: var(--aui-surface, #ffffff);
  --ui-alp-strong: var(--aui-ink, #171717);
  --ui-alp-ink: var(--aui-ink, #171717);
  --ui-alp-text: var(--aui-muted, #6b6b6b);
  --ui-alp-muted: var(--aui-muted, #8a8a8a);
  --ui-alp-line: var(--aui-border, #ececec);
  --ui-alp-tag: #f3f3f3;
  --ui-alp-well: #f8f8f8;
  --ui-alp-shadow: 0 0 0 1px var(--ui-alp-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-alp-shadow-on: 0 0 0 1px #d6d6d6, 0 2px 6px rgba(0, 0, 0, 0.06);
  --ui-alp-pop: var(--aui-shadow-popover, 0 0 0 1px var(--ui-alp-line), 0 16px 32px -12px rgba(0, 0, 0, 0.2));
  --ui-alp-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
}
.ui-alp { border-radius: var(--aui-radius-lg, 16px); font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif); font-size: 14px; letter-spacing: -0.006em; }
.ui-alp b, .ui-alp__card-title, .ui-alp__step-name { font-weight: 600; }
.ui-alp__step { border-radius: 14px; }
.ui-alp__thumb { border-radius: 9px; }
.ui-alp__art { border-radius: 12px; }
.ui-alp__badge, .ui-alp__chip, .ui-alp__status { border-radius: 999px; padding-left: 8px; padding-right: 8px; }
.ui-alp__tile { border-radius: 5px; }
.ui-alp__card { border-radius: 14px; padding: 12px 12px 13px; }
:where(.dark, [data-theme="dark"]) .ui-alp, :where(.dark, [data-theme="dark"]) .ui-alp__card {
  --ui-alp-card: var(--aui-surface, #232326);
  --ui-alp-strong: var(--aui-ink, #ededed);
  --ui-alp-ink: var(--aui-ink, #ededed);
  --ui-alp-text: var(--aui-muted, #a1a1a6);
  --ui-alp-muted: var(--aui-muted, #7c7c82);
  --ui-alp-line: var(--aui-border, #2a2a2e);
  --ui-alp-tag: #2f2f33;
  --ui-alp-box: #2a2a2e;
  --ui-alp-well: #26262a;
  --ui-alp-shadow: 0 0 0 1px var(--ui-alp-line), 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-alp-shadow-on: 0 0 0 1px #3a3a40, 0 2px 6px rgba(0, 0, 0, 0.4);
  --ui-alp-pop: var(--aui-shadow-popover, 0 0 0 1px var(--ui-alp-line), 0 16px 32px -12px rgba(0, 0, 0, 0.6));
}
`;
