import { useEffect, useState } from 'react'
import { ArrowLeft, Copy, Plus, Sparkles, Trash2, Workflow, X } from 'lucide-react'
import type { Pipeline, PipelineNode } from '@shared/types'
import { actions, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { DropdownMenu } from '../../affect/dropdown-menu'
import { PageHeader } from '../PageHeader'
import { ConfirmDialog } from '../ConfirmDialog'
import { ROLE_LABEL } from './roles'
import { TextField } from '../../affect/text-field'
import { TextArea } from '../../affect/text-area'
import { NumberInput } from '../../affect/number-input'
import { Select } from '../../affect/select'
import { PipelineCanvas } from './PipelineCanvas'
import { ModelSelect } from '../ModelSelect'
import { t } from '@/lib/i18n'
import { Button } from '../../affect/button'
import { WritingAssistant, type AssistantMessage } from '../../affect/writing-assistant'

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`

/** The pipeline as a node graph, full width; the node inspector slides in only when a node is selected. */
export function PipelineEditor({
  pipelineId, onBack, onOpen, leftCollapsed, onExpandLeft
}: { pipelineId: string; onBack: () => void; onOpen: (id: string) => void; leftCollapsed: boolean; onExpandLeft: () => void }) {
  const pipelines = useStore((s) => s.pipelines)
  const agents = useStore((s) => s.agents)
  const selected = pipelineId
  const [draft, setDraft] = useState<Pipeline | null>(null)
  const [node, setNode] = useState<string | null>(null)
  const [detached, setDetached] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  // AI Support: a small model edits the draft from a request; its changes show as unsaved, like any edit.
  const [aiOpen, setAiOpen] = useState(false)
  const [aiMsgs, setAiMsgs] = useState<AssistantMessage[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [canvasRev, setCanvasRev] = useState(0)
  useEffect(() => {
    setAiMsgs([])
    setAiOpen(false)
  }, [pipelineId])
  useEffect(() => {
    if (!aiOpen) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setAiOpen(false)
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [aiOpen])
  const askAi = async (text: string) => {
    if (!draft) return
    const history = aiMsgs.filter((m) => !m.error).map((m) => ({ role: m.role, text: String(m.text) }))
    setAiMsgs((l) => [...l, { id: uid('u'), role: 'user', text }])
    setAiBusy(true)
    try {
      const r = await window.cm.assistPipeline(draft, history, text)
      if (r.pipeline) {
        setDraft(r.pipeline)
        setNode(null)
        setCanvasRev((x) => x + 1)
      }
      setAiMsgs((l) => [...l, { id: uid('a'), role: 'assistant', text: r.reply || (r.pipeline ? t('Done: check the graph and save.') : t('Nothing to change.')) }])
    } catch (e) {
      setAiMsgs((l) => [...l, { id: uid('a'), role: 'assistant', error: true, text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }])
    }
    setAiBusy(false)
  }
  const saved = pipelines.find((p) => p.id === selected) ?? null
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved)

  useEffect(() => {
    setDraft(saved ? structuredClone(saved) : null)
    setNode(null)
  }, [selected, pipelines])

  const patch = (p: Partial<Pipeline>) => setDraft((d) => (d ? { ...d, ...p } : d))
  const patchNode = (id: string, p: Partial<PipelineNode>) =>
    setDraft((d) => (d ? { ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...p } : n)) } : d))
  const removeNode = (id: string) => {
    setDraft((d) => (d ? { ...d, nodes: d.nodes.filter((n) => n.id !== id).map((n) => (n.onFail === id ? { ...n, onFail: undefined } : n)) } : d))
    setNode(null)
  }
  const addNode = (agentId: string) => {
    const a = agents.find((x) => x.id === agentId)!
    const last = draft?.nodes[draft.nodes.length - 1]
    const id = uid('n')
    setDraft((d) =>
      d
        ? {
            ...d,
            nodes: [
              ...d.nodes,
              { id, role: a.role, agentId: a.id, label: a.name, instructions: a.description, x: (last?.x ?? (d.nodes.length - 1) * 290 + 40) + 290, y: last?.y ?? 80 }
            ]
          }
        : d
    )
    setNode(id)
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    await window.cm.savePipeline(draft)
    await actions.reloadPipelines()
    setSaving(false)
  }
  const create = async (from?: Pipeline) => {
    const p: Pipeline = from
      ? { ...structuredClone(from), id: uid('p'), name: t('{name} copy', { name: from.name }), builtIn: false }
      : { id: uid('p'), name: t('New pipeline'), description: '', maxLoops: 3, nodes: [] }
    await window.cm.savePipeline(p)
    await actions.reloadPipelines()
    onOpen(p.id)
  }

  const current = draft?.nodes.find((n) => n.id === node) ?? null
  const blocked = detached.length > 0
    ? detached.length === 1 ? t('1 node is not connected to the chain') : t('{n} nodes are not connected to the chain', { n: detached.length })
    : draft?.nodes.length === 0 ? t('Add at least one node') : null

  return (
    <>
      <PageHeader leftCollapsed={leftCollapsed} onExpandLeft={onExpandLeft}>
        <button onClick={onBack} className="no-drag flex items-center gap-1 rounded-md px-1 text-dim hover:text-ink">
          {t('Pipelines')} <ArrowLeft size={13} />
        </button>
        <span className="text-mute">/</span>
        <Workflow size={14} className="text-accent" />
        <span className="font-medium text-ink">{draft?.name ?? ''}</span>
      </PageHeader>
      <div className="flex min-h-0 flex-1">
        {draft ? (
          <div className="flex min-w-0 flex-1 flex-col">
            {/* pipeline fields */}
            <div className="flex shrink-0 items-end gap-3 border-b border-line px-4 py-3">
              <TextField label={t('Name')} size="sm" className="w-56" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
              <TextField
                label={t('Description')} size="sm" className="min-w-0 flex-1" value={draft.description}
                onChange={(e) => patch({ description: e.target.value })} placeholder={t("Shown in the composer's execution menu")}
              />
              <div className="w-56">
                <div className="mb-1.5 text-[12px] font-medium text-dim">{t('Model (whole pipeline)')}</div>
                <ModelSelect
                  trigger="field"
                  side="bottom"
                  align="start"
                  allowInherit
                  inheritLabel={t("Composer's model")}
                  value={draft.model ?? null}
                  onChange={(id) => patch({ model: id ?? undefined })}
                />
              </div>
              <NumberInput
                label={t('Max loops')} size="sm" className="w-32" min={0} max={20} value={draft.maxLoops}
                onValueChange={(v) => patch({ maxLoops: v ?? 0 })}
              />
              <DropdownMenu
                width={300}
                align="end"
                title={t('Add a node played by')}
                items={agents.map((a) => ({ label: a.name, description: a.description, onSelect: () => addNode(a.id) }))}
                trigger={({ triggerProps }) => (
                  <button {...triggerProps} className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-black">
                    {t('Add node')} <Plus size={13} />
                  </button>
                )}
              />
            </div>

            <div className="flex min-h-0 flex-1">
              <div className="relative min-w-0 flex-1 bg-bg/40">
                <PipelineCanvas
                  key={canvasRev}
                  draft={draft}
                  agents={agents}
                  selected={node}
                  onSelect={setNode}
                  onChange={setDraft}
                  onDetached={setDetached}
                />
                {draft.nodes.length === 0 && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-mute">{t('Add a node to start the chain')}</div>
                )}
                {aiOpen && (
                  <div className="absolute bottom-3 left-3 z-10 flex h-[min(480px,calc(100%-24px))] w-[360px]">
                    <WritingAssistant
                      className="w-full"
                      title={t('AI Support')}
                      subtitle={t('Describe the change, it edits the graph.')}
                      messages={aiMsgs}
                      busy={aiBusy}
                      autoFocus
                      onSend={(v) => void askAi(v)}
                      onNew={aiMsgs.length ? () => setAiMsgs([]) : undefined}
                      placeholder={t('Add a node that…')}
                      empty={t('"Add a security review before Ship" or "Redesign it for a bug fix with a QA loop".')}
                      headerAction={
                        <button onClick={() => setAiOpen(false)} aria-label={t('Close')} title={t('Close')} className="ui-wa__round">
                          <X size={15} />
                        </button>
                      }
                    />
                  </div>
                )}
              </div>

              {/* inspector: hidden until a node is selected */}
              {current && (
              <div className="cm-in flex w-[300px] shrink-0 flex-col border-l border-line">
                {current ? (
                  <div className="flex-1 overflow-y-auto p-4">
                    <div className="mb-3 text-[11px] font-semibold text-mute">{t('Node')}</div>
                    <TextField label={t('Label')} size="sm" value={current.label} onChange={(e) => patchNode(current.id, { label: e.target.value })} />
                    <Select
                      className="mt-3"
                      size="sm"
                      label={t('Agent')}
                      value={current.agentId ?? null}
                      options={agents.map((a) => ({ value: a.id, label: a.name, description: `${t(ROLE_LABEL[a.role])} · ${a.description}` }))}
                      onChange={(v) => {
                        const a = agents.find((x) => x.id === v)
                        if (a) patchNode(current.id, { agentId: a.id, role: a.role })
                      }}
                    />
                    <div className="mt-3">
                      <div className="mb-1.5 text-[12px] font-medium text-dim">{t('Model for this node')}</div>
                      <ModelSelect
                        trigger="field"
                        side="bottom"
                        align="start"
                        allowInherit
                        inheritLabel={t('Pipeline model')}
                        value={current.model ?? null}
                        onChange={(id) => patchNode(current.id, { model: id ?? undefined })}
                      />
                      {current.model && current.model !== draft.model && (
                        <p className="mt-1.5 text-[11.5px] leading-snug text-mute">
                          {t('Runs as a separate agent: it gets a handoff from the previous one (summary + brain) instead of the shared session.')}
                        </p>
                      )}
                    </div>
                    <TextArea
                      className="mt-3"
                      label={t('What this node must do')}
                      minRows={5}
                      maxRows={14}
                      value={current.instructions}
                      onChange={(e) => patchNode(current.id, { instructions: e.target.value })}
                    />
                    <div className="mt-3 rounded-lg border border-line bg-panel px-3 py-2 text-[12px] text-dim">
                      {current.onFail ? (
                        <>
                          {t('On failure loops back to {node}. Select the red link and press ⌫ to remove it.').split('{node}').map((part, i) =>
                            i === 0 ? part : (
                              <span key={i}>
                                <b className="text-bad">{draft.nodes.find((n) => n.id === current.onFail)?.label}</b>
                                {part}
                              </span>
                            )
                          )}
                        </>
                      ) : (
                        t('No loop. Drag from the red handle (bottom right) to the small red dot (bottom left) of an earlier node to add one.')
                      )}
                    </div>
                    <button onClick={() => removeNode(current.id)} className="mt-4 flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-bad hover:bg-bad/10">
                      {t('Remove node')} <Trash2 size={13} />
                    </button>
                  </div>
                ) : null}
              </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
              <Button variant="secondary" size="sm" aria-pressed={aiOpen} iconRight={<Sparkles size={13} />} onClick={() => setAiOpen((o) => !o)}>
                {t('AI Support')}
              </Button>
              <Button variant="secondary" size="sm" iconRight={<Copy size={13} />} onClick={() => void create(draft)}>
                {t('Duplicate')}
              </Button>
              {!draft.builtIn && (
                <button onClick={() => setConfirmDelete(true)} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] text-bad hover:bg-bad/10">
                  {t('Delete')} <Trash2 size={13} />
                </button>
              )}
              <div className="flex-1" />
              {blocked ? <span className="text-[12px] text-warn">{blocked}</span> : dirty && <span className="text-[12px] text-warn">{t('Unsaved changes')}</span>}
              <button disabled={!dirty} onClick={() => setDraft(saved && structuredClone(saved))} className="h-8 rounded-lg px-3 text-[12.5px] text-dim hover:text-ink disabled:opacity-40">
                {t('Revert')}
              </button>
              <button disabled={!dirty || saving || !!blocked} onClick={() => void save()} className="h-8 rounded-lg bg-ink px-4 text-[12.5px] font-medium text-black disabled:opacity-40">
                {t('Save')}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid flex-1 place-items-center text-[13px] text-mute">{t('Pipeline not found')}</div>
        )}
      </div>
      {confirmDelete && draft && (
        <ConfirmDialog
          title={t('Delete pipeline "{name}"?', { name: draft.name })}
          danger
          confirmLabel={t('Delete')}
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await window.cm.deletePipeline(draft.id)
            await actions.reloadPipelines()
            onBack()
          }}
        >
          {t("Past runs keep their record; this pipeline won't be offered in the composer anymore.")}
        </ConfirmDialog>
      )}
    </>
  )
}
