"use client";
/*
 * affectUI Pro – © Florian Höller (adfects), https://www.affectui.com
 * Used in code-maxxer under an affectUI Pro license. This file may not be copied,
 * redistributed or published on its own, outside code-maxxer. Licenses: https://www.affectui.com/pricing
 */

import { isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { t as tr } from "@/lib/i18n";
import { Marquee } from "../app/Marquee";

/*
 * Agent Monitor – one AI agent at work as a small card on a gray tray, in a single self-contained file.
 *   · in the white card, on top the agent – its mark, name and role – what it has cost so far (with a soft shimmer
 *     while it runs) and its state
 *   · in a gray well its current step and the clock; each new step rolls in from below
 *   · when it wants something from you, the well shows the exact command, with Decline and Allow (Escape and Enter
 *     while the card has the focus); once it's finished, what came of it ("+42 −8 · 6 files")
 *   · a slim time strip – every step as wide as it took – and the finished steps, three rows tall and scrollable,
 *     each with the logo of the tool it used; a finished step drops in at the top. Point at a bar or a row and its
 *     partner lights up, the rest fade; click either and a small info card opens with what the step did
 *   · on the tray under the card, the controls: Pause and Cancel, Decline and Allow, Try again, the log
 *   · fold it away and it's a small gray bar: the agent in a white chip, the logos of the tools it has used so far (the one in use
 *     lit, each naming its last step on hover), and the clock or its state – click it to open the card
 * The styles are injected below, so no extra files are needed.
 */

export type AgentRunState = "idle" | "running" | "waiting" | "paused" | "finished" | "failed" | "cancelled";

/** What kind of work a step is – gives it its icon when it has no logo of its own */
export type AgentStepKind = "read" | "search" | "edit" | "run" | "think" | "web";

export type AgentRunStep = {
  id: string;
  /** What the step does or did – the text carries its state, so keep it short */
  label: string;
  kind?: AgentStepKind;
  /** The tool's logo (GitHub, Linear, Slack…) or an icon of your own instead of the kind's */
  icon?: ReactNode;
  state: "queued" | "running" | "done" | "failed";
  /** For the running step: when it began (ms) */
  since?: number;
  /** For a finished step: how long it took (ms) */
  took?: number;
  /** For the step's info card: the tool's name, a sentence on what happened, and what it ran or touched */
  tool?: string;
  detail?: string;
  output?: string;
};

export type AgentMonitorProps = {
  /** Where the run is */
  state?: AgentRunState;
  /** The agent: its name, what it's for (or its model) and its mark – a 16px logo */
  agent?: { name: string; role?: string; mark?: ReactNode };
  /** Every step, oldest first – the running one fills the well, queued ones count toward "3/6" */
  steps?: AgentRunStep[];
  /** What the well says while it runs – leave it out to show the running step */
  current?: { label: string; kind?: AgentStepKind; icon?: ReactNode };
  /** When the run began (ms) – the clock counts from here */
  since?: number;
  /** When it ended (ms) – the clock stops here */
  until?: number;
  /** How long it was paused (ms) – left out of the clock, so it never jumps on resume */
  pausedFor?: number;
  /** What the run has cost so far, in USD */
  cost?: number;
  /** While it's waiting on you: what it wants to do, the exact command, the tool's logo */
  ask?: { title: string; command?: string; icon?: ReactNode };
  /** Once it's finished: what came of it */
  outcome?: { added?: number; removed?: number; files?: number; note?: string };
  /** When it failed: what went wrong, in a few words */
  error?: string;
  /** Start folded away, as the small bar */
  defaultFolded?: boolean;
  /** code-maxxer: what it was asked, two lines under the agent (the user's last request) */
  brief?: string;
  /** code-maxxer: shown in the tray before the step count, e.g. the model at work */
  trayBadge?: ReactNode;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onAllow?: () => void;
  onDecline?: () => void;
  onRetry?: () => void;
  onOpenLog?: () => void;
  className?: string;
};

/* ---------- Small parts ---------- */

const svg = (d: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const KIND_ICON: Record<AgentStepKind, ReactNode> = {
  read: svg(<><path d="M4 1.75h5.25L12 4.5v9.75H4z" /><path d="M9 1.75V4.75h3M6.25 8h3.5M6.25 10.5h3.5" /></>, 12),
  search: svg(<><circle cx="7.25" cy="7.25" r="4.25" /><path d="m10.5 10.5 3.25 3.25" /></>, 12),
  edit: svg(<><path d="M10.75 2.75 13.25 5.25 6 12.5H3.5V10z" /><path d="m9.25 4.25 2.5 2.5" /></>, 12),
  run: svg(<><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="m4.75 6.25 2 1.75-2 1.75M8.5 10h2.75" /></>, 12),
  think: svg(<path d="M8 1.75c.4 3.1 1.6 4.4 4.75 4.75-3.15.35-4.35 1.65-4.75 4.75-.4-3.1-1.6-4.4-4.75-4.75C6.4 6.15 7.6 4.85 8 1.75z" />, 12),
  web: svg(<><circle cx="8" cy="8" r="6.25" /><path d="M1.75 8h12.5M8 1.75c1.75 1.9 2.6 4 2.6 6.25S9.75 12.35 8 14.25C6.25 12.35 5.4 10.25 5.4 8S6.25 3.65 8 1.75z" /></>, 12),
};
const KIND_NAME_EN: Record<AgentStepKind, string> = { read: "Read", search: "Search", edit: "Edit", run: "Terminal", think: "Thinking", web: "Web" };
const KIND_NAME = new Proxy(KIND_NAME_EN, { get: (o, k: string) => tr(o[k as AgentStepKind]) });
const Fold = () => svg(<path d="m5 3 3 3 3-3M5 13l3-3 3 3" />, 12);
const PauseIcon = () => svg(<path d="M6 4v8M10 4v8" />, 11);
const PlayIcon = () => svg(<path d="M5.5 3.75v8.5L12 8z" />, 11);
const CancelIcon = () => svg(<path d="m5 5 6 6M11 5l-6 6" />, 11);
const CheckIcon = () => svg(<path d="m3.75 8.25 2.75 2.75 5.75-6" />, 11);
const WarnIcon = () => svg(<><path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.5 9.75a1 1 0 0 1-.87 1.5H2.5a1 1 0 0 1-.87-1.5z" /><path d="M8 6.25v3M8 11.5v.25" /></>, 11);
const LogIcon = () => svg(<path d="M5.5 10.5 10.75 5.25M6 5h4.75v4.75" />, 12);
const RetryIcon = () => svg(<path d="M3.25 8a4.75 4.75 0 1 0 1.4-3.35M3.25 2.75v2.5h2.5" />, 12);

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};
const words = (ms: number) => {
  // Whole seconds the same way the clock counts them, so "Finished in 18s" and 0:18 agree
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
const secs = (ms: number) => (ms < 10_000 ? `${(Math.max(0, ms) / 1000).toFixed(1)}s` : words(ms));
const usd = (n: number) => (n > 0 && n < 0.001 ? "<$0.001" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const num = new Intl.NumberFormat("en-US");
const LABEL_EN: Record<AgentRunState, string> = { idle: "Idle", running: "Running", waiting: "Needs you", paused: "Paused", finished: "Finished", failed: "Failed", cancelled: "Cancelled" };
const LABEL = new Proxy(LABEL_EN, { get: (o, k: string) => tr(o[k as AgentRunState]) });

/** Content that changes in place: the old line rolls up and out while the new one rolls in from below */
function Roll({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const last = useRef({ id, node: children });
  const [out, setOut] = useState<{ id: string; node: ReactNode } | null>(null);
  if (last.current.id !== id && out?.id !== last.current.id) setOut(last.current);
  useLayoutEffect(() => {
    last.current = { id, node: children };
  });
  return (
    <span className={["ui-agm__roll", className].filter(Boolean).join(" ")}>
      {out && (
        <span key={`out-${out.id}`} className="ui-agm__roll-layer" data-leaving="" aria-hidden="true" onAnimationEnd={(e) => e.target === e.currentTarget && setOut(null)}>
          {out.node}
        </span>
      )}
      <span key={id} className="ui-agm__roll-layer" data-coming={out ? "" : undefined}>
        {children}
      </span>
    </span>
  );
}

/** Content that swaps in place and may change width: the old one fades out as the new one fades in, and the room
 *  between them eases to the new width – so nothing around it jumps */
function Morph({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  const last = useRef({ id, node: children });
  const [out, setOut] = useState<{ id: string; node: ReactNode } | null>(null);
  if (last.current.id !== id && out?.id !== last.current.id) setOut(last.current);
  useLayoutEffect(() => {
    last.current = { id, node: children };
  });
  const cur = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number>();
  useLayoutEffect(() => {
    const w = cur.current?.offsetWidth;
    if (w != null && w !== width) setWidth(w);
  });
  return (
    <span className={["ui-agm__morph", className].filter(Boolean).join(" ")} style={{ width }}>
      {out && (
        <span key={`out-${out.id}`} className="ui-agm__morph-layer" data-leaving="" aria-hidden="true" inert onAnimationEnd={(e) => e.target === e.currentTarget && setOut(null)}>
          {out.node}
        </span>
      )}
      <span ref={cur} key={id} className="ui-agm__morph-layer" data-coming={out ? "" : undefined}>
        {children}
      </span>
    </span>
  );
}

/* ---------- The component ---------- */

export function AgentMonitor({
  state = "idle",
  agent = { name: "Agent" },
  steps = [],
  current,
  since,
  until,
  pausedFor = 0,
  cost,
  ask,
  outcome,
  error,
  defaultFolded = false,
  brief,
  onPause,
  onResume,
  onCancel,
  onAllow,
  onDecline,
  onRetry,
  onOpenLog,
  trayBadge,
  className,
}: AgentMonitorProps) {
  const uid = useId();
  const [folded, setFolded] = useState(defaultFolded);
  const tile = useRef<HTMLButtonElement>(null);
  const fold = useRef<HTMLButtonElement>(null);
  // After folding or opening, the focus moves to the control that does the opposite – it never falls off the page
  const moveFocus = useRef(false);
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    (folded ? tile : fold).current?.focus();
  }, [folded]);
  const toggle = (next: boolean) => {
    moveFocus.current = true;
    setFolded(next);
  };

  // A bar and its row belong together: pointing at one lights up both and fades the rest
  const [pointed, setHot] = useState<string | null>(null);
  // A clicked bar or row opens the step's info card, anchored under what was clicked
  const [info, setInfo] = useState<{ id: string; from: "row" | "bar" } | null>(null);
  const hot = pointed ?? info?.id ?? null;
  const card = useRef<HTMLElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const openInfo = (id: string, from: "row" | "bar") => setInfo((o) => (o?.id === id ? null : { id, from }));
  const closeInfo = (refocus: boolean) => {
    const id = info?.id;
    setInfo(null);
    if (refocus && id) card.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] .ui-agm__step-hit`)?.focus();
  };
  useEffect(() => {
    if (!info) return;
    pop.current?.querySelector<HTMLElement>(".ui-agm__info-close")?.focus({ preventScroll: true });
    const away = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!pop.current?.contains(t) && !t.closest?.(".ui-agm__step, .ui-agm__strip .ui-agm__seg")) setInfo(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [info?.id]);
  useLayoutEffect(() => {
    // Under the row – or under the time strip when a bar was clicked
    const box = card.current;
    const el = pop.current;
    if (!info || !box || !el) return;
    const anchor = info.from === "row" ? box.querySelector(`[data-id="${CSS.escape(info.id)}"]`) : box.querySelector(".ui-agm__strip-wrap");
    if (anchor) el.style.top = `${anchor.getBoundingClientRect().bottom - box.getBoundingClientRect().top + 6}px`;
  });
  const list = useRef<HTMLOListElement>(null);
  // Moving from one row (or bar) to the next fires leave before enter: letting go a beat later means the next enter
  // takes over directly, instead of everything flashing back to full for a frame and fading again
  const letGo = useRef(0);
  useEffect(() => () => window.clearTimeout(letGo.current), []);
  const point = (id: string, reveal = false) => ({
    onPointerEnter: () => {
      window.clearTimeout(letGo.current);
      setHot(id);
      // A bar whose row has scrolled out of the list brings the row back into view
      const box = list.current;
      const row = reveal ? box?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) : null;
      if (box && row && (row.offsetTop < box.scrollTop || row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight)) {
        box.scrollTo({ top: row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2, behavior: "smooth" });
      }
    },
    onPointerLeave: () => {
      window.clearTimeout(letGo.current);
      letGo.current = window.setTimeout(() => setHot((h) => (h === id ? null : h)), 70);
    },
  });
  // More rows than fit: the list scrolls, and fades at the edge that has more
  const [edge, setEdge] = useState({ top: false, bottom: false });
  const measure = () => {
    const box = list.current;
    if (!box) return;
    const next = { top: box.scrollTop > 2, bottom: box.scrollTop + box.clientHeight < box.scrollHeight - 2 };
    setEdge((e) => (e.top === next.top && e.bottom === next.bottom ? e : next));
  };

  // The clock – and the running step's bar – move while the agent works or waits on you; paused, both stand still
  const live = state === "running" || state === "waiting";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [live]);
  const stoodStill = useRef(now);
  if (live) stoodStill.current = now;
  const still = live ? now : stoodStill.current;
  const at = until ?? still;
  const elapsed = since ? Math.max(0, at - since - pausedFor) : 0;

  // Waiting on you: Enter allows and Escape declines while the card (not one of its buttons) has the focus
  const onKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (state !== "waiting" || e.target !== e.currentTarget) return;
    if (e.key === "Enter" && onAllow) {
      e.preventDefault();
      onAllow();
    } else if (e.key === "Escape" && onDecline) {
      e.preventDefault();
      onDecline();
    }
  };

  const running = steps.find((s) => s.state === "running");
  // Where the run is: every step that has run (a failed one too), and the one running now
  const position = Math.min(steps.length, steps.filter((s) => s.state !== "queued").length);
  const doing = current ?? (running ? { label: running.label, kind: running.kind, icon: running.icon } : undefined);
  const iconOf = (x?: { kind?: AgentStepKind; icon?: ReactNode }) => x?.icon ?? KIND_ICON[x?.kind ?? "think"];
  const tookOf = (s: AgentRunStep) => (s.state === "running" ? (s.since ? Math.max(0, still - s.since) : 0) : (s.took ?? 0));
  const changes = outcome && (outcome.added != null || outcome.removed != null);
  const said = `${agent.name}: ${LABEL[state]}${state === "running" && doing ? ` – ${doing.label}` : ""}${state === "waiting" && ask ? ` – ${ask.title}` : ""}`;

  // The time strip and the latest steps: what has run so far
  const ran = steps.filter((s) => s.state !== "queued");
  const ranTotal = ran.reduce((n, s) => n + Math.max(tookOf(s), 1), 0);
  // Newest first: a step that finishes drops out of the well into the top of the list – the fourth slides away under the clip
  // code-maxxer: the running step heads the list too (shimmering), so the list reads as the work in order
  const recent = [...ran].reverse();
  const opened = info ? ran.find((x) => x.id === info.id) : undefined;
  // When it started into the run: from its own start time if it has one, otherwise the steps before it added up
  const openedAt = !opened ? 0 : opened.since != null && since != null ? Math.max(0, opened.since - since) : ran.slice(0, ran.indexOf(opened)).reduce((n, x) => n + tookOf(x), 0);
  useEffect(() => {
    if (info && !opened) setInfo(null);
  }, [info, opened]);
  useEffect(measure, [recent.length, folded]);

  // Folded away: the tools it has used so far, each once, in the order it first picked them up – told apart by their logo or their kind
  // Each keeps the latest step it was used for – that is what its hover card tells
  const tools: { id: string; icon: ReactNode; live?: "run" | "ask"; tip: { title: string; sub?: string } }[] = [];
  const seen = new Map<unknown, number>();
  const addTool = (id: string, x: { kind?: AgentStepKind; icon?: ReactNode }, tip: (typeof tools)[number]["tip"], live?: "run" | "ask") => {
    const k = isValidElement(x.icon) ? x.icon.type : (x.icon ?? `kind-${x.kind ?? "think"}`);
    const at = seen.get(k);
    // Used again: it keeps its place (and key), so the bar never shrinks – only what it tells and whether it's lit change
    if (at != null) {
      tools[at] = { ...tools[at], live: live ?? tools[at].live, tip };
      return;
    }
    seen.set(k, tools.length);
    tools.push({ id, icon: iconOf(x), live, tip });
  };
  ran.forEach((x) =>
    addTool(
      x.id,
      x,
      { title: x.label, sub: [x.tool ?? KIND_NAME[x.kind ?? "think"], x.state === "failed" ? tr("Failed") : secs(tookOf(x))].join(" · ") },
      x.state === "running" && state === "running" ? "run" : undefined,
    ),
  );
  if (state === "waiting" && ask?.icon) addTool("ask", { icon: ask.icon }, { title: ask.title, sub: tr("Waiting on you") }, "ask");
  const shownTools = tools.slice(-4);
  const strip = (className: string, interactive: boolean) => (
    <span className={className} aria-hidden="true">
      {ran.map((s) => (
        <span
          key={s.id}
          className="ui-agm__seg"
          data-state={s.state}
          data-hot={interactive && hot === s.id ? "" : undefined}
          style={{ flexGrow: Math.max(tookOf(s), 1) / ranTotal }}
          title={interactive ? `${s.label} · ${secs(tookOf(s))}` : undefined}
          {...(interactive ? { ...point(s.id, true), onClick: () => openInfo(s.id, "bar") } : {})}
        />
      ))}
      {state === "waiting" && <span className="ui-agm__seg" data-state="waiting" />}
    </span>
  );

  // The well: one line, rolled in whenever it changes
  const well: { id: string; node: ReactNode } =
    state === "running" && doing
      ? {
          id: `r-${doing.label}`,
          node: (
            <>
              <span className="ui-agm__tile">{iconOf(doing)}</span>
              <Marquee className="ui-agm__task ui-agm__shine" delay={300} hoverTarget=".ui-agm__panel">{doing.label}</Marquee>
            </>
          ),
        }
      : state === "waiting"
        ? {
            id: `w-${ask?.title ?? ""}-${ask?.command ?? ""}`,
            node: (
              <>
                {ask?.icon && <span className="ui-agm__tile">{ask.icon}</span>}
                <span className="ui-agm__task">{ask?.title ?? "Waiting on you"}</span>
                {ask?.command && (
                  <code className="ui-agm__code" title={ask.command}>
                    {ask.command}
                  </code>
                )}
              </>
            ),
          }
        : state === "paused"
          ? { id: "p", node: <span className="ui-agm__task ui-agm__task--quiet">Paused{doing ? ` · ${doing.label}` : ""}</span> }
          : state === "finished"
            ? {
                id: "f",
                node: (
                  <>
                    <span className="ui-agm__task">{tr("Finished in {t}", { t: words(elapsed) })}</span>
                    {changes && (
                      <span className="ui-agm__diff">
                        <span className="ui-agm__add">+{num.format(outcome!.added ?? 0)}</span>
                        <span className="ui-agm__del">−{num.format(outcome!.removed ?? 0)}</span>
                      </span>
                    )}
                    {outcome?.files != null && <span className="ui-agm__note">{outcome.files === 1 ? "1 file" : `${outcome.files} files`}</span>}
                    {outcome?.note && <span className="ui-agm__note">{outcome.note}</span>}
                  </>
                ),
              }
            : state === "failed"
              ? {
                  id: `x-${error ?? ""}`,
                  node: (
                    <>
                      <span className="ui-agm__flag" aria-hidden="true" />
                      <span className="ui-agm__task">{error ?? "Something went wrong"}</span>
                    </>
                  ),
                }
              : state === "cancelled"
                ? { id: "c", node: <span className="ui-agm__task ui-agm__task--quiet">Cancelled after {words(elapsed)}</span> }
                : { id: "i", node: <span className="ui-agm__task ui-agm__task--quiet">{tr("No task yet")}</span> };
  const mark = agent.mark ?? agent.name.trim().slice(0, 1).toUpperCase();
  const showClock = since != null && (state === "running" || state === "paused" || state === "waiting" || state === "failed");

  return (
    <div className={["ui-agm", className].filter(Boolean).join(" ")} data-status={state} data-folded={folded ? "" : undefined} data-pointing={hot ? "" : undefined}
      onKeyDown={(e) => {
        if (e.key === "Escape" && info) {
          e.stopPropagation();
          closeInfo(true);
        }
      }}
    >
      <style href="ui-agent-monitor" precedence="default">
        {css}
      </style>

      {folded ? (
        // Folded away: a small gray bar – the agent in a white chip, the tools used so far, the clock or the state
        <button ref={tile} type="button" className="ui-agm__icon" title={said} aria-label={`${said} – open`} aria-expanded={false} aria-controls={uid} onClick={() => toggle(false)}>
          {/* The agent in a small white chip on the tray */}
          <span className="ui-agm__icon-who">
            <span className="ui-agm__face" aria-hidden="true">
              {mark}
            </span>
            <Marquee className="ui-agm__icon-name" delay={300} hoverTarget=".ui-agm__icon">{agent.name}</Marquee>
          </span>
          {shownTools.length > 0 && (
            <span className="ui-agm__tools" aria-hidden="true">
              {tools.length > shownTools.length && <span className="ui-agm__tools-more">+{tools.length - shownTools.length}</span>}
              {shownTools.map((t) => (
                <span key={t.id} className="ui-agm__tool" data-live={t.live}>
                  {t.icon}
                  {/* On hover the tile lifts and this card shows above it */}
                  <span className="ui-agm__tip">
                    <span className="ui-agm__tip-title">{t.tip.title}</span>
                    {t.tip.sub && <span className="ui-agm__tip-sub">{t.tip.sub}</span>}
                  </span>
                </span>
              ))}
            </span>
          )}
          {/* The clock while it runs – or a small tag for what needs a look: it swaps in with a soft fade, and the bar eases to its new width */}
          <Morph id={state === "running" || state === "paused" ? "clock" : state} className="ui-agm__icon-end">
            {state === "finished" ? (
              <span className="ui-agm__done-tag" data-tone="done">
                <CheckIcon />
                {words(elapsed)}
              </span>
            ) : state === "waiting" ? (
              <span className="ui-agm__done-tag" data-tone="ask">
                <WarnIcon />
                {LABEL[state]}
              </span>
            ) : state === "failed" ? (
              <span className="ui-agm__done-tag" data-tone="fail">
                <CancelIcon />
                {LABEL[state]}
              </span>
            ) : (
              <span className={["ui-agm__icon-meta", state === "running" ? "ui-agm__shine" : ""].filter(Boolean).join(" ")} data-status={state}>
                {state === "running" || state === "paused" ? clock(elapsed) : LABEL[state]}
              </span>
            )}
          </Morph>
        </button>
      ) : (
        <section ref={card} id={uid} className="ui-agm__panel" aria-label={said} tabIndex={state === "waiting" ? 0 : undefined} onKeyDown={onKeys}>
          {/* The white card: the agent, what it's doing, where the time went */}
          <div className="ui-agm__card">
          <div className="ui-agm__top">
            <span className="ui-agm__face" aria-hidden="true">
              {mark}
            </span>
            <span className="ui-agm__who">
              <Marquee className="ui-agm__name" delay={300} hoverTarget=".ui-agm__panel">{agent.name}</Marquee>
              {agent.role && <Marquee className="ui-agm__role" delay={300} hoverTarget=".ui-agm__panel">{agent.role}</Marquee>}
            </span>
            {cost != null && state !== "idle" && (
              <span className="ui-agm__cost" data-live={live ? "" : undefined} aria-label={`Cost so far ${usd(cost)}`}>
                {usd(cost)}
              </span>
            )}
            <span className="ui-agm__state" data-status={state}>
              <span className="ui-agm__dot" />
              <Roll id={state}>{LABEL[state]}</Roll>
            </span>
            <button ref={fold} type="button" className="ui-agm__fold" aria-label={tr("Fold away")} title={tr("Fold away")} aria-expanded={true} aria-controls={uid} onClick={() => toggle(true)}>
              <Fold />
            </button>
          </div>
          {brief && (
            <Marquee className="ui-agm__brief" delay={300} hoverTarget=".ui-agm__panel">
              {brief}
            </Marquee>
          )}

          {/* The current step – or what it wants from you, what came of it, what went wrong */}
          <div className="ui-agm__well" data-status={state}>
            <Roll id={well.id} className="ui-agm__well-line">
              {well.node}
            </Roll>
            {showClock && (
              <span className="ui-agm__clock" aria-label={`Running for ${words(elapsed)}`}>
                {clock(elapsed)}
              </span>
            )}
          </div>

          {/* The time strip: a step as wide as it took – the running one grows */}
          {ran.length > 0 && (
            <div className="ui-agm__strip-wrap" role="img" aria-label={ran.map((x) => `${x.label}, ${secs(tookOf(x))}`).join("; ")}>
              {strip("ui-agm__strip", true)}
            </div>
          )}

          {recent.length > 0 && (
            <ol
              ref={list}
              className="ui-agm__steps"
              style={{ ["--ui-agm-shown" as string]: Math.min(recent.length, 3) }}
              data-fade-top={edge.top ? "" : undefined}
              data-fade-bottom={edge.bottom ? "" : undefined}
              tabIndex={recent.length > 3 ? 0 : undefined}
              aria-label={recent.length > 3 ? "Finished steps" : undefined}
              onScroll={measure}
            >
              {recent.map((x) => (
                <li key={x.id} className="ui-agm__step" data-id={x.id} data-state={x.state} data-hot={hot === x.id ? "" : undefined} {...point(x.id)}>
                  <button type="button" className="ui-agm__step-hit" aria-label={`${x.label} – details`} aria-expanded={info?.id === x.id} onClick={() => openInfo(x.id, "row")} />
                  <span className="ui-agm__step-icon">{iconOf(x)}</span>
                  <Marquee className="ui-agm__step-label" delay={300} hoverTarget=".ui-agm__step">
                    {x.label}
                  </Marquee>
                  <span className="ui-agm__step-time">{x.state === "failed" ? tr("Failed") : x.state === "running" ? "" : x.took == null && x.since == null ? "" : secs(tookOf(x))}</span>
                </li>
              ))}
            </ol>
          )}

          </div>

          {/* The info card of a clicked step: what it did, with which tool, when and for how long */}
          {opened && (
            <div ref={pop} key={opened.id} className="ui-agm__info" role="dialog" aria-label={opened.label} data-state={opened.state}>
              <div className="ui-agm__info-head">
                <span className="ui-agm__tile">{iconOf(opened)}</span>
                <span className="ui-agm__info-title">
                  <span className="ui-agm__info-label">{opened.label}</span>
                  <span className="ui-agm__info-sub">{opened.tool ?? KIND_NAME[opened.kind ?? "think"]}</span>
                </span>
                <button type="button" className="ui-agm__info-close" aria-label="Close" onClick={() => closeInfo(true)}>
                  <CancelIcon />
                </button>
              </div>
              <dl className="ui-agm__info-facts">
                <div>
                  <dt>{tr("Started")}</dt>
                  <dd>+{clock(openedAt)}</dd>
                </div>
                <div>
                  <dt>{tr("Took")}</dt>
                  <dd>{secs(tookOf(opened))}</dd>
                </div>
                <div>
                  <dt>{tr("Share")}</dt>
                  <dd>{Math.max(1, Math.round((Math.max(tookOf(opened), 1) / ranTotal) * 100))}%</dd>
                </div>
                <div>
                  <dt>{tr("State")}</dt>
                  <dd data-state={opened.state}>{opened.state === "running" ? "Running" : opened.state === "failed" ? "Failed" : "Done"}</dd>
                </div>
              </dl>
              {opened.detail && <p className="ui-agm__info-detail">{opened.detail}</p>}
              {opened.output && (
                <code className="ui-agm__info-output" title={opened.output}>
                  {opened.output}
                </code>
              )}
            </div>
          )}

          {/* On the tray: the controls for where the run is – answer it, steer it, open its log */}
          <div className="ui-agm__foot">
            {/* The controls swap with a soft fade as the state changes – Pause and Resume share one slot, so the focus stays */}
            <Morph id={state === "waiting" ? "answer" : state === "failed" && onRetry ? "retry" : state === "running" || state === "paused" ? "steer" : "none"} className="ui-agm__controls">
            {state === "waiting" ? (
              <>
                {onDecline && (
                  <button type="button" className="ui-agm__btn" onClick={onDecline}>
                    {tr("Decline")} <kbd>Esc</kbd>
                  </button>
                )}
                {onAllow && (
                  <button type="button" className="ui-agm__btn ui-agm__btn--go" onClick={onAllow}>
                    {tr("Allow")} <kbd>⏎</kbd>
                  </button>
                )}
              </>
            ) : state === "failed" && onRetry ? (
              <button type="button" className="ui-agm__btn ui-agm__btn--go" onClick={onRetry}>
                <RetryIcon /> {tr("Try again")}
              </button>
            ) : (
              (state === "running" || state === "paused") &&
              (onPause || onResume || onCancel) && (
                // Steering: Pause or Resume and Cancel, side by side
                <span className="ui-agm__group">
                  {(state === "running" ? onPause : onResume) && (
                    // One button for both, so it keeps the focus; its label rolls between Pause and Resume
                    <button type="button" className="ui-agm__seg-btn" onClick={state === "running" ? onPause : onResume}>
                      <Morph id={state} className="ui-agm__seg-label">
                        {state === "running" ? <PauseIcon /> : <PlayIcon />}
                        {state === "running" ? tr("Pause") : tr("Resume")}
                      </Morph>
                    </button>
                  )}
                  {onCancel && (
                    <button type="button" className="ui-agm__seg-btn" onClick={onCancel}>
                      <CancelIcon /> {tr("Cancel")}
                    </button>
                  )}
                </span>
              )
            )}
            </Morph>
            <span className="ui-agm__where">{trayBadge}{steps.length > 0 && state !== "idle" ? `${position}/${steps.length}` : ""}</span>
            {onOpenLog && (
              <button type="button" className="ui-agm__btn ui-agm__btn--quiet" onClick={onOpenLog}>
                {tr("Open chat")} <LogIcon />
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-agm */
.ui-agm {
  --ui-agm-tray: var(--aui-subtle, #f0f0f0);
  --ui-agm-card: #ffffff;
  --ui-agm-strong: var(--aui-ink, #171717);
  --ui-agm-ink: var(--aui-ink, #171717);
  --ui-agm-text: var(--aui-muted, #6b6b6b);
  --ui-agm-muted: var(--aui-muted, #8a8a8a);
  --ui-agm-faint: var(--aui-placeholder, #b8b8b8);
  --ui-agm-line: var(--aui-border, #ececec);
  --ui-agm-edge: var(--aui-border, #ececec);
  --ui-agm-lane: var(--aui-subtle, #f5f5f5);
  --ui-agm-fill: var(--aui-subtle, #e4e4e5);
  --ui-agm-accent: var(--aui-blue, #4fb0fe);
  --ui-agm-accent-bg: color-mix(in srgb, var(--aui-blue, #0190fe) 8%, transparent);
  --ui-agm-green: var(--aui-success, #1e8a4f);
  --ui-agm-green-bg: color-mix(in srgb, var(--aui-green, #5fc88a) 10%, transparent);
  --ui-agm-red: var(--aui-red, #f04438);
  --ui-agm-red-bg: color-mix(in srgb, var(--aui-red, #f04438) 8%, transparent);
  --ui-agm-amber: var(--aui-warning, #b25e00);
  --ui-agm-amber-bg: color-mix(in srgb, var(--aui-amber, #e8b000) 14%, transparent);
  --ui-agm-shine: rgba(23, 23, 23, 0.25);
  --ui-agm-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  /* The time strip: quiet gray steps, the running one in the accent (as r, g, b) */
  --ui-agm-seg: #e6e6e7;
  --ui-agm-live: 47, 107, 255;
  --ui-agm-hot: #a3a3a8;
  --ui-agm-shadow: 0 0 0 1px var(--ui-agm-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-agm-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  position: relative;
  display: inline-block;
  max-width: 100%;
  font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-agm-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-agm *, .ui-agm *::before, .ui-agm *::after { box-sizing: border-box; }
:where(.ui-agm) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-agm :is(button, .ui-agm__panel, .ui-agm__steps):focus-visible { outline: 2px solid var(--ui-agm-focus); outline-offset: 2px; }
.ui-agm :is(ol, ul) { margin: 0; padding: 0; list-style: none; }
.ui-agm svg { display: block; flex: none; }

/* ----- The tray, and the white card on it ----- */
.ui-agm__panel {
  position: relative;
  display: grid;
  width: 372px;
  max-width: 100%;
  padding: 4px;
  border-radius: calc(var(--aui-radius-lg, 16px) + 4px);
  background: var(--ui-agm-tray);
  transform-origin: 24px 24px;
  animation: ui-agm-open 340ms var(--ui-agm-ease) both;
}
.ui-agm__card { display: grid; gap: 12px; min-width: 0; padding: 14px 14px 12px; border-radius: var(--aui-radius-lg, 16px); background: var(--aui-surface, var(--ui-agm-card)); box-shadow: var(--aui-shadow-card, var(--ui-agm-shadow)); }
.ui-agm__top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-agm__face { display: grid; flex: none; place-items: center; width: 30px; height: 30px; margin-right: 2px; border-radius: 9px; background: var(--ui-agm-card); box-shadow: inset 0 0 0 1px var(--ui-agm-line); font-size: 12px; font-weight: 600; color: var(--ui-agm-ink); }
.ui-agm__face > svg { width: 16px; height: 16px; }
.ui-agm__face > img { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.ui-agm__who { display: grid; flex: 1; min-width: 3em; }
.ui-agm__brief { margin: 2px 2px 8px; font-size: 12.5px; line-height: 17px; color: var(--ui-agm-text); }
.ui-agm__name { overflow: hidden; font-weight: 600; line-height: 18px; color: var(--ui-agm-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-agm__role { overflow: hidden; font-size: 12.5px; line-height: 17px; color: var(--ui-agm-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-agm__cost { flex: none; font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--ui-agm-text); animation: ui-agm-morph-in 380ms var(--ui-agm-ease) both; }
.ui-agm__cost[data-live] { background: linear-gradient(90deg, var(--ui-agm-ink) 0%, var(--ui-agm-ink) 38%, var(--ui-agm-shine) 50%, var(--ui-agm-ink) 62%, var(--ui-agm-ink) 100%) 0 0 / 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: ui-agm-shine 1500ms linear infinite; }
/* The state, as a pill: blue while it runs, amber when it needs you, green finished, red failed */
.ui-agm__state { display: inline-flex; flex: none; align-items: center; gap: 6px; height: 26px; padding: 0 10px 0 9px; overflow: hidden; border-radius: 999px; background: var(--ui-agm-lane); font-size: 12.5px; font-weight: 500; color: var(--ui-agm-text); white-space: nowrap; transition: background-color 300ms ease, color 300ms ease; }
.ui-agm__dot { position: relative; flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.6; }
.ui-agm__dot::after { content: ""; position: absolute; inset: -3px; border-radius: 50%; background: currentColor; opacity: 0; }
.ui-agm__state:is([data-status="running"], [data-status="waiting"]) .ui-agm__dot { opacity: 1; }
.ui-agm__state:is([data-status="running"], [data-status="waiting"]) .ui-agm__dot::after { animation: ui-agm-pulse 1600ms ease-out infinite; }
.ui-agm__state .ui-agm__roll { flex: none; height: 26px; }
.ui-agm__state[data-status="running"] { background: var(--ui-agm-accent-bg); color: var(--ui-agm-accent); }
.ui-agm__state[data-status="waiting"] { background: var(--ui-agm-amber-bg); color: var(--ui-agm-amber); }
.ui-agm__state[data-status="finished"] { background: var(--ui-agm-green-bg); color: var(--ui-agm-green); }
.ui-agm__state[data-status="failed"] { background: var(--ui-agm-red-bg); color: var(--ui-agm-red); }
.ui-agm__fold { display: grid; flex: none; place-items: center; width: 28px; height: 28px; margin-right: -4px; border-radius: calc(var(--aui-radius-sm, 7px) + 2px); color: var(--ui-agm-muted); box-shadow: inset 0 0 0 1px var(--ui-agm-line); transition: background-color 160ms ease, color 160ms ease; }
.ui-agm__fold:hover { background: var(--ui-agm-lane); color: var(--ui-agm-ink); }

/* The well: what it's doing now – one line, rolled in whenever it changes */
.ui-agm__well { display: flex; align-items: center; gap: 10px; min-width: 0; height: 44px; padding: 0 12px 0 8px; border-radius: 12px; background: var(--ui-agm-lane); font-size: 13px; transition: background-color 300ms ease; }
.ui-agm__well[data-status="waiting"] { background: var(--ui-agm-amber-bg); }
.ui-agm__well:not([data-status="running"]):not(:has(.ui-agm__tile)) { padding-left: 12px; }
.ui-agm__roll { display: inline-grid; flex: 1; grid-template-columns: minmax(0, 1fr); align-items: center; min-width: 0; height: 44px; overflow: hidden; }
.ui-agm__roll-layer { grid-area: 1 / 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-agm__roll-layer[data-leaving] { animation: ui-agm-out 380ms var(--ui-agm-ease) both; pointer-events: none; }
.ui-agm__roll-layer[data-coming] { animation: ui-agm-in 380ms var(--ui-agm-ease) both; }
.ui-agm__tile { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: var(--ui-agm-card); box-shadow: var(--ui-agm-shadow); color: var(--ui-agm-text); }
.ui-agm__tile > svg { width: 15px; height: 15px; }
.ui-agm__task { min-width: 0; overflow: hidden; font-weight: 500; color: var(--ui-agm-ink); white-space: nowrap; text-overflow: ellipsis; }
/* Waiting on you: the title stays whole, the command gives way */
.ui-agm__well[data-status="waiting"] .ui-agm__task { flex: none; }
.ui-agm__task--quiet { font-weight: 400; color: var(--ui-agm-muted); }
.ui-agm__flag { flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-agm-red); }
.ui-agm__shine { background: linear-gradient(90deg, var(--ui-agm-ink) 0%, var(--ui-agm-ink) 38%, var(--ui-agm-shine) 50%, var(--ui-agm-ink) 62%, var(--ui-agm-ink) 100%) 0 0 / 300% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; animation: ui-agm-shine 1500ms linear infinite; }
.ui-agm__code { flex: 0 1 auto; min-width: 0; overflow: hidden; padding: 0 7px; border-radius: var(--aui-radius-sm, 7px); background: var(--ui-agm-card); box-shadow: var(--ui-agm-shadow); font-family: var(--aui-font-mono, ui-monospace, "SF Mono", Menlo, monospace); font-size: 11.5px; line-height: 22px; letter-spacing: 0; color: var(--ui-agm-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-agm__diff { display: inline-flex; flex: none; gap: 6px; font-weight: 500; font-variant-numeric: tabular-nums; }
.ui-agm__add { color: var(--ui-agm-green); }
.ui-agm__del { color: var(--ui-agm-red); }
.ui-agm__note { flex: none; color: var(--ui-agm-muted); }
.ui-agm__clock { flex: none; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ui-agm-muted); animation: ui-agm-morph-in 380ms var(--ui-agm-ease) both; }

/* The time strip: a step as wide as it took; the running one grows in the accent with a soft sheen */
.ui-agm__strip-wrap { margin: 2px 0; }
.ui-agm__strip { display: flex; gap: 3px; height: 8px; }
.ui-agm__seg {
  position: relative;
  min-width: 4px;
  border-radius: 4px;
  background: var(--ui-agm-seg);
  transition: flex-grow 300ms linear, background-color 400ms ease, opacity 200ms ease;
  animation: ui-agm-grow 420ms var(--ui-agm-ease) backwards;
}
/* A taller, invisible target, so a thin bar is easy to point at */
.ui-agm__strip .ui-agm__seg::after { content: ""; position: absolute; inset: -6px -1px; }
.ui-agm__seg[data-state="running"] { background: rgba(var(--ui-agm-live), 0.3); }
.ui-agm__seg[data-state="running"]::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.75) 50%, transparent 100%) 0 0 / 50% 100% no-repeat; animation: ui-agm-sheen 1600ms ease-in-out infinite; }
.ui-agm__seg[data-state="failed"] { background: repeating-linear-gradient(-45deg, var(--ui-agm-red-bg) 0 2px, transparent 2px 4px), var(--ui-agm-seg); }
/* Waiting on you: a short amber step at the end that breathes */
.ui-agm__seg[data-state="waiting"] { flex: 0 0 14px; background: var(--ui-agm-amber); opacity: 0.6; animation: ui-agm-grow 420ms var(--ui-agm-ease) backwards, ui-agm-breathe 1600ms ease-in-out infinite; }
.ui-agm:not([data-status="running"]) .ui-agm__seg[data-state="running"]::before { animation: none; opacity: 0; }
.ui-agm[data-status="finished"] .ui-agm__seg:not([data-state="failed"]) { background: var(--ui-agm-green-bg); }
/* Paused: the running bar stands still and steps back */
.ui-agm[data-status="paused"] .ui-agm__seg[data-state="running"] { opacity: 0.45; }

/* Pointing at a bar or a row: the pair stays, the rest fade back */
.ui-agm[data-pointing] .ui-agm__strip .ui-agm__seg:not([data-hot]),
.ui-agm[data-pointing] .ui-agm__step:not([data-hot]) { opacity: 0.35; }
.ui-agm__strip .ui-agm__seg[data-hot]:not([data-state="running"]) { background: var(--ui-agm-hot); }

/* The finished steps, newest first, three rows tall and scrollable: each with its tool's logo – a finished one drops in from the top */
.ui-agm__steps::-webkit-scrollbar { display: none; }
.ui-agm__steps[data-fade-top] { --ui-agm-fade-top: transparent; }
.ui-agm__steps[data-fade-bottom] { --ui-agm-fade-bottom: transparent; }
.ui-agm__steps { position: relative; display: grid; align-content: start; height: calc(var(--ui-agm-shown, 0) * 30px); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; margin: -2px -6px 0; --ui-agm-fade-top: #000; --ui-agm-fade-bottom: #000; -webkit-mask-image: linear-gradient(to bottom, var(--ui-agm-fade-top), #000 14px, #000 calc(100% - 14px), var(--ui-agm-fade-bottom)); mask-image: linear-gradient(to bottom, var(--ui-agm-fade-top), #000 14px, #000 calc(100% - 14px), var(--ui-agm-fade-bottom)); transition: height 420ms var(--ui-agm-ease); }
.ui-agm__step { position: relative; display: flex; align-items: center; gap: 10px; height: 30px; padding: 0 8px; border-radius: calc(var(--aui-radius-sm, 7px) + 2px); font-size: 13px; cursor: pointer; transition: opacity 200ms ease, background-color 200ms ease; animation: ui-agm-drop 460ms var(--ui-agm-ease) backwards; }
.ui-agm__step[data-hot] { background: var(--ui-agm-lane); }
.ui-agm__strip .ui-agm__seg { cursor: pointer; }
/* The whole row is the button; its content sits on top, untouched by it */
.ui-agm__step-hit { position: absolute; inset: 0; border-radius: inherit; }
.ui-agm .ui-agm__step-hit:focus-visible { outline-offset: -2px; }
.ui-agm__step > :not(.ui-agm__step-hit) { position: relative; pointer-events: none; }
.ui-agm__step-icon { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--ui-agm-card); box-shadow: var(--ui-agm-shadow); color: var(--ui-agm-muted); }
.ui-agm__step-icon > svg { width: 12px; height: 12px; }
.ui-agm__step-label { flex: 1; min-width: 0; overflow: hidden; color: var(--ui-agm-text); white-space: nowrap; text-overflow: ellipsis; }
.ui-agm__step-time { flex: none; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ui-agm-faint); }
.ui-agm__step[data-state="failed"] .ui-agm__step-time { color: var(--ui-agm-red); }
/* code-maxxer: the step at work shimmers */
.ui-agm__step[data-state="running"] .ui-agm__step-label { color: var(--ui-agm-strong); background: linear-gradient(90deg, currentColor 0%, currentColor 38%, var(--ui-agm-hot) 50%, currentColor 62%, currentColor 100%) 0 0 / 300% 100%; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: ui-agm-shine 1400ms linear infinite; }
@keyframes ui-agm-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .ui-agm__step[data-state="running"] .ui-agm__step-label { animation: none; } }

/* The info card: a step's details, floating under the row or the time strip that was clicked */
.ui-agm__info { position: absolute; z-index: 2; right: 12px; left: 12px; display: grid; gap: 10px; padding: 12px; border-radius: calc(var(--aui-radius-lg, 16px) - 2px); background: var(--aui-overlay, var(--ui-agm-card)); box-shadow: var(--aui-shadow-popover, 0 0 0 1px var(--ui-agm-line), 0 12px 24px -8px rgba(0, 0, 0, 0.16), 0 4px 8px -4px rgba(0, 0, 0, 0.06)); transform-origin: 50% 0; animation: ui-agm-pop 260ms var(--ui-agm-ease) both; }
.ui-agm__info-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ui-agm__info-title { display: grid; flex: 1; min-width: 0; }
.ui-agm__info-label { overflow: hidden; font-weight: 600; line-height: 18px; color: var(--ui-agm-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-agm__info-sub { font-size: 12px; line-height: 16px; color: var(--ui-agm-muted); }
.ui-agm__info-close { display: grid; flex: none; place-items: center; width: 26px; height: 26px; margin: -2px -2px 0 0; border-radius: calc(var(--aui-radius-sm, 7px) + 1px); color: var(--ui-agm-faint); transition: background-color 160ms ease, color 160ms ease; }
.ui-agm__info-close:hover { background: var(--ui-agm-lane); color: var(--ui-agm-ink); }
.ui-agm__info-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin: 0; }
.ui-agm__info-facts > div { display: grid; gap: 1px; padding: 6px 8px; border-radius: 9px; background: var(--ui-agm-lane); }
.ui-agm__info-facts dt { font-size: 11px; line-height: 14px; color: var(--ui-agm-muted); }
.ui-agm__info-facts dd { margin: 0; font-size: 12.5px; font-weight: 500; line-height: 17px; font-variant-numeric: tabular-nums; color: var(--ui-agm-ink); }
.ui-agm__info-facts dd[data-state="failed"] { color: var(--ui-agm-red); }
.ui-agm__info-facts dd[data-state="running"] { color: var(--ui-agm-accent); }
.ui-agm__info-detail { margin: 0; font-size: 13px; line-height: 19px; color: var(--ui-agm-text); }
.ui-agm__info-output { display: block; overflow: hidden; padding: 6px 9px; border-radius: 8px; background: var(--ui-agm-lane); font-family: var(--aui-font-mono, ui-monospace, "SF Mono", Menlo, monospace); font-size: 11.5px; line-height: 16px; letter-spacing: 0; color: var(--ui-agm-ink); white-space: nowrap; text-overflow: ellipsis; }

/* ----- On the tray: the controls ----- */
.ui-agm__foot { display: flex; align-items: center; gap: 6px; min-height: 46px; padding: 8px 6px 4px 4px; }
.ui-agm__where { display: inline-flex; flex: 1; align-items: center; justify-content: flex-end; gap: 12px; min-width: 0; padding-right: 12px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--ui-agm-muted); text-align: right; }
/* Swapping content: the old fades and shrinks away, the new fades and grows in, the width eases between them */
.ui-agm__morph { display: inline-grid; flex: none; align-items: center; transition: width 380ms var(--ui-agm-ease); }
.ui-agm__morph-layer { grid-area: 1 / 1; justify-self: start; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.ui-agm__morph-layer[data-leaving] { animation: ui-agm-morph-out 240ms ease both; pointer-events: none; }
.ui-agm__morph-layer[data-coming] { animation: ui-agm-morph-in 380ms var(--ui-agm-ease) both; }
.ui-agm__icon-end { overflow: hidden; }
.ui-agm__icon-end .ui-agm__morph-layer, .ui-agm__controls .ui-agm__morph-layer { transform-origin: 0 50%; }
.ui-agm__icon-meta.ui-agm__shine { color: transparent; }
.ui-agm__seg-label .ui-agm__morph-layer { gap: 5px; }
.ui-agm__seg-label .ui-agm__morph-layer > svg { color: var(--ui-agm-muted); }
/* Pause / Resume and Cancel: two white buttons side by side on the tray */
.ui-agm__group { display: inline-flex; gap: 6px; }
.ui-agm__seg-btn, .ui-agm__btn { display: inline-flex; align-items: center; gap: 5px; height: 32px; padding: 0 12px 0 10px; border-radius: var(--aui-radius, 10px); background: var(--aui-surface, var(--ui-agm-card)); box-shadow: var(--ui-agm-shadow); font-size: 13px; font-weight: 500; color: var(--ui-agm-ink); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease, transform 160ms ease, opacity 160ms ease; }
.ui-agm__seg-btn > svg { color: var(--ui-agm-muted); }
.ui-agm__seg-btn:hover, .ui-agm__btn:hover { background: var(--ui-agm-lane); }
.ui-agm__seg-btn:active, .ui-agm__btn:active { transform: scale(0.96); }
.ui-agm__btn { padding: 0 12px; }
.ui-agm__btn--go { padding: 0 10px 0 12px; background: var(--aui-primary, var(--ui-agm-ink)); box-shadow: none; color: var(--aui-on-primary, var(--ui-agm-card)); }
.ui-agm__btn--go:hover { background: var(--aui-primary, var(--ui-agm-ink)); opacity: 0.86; }
.ui-agm__btn--go > svg { color: inherit; }
.ui-agm__btn--quiet { height: 30px; padding: 0 8px; background: none; box-shadow: none; color: var(--ui-agm-text); }
.ui-agm__btn--quiet:hover { background: var(--ui-agm-fill); color: var(--ui-agm-ink); }
.ui-agm__btn kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: calc(var(--aui-radius-sm, 7px) - 2px); background: var(--ui-agm-card); box-shadow: 0 0 0 1px var(--ui-agm-line); font: inherit; font-size: 10.5px; font-weight: 400; color: var(--ui-agm-muted); }
.ui-agm__btn--go kbd { background: rgba(255, 255, 255, 0.16); box-shadow: none; color: rgba(255, 255, 255, 0.8); }

/* ----- Folded away: a small gray bar – the agent in a white chip, the tools used so far, the clock or state ----- */
.ui-agm__icon { position: relative; display: inline-flex; align-items: center; gap: 12px; height: 48px; padding: 4px 14px 4px 4px; border-radius: var(--aui-radius-lg, 16px); background: var(--ui-agm-tray); text-align: left; transform-origin: 24px 50%; animation: ui-agm-open 300ms var(--ui-agm-ease) both; }
.ui-agm__icon-who { display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0 12px 0 5px; border-radius: 12px; background: var(--ui-agm-card); box-shadow: var(--ui-agm-shadow); }
.ui-agm__icon-who .ui-agm__face { width: 30px; height: 30px; box-shadow: none; background: var(--ui-agm-lane); }
.ui-agm__icon-name { max-width: 140px; overflow: hidden; font-size: 13px; font-weight: 600; color: var(--ui-agm-strong); white-space: nowrap; text-overflow: ellipsis; }
/* The tools, slightly stacked – each tile opaque with a ring in the tray's color, so the overlap stays clean */
.ui-agm__tools { display: flex; align-items: center; }
.ui-agm__tool { position: relative; display: grid; flex: none; place-items: center; width: 26px; height: 26px; border-radius: 8px; background: var(--ui-agm-card); box-shadow: inset 0 0 0 1px var(--ui-agm-line), 0 0 0 2px var(--ui-agm-tray); color: var(--ui-agm-muted); animation: ui-agm-join 480ms var(--ui-agm-ease) backwards; transition: transform 220ms var(--ui-agm-ease), box-shadow 220ms ease; }
.ui-agm__tool + .ui-agm__tool { margin-left: -6px; }
.ui-agm__tool > svg { width: 13px; height: 13px; opacity: 0.4; filter: grayscale(1); pointer-events: none; transition: opacity 300ms ease, filter 300ms ease; }
/* Used before: faded back; the one in use – or the one it asks to use – in full color */
.ui-agm__tool[data-live] { z-index: 1; }
.ui-agm__tool[data-live] > svg, .ui-agm[data-status="finished"] .ui-agm__tool > svg { opacity: 1; filter: none; }
.ui-agm__tool[data-live="ask"] { background: linear-gradient(var(--ui-agm-amber-bg), var(--ui-agm-amber-bg)), var(--ui-agm-card); }
/* Pointing at a tool: its tile lifts above the stack, and its card fades in above it – the bar stays put */
.ui-agm__tool:hover { z-index: 3; transform: translateY(-4px); box-shadow: inset 0 0 0 1px var(--ui-agm-line), 0 0 0 2px var(--ui-agm-tray), 0 6px 12px -2px rgba(0, 0, 0, 0.14); }
.ui-agm__tool:hover > svg { opacity: 1; filter: none; }
.ui-agm__tip { position: absolute; bottom: calc(100% + 10px); left: 50%; display: grid; gap: 1px; width: max-content; max-width: 220px; padding: 8px 11px; border-radius: calc(var(--aui-radius-lg, 16px) - 5px); background: var(--aui-overlay, var(--ui-agm-card)); box-shadow: var(--aui-shadow-popover, 0 0 0 1px var(--ui-agm-line), 0 12px 24px -8px rgba(0, 0, 0, 0.16), 0 4px 8px -4px rgba(0, 0, 0, 0.06)); font-weight: 400; text-align: left; white-space: normal; opacity: 0; transform: translate(-50%, 4px) scale(0.97); transform-origin: 50% 100%; pointer-events: none; transition: opacity 160ms ease, transform 220ms var(--ui-agm-ease); }
.ui-agm__tool:hover .ui-agm__tip { opacity: 1; transform: translate(-50%, 0); }
.ui-agm__tip-title { overflow: hidden; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--ui-agm-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-agm__tip-sub { font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; color: var(--ui-agm-muted); }
.ui-agm__tools-more { flex: none; margin-right: 4px; font-size: 11px; font-weight: 500; color: var(--ui-agm-muted); }
.ui-agm__icon-meta { flex: none; min-width: 36px; font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--ui-agm-ink); white-space: nowrap; }
.ui-agm__icon-meta:is([data-status="idle"], [data-status="paused"], [data-status="cancelled"]) { color: var(--ui-agm-muted); }
.ui-agm__done-tag { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 26px; padding: 0 10px 0 8px; border-radius: 999px; background: var(--ui-agm-green-bg); font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums; color: var(--ui-agm-green); white-space: nowrap; }
.ui-agm__done-tag > svg { stroke-width: 1.8; }
.ui-agm__done-tag[data-tone="ask"] { background: var(--ui-agm-amber-bg); color: var(--ui-agm-amber); }
.ui-agm__done-tag[data-tone="ask"] > svg { stroke-width: 1.5; }
.ui-agm__done-tag[data-tone="fail"] { background: var(--ui-agm-red-bg); color: var(--ui-agm-red); }

@keyframes ui-agm-breathe { 50% { opacity: 0.35; } }
@keyframes ui-agm-pulse { from { opacity: 0.45; transform: scale(0.6); } to { opacity: 0; transform: scale(1.8); } }
@keyframes ui-agm-pop { from { opacity: 0; transform: translateY(-4px) scale(0.97); } }
@keyframes ui-agm-morph-in { from { opacity: 0; transform: scale(0.88); filter: blur(3px); } }
@keyframes ui-agm-morph-out { to { opacity: 0; transform: scale(0.88); filter: blur(3px); } }
/* A new tool opens its own room – the bar grows with it – while the tile scales in */
@keyframes ui-agm-join { from { width: 0; margin-left: 0; opacity: 0; transform: scale(0.5); } 40% { opacity: 0; } }
@keyframes ui-agm-drop { from { margin-top: -30px; opacity: 0; filter: blur(2px); } }
@keyframes ui-agm-open { from { opacity: 0; transform: scale(0.92); } }
@keyframes ui-agm-in { from { opacity: 0; transform: translateY(70%); filter: blur(2px); } }
@keyframes ui-agm-out { to { opacity: 0; transform: translateY(-70%); filter: blur(2px); } }
@keyframes ui-agm-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
@keyframes ui-agm-grow { from { clip-path: inset(0 100% 0 0 round 4px); } to { clip-path: inset(0 0 0 0 round 4px); } }
@keyframes ui-agm-sheen { from { background-position: -100% 0; } to { background-position: 200% 0; } }
@media (pointer: coarse) {
  .ui-agm__fold, .ui-agm__info-close { width: 36px; height: 36px; }
  .ui-agm__seg-btn, .ui-agm__btn { height: 36px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-agm *, .ui-agm *::before, .ui-agm *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-agm {
  --ui-agm-tray: var(--aui-subtle, #111113);
  --ui-agm-card: #19191b;
  --ui-agm-strong: var(--aui-ink, #ededed);
  --ui-agm-ink: var(--aui-ink, #ededed);
  --ui-agm-text: var(--aui-muted, #a1a1a1);
  --ui-agm-muted: var(--aui-muted, #8b8b92);
  --ui-agm-faint: var(--aui-placeholder, #5c5c63);
  --ui-agm-line: var(--aui-border, #2a2a2e);
  --ui-agm-edge: var(--aui-border, #2a2a2e);
  --ui-agm-lane: var(--aui-subtle, #232326);
  --ui-agm-fill: var(--aui-subtle, #2a2a2e);
  --ui-agm-accent: var(--aui-blue, #4fb0fe);
  --ui-agm-accent-bg: color-mix(in srgb, var(--aui-blue, #4fb0fe) 14%, transparent);
  --ui-agm-green: var(--aui-green, #5fc88a);
  --ui-agm-green-bg: color-mix(in srgb, var(--aui-green, #7dcf9f) 13%, transparent);
  --ui-agm-red: var(--aui-red, #ff6b5f);
  --ui-agm-red-bg: color-mix(in srgb, var(--aui-red, #ff6b5f) 12%, transparent);
  --ui-agm-amber: var(--aui-amber, #e6c24d);
  --ui-agm-amber-bg: color-mix(in srgb, var(--aui-amber, #e6c24d) 14%, transparent);
  --ui-agm-shine: rgba(255, 255, 255, 0.95);
  --ui-agm-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-agm-seg: #2c2c30;
  --ui-agm-live: 91, 140, 255;
  --ui-agm-hot: #6b6b72;
  --ui-agm-shadow: 0 0 0 1px var(--ui-agm-line), 0 1px 2px rgba(0, 0, 0, 0.3);
}
:where(.dark, [data-theme="dark"]) .ui-agm__btn--go { color: var(--aui-on-primary, #111113); }
:where(.dark, [data-theme="dark"]) .ui-agm__btn--go kbd { background: rgba(0, 0, 0, 0.1); color: rgba(0, 0, 0, 0.6); }
:where(.dark, [data-theme="dark"]) .ui-agm__seg[data-state="running"]::before { background-image: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.22) 50%, transparent 100%); }
`;
