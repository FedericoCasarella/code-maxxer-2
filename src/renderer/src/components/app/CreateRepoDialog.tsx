import { useState } from 'react'
import { Globe, Lock, Plus } from 'lucide-react'
import { actions } from '@/lib/store'
import { t } from '@/lib/i18n'
import { Dialog } from '../affect/dialog'
import { Button } from '../affect/button'
import { TextField } from '../affect/text-field'
import { TextArea } from '../affect/text-area'
import { Switch } from '../affect/switch'
import { SegmentedControl } from '../affect/segmented-control'

/**
 * The branch folder has no git repository: create it here (git init and a first commit),
 * and optionally publish it on GitHub with the user's gh login.
 */
export function CreateRepoDialog({ wsId, folder, githubUser, onClose, onCreated }: {
  wsId: string
  folder: string
  githubUser: string | null
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState(folder)
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'private' | 'public'>('private')
  const [github, setGithub] = useState(!!githubUser)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.cm.repo.create(wsId, { name: name.trim(), description, visibility, github })
      await actions.reloadProjects()
      onCreated()
      onClose()
    } catch (e: any) {
      setError(e.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') ?? t('Failed'))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Create a repository')}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button size="sm" loading={busy} disabled={!name.trim()} iconRight={<Plus size={13} />} onClick={() => void submit()}>
            {t('Create')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField
          autoFocus
          label={t('Name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          error={error ?? undefined}
        />
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13px] text-ink">{t('Publish on GitHub')}</div>
            <div className="text-[12px] text-mute">
              {githubUser ? t('As {user}, with gh', { user: githubUser }) : t('Sign in to GitHub with gh auth login first')}
            </div>
          </div>
          <Switch size="sm" checked={github} disabled={!githubUser} onChange={(e) => setGithub(e.currentTarget.checked)} aria-label={t('Publish on GitHub')} />
        </div>
        {github && (
          <>
            <SegmentedControl
              size="sm"
              aria-label={t('Visibility')}
              value={visibility}
              onChange={setVisibility}
              options={[
                { value: 'private', label: <span className="flex items-center gap-1.5">{t('Private')} <Lock size={12} /></span> },
                { value: 'public', label: <span className="flex items-center gap-1.5">{t('Public')} <Globe size={12} /></span> }
              ]}
            />
            <TextArea label={t('Description')} optional minRows={2} maxRows={5} value={description} onChange={(e) => setDescription(e.target.value)} />
          </>
        )}
      </div>
    </Dialog>
  )
}
