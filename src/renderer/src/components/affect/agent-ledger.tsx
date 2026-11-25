"use client";

import { t } from "@/lib/i18n";
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/*
 * Agent Ledger – everything an agent changed in your systems, each change with an undo, in a single
 * self-contained file. A soft gray tray with the agent and the count, a white card with a row per change –
 * newest first, new ones sliding in as the agent works.
 *   · every row keeps its height: the system's logo, what was done and to what, and before → after
 *   · point at a row and its time turns into "Undo"; point at Undo and every change that builds on it lights up –
 *     "Also undone" where it can be reversed, "Can't undo" where it can't (a sent email, a payout)
 *   · undo strikes the change through, its dependents a beat after each other; "Redo" brings them back
 * The styles are injected below, so no extra files are needed.
 */

export type LedgerEntry = {
  id: string;
  /** What was done, in a few words – e.g. "Changed price" */
  action: string;
  /** To what – e.g. "Pro plan" */
  target?: string;
  /** Where – e.g. "Stripe"; shown after the time and in the labels */
  system: string;
  /** The system's logo */
  icon?: ReactNode;
  /** When it happened (epoch ms) */
  at: number;
  /** Before and after – e.g. ["$29", "$34"]; or a single line of detail */
  change?: [before: string, after: string];
  detail?: string;
  /** False for changes that can't be taken back – a sent email, a payout (default true) */
  reversible?: boolean;
  /** Ids of the changes this one builds on – undoing one of those undoes this one too */
  dependsOn?: string[];
};

export type AgentLedgerProps = {
  entries: LedgerEntry[];
  /** Who made the changes – e.g. "Launch agent" */
  agent?: string;
  /** The clock for "2m ago" – defaults to now */
  now?: number;
  /** Controlled ids of undone changes */
  undone?: string[];
  defaultUndone?: string[];
  /** Undo sends the change and its reversible dependents, Redo the same set back */
  onUndo?: (ids: string[]) => void;
  onRedo?: (ids: string[]) => void;
  /** Lights up a change and what builds on it, as if its Undo were pointed at – e.g. for a walkthrough */
  pointAt?: string | null;
  title?: string;
  /** The count in the header when the rows are one page of a longer list (default: the rows) */
  total?: number;
  /** A row was clicked (or Enter on it) – e.g. to open what it's about */
  onSelect?: (entry: LedgerEntry) => void;
  className?: string;
};

/* ---------- Helpers ---------- */

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return t("just now");
  if (s < 60) return t("{n}s ago", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("{n}m ago", { n: m });
  const h = Math.floor(m / 60);
  return h < 24 ? t("{n}h ago", { n: h }) : t("{n}d ago", { n: Math.floor(h / 24) });
};
/** "2m ago" for the last month – older (or a clock ahead of ours) gets its date, "Sep 20" or "Sep 20, 2025" */
const when = (at: number, now: number) => {
  const ms = now - at;
  if (ms > -60_000 && ms < 30 * 86_400_000) return ago(ms);
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" }).format(at);
};
/** The first letter or digit, whole – an emoji or a space in front doesn't split it */
const firstLetter = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "·").toUpperCase();

/** Who builds directly on each change – looked up once, so a long ledger stays quick */
const childrenOf = (entries: LedgerEntry[]) => {
  const map = new Map<string, LedgerEntry[]>();
  for (const e of entries) for (const parent of e.dependsOn ?? []) map.set(parent, [...(map.get(parent) ?? []), e]);
  return map;
};
/** Everything that builds on a change, directly or through others */
const dependentsOf = (id: string, children: Map<string, LedgerEntry[]>): LedgerEntry[] => {
  const out: LedgerEntry[] = [];
  const seen = new Set([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) {
    for (const e of children.get(queue[i]) ?? []) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        out.push(e);
        queue.push(e.id);
      }
    }
  }
  return out;
};

/* ---------- Icons ---------- */

