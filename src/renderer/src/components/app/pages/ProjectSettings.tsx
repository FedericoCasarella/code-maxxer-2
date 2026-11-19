import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ExternalLink, ImageUp, Play, RotateCcw, Square, TriangleAlert, Unlink } from 'lucide-react'
import type { ProjectSettings as Settings } from '@shared/project'
import type { DevServerState } from '@shared/design'
import { actions, getState, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { Switch } from '../../affect/switch'
import { Spinner } from '../../affect/spinner'
import { Button } from '../../affect/button'
import { TextField } from '../../affect/text-field'
import { TextArea } from '../../affect/text-area'
import { Card, CardFooter, CardHeader } from '../../affect/card'
import { ProjectAvatar, RemoveProjectDialog } from '../Sidebar'
import { Group, Row } from './SettingsPage'

const COLORS = ['#737373', '#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#8b5cf6', '#ec4899', '#3b82f6']
const ENV_HINT = 'Runs with zsh in the branch folder. Has $CM_PROJECT_PATH, $CM_WORKTREE_PATH, $CM_BRANCH, $CM_PROJECT_NAME.'

/** Settings → a project: identity, preview, worktree hooks, formatter, danger zone. */
export function ProjectSettings({ id }: { id: string }) {
  const p = useStore((s) => s.projects.find((x) => x.id === id))
  const workspaces = useStore((s) => s.workspaces)
  const [st, setSt] = useState<Settings | null>(null)
  const [name, setName] = useState(p?.name ?? '')
  const [iconError, setIconError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setSt(null)
    void window.cm.project.settings(id).then(setSt)
  }, [id])
  useEffect(() => setName(p?.name ?? ''), [p?.name])

  if (!p) return <div className="py-10 text-center text-[12.5px] text-mute">{t('This project is gone.')}</div>
  if (!st) return <div className="flex justify-center py-10"><Spinner size={14} /></div>

  // Optimistic: the page shows the change at once, the saved copy replaces it.
  const save = (patch: { [K in keyof Settings]?: Partial<Settings[K]> }) => {
    const next: Settings = {
      preview: { ...st.preview, ...patch.preview },
      hooks: { ...st.hooks, ...patch.hooks },
      formatter: { ...st.formatter, ...patch.formatter }
    }
    setSt(next)
    void window.cm.project.save(id, next).then(setSt)
  }
  const main = workspaces.find((w) => w.projectId === id && w.worktreePath === p.path)

  const upload = (f: File | undefined) => {
    setIconError(null)
    if (!f) return
    if (f.type !== 'image/png') return setIconError(t('Pick a PNG.'))
    if (f.size > 256 * 1024) return setIconError(t('The PNG must be 256 KB or smaller.'))
    const r = new FileReader()
    r.onload = () => void actions.updateProject(id, { avatarUrl: String(r.result) })
    r.readAsDataURL(f)
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-[18px] font-semibold text-ink">{p.name}</h1>
        <p className="mt-0.5 font-mono text-[12px] text-mute">{p.path}</p>
      </div>

      <Group title={t('Identity')} hint={t('How the project shows in the sidebar and pickers.')}>
        <Row label={t('Name')}>
          <TextField
            size="sm"
            className="w-[300px]"
            aria-label={t('Name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== p.name && void actions.renameProject(id, name.trim())}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </Row>
        <Row label={t('Color')} hint={t('Shown when the project has no icon.')}>
          <div className="flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                aria-label={c}
                aria-pressed={p.color === c}
                onClick={() => void actions.updateProject(id, { color: c })}
                className={cn('size-6 rounded-md ring-offset-2 ring-offset-[var(--color-panel)] transition-shadow', p.color === c ? 'ring-2 ring-white/70' : 'hover:ring-1 hover:ring-white/30')}
                style={{ background: c }}
              />
            ))}
          </div>
        </Row>
        <Row label={t('Icon')} hint={iconError ? <span className="text-bad">{iconError}</span> : p.owner ? t('The GitHub avatar by default. A PNG up to 256 KB replaces it.') : t('A PNG up to 256 KB.')}>
          <div className="flex items-center gap-2">
            <ProjectAvatar p={p} className="size-8 rounded-lg text-[13px]" />
            <input ref={file} type="file" accept="image/png" className="hidden" onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ''))} />
            <Button size="sm" variant="secondary" iconRight={<ImageUp size={13} />} onClick={() => file.current?.click()}>
              {t('Upload PNG')}
            </Button>
            <Button size="sm" variant="ghost" iconRight={<RotateCcw size={13} />} onClick={() => (setIconError(null), void actions.updateProject(id, { avatarUrl: 'github' }))}>
              {t('Reset')}
            </Button>
          </div>
        </Row>
      </Group>

      <Group title={t('Preview')} hint={t('The dev server the browser panel opens. Start it from the browser panel or here.')}>
        <Row label={t('Command')} hint={t('Empty: npm run dev, or start, from package.json.')}>
          <Draft className="w-[300px]" mono value={st.preview.command} placeholder="npm run dev" onSave={(command) => save({ preview: { command } })} />
        </Row>
        <Row label="URL" hint={t('Empty: the first localhost address the command prints.')}>
          <Draft className="w-[300px]" mono value={st.preview.url} placeholder="localhost:5173" onSave={(url) => save({ preview: { url } })} />
        </Row>
        <Row label={t('Install dependencies')} hint={t('Runs npm install first when node_modules is missing.')}>
          <Switch size="sm" checked={st.preview.install} onChange={(e) => save({ preview: { install: e.currentTarget.checked } })} aria-label={t('Install dependencies')} />
        </Row>
        {main && <PreviewRow wsId={main.id} />}
      </Group>

      <Group title={t('Worktree hooks')} hint={t('Scripts for the branches code-maxxer creates. Saved on this Mac.')}>
        <Script
          label="Setup script"
          hint="Runs after a new branch is created: install deps, copy env files, run migrations."
          value={st.hooks.setup}
          placeholder="npm install"
          onSave={(setup) => save({ hooks: { setup } })}
        />
        <Row label={t('Wait for setup')} hint={t('The agent starts after the setup script finishes.')}>
          <Switch size="sm" checked={st.hooks.wait} onChange={(e) => save({ hooks: { wait: e.currentTarget.checked } })} aria-label={t('Wait for setup')} />
        </Row>
        <Script
          label="Archive script"
          hint="Runs before a branch's worktree is removed."
          value={st.hooks.archive}
          placeholder={'echo "Cleaning up $CM_BRANCH"'}
          onSave={(archive) => save({ hooks: { archive } })}
        />
      </Group>

      <Group title={t('Formatter')} hint={t('After each agent turn, runs on the files it changed.')}>
        <Script
          label="Command"
          hint="Reads the file on stdin and prints the formatted text. ${file} is its path, ${relativeFile} the path from the branch root. Empty: off."
          value={st.formatter.command}
          placeholder={'npx --no-install prettier --stdin-filepath "${file}"'}
          rows={1}
          onSave={(command) => save({ formatter: { command } })}
        />
        <Script
          label="Files"
          hint="One glob per line, from the branch root."
          value={st.formatter.globs}
          rows={2}
          onSave={(globs) => save({ formatter: { globs } })}
        />
      </Group>

      <section className="mb-7">
        <h2 className="mb-2 text-[14px] font-semibold text-bad">{t('Danger zone')}</h2>
        <Card
          className="danger-card"
          style={{ '--ui-crd-tray': 'color-mix(in srgb, var(--color-bad) 10%, transparent)', '--ui-crd-shadow': '0 0 0 1px color-mix(in srgb, var(--color-bad) 28%, transparent)', padding: 8 } as CSSProperties}
        >
          <CardHeader
            icon={<TriangleAlert size={16} className="text-bad" />}
            title={t('Remove from workspace')}
            description={t('code-maxxer forgets the project, its chats and brain. The repository, its worktrees and branches stay on disk: you can add it again later.')}
          />
          <CardFooter style={{ justifyContent: 'flex-end', padding: '8px 0 0' }}>
            <Button size="sm" variant="destructive" iconRight={<Unlink size={13} />} onClick={() => setRemoving(true)}>
              {t('Remove')}
            </Button>
          </CardFooter>
        </Card>
      </section>

      {removing && (
        <RemoveProjectDialog
          project={p}
          mode="forget"
          worktrees={0}
          onClose={() => {
            setRemoving(false)
            if (!getState().projects.some((x) => x.id === id)) actions.setView('chat')
          }}
        />
      )}
    </>
  )
}

