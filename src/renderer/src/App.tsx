import { useEffect, useState } from 'react'
import { actions, useStore } from './lib/store'
import { Sidebar } from './components/app/Sidebar'
import { Center } from './components/app/Center'
import { FilesPanel } from './components/app/FilesPanel'
import { BottomBar } from './components/app/BottomBar'

export function App() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    void actions.init().then(() => setReady(true))
  }, [])
  const selectedWs = useStore((s) => s.selectedWs)

  if (!ready) return <div className="h-full bg-bg" />
  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col border-x border-line bg-panel">
          <Center />
        </main>
        <FilesPanel workspaceId={selectedWs} />
      </div>
      <BottomBar />
    </div>
  )
}