/* A small ledger mark for the title (drawn for affectUI) */
const LedgerMark = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="2" y="1.8" width="12" height="12.4" rx="2.6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M5 5.4h6M5 8h6M5 10.6h3.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);
/* Undo, redo and lock: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const UndoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4 7H15C18.3137 7 21 9.68629 21 13C21 16.3137 18.3137 19 15 19H8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M8 3L4 7L8 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const RedoIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M20 7H9C5.68629 7 3 9.68629 3 13C3 16.3137 5.68629 19 9 19H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M16 3L20 7L16 11" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const Lock = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M4.26781 18.8447C4.49269 20.515 5.87613 21.8235 7.55966 21.9009C8.97627 21.966 10.4153 22 12 22C13.5847 22 15.0237 21.966 16.4403 21.9009C18.1239 21.8235 19.5073 20.515 19.7322 18.8447C19.879 17.7547 20 16.6376 20 15.5C20 14.3624 19.879 13.2453 19.7322 12.1553C19.5073 10.485 18.1239 9.17649 16.4403 9.09909C15.0237 9.03397 13.5847 9 12 9C10.4153 9 8.97627 9.03397 7.55966 9.09909C5.87613 9.17649 4.49269 10.485 4.26781 12.1553C4.12104 13.2453 4 14.3624 4 15.5C4 16.6376 4.12104 17.7547 4.26781 18.8447Z" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7.5 9V6.5C7.5 4.01472 9.51472 2 12 2C14.4853 2 16.5 4.01472 16.5 6.5V9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);

export function AgentLedger({ entries, agent, now: nowProp, undone: undoneProp, defaultUndone = [], onUndo, onRedo, pointAt = null, title = t("Ledger"), total, onSelect, className }: AgentLedgerProps) {
  const label = useId();
  // The changes already there when the ledger appears just show – only the ones added later grow in
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null) initial.current = new Set(entries.map((e) => e.id));
  const [ownUndone, setOwnUndone] = useState<string[]>(defaultUndone);
  const undone = new Set(undoneProp ?? ownUndone);
  const [preview, setPreview] = useState<string | null>(null);
  /** The order rows were struck through in, for the stagger */
  const [order, setOrder] = useState<Record<string, number>>({});
  // Undone from outside: the ones that just joined strike through in the order they're listed
  const before = useRef<string[]>(undoneProp ?? []);
  useEffect(() => {
    if (!undoneProp) return;
    const fresh = undoneProp.filter((id) => !before.current.includes(id));
    before.current = undoneProp;
    if (fresh.length) setOrder(Object.fromEntries(fresh.map((id, i) => [id, i])));
  }, [undoneProp]);

  // Without a clock from outside, "2m ago" keeps itself fresh
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (nowProp !== undefined) return;
    const t = window.setInterval(() => setTick(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, [nowProp]);
  const now = nowProp ?? tick;

  const sorted = [...entries].sort((a, b) => b.at - a.at);
  const children = useMemo(() => childrenOf(entries), [entries]);
  const chainOf = (id: string) => dependentsOf(id, children).filter((e) => !undone.has(e.id));
  const lit = preview ?? pointAt;
  const previewChain = lit ? chainOf(lit) : [];
  const previewIds = new Map(previewChain.map((e) => [e.id, e.reversible !== false ? "also" : "kept"] as const));

  const undo = (e: LedgerEntry) => {
    const ids = [e.id, ...chainOf(e.id).filter((d) => d.reversible !== false).map((d) => d.id)];
    setOrder(Object.fromEntries(ids.map((id, i) => [id, i])));
    setOwnUndone((u) => [...u, ...ids.filter((id) => !u.includes(id))]);
    setPreview(null);
    onUndo?.(ids);
  };
  const redo = (e: LedgerEntry) => {
    // Back with it come the ones that went with it
    const ids = [e.id, ...dependentsOf(e.id, children).filter((d) => undone.has(d.id)).map((d) => d.id)];
    setOrder({});
    setOwnUndone((u) => u.filter((id) => !ids.includes(id)));
    onRedo?.(ids);
  };

  const count = total ?? entries.length;
  const undoneCount = entries.filter((e) => undone.has(e.id)).length;

  return (
    <div className={["ui-ldg", className].filter(Boolean).join(" ")}>
      <style href="ui-agent-ledger" precedence="default">
        {css}
      </style>

      <header className="ui-ldg__bar">
        <span className="ui-ldg__mark">
          <LedgerMark />
        </span>
        <span className="ui-ldg__title" id={label}>
          {title}
        </span>
        {agent && <span className="ui-ldg__agent">{agent}</span>}
        <span className="ui-ldg__sum">
          <span>
            <b>{count.toLocaleString()}</b> {count === 1 ? t("change") : t("changes")}
          </span>
          {undoneCount > 0 && (
            <span className="ui-ldg__sum-undone">
              <b>{undoneCount.toLocaleString()}</b> {t("undone")}
            </span>
          )}
        </span>
      </header>

      <ol className="ui-ldg__panel" aria-labelledby={label}>
        {sorted.map((e) => {
          const isUndone = undone.has(e.id);
          const mark = previewIds.get(e.id);
          const blocked = e.reversible === false;
          const builtOn = isUndone || blocked ? 0 : chainOf(e.id).length;
          const change = e.change && (e.change[0].trim() || e.change[1].trim()) ? e.change : undefined;
          return (
            <li
              key={e.id}
              className="ui-ldg__row"
              data-undone={isUndone ? "" : undefined}
              data-initial={initial.current?.has(e.id) ? "" : undefined}
              data-preview={lit === e.id ? "" : undefined}
              data-chain={mark}
              style={{ "--o": order[e.id] ?? 0 } as CSSProperties}
              data-clickable={onSelect ? "" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              onClick={onSelect ? (ev) => !(ev.target as HTMLElement).closest("button") && onSelect(e) : undefined}
              onKeyDown={onSelect ? (ev: KeyboardEvent) => ev.key === "Enter" && ev.target === ev.currentTarget && onSelect(e) : undefined}
            >
              <span className="ui-ldg__icon" aria-hidden="true">
                {e.icon ?? firstLetter(e.system)}
              </span>
              <div className="ui-ldg__main">
                <span className="ui-ldg__what" title={e.target ? `${e.action} ${e.target}` : e.action}>
                  <span className="ui-ldg__action" dir="auto">
                    {e.action}
                  </span>
                  {e.target && (
                    <span className="ui-ldg__target" dir="auto">
                      {e.target}
                    </span>
                  )}
                  {/* The strike: a line drawn across what was done when it's undone */}
                  <span className="ui-ldg__strike" aria-hidden="true" />
                </span>
                <span className="ui-ldg__change" title={change ? `${change[0]} → ${change[1]}` : e.detail}>
                  {change ? (
                    <>
                      <span className="ui-ldg__before" dir="auto">
                        {change[0]}
                      </span>
                      <span className="ui-ldg__arrow" aria-label="to">
                        →
                      </span>
                      <span className="ui-ldg__after" dir="auto">
                        {change[1]}
                      </span>
                    </>
                  ) : (
                    <span className="ui-ldg__detail" dir="auto">
                      {e.detail}
                    </span>
                  )}
                </span>
              </div>

              {/* On the right, always one slot: the time – or Undo, Redo, and what an undo would do to this row */}
              <div className="ui-ldg__end">
                {mark ? (
                  <span className="ui-ldg__flag" data-kind={mark}>
                    {mark === "also" ? (
                      t("Also undone")
                    ) : (
                      <>
                        <Lock />
                        {t("Can't undo")}
                      </>
                    )}
                  </span>
                ) : (
                  <>
                    <span className="ui-ldg__time" data-hide={isUndone || !blocked ? "" : undefined}>
                      {isUndone ? (
                        t("Undone")
                      ) : (
                        <>
                          {when(e.at, now)}
                          <span className="ui-ldg__sys"> · {e.system}</span>
                        </>
                      )}
                    </span>
                    {isUndone ? (
                      <button type="button" className="ui-ldg__act" onClick={() => redo(e)} aria-label={`Redo: ${e.action}${e.target ? ` ${e.target}` : ""}`}>
                        <RedoIcon />
                        <span className="ui-ldg__act-label">{t("Redo")}</span>
                      </button>
                    ) : blocked ? null : (
                      <button
                        type="button"
                        className="ui-ldg__act"
                        onMouseEnter={() => setPreview(e.id)}
                        onMouseLeave={() => setPreview((p) => (p === e.id ? null : p))}
                        onFocus={() => setPreview(e.id)}
                        onBlur={() => setPreview((p) => (p === e.id ? null : p))}
                        onClick={() => undo(e)}
                        aria-label={`Undo: ${e.action}${e.target ? ` ${e.target}` : ""}${builtOn ? ` – and ${builtOn} that build on it` : ""}`}
                      >
                        <UndoIcon />
                        <span className="ui-ldg__act-label">{t("Undo")}</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-ldg */
.ui-ldg {
  --ui-ldg-tray: var(--aui-subtle, #f0f0f0);
  --ui-ldg-panel: var(--aui-surface, #ffffff);
  --ui-ldg-card: #ffffff;
  --ui-ldg-strong: var(--aui-ink, #171717);
  --ui-ldg-ink: var(--aui-ink, #171717);
  --ui-ldg-text: var(--aui-muted, #6b6b6b);
  --ui-ldg-muted: var(--aui-muted, #8a8a8a);
  --ui-ldg-faint: var(--aui-placeholder, #c2c2c2);
  --ui-ldg-line: var(--aui-border, #f0f0f0);
  --ui-ldg-fill: rgba(0, 0, 0, 0.05);
  --ui-ldg-accent: var(--aui-blue, #4fb0fe);
  --ui-ldg-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-ldg-undo-bg: #f2f6ff;
  --ui-ldg-also-bg: #f5f8ff;
  --ui-ldg-also-chip: #e3f3ff;
  --ui-ldg-also-fg: var(--aui-blue, #0190fe);
  --ui-ldg-kept-bg: #fff7ee;
  --ui-ldg-kept-chip: #ffecd6;
  --ui-ldg-kept-fg: var(--aui-warning, #b25e00);
  --ui-ldg-strike: #8a8a8a;
  --ui-ldg-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-ldg-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  --ui-ldg-row: 62px;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 4px;
  border-radius: calc(var(--aui-radius-lg, 16px) + 4px);
  background: var(--ui-ldg-tray);
  container: ui-ldg / inline-size;
  font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-ldg-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-ldg *, .ui-ldg *::before, .ui-ldg *::after { box-sizing: border-box; }
:where(.ui-ldg) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-ldg button:focus-visible { outline: 2px solid var(--ui-ldg-focus); outline-offset: 2px; }
.ui-ldg svg { display: block; flex: none; }

/* ----- On the tray: whose changes, how many ----- */
.ui-ldg__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; padding: 8px 12px 12px; }
.ui-ldg__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-ldg-accent); }
.ui-ldg__title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; color: var(--ui-ldg-strong); }
.ui-ldg__agent { min-width: 0; overflow: hidden; font-size: 13px; color: var(--ui-ldg-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-ldg__sum { display: flex; align-items: center; gap: 14px; margin-left: auto; font-size: 13px; line-height: 18px; color: var(--ui-ldg-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ui-ldg__sum b { font-weight: 600; color: var(--ui-ldg-ink); }
.ui-ldg__sum-undone { animation: ui-ldg-fade 240ms ease both; }

/* ----- The white card: one row per change, newest first ----- */
.ui-ldg__panel { display: grid; margin: 0; padding: 6px; overflow: hidden; border-radius: var(--aui-radius-lg, 16px); background: var(--ui-ldg-panel); box-shadow: var(--aui-shadow-card, var(--ui-ldg-shadow)); list-style: none; }
.ui-ldg__row { position: relative; display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; align-items: center; column-gap: 12px; height: var(--ui-ldg-row); padding: 10px 12px 10px 10px; border-radius: calc(var(--aui-radius-sm, 7px) + 4px); transition: background-color 200ms ease; animation: ui-ldg-grow 520ms var(--ui-ldg-ease) backwards; }
/* A new change opens its row – the card grows smoothly instead of jumping – and then fades in */
.ui-ldg__row > * { animation: ui-ldg-in 420ms var(--ui-ldg-ease) 140ms backwards; }
.ui-ldg__row[data-initial], .ui-ldg__row[data-initial] > * { animation: none; }
.ui-ldg__row + .ui-ldg__row::before { content: ""; position: absolute; top: 0; right: 12px; left: 54px; height: 1px; background: var(--ui-ldg-line); }
.ui-ldg__row:hover { background: var(--aui-subtle, #fafafa); }
.ui-ldg__row[data-clickable] { cursor: pointer; }
.ui-ldg__row[data-clickable]:focus-visible { outline: 2px solid var(--ui-ldg-focus); outline-offset: -2px; }
/* Pointing at Undo: this row and every change built on it light up */
.ui-ldg__row[data-preview] { background: var(--ui-ldg-undo-bg); }
.ui-ldg__row[data-chain="also"] { background: var(--ui-ldg-also-bg); }
.ui-ldg__row[data-chain="kept"] { background: var(--ui-ldg-kept-bg); }
.ui-ldg__row:is([data-preview], [data-chain]) + .ui-ldg__row::before, .ui-ldg__row:is([data-preview], [data-chain])::before { opacity: 0; }

.ui-ldg__icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: var(--ui-ldg-card); box-shadow: var(--ui-ldg-shadow); font-size: 13px; font-weight: 600; color: var(--ui-ldg-text); transition: opacity 300ms ease, filter 300ms ease; }
.ui-ldg__icon > svg { width: 16px; height: 16px; }

/* Two lines: what was done to what – then before → after */
.ui-ldg__main { position: relative; display: grid; min-width: 0; }
.ui-ldg__what { position: relative; display: flex; align-items: baseline; gap: 6px; justify-self: start; min-width: 0; max-width: 100%; white-space: nowrap; }
/* The target gives way first, then the action – both end in "…", the full line is in the tooltip */
.ui-ldg__action { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: var(--ui-ldg-ink); transition: color 300ms ease; }
.ui-ldg__target { flex: 0 100 auto; min-width: 0; overflow: hidden; color: var(--ui-ldg-text); text-overflow: ellipsis; transition: color 300ms ease; }
.ui-ldg__change { display: flex; align-items: baseline; gap: 6px; min-width: 0; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-ldg-muted); white-space: nowrap; }
/* Before gives way, the new value stays readable */
.ui-ldg__before { flex: 0 100 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-decoration: line-through; text-decoration-color: var(--ui-ldg-faint); }
.ui-ldg__arrow { flex: none; color: var(--ui-ldg-faint); }
.ui-ldg__detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-ldg__after { flex: 0 1 auto; min-width: 0; overflow: hidden; color: var(--ui-ldg-text); text-overflow: ellipsis; }

/* Undone: a line draws across what was done, a beat after each other down the chain, and the row goes quiet */
.ui-ldg__strike { position: absolute; top: 50%; left: -2px; width: calc(100% + 4px); height: 1.5px; border-radius: 1px; background: var(--ui-ldg-strike); transform: scaleX(0); transform-origin: left; pointer-events: none; transition: transform 380ms var(--ui-ldg-ease) calc(var(--o, 0) * 110ms); }
.ui-ldg__row[data-undone] .ui-ldg__strike { transform: scaleX(1); }
.ui-ldg__row[data-undone] :is(.ui-ldg__action, .ui-ldg__target, .ui-ldg__after) { color: var(--ui-ldg-muted); transition-delay: calc(var(--o, 0) * 110ms); }
.ui-ldg__row[data-undone] .ui-ldg__icon { opacity: 0.5; filter: grayscale(1); transition-delay: calc(var(--o, 0) * 110ms); }

/* On the right: one slot – the time, or Undo / Redo on hover, or what an undo does to this row */
.ui-ldg__end { position: relative; display: grid; justify-items: end; align-items: center; min-width: 120px; height: 28px; }
/* The time only shows – the buttons in the same slot sit on top and get every click */
.ui-ldg__time { grid-area: 1 / 1; pointer-events: none; font-size: 13px; line-height: 18px; color: var(--ui-ldg-muted); white-space: nowrap; font-variant-numeric: tabular-nums; transition: opacity 140ms ease; }
.ui-ldg__row[data-undone] .ui-ldg__time { color: var(--ui-ldg-faint); }
.ui-ldg__act { position: relative; z-index: 1; grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 6px; height: 28px; margin-right: -4px; padding: 0 11px 0 9px; border-radius: 999px; background: var(--ui-ldg-card); box-shadow: var(--ui-ldg-shadow); font-size: 13px; font-weight: 500; color: var(--ui-ldg-ink); white-space: nowrap; opacity: 0; transition: opacity 140ms ease, box-shadow 140ms ease; }
.ui-ldg__row:is(:hover, :focus-within, [data-preview]) .ui-ldg__act { opacity: 1; }
.ui-ldg__row:is(:hover, :focus-within) .ui-ldg__time[data-hide], .ui-ldg__row[data-preview] .ui-ldg__time[data-hide] { opacity: 0; }
.ui-ldg__act:hover { box-shadow: 0 0 0 1px #e2e2e2, 0 2px 6px rgba(0, 0, 0, 0.08); }
.ui-ldg__row[data-preview] .ui-ldg__act { color: var(--ui-ldg-also-fg); }
.ui-ldg__flag { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 10px; border-radius: 999px; font-size: 12.5px; font-weight: 500; line-height: 24px; white-space: nowrap; animation: ui-ldg-fade 160ms ease both; }
.ui-ldg__flag[data-kind="also"] { background: var(--ui-ldg-also-chip); color: var(--ui-ldg-also-fg); }
.ui-ldg__flag[data-kind="kept"] { background: var(--ui-ldg-kept-chip); color: var(--ui-ldg-kept-fg); }

/* ----- Narrow: smaller gaps, the time stands alone ----- */
@container ui-ldg (max-width: 480px) {
  .ui-ldg__sum { flex-basis: 100%; justify-content: space-between; margin-left: 0; }
  .ui-ldg__row { column-gap: 10px; padding: 10px 8px 10px 8px; }
  .ui-ldg__row + .ui-ldg__row::before { left: 50px; right: 8px; }
  .ui-ldg__end { min-width: 76px; }
  /* The logo already says where – the time stands alone */
  .ui-ldg__sys { display: none; }
  /* Undo and Redo shrink to their icon – the label stays for screen readers */
  .ui-ldg__act { width: 28px; justify-content: center; padding: 0; }
  .ui-ldg__act-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
}
/* Touch screens can't point: Undo and Redo show on every row, in place of the time */
@media (hover: none) {
  .ui-ldg__act { opacity: 1; }
  .ui-ldg__time[data-hide] { opacity: 0; }
}

@keyframes ui-ldg-grow { from { height: 0; padding-top: 0; padding-bottom: 0; } }
@keyframes ui-ldg-in { from { opacity: 0; transform: translateY(-4px); } }
@keyframes ui-ldg-fade { from { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .ui-ldg *, .ui-ldg *::before, .ui-ldg *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ldg {
  --ui-ldg-tray: var(--aui-subtle, #1a1a1c);
  --ui-ldg-panel: var(--aui-surface, #232326);
  --ui-ldg-card: #2a2a2e;
  --ui-ldg-strong: var(--aui-ink, #f5f5f5);
  --ui-ldg-ink: var(--aui-ink, #f0f0f0);
  --ui-ldg-text: var(--aui-muted, #a1a1a1);
  --ui-ldg-muted: var(--aui-muted, #8a8a8a);
  --ui-ldg-faint: var(--aui-placeholder, #5c5c5c);
  --ui-ldg-line: var(--aui-border, #2e2e31);
  --ui-ldg-fill: rgba(255, 255, 255, 0.06);
  --ui-ldg-accent: var(--aui-blue, #4fb0fe);
  --ui-ldg-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-ldg-undo-bg: #1b2a38;
  --ui-ldg-also-bg: #192835;
  --ui-ldg-also-chip: #1d364d;
  --ui-ldg-also-fg: #8bcbfe;
  --ui-ldg-kept-bg: #2d2216;
  --ui-ldg-kept-chip: #3a2712;
  --ui-ldg-kept-fg: var(--aui-warning, #ffb35c);
  --ui-ldg-strike: #8a8a8a;
  --ui-ldg-shadow: 0 0 0 1px #2e2e31, 0 1px 2px rgba(0, 0, 0, 0.4);
}
`;
