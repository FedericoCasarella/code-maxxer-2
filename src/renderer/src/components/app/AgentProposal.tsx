import { useState } from 'react'
import { Check } from 'lucide-react'
import { actions, getState, useStore } from '@/lib/store'
import { t } from '@/lib/i18n'
import { SmartRecommendation } from '../affect/smart-recommendation'

type Proposal = { name: string; handle?: string; description: string; why: string; instructions: string; skills?: string[] }
// Same as the main process's slugify, so the handle matches the saved agent
const slug = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'skill'

/**
 * The chat noticed the user is training a repeatable kind of work and proposes an agent for it (or an update of the
 * @agent they corrected). One click saves it; it can then be called with @handle and used in pipelines.
 */
export function AgentProposal({ id, wsId, p, update }: { id: string; wsId: string; p: Proposal; update: boolean }) {
  const handle = slug(p.handle || p.name)
  const existing = useStore((s) => s.agents.find((a) => a.handle === handle))
  const [accepted, setAccepted] = useState(false)
  // A new agent already created (this card accepted earlier): just say so
  if (!update && existing && !accepted)
    return (
      <div className="cm-in flex items-center gap-1.5 text-[12.5px] text-dim">
        <Check size={13} className="text-ok" /> {t('Agent @{handle} created', { handle })}
      </div>
    )
  return (
    <div className="cm-in max-w-[560px]">
      <SmartRecommendation
        key={id}
        title={update ? t('Agent update proposal') : t('New agent proposal')}
        options={[{ id, label: update ? `@${handle}` : p.name, reason: p.why, signal: 3 }]}
        onAccept={() => {
          setAccepted(true)
          void window.cm.acceptAgentProposal(wsId, p).then(() => actions.reloadAgents())
        }}
        onUndo={
          update
            ? undefined
            : () => {
                setAccepted(false)
                const a = getState().agents.find((x) => x.handle === handle)
                if (a) void window.cm.deleteAgent(a.id).then(() => actions.reloadAgents())
              }
        }
      />
    </div>
  )
}
