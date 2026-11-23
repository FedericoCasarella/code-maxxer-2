import { useMemo, useState } from 'react'
import { usePersisted } from '@/lib/persist'
import { CircleDot, Clock, Gauge, Hash, Plus, Radio, Search, Server, Siren, Stethoscope } from 'lucide-react'
import type { EnvDetail, Incident, IncidentStatus, Severity } from '@shared/recon'
import { cn, timeAgo, timeAgoLabel } from '@/lib/utils'
import { t } from '@/lib/i18n'
import { SegmentedControl } from '../../../affect/segmented-control'
import { Select } from '../../../affect/select'
import { TextField } from '../../../affect/text-field'
import { TextArea } from '../../../affect/text-area'
import { EmptyState } from '../../../affect/empty-state'
import { ListTable, period } from '../../../affect/list-table'
import { Spinner } from '../../../affect/spinner'
import { Btn, INC_STATUS, incLabel, Md, Modal, Pill, SEVERITY } from './ui'
import { Dialog } from '../../../affect/dialog'
import { Marquee } from '../../Marquee'

type Filter = 'open' | 'resolved' | 'all'
const isOpen = (i: Incident) => !['resolved', 'cancelled'].includes(i.status)

export function IncidentsView({ projectId, incidents, envs, open, setOpen, onChanged }: {
  projectId: string; incidents: Incident[]; envs: EnvDetail[]; open: Incident | null; setOpen: (i: Incident | null) => void; onChanged: () => void
}) {
  const [filter, setFilter] = usePersisted<Filter>('recon.incidents', 'open')
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return incidents.filter((i) => (filter === 'all' || (filter === 'open' ? isOpen(i) : !isOpen(i))) && (!s || `${i.title} ${i.details}`.toLowerCase().includes(s)))
  }, [incidents, filter, q])
  const envName = (id: string | null) => envs.find((e) => e.env.id === id)?.env.name ?? '—'

  return (
    <>
      <div className="mb-3 flex items-center gap-3">
        <SegmentedControl
          size="sm"
          value={filter}
          onChange={setFilter}
          aria-label={t('Filter')}
          options={[
            { value: 'open', label: incLabel('open', true), count: incidents.filter(isOpen).length },
            { value: 'resolved', label: t('Closed') },
            { value: 'all', label: t('All'), count: incidents.length }
          ]}
        />
        <span className="flex-1" />
<TextField size="sm" className="w-56" prefix={<Search size={13} />} clearable aria-label={t('Search…')} placeholder={t('Search…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Btn primary onClick={() => setCreating(true)}>
          {t('New incident')} <Plus size={13} />
        </Btn>
      </div>
      <ListTable<Incident>
        rows={list}
        rowKey={(i) => i.id}
        onRowClick={(i) => setOpen(i)}
        rowClassName="inc-row"
        empty={
          <div className="py-14">
            <EmptyState bare title={filter === 'open' ? t('No open incidents') : t('No incidents')} text={t('The uptime monitor files one when a site goes down; you can open your own.')} />
          </div>
        }
        columns={[
          { id: 'number', label: '#', icon: <Hash />, width: 80, filter: 'text', value: (i) => i.number, render: (i) => <span className="font-mono text-[11.5px] text-mute">{i.number}</span> },
          {
            id: 'title', label: t('Incident'), icon: <Siren />, filter: 'text', value: (i) => i.title,
            render: (i) => (
              <div className="min-w-0">
                <Marquee className="font-medium text-ink" delay={300} hoverTarget=".inc-row">{i.title}</Marquee>
                <Marquee className="text-[11.5px] text-mute" delay={300} hoverTarget=".inc-row">{i.summary || i.details || '—'}</Marquee>
              </div>
            )
          },
          {
            id: 'env', label: t('Environment'), icon: <Server />, width: 150, filter: 'options', value: (i) => envName(i.env_id),
            render: (i) => <Marquee delay={300} hoverTarget=".inc-row" className="text-dim">{envName(i.env_id)}</Marquee>
          },
          {
            id: 'severity', label: t('Severity'), icon: <Gauge />, width: 130, filter: 'options', value: (i) => i.severity, optionLabel: (v) => t(v),
            render: (i) => <Pill className={SEVERITY[i.severity]}>{t(i.severity)}</Pill>
          },
          {
            id: 'status', label: t('Status'), icon: <CircleDot />, width: 150, filter: 'options', value: (i) => i.status, optionLabel: (v) => incLabel(v as IncidentStatus),
            render: (i) => <Pill className={INC_STATUS[i.status].c}>{i.status === 'diagnosing' && <Spinner size={9} />}{incLabel(i.status)}</Pill>
          },
          { id: 'source', label: t('Source'), icon: <Radio />, width: 130, filter: 'options', value: (i) => i.source, optionLabel: (v) => t(v), render: (i) => <span className="capitalize text-mute">{t(i.source)}</span> },
          {
            id: 'opened', label: t('Opened'), icon: <Clock />, width: 130, filter: 'options', value: (i) => Date.parse(i.created_at), filterValue: (i) => period(Date.parse(i.created_at)),
            render: (i) => <span className="text-mute">{timeAgoLabel(i.created_at)}</span>
          }
        ]}
      />

      {creating && <NewIncident projectId={projectId} envs={envs} onClose={() => setCreating(false)} onCreated={(i) => { setCreating(false); onChanged(); setOpen(i) }} />}
      {open && <IncidentDetail inc={incidents.find((i) => i.id === open.id) ?? open} envName={envName(open.env_id)} onClose={() => setOpen(null)} onChanged={onChanged} />}
    </>
  )
}

function NewIncident({ projectId, envs, onClose, onCreated }: { projectId: string; envs: EnvDetail[]; onClose: () => void; onCreated: (i: Incident) => void }) {
  const [f, setF] = useState({ title: '', details: '', severity: 'medium' as Severity, env_id: envs[0]?.env.id ?? null })
  return (
    <Modal
      title={t('New incident')}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>{t('Cancel')}</Btn>
          <Btn primary disabled={!f.title.trim()} onClick={async () => onCreated(await window.cm.recon.createIncident({ project_id: projectId, ...f, title: f.title.trim() }))}>
            {t('Open incident')}
          </Btn>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <TextField className="col-span-2" label={t("What's wrong")} autoFocus placeholder={t('Checkout returns 502')} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <Select label={t('Environment')} value={f.env_id} options={envs.map((e) => ({ value: e.env.id, label: e.env.name }))} onChange={(v) => setF({ ...f, env_id: v })} />
        <Select
          label={t('Severity')}
          value={f.severity}
          options={(['low', 'medium', 'high', 'critical'] as Severity[]).map((s) => ({ value: s, label: t(s[0].toUpperCase() + s.slice(1)) }))}
          onChange={(v) => setF({ ...f, severity: v as Severity })}
        />
        <TextArea className="col-span-2" label={t('Details')} optional minRows={4} maxRows={10} placeholder={t('Since when, which page, what users see…')} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} />
      </div>
    </Modal>
  )
}

