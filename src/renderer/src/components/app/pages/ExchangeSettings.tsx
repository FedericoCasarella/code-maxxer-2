import { useEffect, useState } from 'react'
import { Save, Search, Send } from 'lucide-react'
import type { ExchangeChat, ExchangeEvents, ExchangeState } from '@shared/exchange'
import { timeAgo } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Switch } from '../../affect/switch'
import { Spinner } from '../../affect/spinner'
import { Button } from '../../affect/button'
import { TextField } from '../../affect/text-field'
import { Select } from '../../affect/select'
import { Group, Row } from './SettingsPage'

const EVENTS: { key: keyof ExchangeEvents; label: string; hint: string }[] = [
  { key: 'questions', label: 'Questions', hint: 'The agent asks you something: answer with a tap or in words' },
  { key: 'plans', label: 'Plans', hint: 'A plan waits for you: approve or reject it' },
  { key: 'lessons', label: 'Lessons', hint: 'Auto-learning proposes a lesson: keep or discard it' },
  { key: 'runs', label: 'Runs', hint: 'A run finished or failed' },
  { key: 'scheduled', label: 'Scheduled runs', hint: 'A scheduled run was sent or failed' },
  { key: 'recon', label: 'Servers', hint: 'Recon: a server went down or came back' },
  { key: 'security', label: 'Security', hint: 'A security scan finished' }
]

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Settings → Exchange: code-maxxer on Telegram. */
export function ExchangeSettings() {
  const [st, setSt] = useState<ExchangeState | null>(null)
  const [token, setToken] = useState('')
  const [chats, setChats] = useState<ExchangeChat[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => void window.cm.exchange.get().then(setSt), [])
  if (!st) return <div className="flex justify-center py-10"><Spinner size={14} /></div>

  const act = async (k: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(k)
    setMsg(null)
    try {
      await fn()
      if (ok) setMsg({ ok: true, text: ok })
    } catch (e) {
      setMsg({ ok: false, text: clean(e) })
    } finally {
      setBusy(null)
    }
  }
  // Optimistic: the switch moves at once, the saved state replaces it.
  const save = (p: Parameters<typeof window.cm.exchange.save>[0], ok?: string) => {
    setSt({ ...st, ...p, events: { ...st.events, ...(p.events ?? {}) } })
    return act('save', async () => setSt(await window.cm.exchange.save(p)), ok)
  }
  const ready = st.hasToken && !!st.chatId
  const chatOptions = [...(chats ?? []), ...(st.chatId && !chats?.some((c) => c.id === st.chatId) ? [{ id: st.chatId, title: st.chatTitle || st.chatId, kind: 'saved' }] : [])]

  return (
    <>
      <Group title="Telegram" hint={t("Talk to code-maxxer from your phone. Questions, decisions and notifications arrive there too, and anything you write goes to a project's chat.")}>
        <Row label={t('Enabled')} hint={ready ? (st.bot ? `@${st.bot.username}` : t('Bot connected')) : t('Add the bot and pick the chat first.')}>
          <Switch checked={st.enabled} disabled={!ready} onChange={(e) => void save({ enabled: e.currentTarget.checked })} aria-label={t('Enabled')} />
        </Row>
        <Row label={t('Bot token')} hint={st.hasToken ? t('Saved, encrypted on this Mac. Paste a new one to replace it.') : t('In Telegram open @BotFather, send /newbot and paste the token here.')}>
          <div className="flex w-[360px] items-center gap-2">
            <TextField
              size="sm"
              className="min-w-0 flex-1"
              type="password"
              aria-label={t('Bot token')}
              placeholder={st.hasToken ? '••••••••••' : '123456:ABC-DEF…'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              spellCheck={false}
            />
            <Button size="sm" variant="secondary" disabled={!token.trim()} loading={busy === 'save'} iconRight={<Save size={13} />} onClick={() => void save({ token }, t('Bot saved')).then(() => setToken(''))}>
              {t('Save')}
            </Button>
          </div>
        </Row>
        <Row label={t('Chat')} hint={st.bot ? t('Write anything to @{bot} (or add it to a group), then Detect.', { bot: st.bot.username }) : t('Write anything to your bot, then Detect.')}>
          <div className="flex w-[360px] items-center gap-2">
            <Select
              size="sm"
              className="min-w-0 flex-1"
              aria-label={t('Chat')}
              placeholder={chats && !chats.length ? t('No chat wrote to the bot yet') : t('Pick a chat')}
              value={st.chatId || null}
              options={chatOptions.map((c) => ({ value: c.id, label: c.title, description: c.kind === 'private' ? t('Private chat') : c.kind === 'saved' ? t('Saved') : t('Group') }))}
              onChange={(v, o) => v && void save({ chatId: v, chatTitle: String(o.label) }, t('Chat saved'))}
            />
            <Button size="sm" variant="secondary" disabled={!st.hasToken} loading={busy === 'detect'} iconRight={<Search size={13} />} onClick={() => void act('detect', async () => setChats(await window.cm.exchange.detect()))}>
              {t('Detect')}
            </Button>
          </div>
        </Row>
        <Row
          label={t('Test')}
          hint={msg ? <span className={msg.ok ? 'text-ok' : 'text-bad'}>{msg.text}</span> : st.lastError ? <span className="text-bad">{st.lastError}</span> : st.lastSentAt ? (() => { const ago = timeAgo(st.lastSentAt); return ago === 'now' ? t('Last message just now') : t('Last message {t} ago', { t: ago }) })() : t('Send a message to check it arrives.')}
        >
          <Button size="sm" variant="secondary" disabled={!ready} loading={busy === 'test'} iconRight={<Send size={13} />} onClick={() => void act('test', () => window.cm.exchange.test(), t('Test sent: check Telegram'))}>
            {t('Send a test')}
          </Button>
        </Row>
      </Group>
      <Group title={t('What goes to Telegram')} hint={t('Everything also stays in the app.')}>
        {EVENTS.map((ev) => (
          <Row key={ev.key} label={t(ev.label)} hint={t(ev.hint)}>
            <Switch checked={st.events[ev.key]} onChange={(e) => void save({ events: { [ev.key]: e.currentTarget.checked } as Partial<ExchangeEvents> as ExchangeEvents })} aria-label={t(ev.label)} />
          </Row>
        ))}
      </Group>
    </>
  )
}
