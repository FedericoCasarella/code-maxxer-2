import { useCallback, useEffect, useState } from 'react'
import { LayoutDashboard, Radar, Rocket, Server, Siren } from 'lucide-react'
import type { EnvDetail, Incident, Overview, SessionLog } from '@shared/recon'
import { useStore } from '@/lib/store'
import { PageHeader } from '../../PageHeader'
import { ProBadge, ProGate } from '../../ProGate'
import { SegmentedControl } from '../../../affect/segmented-control'
import { Select } from '../../../affect/select'
import { EmptyState } from '../../../affect/empty-state'
import { demoOverview, OverviewView } from './Overview'
import { EnvironmentsView } from './Environments'
import { IncidentsView } from './Incidents'
import { CicdView } from './Cicd'

type Tab = 'overview' | 'incidents' | 'environments' | 'cicd'
type Props = { leftCollapsed: boolean; onExpandLeft: () => void }

/** Recon (Pro): production + staging servers, scanned before use, monitored, with incidents and a GitHub-free CI/CD. */
export function ReconPage(p: Props) {
  return (
    <>
      <PageHeader leftCollapsed={p.leftCollapsed} onExpandLeft={p.onExpandLeft}>
        <Radar size={14} className="text-accent" />
        <span className="font-medium text-ink">Recon</span>
        <ProBadge />
      </PageHeader>
      <ProGate
        feature="Recon"
        description="Connect production and staging, scan them before use, watch uptime, diagnose incidents and deploy with a built-in CI/CD, no GitHub needed."
        preview={
          <div className="h-full overflow-hidden px-6 pt-4">
            <div className="mb-4 h-8 w-[460px] rounded-lg bg-white/[.05]" />
            <OverviewView data={demoOverview()} days={30} />
          </div>
        }
      >
        {() => <Recon />}
      </ProGate>
    </>
  )
}

function Recon() {
  const space = useStore((s) => s.space)
  const projects = useStore((s) => s.projects).filter((x) => x.spaceId === space)
  const selectedProject = useStore((s) => s.selectedProject)
  const [pid, setPid] = useState<string | null>(projects.find((x) => x.id === selectedProject)?.id ?? projects[0]?.id ?? null)
  const [tab, setTab] = useState<Tab>('overview')
  const [days, setDays] = useState('30')
  const [envFilter, setEnvFilter] = useState('all')
  const [envs, setEnvs] = useState<EnvDetail[]>([])
  const [overview, setOverview] = useState<Overview | null>(null)
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [openInc, setOpenInc] = useState<Incident | null>(null)
  const [tick, setTick] = useState(0)
  const [sessionLogs, setSessionLogs] = useState<Record<string, SessionLog[]>>({})
  const [deployLogs, setDeployLogs] = useState<Record<string, { step: number; line: string }[]>>({})

  const load = useCallback(async () => {
    if (!pid) return
    const [e, o, i] = await Promise.all([
      window.cm.recon.envs(pid),
      window.cm.recon.overview(pid, Number(days), envFilter === 'all' ? null : envFilter),
      window.cm.recon.incidents(pid)
    ])
    setEnvs(e)
    setOverview(o)
    setIncidents(i)
    setTick((t) => t + 1)
  }, [pid, days, envFilter])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    let pending: ReturnType<typeof setTimeout> | null = null
    return window.cm.onEvent((e) => {
      if (e.type === 'recon:changed' && e.projectId === pid) {
        if (!pending) pending = setTimeout(() => ((pending = null), void load()), 250)
      } else if (e.type === 'recon:session-log') {
        setSessionLogs((m) => ({ ...m, [e.sessionId]: [...(m[e.sessionId] ?? []), e.log] }))
      } else if (e.type === 'recon:deploy-log') {
        setDeployLogs((m) => ({ ...m, [e.deployId]: [...(m[e.deployId] ?? []), { step: e.step, line: e.line }] }))
      }
    })
  }, [pid, load])

  const openCount = incidents.filter((i) => !['resolved', 'cancelled'].includes(i.status)).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-4">
        <Select
          className="w-64"
          size="sm"
          aria-label="Project"
          value={pid}
          options={projects.map((x) => ({ value: x.id, label: x.owner ? `${x.owner}/${x.name}` : x.name }))}
          onChange={(v) => setPid(v)}
        />
        <SegmentedControl
          size="sm"
          value={tab}
          onChange={setTab}
          aria-label="Section"
          options={[
            { value: 'overview', label: 'Overview', icon: <LayoutDashboard size={13} /> },
            { value: 'incidents', label: 'Incidents', icon: <Siren size={13} />, count: openCount || undefined },
            { value: 'environments', label: 'Environments', icon: <Server size={13} /> },
            { value: 'cicd', label: 'CI/CD', icon: <Rocket size={13} /> }
          ]}
        />
        <span className="flex-1" />
        {tab === 'overview' && (
          <>
            <Select
              className="w-40"
              size="sm"
              aria-label="Environment"
              value={envFilter}
              options={[{ value: 'all', label: 'All environments' }, ...envs.map((e) => ({ value: e.env.id, label: e.env.name }))]}
              onChange={setEnvFilter}
            />
            <SegmentedControl
              size="sm"
              value={days}
              onChange={setDays}
              aria-label="Range"
              options={[{ value: '7', label: '7d' }, { value: '30', label: '30d' }, { value: '90', label: '90d' }]}
            />
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        {!pid ? (
          <div className="py-20">
            <EmptyState title="No project" text="Add a project to this workspace first." />
          </div>
        ) : tab === 'overview' ? (
          overview && (
            <OverviewView
              data={overview}
              days={Number(days)}
              onOpenIncident={(i) => {
                setOpenInc(i)
                setTab('incidents')
              }}
            />
          )
        ) : tab === 'incidents' ? (
          <IncidentsView projectId={pid} incidents={incidents} envs={envs} open={openInc} setOpen={setOpenInc} onChanged={() => void load()} />
        ) : tab === 'environments' ? (
          <EnvironmentsView projectId={pid} envs={envs} liveLogs={sessionLogs} onChanged={() => void load()} />
        ) : (
          <CicdView envs={envs} tick={tick} liveLogs={deployLogs} />
        )}
      </div>
    </div>
  )
}