function IncidentDetail({ inc, envName, onClose, onChanged }: { inc: Incident; envName: string; onClose: () => void; onChanged: () => void }) {
  const [err, setErr] = useState<string | null>(null)
  const setStatus = async (status: IncidentStatus) => {
    await window.cm.recon.updateIncident(inc.id, { status })
    onChanged()
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      size="lg"
      title={inc.title}
      description={
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[11.5px]">#{inc.number} · {envName} · {t(inc.source)} · {timeAgo(inc.created_at) === 'now' ? t('just now') : t('{t} ago', { t: timeAgo(inc.created_at) })}</span>
          <Pill className={SEVERITY[inc.severity]}>{t(inc.severity)}</Pill>
          <Pill className={INC_STATUS[inc.status].c}>{inc.status === 'diagnosing' && <Spinner size={9} />}{incLabel(inc.status)}</Pill>
        </span>
      }
      footer={
        <>
              <Btn
                primary
                disabled={inc.status === 'diagnosing' || !inc.env_id}
                onClick={async () => {
                  setErr(null)
                  try {
                    await window.cm.recon.diagnose(inc.id)
                    onChanged()
                  } catch (e) {
                    setErr((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
                  }
                }}
              >
                <Stethoscope size={13} /> {inc.diagnosis ? t('Diagnose again') : t('Diagnose')}
              </Btn>
              <span className="flex-1" />
              {isOpen(inc) ? (
                <>
                  <Btn onClick={() => void setStatus('cancelled')}>{t('Dismiss')}</Btn>
                  <Btn className={cn('text-ok hover:bg-ok/10 hover:text-ok')} onClick={() => void setStatus('resolved')}>{t('Mark resolved')}</Btn>
                </>
              ) : (
                <Btn onClick={() => void setStatus('open')}>{t('Reopen')}</Btn>
              )}
        </>
      }
    >
      {inc.details && <p className="selectable whitespace-pre-wrap text-[12.5px] text-dim">{inc.details}</p>}
      <div className="mt-4 text-[11px] font-medium text-mute">{t('Diagnosis')}</div>
      <div className="mt-2 rounded-xl border border-line bg-panel/60 p-4">
        {inc.status === 'diagnosing' ? (
          <span className="flex items-center gap-2 text-[12.5px] text-dim"><Spinner size={12} /> {t('Reading the server…')}</span>
        ) : inc.diagnosis ? (
          <Md>{inc.diagnosis}</Md>
        ) : (
          <span className="text-[12.5px] text-mute">{t('No diagnosis yet. Recon reads logs, failed units and resources (read-only) and explains the likely cause and the fix.')}</span>
        )}
      </div>
      {err && <div className="mt-3 text-[12px] text-bad">{err}</div>}
    </Dialog>
  )
}
