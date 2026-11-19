"use client";

import { t } from "@/lib/i18n";
import { useState, type ReactNode } from "react";

/*
 * Approval Card – an agent asks before it acts: who asks and what kind of step, what will happen, the detail to check,
 * the full context on demand, and Reject / Approve. After the choice it says what was decided.
 * A single self-contained file; the styles are injected below.
 */

export type ApprovalState = "pending" | "working" | "approved" | "rejected" | "failed";

export type ApprovalCardProps = {
  /** Who asks, e.g. "Design agent" – its initials make the badge */
  agent: string;
  /** What kind of step, e.g. "Skill" */
  kind?: string;
  /** When, already formatted, e.g. "just now" */
  time?: string;
  /** A pill on the right of the header, e.g. "Needs you" */
  flag?: string;
  title: ReactNode;
  subtitle?: ReactNode;
  /** The detail to check, under a small label */
  detailLabel?: string;
  detail?: ReactNode;
  /** More, folded until asked for */
  context?: ReactNode;
  state?: ApprovalState;
  /** A line under the result, e.g. why it failed */
  note?: ReactNode;
  approveLabel?: string;
  rejectLabel?: string;
  onApprove?: () => void;
  onReject?: () => void;
  className?: string;
};

const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export function ApprovalCard({
  agent,
  kind,
  time,
  flag,
  title,
  subtitle,
  detailLabel,
  detail,
  context,
  state = "pending",
  note,
  approveLabel = t("Approve"),
  rejectLabel = t("Reject"),
  onApprove,
  onReject,
  className,
}: ApprovalCardProps) {
  const [more, setMore] = useState(false);
  const decided = state === "approved" || state === "rejected" || state === "failed";
  const result = state === "approved" ? t("Approved") : state === "rejected" ? t("Rejected") : state === "failed" ? t("Failed") : null;
  return (
    <section className={["ui-ac", className].filter(Boolean).join(" ")} data-state={state} aria-label={typeof title === "string" ? title : undefined}>
      <style href="ui-approval-card" precedence="default">
        {css}
      </style>
      <header className="ui-ac__head">
        <span className="ui-ac__badge" aria-hidden="true">
          {initials(agent)}
        </span>
        <span className="ui-ac__who">
          {[agent, kind, time].filter(Boolean).join(" · ")}
        </span>
        {flag && !decided && (
          <span className="ui-ac__flag">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            {flag}
          </span>
        )}
      </header>

      <div className="ui-ac__card">
        <h3 className="ui-ac__title">{title}</h3>
        {subtitle && <p className="ui-ac__sub">{subtitle}</p>}
        {detail && (
          <div className="ui-ac__detail">
            {detailLabel && <div className="ui-ac__label">{detailLabel}</div>}
            <div className="ui-ac__box">{detail}</div>
          </div>
        )}
        {context && (
          <>
            <button type="button" className="ui-ac__more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
              {t("Full context")}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="ui-ac__fold" data-open={more || undefined}>
              <div>
                <div className="ui-ac__context">{context}</div>
              </div>
            </div>
          </>
        )}
      </div>

      <footer className="ui-ac__foot">
        {decided ? (
          <span className="ui-ac__result" data-state={state}>
            {state === "approved" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 12.5l4 4 8-9" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 8l8 8M16 8l-8 8" />
              </svg>
            )}
            {result}
            {note && <span className="ui-ac__note">{note}</span>}
          </span>
        ) : (
          <>
            <span className="ui-ac__spacer" />
            <button type="button" className="ui-ac__btn" data-kind="reject" disabled={state === "working"} onClick={onReject}>
              {rejectLabel}
            </button>
            <button type="button" className="ui-ac__btn" data-kind="approve" disabled={state === "working"} aria-busy={state === "working" || undefined} onClick={onApprove}>
              {state === "working" && <span className="ui-ac__spin" aria-hidden="true" />}
              {approveLabel}
            </button>
          </>
        )}
      </footer>
    </section>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-ac {
  --ui-ac-tray: #efefef;
  --ui-ac-card: var(--aui-surface, #ffffff);
  --ui-ac-box: #f4f4f4;
  --ui-ac-line: var(--aui-border, #e6e6e6);
  --ui-ac-ink: var(--aui-ink, #171717);
  --ui-ac-dim: #4d4d4d;
  --ui-ac-muted: var(--aui-muted, #8f8f8f);
  --ui-ac-warn: #b45309;
  --ui-ac-warn-bg: #fdf0dc;
  --ui-ac-ok: #1f9d5c;
  --ui-ac-bad: #e5484d;
  --ui-ac-primary: var(--aui-primary, #171717);
  --ui-ac-on-primary: var(--aui-on-primary, #ffffff);
  --ui-ac-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-ac-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  max-width: 560px;
  padding: 4px;
  border-radius: 18px;
  background: var(--ui-ac-tray);
  color: var(--ui-ac-ink);
  font-size: 13px;
  animation: ui-ac-in 380ms var(--ui-ac-ease) both;
}
.ui-ac__head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px; }
.ui-ac__badge {
  display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 6px;
  background: var(--ui-ac-card); border: 1px solid var(--ui-ac-line); font-size: 9px; font-weight: 700; letter-spacing: 0.02em;
}
.ui-ac__who { flex: 1; min-width: 0; font-size: 12px; color: var(--ui-ac-muted); white-space: nowrap; overflow: hidden; mask-image: linear-gradient(90deg, #000 90%, transparent); }
.ui-ac__flag {
  display: inline-flex; align-items: center; gap: 4px; flex: none; height: 20px; padding: 0 8px; border-radius: 999px;
  background: var(--ui-ac-warn-bg); color: var(--ui-ac-warn); font-size: 11px; font-weight: 500;
}
.ui-ac__flag svg { width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.ui-ac__card { padding: 13px 14px 12px; border-radius: 14px; background: var(--ui-ac-card); border: 1px solid var(--ui-ac-line); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }
.ui-ac__title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; }
.ui-ac__sub { margin: 4px 0 0; font-size: 12.5px; line-height: 1.45; color: var(--ui-ac-dim); }
.ui-ac__detail { margin-top: 12px; }
.ui-ac__label { margin-bottom: 5px; font-size: 11.5px; font-weight: 500; color: var(--ui-ac-muted); }
.ui-ac__box { padding: 9px 11px; border-radius: 9px; background: var(--ui-ac-box); border: 1px solid var(--ui-ac-line); font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.ui-ac__more {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 10px; padding: 0; border: 0; background: none;
  color: var(--ui-ac-muted); font: inherit; font-size: 12px; cursor: pointer;
}
.ui-ac__more:hover { color: var(--ui-ac-ink); }
.ui-ac__more svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; transition: transform 220ms var(--ui-ac-ease); }
.ui-ac__more[aria-expanded="true"] svg { transform: rotate(180deg); }
.ui-ac__fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 280ms var(--ui-ac-ease); }
.ui-ac__fold[data-open] { grid-template-rows: 1fr; }
.ui-ac__fold > div { min-height: 0; overflow: hidden; }
.ui-ac__context { padding-top: 8px; font-size: 12.5px; line-height: 1.5; color: var(--ui-ac-dim); white-space: pre-wrap; overflow-wrap: anywhere; }
.ui-ac__foot { display: flex; align-items: center; gap: 6px; min-height: 40px; padding: 4px 4px 0 8px; }
.ui-ac__spacer { flex: 1; }
.ui-ac__btn {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 13px; border-radius: 9px; border: 1px solid var(--ui-ac-line);
  font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color 150ms, transform 120ms var(--ui-ac-ease), opacity 150ms;
}
.ui-ac__btn:active:not(:disabled) { transform: scale(0.97); }
.ui-ac__btn:disabled { opacity: 0.6; cursor: default; }
.ui-ac__btn:focus-visible { outline: 2px solid var(--ui-ac-focus); outline-offset: 2px; }
.ui-ac__btn[data-kind="reject"] { background: var(--ui-ac-card); color: var(--ui-ac-ink); }
.ui-ac__btn[data-kind="reject"]:hover:not(:disabled) { background: var(--ui-ac-box); }
.ui-ac__btn[data-kind="approve"] { background: var(--ui-ac-primary); border-color: var(--ui-ac-primary); color: var(--ui-ac-on-primary); }
.ui-ac__btn[data-kind="approve"]:hover:not(:disabled) { filter: brightness(1.12); }
.ui-ac__spin { width: 11px; height: 11px; border-radius: 50%; border: 1.6px solid currentColor; border-right-color: transparent; animation: ui-ac-spin 800ms linear infinite; }
.ui-ac__result { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12.5px; font-weight: 500; animation: ui-ac-in 300ms var(--ui-ac-ease) both; }
.ui-ac__result[data-state="approved"] { color: var(--ui-ac-ok); }
.ui-ac__result[data-state="rejected"] { color: var(--ui-ac-muted); }
.ui-ac__result[data-state="failed"] { color: var(--ui-ac-bad); }
.ui-ac__result svg { width: 13px; height: 13px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.ui-ac__note { margin-left: 4px; font-weight: 400; color: var(--ui-ac-muted); }
@keyframes ui-ac-in { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-ac-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ui-ac, .ui-ac__result { animation: none; } .ui-ac__fold { transition: none; } }

:where(.dark, [data-theme="dark"]) .ui-ac {
  --ui-ac-tray: #232327;
  --ui-ac-card: #18181b;
  --ui-ac-box: #202024;
  --ui-ac-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-ac-ink: var(--aui-ink, #ededed);
  --ui-ac-dim: #a1a1aa;
  --ui-ac-muted: var(--aui-muted, #8f8f8f);
  --ui-ac-warn: #f5a524;
  --ui-ac-warn-bg: rgba(245, 165, 36, 0.12);
  --ui-ac-ok: #4fc38a;
  --ui-ac-bad: #ff6b6b;
  --ui-ac-primary: var(--aui-primary, #ededed);
  --ui-ac-on-primary: var(--aui-on-primary, #121213);
  --ui-ac-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
}
`;
