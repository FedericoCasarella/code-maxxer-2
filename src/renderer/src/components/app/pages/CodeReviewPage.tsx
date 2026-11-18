import { GitPullRequestArrow } from 'lucide-react'
import { PageHeader } from '../PageHeader'
import { ProBadge } from '../ProGate'
import { EmptyState } from '../../affect/empty-state'

/** Code Review (Pro): coming soon. */
export function CodeReviewPage({ leftCollapsed, onExpandLeft }: { leftCollapsed: boolean; onExpandLeft: () => void }) {
  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <GitPullRequestArrow size={14} className="text-accent" />
        <span className="font-medium text-ink">Code Review</span>
        <ProBadge />
      </PageHeader>
      <div className="grid min-h-0 flex-1 place-items-center px-6">
        <EmptyState
          icon={<GitPullRequestArrow size={20} />}
          title="Coming soon"
          text="Reviews of your branches and pull requests, with comments and fixes the agent can apply. It will be part of Pro."
        />
      </div>
    </>
  )
}
