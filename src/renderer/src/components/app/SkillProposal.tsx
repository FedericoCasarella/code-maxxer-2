import { useState } from 'react'
import { Zap } from 'lucide-react'
import { usePersisted } from '@/lib/persist'
import { t } from '@/lib/i18n'
import { timeAgoLabel } from '@/lib/utils'
import { ApprovalCard, type ApprovalState } from '../affect/approval-card'

type Proposal = { name: string; url: string; why: string; what: string }

/** A skill the agent found online for work it struggles with: installed in this chat only if the user approves. */
export function SkillProposal({ id, wsId, at, p }: { id: string; wsId: string; at: number; p: Proposal }) {
  // The choice stays with the card across reloads
  const [decided, setDecided] = usePersisted<'approved' | 'rejected' | null>(`skill-proposal.${id}`, null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state: ApprovalState = working ? 'working' : error ? 'failed' : decided ?? 'pending'
  return (
    <div className="cm-in max-w-[560px]">
      <ApprovalCard
        agent={t('Agent')}
        icon={<Zap size={12} />}
        kind={t('Skill')}
        time={timeAgoLabel(at)}
        flag={t('To approve')}
        title={t('Install the skill {name}', { name: p.name })}
        subtitle={p.why}
        detailLabel={t('What it does')}
        detail={p.what}
        context={p.url}
        state={state}
        note={error ?? (decided === 'approved' ? t('Loaded in this chat from the next message') : undefined)}
        approveLabel={t('Install')}
        onReject={() => setDecided('rejected')}
        onApprove={() => {
          setWorking(true)
          setError(null)
          window.cm
            .installSkillProposal(wsId, p.url)
            .then(() => setDecided('approved'))
            .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
            .finally(() => setWorking(false))
        }}
      />
    </div>
  )
}
