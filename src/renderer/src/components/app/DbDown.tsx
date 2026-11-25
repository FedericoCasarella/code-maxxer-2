import { useEffect, useState } from 'react'
import { Database } from 'lucide-react'
import { EmptyState } from '../affect/empty-state'
import { Spinner } from '../affect/spinner'
import { t } from '@/lib/i18n'

/** Whether the database answers: false while it is down (the app reloads by itself when it is back). */
export function useDbOk(): boolean {
  const [ok, setOk] = useState(true)
  useEffect(() => {
    void window.cm.dbOk?.().then(setOk).catch(() => {})
    return window.cm.onEvent((e) => e.type === 'db' && setOk(e.ok))
  }, [])
  return ok
}

/** The whole window while the database is down: what is wrong and how to fix it, instead of a blank screen. */
export function DbDown() {
  return (
    <div className="grid h-full place-items-center bg-bg px-6">
      <EmptyState
        bare
        icon={<Database size={18} />}
        title={t('The database is not reachable')}
        text={
          // Dev runs on the cm2-postgres container; the installed app on its own database
          import.meta.env.DEV
            ? t('Code-Maxxer keeps everything in its database (the cm2-postgres container in Docker). Start Docker Desktop: the app comes back by itself as soon as the database answers.')
            : t('Code-Maxxer keeps everything in its database, which stopped answering. If it does not come back in a minute, quit Code-Maxxer and open it again.')
        }
        action={
          <span className="flex items-center gap-2 text-[12px] text-mute">
            <Spinner size={12} /> {t('Waiting for the database…')}
          </span>
        }
      />
    </div>
  )
}
