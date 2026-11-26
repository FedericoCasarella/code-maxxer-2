import { useState, type ReactElement } from 'react'
import { ArrowUpFromLine, GitBranch, GitMerge, GitPullRequestArrow, RefreshCw } from 'lucide-react'
import type { BranchInfo, Workspace } from '@shared/types'
import { ContextMenu } from '../affect/context-menu'
import { CommandMenu } from '../affect/command-menu'
import { Dialog } from '../affect/dialog'
import { toast } from '../affect/toaster'
import { t } from '@/lib/i18n'
import { Github } from './Logos'

type Action = 'merge' | 'mergeFrom' | 'push' | 'pr' | 'update' | 'github'

/** The main process sends errors as {key, vars, detail}: the sentence is translated here, git's own words follow it. */
function errorText(e: unknown): { title: string; description?: string } {
  const raw = String((e as Error)?.message ?? e)
  const json = raw.slice(raw.indexOf('{'))
  try {
    const o = JSON.parse(json) as { key: string; vars?: Record<string, string>; detail?: string }
    return { title: t(o.key, o.vars), description: o.detail || undefined }
  } catch {
    return { title: raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }
  }
}

const DONE: Record<Action, string> = {
  merge: 'Merged {name}',
  mergeFrom: 'Merged {name}',
  push: 'Pushed {name}',
  pr: 'Opened on GitHub',
  update: 'Updated from {name}',
  github: 'Opened on GitHub'
}
const BUSY: Record<Action, string> = {
  merge: 'Merging…',
  mergeFrom: 'Merging…',
  push: 'Pushing…',
  pr: 'Opening GitHub…',
  update: 'Updating…',
  github: 'Opening GitHub…'
}

function runAction(ws: Workspace, action: Action, target?: string) {
  void toast
    .promise(window.cm.branchAction(ws.id, action, target), {
      loading: t(BUSY[action]),
      success: (name: string) => t(DONE[action], { name }),
      error: (e: unknown) => errorText(e)
    })
    .catch(() => {})
}

/** Right-click on a branch in the sidebar: merge it into another branch (searched in the Command Menu) and the GitHub actions. */
export function BranchMenu({ ws, children }: { ws: Workspace; children: ReactElement }) {
  const [picking, setPicking] = useState<BranchInfo[] | null>(null)
  // into: this branch goes into the picked one; from: the picked one comes into this branch
  const [mode, setMode] = useState<'into' | 'from'>('into')

  const openPicker = async (m: 'into' | 'from') => {
    setMode(m)
    const all = await window.cm.listBranches(ws.id).catch(() => [] as BranchInfo[])
    setPicking(all.filter((b) => b.name !== ws.branch))
  }

  return (
    <>
      <ContextMenu
        title={ws.branch}
        items={[
          { label: t('Merge into…'), icon: <GitMerge size={16} />, onSelect: () => void openPicker('into') },
          { label: t('Merge a branch into this…'), icon: <GitMerge size={16} className="-scale-y-100" />, onSelect: () => void openPicker('from') },
          { label: t('Update from main'), icon: <RefreshCw size={16} />, onSelect: () => runAction(ws, 'update') },
          { label: t('Push'), icon: <ArrowUpFromLine size={16} />, divider: true, onSelect: () => runAction(ws, 'push') },
          { label: t('Open or create the PR'), icon: <GitPullRequestArrow size={16} />, onSelect: () => runAction(ws, 'pr') },
          { label: t('Open on GitHub'), icon: <Github size={16} />, onSelect: () => runAction(ws, 'github') }
        ]}
      >
        {children}
      </ContextMenu>
      <Dialog
        open={!!picking}
        onOpenChange={(o) => !o && setPicking(null)}
        title={mode === 'into' ? t('Merge {branch} into', { branch: ws.branch }) : t('Merge into {branch}', { branch: ws.branch })}
        closeButton
      >
        {picking && (
          <CommandMenu
            autoFocus
            assistant={false}
            footer={false}
            placeholder={t('Search a branch…')}
            groups={[{ id: 'branches', label: t('Branches'), commands: picking.map((b) => ({ id: b.name, label: b.name, icon: <GitBranch size={16} /> })) }]}
            onRun={(id) => {
              setPicking(null)
              runAction(ws, mode === 'into' ? 'merge' : 'mergeFrom', id)
            }}
            onClose={() => setPicking(null)}
          />
        )}
      </Dialog>
    </>
  )
}
