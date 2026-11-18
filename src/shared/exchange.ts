// Exchange: talk to code-maxxer from Telegram. Questions, decisions and notifications go there too.

export type ExchangeEvents = {
  /** The agent asks you something (ask_user) */
  questions: boolean
  /** A plan waits for approval */
  plans: boolean
  /** Auto-learning proposes lessons to keep or discard */
  lessons: boolean
  /** A run finished or failed */
  runs: boolean
  /** A scheduled run was sent or failed */
  scheduled: boolean
  /** Recon: a server went down or recovered */
  recon: boolean
  /** Security: a scan finished */
  security: boolean
}

export type ExchangeSettings = {
  enabled: boolean
  chatId: string
  /** Shown in the picker, so the saved chat has a name after a restart */
  chatTitle?: string
  events: ExchangeEvents
}

/** What the page shows: the token never leaves main, only whether one is saved and the bot's name. */
export type ExchangeState = ExchangeSettings & {
  hasToken: boolean
  bot: { username: string; name: string } | null
  lastError: string | null
  lastSentAt: string | null
}

export type ExchangeChat = { id: string; title: string; kind: string }

export type ExchangeApi = {
  get(): Promise<ExchangeState>
  /** `token` only when typed: empty string removes it, undefined keeps the saved one */
  save(p: Partial<ExchangeSettings> & { token?: string }): Promise<ExchangeState>
  /** Chats that wrote to the bot recently (write anything to the bot first); `token` to try one before saving */
  detect(token?: string): Promise<ExchangeChat[]>
  test(): Promise<void>
}

export const DEFAULT_EVENTS: ExchangeEvents = {
  questions: true,
  plans: true,
  lessons: true,
  runs: true,
  scheduled: true,
  recon: true,
  security: true
}
