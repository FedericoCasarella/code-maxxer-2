import { ShieldHalf } from 'lucide-react'
import { PageHeader } from '../PageHeader'
import { ProBadge } from '../ProGate'
import { EmptyState } from '../../affect/empty-state'

/** Cyber Security (Pro): coming soon. */
export function SecurityPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <ShieldHalf size={14} className="text-accent" />
        <span className="font-medium text-ink">Cyber Security</span>
        <ProBadge />
      </PageHeader>
      <div className="grid min-h-0 flex-1 place-items-center px-6">
        <EmptyState
          icon={<ShieldHalf size={20} />}
          title="Coming soon"
          text="Security reviews of your code and servers, with fixes the agent can apply. It will be part of Pro."
        />
      </div>
    </>
  )
}
