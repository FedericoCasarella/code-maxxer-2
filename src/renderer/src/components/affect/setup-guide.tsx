"use client";

import { t } from "@/lib/i18n";
import { useEffect, useId, useState, type ReactNode } from "react";

/**
 * Setup Guide (affectUI, classic): onboarding panel with a progress bar and collapsible task groups that strike
 * through when done. Recreated for code-maxxer.
 */

export type SetupTask = { id: string; label: ReactNode; done?: boolean; locked?: boolean };
export type SetupGroup = { id: string; title: ReactNode; tasks: SetupTask[] };

export interface SetupGuideProps {
  title?: ReactNode;
  groups: SetupGroup[];
  /** A pending task was clicked */
  onTask?: (groupId: string, taskId: string) => void;
  onClose?: () => void;
  /** Body folded away, only the header and the bar left */
  minimized?: boolean;
  onMinimizedChange?: (minimized: boolean) => void;
  className?: string;
}

export function SetupGuide({ title, groups, onTask, onClose, minimized = false, onMinimizedChange, className }: SetupGuideProps) {
  const uid = useId();
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  const done = groups.reduce((n, g) => n + g.tasks.filter((x) => x.done).length, 0);
  const firstOpen = () => groups.find((g) => g.tasks.some((x) => !x.done))?.id ?? null;
  const [open, setOpen] = useState<string | null>(firstOpen);
  // A group just finished: the next one with work left opens
  const pendingKey = groups.map((g) => g.tasks.every((x) => x.done)).join();
  useEffect(() => {
    setOpen((cur) => (cur && groups.find((g) => g.id === cur)?.tasks.some((x) => !x.done) ? cur : firstOpen()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  return (
    <section className={["ui-sgd", className].filter(Boolean).join(" ")} aria-label={typeof title === "string" ? title : t("Setup guide")}>
      <style href="ui-setup-guide" precedence="default">
        {css}
      </style>
      <header className="ui-sgd__head">
        <h3 className="ui-sgd__title" dir="auto">
          {title ?? t("Setup guide")}
        </h3>
        <div className="ui-sgd__actions">
          {onMinimizedChange && (
            <button
              type="button"
              className="ui-sgd__icon-btn"
              aria-label={minimized ? t("Expand setup guide") : t("Minimize setup guide")}
              aria-expanded={!minimized}
              onClick={() => onMinimizedChange(!minimized)}
            >
              {minimized ? (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13.5 6.5v-4h-4M13.5 2.5 9 7M2.5 9.5v4h4M2.5 13.5 7 9" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.5 2.5v4h4M9.5 6.5l4.5-4.5M6.5 13.5v-4h-4M6.5 9.5 2 14" />
                </svg>
              )}
            </button>
          )}
          {onClose && (
            <button type="button" className="ui-sgd__icon-btn" aria-label={t("Close setup guide")} onClick={onClose}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
              </svg>
            </button>
          )}
        </div>
      </header>
      <span
        className="ui-sgd__track"
        role="progressbar"
        aria-label={t("Setup guide progress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={total ? Math.round((done / total) * 100) : 0}
      >
        <span className="ui-sgd__fill" style={{ transform: `scaleX(${total ? done / total : 0})` }} />
      </span>
      <div className="ui-sgd__body" data-hidden={minimized || undefined} inert={minimized || undefined}>
        <div className="ui-sgd__groups">
          {groups.map((g) => {
            const isOpen = open === g.id;
            const allDone = g.tasks.length > 0 && g.tasks.every((x) => x.done);
            const panelId = `${uid}-${g.id}`;
            return (
              <div key={g.id} className="ui-sgd__group" data-open={isOpen || undefined}>
                <button type="button" className="ui-sgd__group-head" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpen(isOpen ? null : g.id)}>
                  <span className="ui-sgd__group-title" data-done={allDone || undefined} dir="auto">
                    {g.title}
                  </span>
                  <svg className="ui-sgd__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m4.5 6.25 3.5 3.5 3.5-3.5" />
                  </svg>
                </button>
                <div className="ui-sgd__panel" id={panelId} inert={!isOpen || undefined}>
                  <ul className="ui-sgd__tasks">
                    {g.tasks.map((x) => {
                      const state = x.done ? "done" : x.locked ? "locked" : "current";
                      return (
                        <li key={x.id}>
                          <button
                            type="button"
                            className="ui-sgd__task"
                            data-state={state}
                            disabled={state === "locked"}
                            aria-pressed={!!x.done}
                            onClick={() => state === "current" && onTask?.(g.id, x.id)}
                          >
                            <span className="ui-sgd__mark" aria-hidden="true">
                              {state === "done" ? (
                                <svg viewBox="0 0 16 16" aria-hidden="true">
                                  <circle cx="8" cy="8" r="7" fill="currentColor" />
                                  <path d="m5 8.2 2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              ) : state === "locked" ? (
                                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                                  <circle cx="8" cy="8" r="6" />
                                  <path d="m4 12 8-8" />
                                </svg>
                              ) : null}
                            </span>
                            <span className="ui-sgd__task-label" dir="auto">
                              {x.label}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-sgd {
  --ui-sgd-card: var(--aui-surface, #ffffff);
  --ui-sgd-line: var(--aui-border, #ececec);
  --ui-sgd-ink: var(--aui-ink, #171717);
  --ui-sgd-text: var(--aui-ink, #262626);
  --ui-sgd-muted: var(--aui-muted, #a3a3a3);
  --ui-sgd-icon: var(--aui-muted, #737373);
  --ui-sgd-track: #ececec;
  --ui-sgd-accent: var(--aui-blue, #4fb0fe);
  --ui-sgd-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-sgd-open: var(--aui-subtle, #f6f6f7);
  --ui-sgd-dot: #e1e3e8;
  --ui-sgd-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  box-sizing: border-box;
  width: 100%;
  max-width: 320px;
  padding: 16px 8px 8px;
  background: var(--ui-sgd-card);
  border: 1px solid var(--ui-sgd-line);
  border-radius: calc(var(--aui-radius-lg, 16px) + 4px);
  box-shadow: rgba(0, 0, 0, 0.03) 0px 1px 2px, rgba(0, 0, 0, 0.035) 0px 8px 24px;
  font-family: var(--aui-font, "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  color: var(--ui-sgd-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-sgd *, .ui-sgd ::before, .ui-sgd ::after { box-sizing: border-box; }
.ui-sgd button { margin: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
.ui-sgd button:focus-visible { outline: 2px solid var(--ui-sgd-focus); outline-offset: 2px; }
.ui-sgd__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 8px; }
.ui-sgd__title { min-width: 0; margin: 0; text-align: start; overflow-wrap: anywhere; font-size: 13px; font-weight: 600; line-height: 18px; }
.ui-sgd__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; margin-right: -4px; }
.ui-sgd__icon-btn { display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--aui-radius-sm, 7px); transition: background-color 160ms, color 160ms; color: var(--ui-sgd-icon) !important; }
.ui-sgd__icon-btn:hover { background: var(--aui-subtle, #f2f2f2) !important; color: var(--ui-sgd-ink) !important; }
.ui-sgd__icon-btn svg { width: 16px; height: 16px; }
.ui-sgd__track { display: block; height: 5px; margin: 10px 8px 8px; overflow: hidden; border-radius: 3px; background: var(--ui-sgd-track); }
.ui-sgd__fill { display: block; height: 100%; border-radius: inherit; background: var(--ui-sgd-accent); transform-origin: left center; transition: transform 700ms var(--ui-sgd-ease); }
.ui-sgd__body { display: grid; grid-template-rows: 1fr; transition: grid-template-rows 420ms var(--ui-sgd-ease), opacity 260ms ease; }
.ui-sgd__body[data-hidden] { grid-template-rows: 0fr; opacity: 0; }
.ui-sgd__groups { min-height: 0; overflow: hidden; }
.ui-sgd__group { border-radius: calc(var(--aui-radius-lg, 16px) - 4px); transition: background-color 260ms; }
.ui-sgd__group[data-open] { background: var(--ui-sgd-open); }
.ui-sgd__group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; width: 100%; padding: 11px 12px; border-radius: calc(var(--aui-radius-lg, 16px) - 4px); text-align: left; }
.ui-sgd__group-title { position: relative; min-width: 0; text-align: start; overflow-wrap: anywhere; font-size: 13px; font-weight: 500; line-height: 18px; transition: color 300ms; }
.ui-sgd__group-title::after { content: ""; position: absolute; left: 0; right: 0; top: 52%; height: 1.5px; border-radius: 1px; background: currentcolor; transform: scaleX(0); transform-origin: left center; transition: transform 420ms var(--ui-sgd-ease); }
.ui-sgd__group-title[data-done]::after { transform: scaleX(1); }
.ui-sgd__chevron { flex: 0 0 auto; width: 16px; height: 16px; margin-top: 2px; color: var(--ui-sgd-icon); transition: transform 320ms var(--ui-sgd-ease); }
.ui-sgd__group[data-open] .ui-sgd__chevron { transform: rotate(180deg); }
.ui-sgd__panel { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 380ms var(--ui-sgd-ease); }
.ui-sgd__group[data-open] .ui-sgd__panel { grid-template-rows: 1fr; }
.ui-sgd__tasks { min-height: 0; overflow: hidden; margin: 0; padding: 0; list-style: none; }
.ui-sgd__tasks li:last-child { padding-bottom: 8px; }
.ui-sgd__task { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 7px 12px; border-radius: calc(var(--aui-radius-sm, 7px) + 3px); text-align: left; opacity: 0; transform: translateY(-4px); transition: opacity 260ms ease, transform 320ms var(--ui-sgd-ease), color 260ms ease; }
.ui-sgd__group[data-open] .ui-sgd__task { opacity: 1; transform: none; transition-delay: 80ms; }
.ui-sgd__task[data-state="current"] { color: var(--ui-sgd-text); }
.ui-sgd__task[data-state="current"]:hover .ui-sgd__mark { background: rgb(211, 215, 222); }
.ui-sgd__task[data-state="locked"] { color: var(--ui-sgd-muted); cursor: default; }
.ui-sgd__task[data-state="done"] { color: var(--ui-sgd-muted); cursor: default; }
.ui-sgd__mark { display: grid; place-items: center; flex: 0 0 auto; width: 16px; height: 16px; margin-top: 2px; border-radius: 50%; transition: background-color 200ms; }
.ui-sgd__task[data-state="current"] .ui-sgd__mark { background: var(--ui-sgd-dot); }
.ui-sgd__task[data-state="locked"] .ui-sgd__mark { color: var(--aui-placeholder, #d4d4d4); }
.ui-sgd__task[data-state="done"] .ui-sgd__mark { color: var(--ui-sgd-accent); }
.ui-sgd__mark svg { width: 16px; height: 16px; }
.ui-sgd__task[data-state="done"] .ui-sgd__mark svg { animation: ui-sgd-pop 420ms var(--ui-sgd-ease); }
.ui-sgd__task-label { min-width: 0; text-align: start; white-space: pre-line; overflow-wrap: anywhere; font-size: 13px; line-height: 18px; text-decoration-line: line-through; text-decoration-color: transparent; text-decoration-thickness: 1.5px; transition: text-decoration-color 260ms; }
.ui-sgd__task[data-state="done"] .ui-sgd__task-label { text-decoration-color: currentcolor; }
@keyframes ui-sgd-pop { 0% { transform: scale(0.5); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .ui-sgd__fill, .ui-sgd__body, .ui-sgd__panel, .ui-sgd__task, .ui-sgd__chevron, .ui-sgd__group-title::after { transition: none; }
  .ui-sgd__mark svg { animation: none !important; }
}
:where(.dark, [data-theme="dark"]) .ui-sgd {
  --ui-sgd-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  --ui-sgd-card: var(--aui-surface, #232326);
  --ui-sgd-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-sgd-ink: var(--aui-ink, #ededed);
  --ui-sgd-text: var(--aui-ink, #dcdcdc);
  --ui-sgd-muted: var(--aui-muted, #8f8f8f);
  --ui-sgd-icon: var(--aui-muted, #8f8f8f);
  --ui-sgd-track: rgba(255, 255, 255, 0.1);
  --ui-sgd-open: var(--aui-subtle, #2a2a2d);
  --ui-sgd-dot: #3a3a3f;
  box-shadow: rgba(0, 0, 0, 0.4) 0px 1px 2px, rgba(0, 0, 0, 0.35) 0px 8px 24px;
}
:where(.dark, [data-theme="dark"]) .ui-sgd__icon-btn:hover { background: var(--aui-subtle, rgba(255, 255, 255, 0.06)) !important; }
:where(.dark, [data-theme="dark"]) .ui-sgd__task[data-state="current"]:hover .ui-sgd__mark { background: rgb(74, 74, 80); }
:where(.dark, [data-theme="dark"]) .ui-sgd__task[data-state="locked"] .ui-sgd__mark { color: var(--aui-placeholder, #4a4a50); }
`;
