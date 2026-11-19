"use client";

import { t } from "@/lib/i18n";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/*
 * Writing Assistant – a small chat card: title, a new-chat button, bubbles over a soft glow and a pill input.
 * A single self-contained file; the styles are injected below.
 */

export type AssistantMessage = { id: string; role: "user" | "assistant"; text: ReactNode; error?: boolean };

export type WritingAssistantProps = {
  title?: string;
  subtitle?: string;
  messages: AssistantMessage[];
  onSend: (text: string) => void;
  /** Clears the chat (the + button); hidden when missing */
  onNew?: () => void;
  /** Shows a typing indicator and blocks sending */
  busy?: boolean;
  placeholder?: string;
  /** Shown in the empty chat */
  empty?: ReactNode;
  /** Optional: a mic button while the input is empty */
  onMic?: () => void;
  micActive?: boolean;
  /** Extra button in the header, e.g. close */
  headerAction?: ReactNode;
  autoFocus?: boolean;
  className?: string;
};

export function WritingAssistant({
  title = t("Assistant"),
  subtitle,
  messages,
  onSend,
  onNew,
  busy = false,
  placeholder = t("Ask anything..."),
  empty,
  onMic,
  micActive = false,
  headerAction,
  autoFocus = false,
  className,
}: WritingAssistantProps) {
  const [text, setText] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // New bubbles scroll into view
  useLayoutEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, busy]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  // The field grows with its text, up to four lines
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [text]);

  const send = () => {
    const v = text.trim();
    if (!v || busy) return;
    onSend(v);
    setText("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const showSend = text.trim().length > 0 || !onMic;

  return (
    <section className={["ui-wa", className].filter(Boolean).join(" ")} aria-label={title}>
      <style href="ui-writing-assistant" precedence="default">
        {css}
      </style>
      <header className="ui-wa__head">
        <div className="ui-wa__titles">
          <h3 className="ui-wa__title">{title}</h3>
          {subtitle && <p className="ui-wa__sub">{subtitle}</p>}
        </div>
        {onNew && (
          <button type="button" className="ui-wa__round" onClick={onNew} aria-label={t("New chat")} title={t("New chat")}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
        {headerAction}
      </header>

      <div className="ui-wa__body">
        <span className="ui-wa__glow" aria-hidden="true" />
        <div className="ui-wa__list" ref={list} role="log" aria-live="polite">
          {messages.length === 0 && empty && <div className="ui-wa__empty">{empty}</div>}
          {messages.map((m) => (
            <div key={m.id} className="ui-wa__bubble" data-role={m.role} data-error={m.error || undefined} dir="auto">
              {m.text}
            </div>
          ))}
          {busy && (
            <div className="ui-wa__bubble ui-wa__typing" data-role="assistant" aria-label={t("Writing")}>
              <span />
              <span />
              <span />
            </div>
          )}
        </div>

        <div className="ui-wa__bar">
          <label className="ui-wa__field">
            <textarea
              ref={input}
              rows={1}
              value={text}
              placeholder={placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              aria-label={placeholder}
            />
          </label>
          {showSend ? (
            <button type="button" className="ui-wa__send" onClick={send} disabled={!text.trim() || busy} aria-label={t("Send")} title={t("Send")}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              className="ui-wa__send"
              data-active={micActive || undefined}
              onClick={onMic}
              aria-pressed={micActive}
              aria-label={t("Dictate")}
              title={t("Dictate")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-wa {
  --ui-wa-card: var(--aui-surface, #ffffff);
  --ui-wa-inner: var(--aui-subtle, #fafafa);
  --ui-wa-line: var(--aui-border, #e8e8e8);
  --ui-wa-ink: var(--aui-ink, #171717);
  --ui-wa-muted: var(--aui-muted, #8f8f8f);
  --ui-wa-user: #ececec;
  --ui-wa-bot: rgba(255, 255, 255, 0.86);
  --ui-wa-field: #ffffff;
  --ui-wa-glow-a: rgba(244, 170, 214, 0.45);
  --ui-wa-glow-b: rgba(172, 170, 250, 0.42);
  --ui-wa-bad: #e5484d;
  --ui-wa-focus: var(--aui-focus, rgba(0, 96, 226, 0.7));
  --ui-wa-ease: var(--aui-ease, cubic-bezier(0.22, 1, 0.36, 1));
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 14px 14px;
  background: var(--ui-wa-card);
  border: 1px solid var(--ui-wa-line);
  border-radius: 22px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  color: var(--ui-wa-ink);
  font-size: 14px;
  animation: ui-wa-in 380ms var(--ui-wa-ease) both;
}
.ui-wa__head { display: flex; align-items: flex-start; gap: 8px; padding: 0 6px; }
.ui-wa__titles { flex: 1; min-width: 0; }
.ui-wa__title { margin: 0; font-size: 19px; font-weight: 600; letter-spacing: -0.01em; }
.ui-wa__sub { margin: 2px 0 0; font-size: 13px; color: var(--ui-wa-muted); }
.ui-wa__round {
  display: grid; place-items: center; flex: none; width: 30px; height: 30px; border: 0; border-radius: 50%;
  background: var(--ui-wa-user); color: var(--ui-wa-ink); cursor: pointer; transition: transform 160ms var(--ui-wa-ease), background-color 160ms;
}
.ui-wa__round:hover { filter: brightness(0.96); }
.ui-wa__round:active { transform: scale(0.94); }
.ui-wa__round svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.ui-wa__body {
  position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1;
  border: 1px solid var(--ui-wa-line); border-radius: 18px; background: var(--ui-wa-inner); overflow: hidden;
}
.ui-wa__glow {
  position: absolute; inset: auto -20% -30% -20%; height: 75%; pointer-events: none;
  background:
    radial-gradient(45% 55% at 30% 60%, var(--ui-wa-glow-a), transparent 70%),
    radial-gradient(45% 55% at 70% 70%, var(--ui-wa-glow-b), transparent 70%);
  filter: blur(18px);
}
.ui-wa__list {
  position: relative; flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px;
  padding: 16px 12px 8px; scrollbar-width: thin;
}
.ui-wa__empty { margin: auto 8px; text-align: center; font-size: 13px; line-height: 1.5; color: var(--ui-wa-muted); }
.ui-wa__bubble {
  max-width: 86%; padding: 9px 13px; border-radius: 16px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere;
  animation: ui-wa-bubble 320ms var(--ui-wa-ease) both;
}
.ui-wa__bubble[data-role="user"] { align-self: flex-end; background: var(--ui-wa-user); border-bottom-right-radius: 6px; }
.ui-wa__bubble[data-role="assistant"] {
  align-self: flex-start; background: var(--ui-wa-bot); border: 1px solid var(--ui-wa-line); border-bottom-left-radius: 6px;
  backdrop-filter: blur(8px);
}
.ui-wa__bubble[data-error] { color: var(--ui-wa-bad); }
.ui-wa__typing { display: flex; gap: 4px; padding: 13px 14px; }
.ui-wa__typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--ui-wa-muted); animation: ui-wa-dot 1.1s ease-in-out infinite; }
.ui-wa__typing span:nth-child(2) { animation-delay: 140ms; }
.ui-wa__typing span:nth-child(3) { animation-delay: 280ms; }
.ui-wa__bar { position: relative; display: flex; align-items: flex-end; gap: 8px; padding: 8px; }
.ui-wa__field {
  flex: 1; display: flex; min-height: 48px; align-items: center; padding: 0 18px; border: 1px solid var(--ui-wa-line);
  border-radius: 999px; background: var(--ui-wa-field); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05); cursor: text;
  transition: border-color 160ms, box-shadow 160ms;
}
.ui-wa__field:focus-within { border-color: var(--aui-border-strong, #bdbdbd); }
.ui-wa__field textarea {
  flex: 1; resize: none; border: 0; outline: 0; background: transparent; color: inherit; font: inherit; line-height: 1.4; padding: 13px 0;
}
.ui-wa__field textarea::placeholder { color: var(--ui-wa-muted); }
.ui-wa__send {
  display: grid; place-items: center; flex: none; width: 48px; height: 48px; border: 1px solid var(--ui-wa-line); border-radius: 50%;
  background: var(--ui-wa-field); color: var(--ui-wa-ink); cursor: pointer; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
  transition: transform 160ms var(--ui-wa-ease), opacity 160ms;
}
.ui-wa__send:active:not(:disabled) { transform: scale(0.94); }
.ui-wa__send:disabled { opacity: 0.45; cursor: default; }
.ui-wa__send[data-active] { color: var(--ui-wa-bad); }
.ui-wa__send svg { width: 19px; height: 19px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ui-wa button:focus-visible { outline: 2px solid var(--ui-wa-focus); outline-offset: 2px; }
@keyframes ui-wa-in { from { opacity: 0; transform: translateY(8px) scale(0.98); } }
@keyframes ui-wa-bubble { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-wa-dot { 0%, 80%, 100% { opacity: 0.3; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-3px); } }
@media (prefers-reduced-motion: reduce) { .ui-wa, .ui-wa__bubble { animation: none; } .ui-wa__typing span { animation: none; } }

:where(.dark, [data-theme="dark"]) .ui-wa {
  --ui-wa-card: var(--aui-surface, #1c1c1f);
  --ui-wa-inner: #161618;
  --ui-wa-line: var(--aui-border, rgba(255, 255, 255, 0.08));
  --ui-wa-ink: var(--aui-ink, #ededed);
  --ui-wa-muted: var(--aui-muted, #8f8f8f);
  --ui-wa-user: #2c2c30;
  --ui-wa-bot: rgba(36, 36, 40, 0.82);
  --ui-wa-field: #222225;
  --ui-wa-glow-a: rgba(214, 112, 178, 0.22);
  --ui-wa-glow-b: rgba(124, 120, 240, 0.24);
  --ui-wa-focus: var(--aui-focus, rgba(77, 141, 255, 0.8));
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.5);
}
`;
