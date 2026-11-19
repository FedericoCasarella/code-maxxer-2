import type { Agent, Pipeline, PipelineNode } from '@shared/types'
import { claudeText } from '../recon/scan'

/*
 * "AI Support" in the pipeline editor: the user asks in words ("add a node that…", "redesign this to…"),
 * a small model answers with a short reply and, when something should change, the whole new pipeline.
 * Nothing is saved here: the editor shows the result as unsaved changes.
 */

const MODEL = 'claude-haiku-5-5'
export type AssistTurn = { role: 'user' | 'assistant'; text: string }

const SYSTEM = `You edit a code-maxxer pipeline: a chain of AI agents that run one after another on a coding task (plan, build, QA, review…).
Each node is played by one of the AGENTS below (by agentId) and has a short label and its instructions (what this node must do).
Nodes run in array order. onFail (optional) is the id of an EARLIER node to loop back to when this node's check fails (e.g. QA → Build). maxLoops caps the loops.

Answer with ONE JSON object and nothing else:
{"reply": "<one or two short sentences for the user: what you changed, or your answer>", "pipeline": <the whole new pipeline, or null when nothing changes>}
pipeline = {"name": string, "description": string, "maxLoops": number, "nodes": [{"id": string, "agentId": string, "label": string, "instructions": string, "onFail"?: string}]}

Rules:
- Keep the ids of nodes you keep; new nodes get a new short id like "n_ab12cd".
- agentId must be one of the AGENTS ids. Pick the agent whose role fits the step.
- Instructions: concrete and short (1-3 sentences), imperative, about this step only.
- Change only what was asked; keep the rest as it is.
- If the request is unclear, ask in reply and set pipeline to null.`

export async function assistPipeline(draft: Pipeline, agents: Agent[], history: AssistTurn[], message: string): Promise<{ reply: string; pipeline: Pipeline | null }> {
  const current = {
    name: draft.name,
    description: draft.description,
    maxLoops: draft.maxLoops,
    nodes: draft.nodes.map((n) => ({ id: n.id, agentId: n.agentId, label: n.label, instructions: n.instructions, ...(n.onFail ? { onFail: n.onFail } : {}) }))
  }
  const prompt =
    `AGENTS:\n${agents.map((a) => `- ${a.id} (${a.role}): ${a.name}, ${a.description}`).join('\n')}\n\n` +
    `CURRENT PIPELINE:\n${JSON.stringify(current)}\n\n` +
    (history.length ? `CONVERSATION SO FAR:\n${history.slice(-8).map((h) => `${h.role}: ${h.text}`).join('\n')}\n\n` : '') +
    `USER: ${message}`
  const r = await claudeText(SYSTEM, prompt, MODEL, 90_000)
  if (!r.ok) throw new Error(r.text || 'The model did not answer')
  const json = r.text.match(/\{[\s\S]*\}/)?.[0]
  let out: { reply?: unknown; pipeline?: any }
  try {
    out = JSON.parse(json ?? '')
  } catch {
    return { reply: r.text.trim().slice(0, 600), pipeline: null }
  }
  const reply = String(out.reply ?? '').trim()
  if (!out.pipeline || !Array.isArray(out.pipeline.nodes)) return { reply, pipeline: null }
  return { reply, pipeline: normalize(draft, agents, out.pipeline) }
}

/** Trust nothing from the model: known agents only, unique ids, loops only backwards, positions kept or laid out. */
function normalize(draft: Pipeline, agents: Agent[], p: any): Pipeline {
  const byId = new Map(agents.map((a) => [a.id, a]))
  const old = new Map(draft.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const nodes: PipelineNode[] = []
  for (const raw of p.nodes as any[]) {
    const agent = byId.get(String(raw?.agentId)) ?? agents.find((a) => a.role === raw?.role) ?? agents[0]
    if (!agent) continue
    let id = String(raw?.id ?? '').replace(/[^\w-]/g, '').slice(0, 24)
    if (!id || seen.has(id)) id = `n_${Math.random().toString(36).slice(2, 8)}`
    seen.add(id)
    const prev = old.get(id)
    nodes.push({
      ...(prev ?? {}),
      id,
      agentId: agent.id,
      role: agent.role,
      label: String(raw?.label ?? agent.name).slice(0, 60),
      instructions: String(raw?.instructions ?? '').slice(0, 2000),
      onFail: undefined
    })
  }
  // onFail must point to an earlier node
  ;(p.nodes as any[]).forEach((raw, i) => {
    const n = nodes[i]
    const to = raw?.onFail ? String(raw.onFail) : ''
    if (n && to && nodes.slice(0, i).some((x) => x.id === to)) n.onFail = to
  })
  // Same chain: positions stay. Nodes added, removed or moved: the chain is laid out again in a row.
  const sameChain = nodes.map((n) => n.id).join() === draft.nodes.map((n) => n.id).join()
  if (!sameChain) nodes.forEach((n, i) => ((n.x = 40 + i * 290), (n.y = 80)))
  return {
    ...draft,
    name: typeof p.name === 'string' && p.name.trim() ? p.name.trim().slice(0, 80) : draft.name,
    description: typeof p.description === 'string' ? p.description.slice(0, 300) : draft.description,
    maxLoops: Number.isFinite(p.maxLoops) ? Math.max(0, Math.min(20, Math.round(p.maxLoops))) : draft.maxLoops,
    nodes
  }
}
