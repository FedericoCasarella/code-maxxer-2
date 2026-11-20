import { useEffect, useState } from 'react'
import { actions, getState, useStore } from '@/lib/store'
import { usePersisted } from '@/lib/persist'
import { t } from '@/lib/i18n'
import { SetupGuide } from '../affect/setup-guide'

/** First steps after install, bottom of the sidebar: each task ticks itself off when the user has done it. */
export function SetupGuideCard() {
  const [closed, setClosed] = usePersisted('setup-guide.closed', false)
  const [minimized, setMinimized] = usePersisted('setup-guide.minimized', false)
  const spaces = useStore((s) => s.spaces)
  const space = useStore((s) => s.space)
  const folders = useStore((s) => s.folders)
  const projects = useStore((s) => s.projects)
  const [learning, setLearning] = useState(false)

  // Auto learning is per project: done once any project has it on
  const ids = projects.map((p) => p.id).join()
  useEffect(() => {
    if (closed) return
    const load = () =>
      void Promise.all(projects.map((p) => window.cm.learning.state(p.id).catch(() => null))).then((l) => setLearning(l.some((x) => x?.enabled)))
    load()
    return window.cm.onEvent((e) => e.type === 'learning' && load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, closed])

  if (closed) return null
  const current = spaces.find((x) => x.id === space)
  // The first workspace is created as "Personal": a name of the user's own ticks it off
  const named = !!current && current.name !== 'Personal'

  return (
    <div className="shrink-0 px-2 pb-2">
      <SetupGuide
        className="!max-w-none"
        minimized={minimized}
        onMinimizedChange={setMinimized}
        onClose={() => setClosed(true)}
        groups={[
          {
            id: 'workspace',
            title: t('Set up your workspace'),
            tasks: [
              { id: 'name', label: t('Choose a workspace name'), done: named },
              { id: 'folder', label: t('Create a new folder'), done: folders.length > 0 },
              { id: 'project', label: t('Link your first project'), done: projects.length > 0 }
            ]
          },
          { id: 'brain', title: t('Enable the brain'), tasks: [{ id: 'learning', label: t('Enable auto learning'), done: learning }] }
        ]}
        onTask={(_, id) => {
          if (id === 'name') window.dispatchEvent(new Event('cm:rename-space'))
          else if (id === 'folder') void actions.newFolder(t('New folder'))
          else if (id === 'project') void actions.addProject()
          else if (id === 'learning') {
            const st = getState()
            const ws = st.selectedWs ?? st.workspaces.find((w) => st.projects.some((p) => p.id === w.projectId))?.id
            if (!ws) return void actions.addProject()
            void actions.selectWorkspace(ws).then(() => actions.showRight('learning'))
          }
        }}
      />
    </div>
  )
}
