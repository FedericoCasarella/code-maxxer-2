import { ClipboardList, Eye, FlaskConical, GitCommitHorizontal, Hammer, Search, ShieldCheck, SquareTerminal, UserCheck } from 'lucide-react'
import type { NodeRole } from '@shared/types'

export const ROLE_ICON: Record<NodeRole, typeof Hammer> = {
  plan: ClipboardList, spec: Search, build: Hammer, qa: FlaskConical, review: Eye, security: ShieldCheck, ship: GitCommitHorizontal, script: SquareTerminal, gate: UserCheck
}

export const ROLE_LABEL: Record<NodeRole, string> = {
  plan: 'Plan', spec: 'Investigate', build: 'Build', qa: 'QA', review: 'Review', security: 'Security', ship: 'Ship', script: 'Script', gate: 'Approval'
}
