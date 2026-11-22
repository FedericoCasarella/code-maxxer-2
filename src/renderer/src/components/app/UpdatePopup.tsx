import { Clock, Download, Sparkles } from 'lucide-react'
import { Button } from '../affect/button'
import { Card, CardFooter, CardHeader } from '../affect/card'
import { useStore } from '@/lib/store'
import { t } from '@/lib/i18n'

/** A newer release: corner popup with Update (download and open the .dmg) and Later (again tomorrow). */
export function UpdatePopup() {
  const u = useStore((s) => s.update)
  if (!u) return null
  const busy = u.state === 'downloading'
  return (
    <div className="cm-in cm-float fixed bottom-12 right-4 z-50 w-[300px]" role="status">
      <Card>
        <CardHeader icon={<Sparkles size={15} />} title={t('New version {v}', { v: u.version })} />
        <CardFooter className="justify-end">
          <Button variant="secondary" size="sm" iconRight={<Clock size={13} />} disabled={busy} onClick={() => void window.cm.snoozeUpdate()}>
            {t('Later')}
          </Button>
          <Button size="sm" iconRight={<Download size={13} />} loading={busy} onClick={() => void window.cm.installUpdate()}>
            {busy && u.progress ? `${u.progress}%` : t('Update')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
