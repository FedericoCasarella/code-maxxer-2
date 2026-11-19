import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, RefreshCw, Search } from 'lucide-react'
import type { ModelInfo, Provider } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { Popover } from '../affect/popover'
import { Spinner } from '../affect/spinner'
import { ProviderLogo } from './Logos'
import { Marquee } from './Marquee'
import { TextField } from '../affect/text-field'
import { t } from '@/lib/i18n'

const GROUPS: { id: Provider; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'codex', label: 'OpenAI · Codex' },
  { id: 'opencode', label: 'OpenCode' }
]

export const providerOf = (model: string): Provider =>
  model.includes('/') ? 'opencode' : /^(gpt|o\d|codex)/i.test(model) ? 'codex' : 'claude'

export function modelLabel(id: string | undefined, models: ModelInfo[]): string {
  if (!id) return ''
  return models.find((m) => m.id === id)?.label ?? id.split('/').pop() ?? id
}

/**
 * The one model picker (composer, pipeline, nodes): searchable, grouped by provider, brand logo per row.
 * `allowInherit` adds a first row to clear the choice (e.g. a node using the pipeline's model).
 */
export function ModelSelect({
  value, onChange, trigger = 'chip', allowInherit, inheritLabel = 'Pipeline model', side = 'top', align = 'end', className
}: {
  value: string | null | undefined
  onChange: (id: string | null) => void
  trigger?: 'chip' | 'field'
  allowInherit?: boolean
  inheritLabel?: string
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
  className?: string
}) {
  const models = useStore((s) => s.models)
  const anchor = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      setQ('')
      setTimeout(() => input.current?.focus(), 20)
    }
  }, [open])

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = models.filter((m) => !s || `${m.label} ${m.id} ${m.description} ${m.provider}`.toLowerCase().includes(s))
    return GROUPS.map((g) => ({ ...g, items: list.filter((m) => m.provider === g.id) })).filter((g) => g.items.length)
  }, [models, q])
  const flat = rows.flatMap((g) => g.items)
  useEffect(() => setActive(0), [q])

  const pick = (id: string | null) => {
    onChange(id)
    setOpen(false)
  }
  const current = value ? models.find((m) => m.id === value) : null
  const label = value ? current?.label ?? value : t(inheritLabel)

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'model-select-trigger',
          trigger === 'chip'
            ? 'flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12.5px] hover:bg-white/5'
            : 'flex h-8 w-full items-center gap-2 rounded-lg border border-line bg-input px-2.5 text-left text-[13px] hover:border-line-strong',
          open && 'bg-white/5',
          className
        )}
      >
        {value ? <ProviderLogo provider={providerOf(value)} size={13} /> : <span className="size-3 rounded-full border border-dashed border-mute" />}
        <Marquee className={cn('min-w-0', value ? 'text-ink' : 'text-dim')} delay={300} hoverTarget=".model-select-trigger">{label}</Marquee>
        <ChevronDown size={12} className="ml-auto shrink-0 text-mute" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} side={side} align={align} width={320} offset={6} unstyled focusOnOpen={false}>
        <div className="cm-in overflow-hidden rounded-xl border border-line-strong bg-raised shadow-2xl">
          <div className="flex items-center gap-1.5 border-b border-line p-2">
            <TextField
              size="sm"
              className="min-w-0 flex-1"
              prefix={<Search size={13} />}
              aria-label={t('Search models')}
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, flat.length - 1)))
                if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)))
                if (e.key === 'Enter' && flat[active]) pick(flat[active].id)
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder={t('Search models')}
            />
            <button
              onClick={async () => {
                setLoading(true)
                await actions.reloadModels(true)
                setLoading(false)
              }}
              title={t('Refresh model lists')}
              className="grid size-7 shrink-0 place-items-center rounded-md text-mute hover:bg-white/[.06] hover:text-ink"
            >
              {loading ? <Spinner size={12} /> : <RefreshCw size={12} />}
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-1" role="listbox">
            {allowInherit && !q && (
              <Row selected={!value} active={false} onPick={() => pick(null)} logo={<span className="size-3.5 rounded-full border border-dashed border-mute" />} label={t(inheritLabel)} hint={t("Use the pipeline's model")} />
            )}
            {rows.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-mute">{t('No models match')}</div>}
            {rows.map((g) => (
              <div key={g.id}>
                <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10.5px] font-semibold text-mute">
                  <ProviderLogo provider={g.id} size={11} /> {g.label}
                  <span className="ml-auto font-normal normal-case tracking-normal">{g.items.length}</span>
                </div>
                {g.items.map((m) => (
                  <Row
                    key={m.id}
                    selected={m.id === value}
                    active={flat[active]?.id === m.id}
                    onPick={() => pick(m.id)}
                    onHover={() => setActive(flat.findIndex((x) => x.id === m.id))}
                    logo={<ProviderLogo provider={m.provider} size={14} />}
                    label={m.label}
                    hint={m.description}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </Popover>
    </>
  )
}

function Row({
  selected, active, onPick, onHover, logo, label, hint
}: { selected: boolean; active: boolean; onPick: () => void; onHover?: () => void; logo: React.ReactNode; label: string; hint?: string }) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn('model-opt-row flex h-9 cursor-default items-center gap-2.5 rounded-md px-2', active ? 'bg-white/[.06]' : 'hover:bg-white/[.04]')}
    >
      <span className="grid w-4 shrink-0 place-items-center">{logo}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <Marquee className="text-[12.5px] text-ink" delay={300} hoverTarget=".model-opt-row">{label}</Marquee>
        {hint && <Marquee className="text-[11px] text-mute" delay={300} hoverTarget=".model-opt-row">{hint}</Marquee>}
      </span>
      {selected && <Check size={13} className="shrink-0 text-ink" />}
    </div>
  )
}