/** A text field that saves when it loses focus (or on Enter). */
function Draft({ value, placeholder, onSave, className, mono }: { value: string; placeholder?: string; onSave: (v: string) => void; className?: string; mono?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <TextField
      size="sm"
      className={className}
      inputClassName={mono ? 'font-mono' : undefined}
      value={v}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

/** A script or multi-line value under its label, saved when it loses focus. */
function Script({ label, hint, value, placeholder, onSave, rows = 3 }: { label: string; hint: string; value: string; placeholder?: string; onSave: (v: string) => void; rows?: number }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div className="px-4 py-3">
      <div className="text-[13px] text-ink">{t(label)}</div>
      <div className="mb-2 mt-0.5 text-[12px] text-mute">{t(hint)}</div>
      <TextArea
        aria-label={t(label)}
        minRows={rows}
        maxRows={12}
        inputClassName="font-mono text-[12px]"
        value={v}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onSave(v)}
        hint={rows > 1 && label !== 'Files' ? t(ENV_HINT) : undefined}
      />
    </div>
  )
}

/** Start / stop the main branch's preview from the settings. */
function PreviewRow({ wsId }: { wsId: string }) {
  const [dev, setDev] = useState<DevServerState | null>(null)
  useEffect(() => {
    void window.cm.preview.state(wsId).then(setDev)
    return window.cm.onEvent((e) => e.type === 'devserver' && e.state.workspaceId === wsId && setDev(e.state))
  }, [wsId])
  const on = dev && ['installing', 'starting', 'ready'].includes(dev.status)
  const hint =
    dev?.status === 'ready' ? (
      <button className="inline-flex items-center gap-1 font-mono text-ok hover:underline" onClick={() => window.open(dev.url!, '_blank')}>
        {dev.url} <ExternalLink size={11} />
      </button>
    ) : dev?.status === 'installing' ? <span className="inline-flex items-center gap-1.5"><Spinner size={11} /> {t('Installing dependencies…')}</span>
    : dev?.status === 'starting' ? <span className="inline-flex items-center gap-1.5"><Spinner size={11} /> {t('Starting…')}</span>
    : dev?.status === 'error' ? <span className="text-bad">{dev.message}</span>
    : t('Off')
  return (
    <Row label={t('Preview')} hint={hint}>
      <Button
        size="sm"
        variant={on ? 'secondary' : 'primary'}
        iconRight={on ? <Square size={12} /> : <Play size={13} />}
        onClick={() => void (on ? window.cm.preview.stop(wsId) : window.cm.preview.start(wsId))}
      >
        {on ? t('Stop') : t('Start')}
      </Button>
    </Row>
  )
}
