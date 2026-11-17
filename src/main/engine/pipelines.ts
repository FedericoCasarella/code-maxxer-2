import type { Agent, NodeRole, Pipeline, PipelineRunState } from '@shared/types'

export const DEFAULT_AGENTS: Agent[] = [
  { id: 'planner', name: 'Planner', role: 'plan', builtIn: true, description: 'Turns a request into a short plan and acceptance criteria.', instructions: 'Think in small steps. Name the files you will touch and the checks that prove it works. No code yet.' },
  { id: 'investigator', name: 'Investigator', role: 'spec', builtIn: true, description: 'Finds the root cause before anyone changes code.', instructions: 'Reproduce first. Prefer a failing command or test over reasoning. Record the cause as a decision.' },
  { id: 'builder', name: 'Builder', role: 'build', builtIn: true, description: 'Writes the change with the smallest diff that works.', instructions: 'Follow the repo conventions. Fix open issues before new work. No unrelated refactors.' },
  { id: 'qa', name: 'QA', role: 'qa', builtIn: true, description: 'Proves it works with the checks the repo has.', instructions: 'Run the real checks (tests, typecheck, build). Every failure becomes an issue with repro, expected, observed.' },
  { id: 'reviewer', name: 'Reviewer', role: 'review', builtIn: true, description: 'Reads the diff like a senior engineer.', instructions: 'Look for bugs, leftovers, needless complexity. Fix trivia directly, record real problems as issues.' },
  { id: 'security', name: 'Security', role: 'security', builtIn: true, description: 'Checks the diff for security holes.', instructions: 'Injection, secrets, unsafe input, auth gaps, unsafe deps. Record each finding as an issue.' },
  { id: 'shipper', name: 'Shipper', role: 'ship', builtIn: true, description: 'Commits finished work.', instructions: 'Commit on the current branch with a clear message. Never push.' }
]

export const agentForRole = (role: NodeRole) => DEFAULT_AGENTS.find((a) => a.role === role)!.id

// Built-in pipelines. A pipeline is a plan the single orchestrator agent executes in order,
// switching role at each node and reporting through the cm2 MCP tools (pipeline_step, brain_*).
export const DEFAULT_PIPELINES: Pipeline[] = [
  {
    id: 'feature',
    name: 'Feature',
    description: 'Plan → build → QA loop → review',
    maxLoops: 4,
    nodes: [
      { id: 'plan', role: 'plan', agentId: 'planner', label: 'Plan', instructions: 'Read only what you need. Write a short numbered plan of the change and the acceptance criteria QA will check. Query brain_search first for past issues in this area.' },
      { id: 'build', role: 'build', agentId: 'builder', label: 'Build', instructions: 'Implement the plan. If open issues exist (brain_search kind=issue, open), fix exactly those first. Keep the diff minimal.' },
      { id: 'qa', role: 'qa', agentId: 'qa', label: 'QA', instructions: 'Verify every acceptance criterion: run typecheck/tests/build that exist in the repo. For each failure call brain_record(kind="issue") with repro, expected, observed. Verdict failed if any issue is open.', onFail: 'build' },
      { id: 'review', role: 'review', agentId: 'reviewer', label: 'Review', instructions: 'Review the diff (git diff) for bugs, leftovers and needless complexity. Fix small things directly; for real problems record an issue and fail.', onFail: 'build' }
    ]
  },
  {
    id: 'bugfix',
    name: 'Bugfix',
    description: 'Reproduce → fix → verify loop',
    maxLoops: 5,
    nodes: [
      { id: 'repro', role: 'spec', agentId: 'investigator', label: 'Reproduce', instructions: 'Find the root cause. Record it with brain_record(kind="decision"). Write the smallest reproduction you can (test or command).' },
      { id: 'fix', role: 'build', agentId: 'builder', label: 'Fix', instructions: 'Fix the root cause, not the symptom. Resolve the issue entries you address with brain_resolve.' },
      { id: 'verify', role: 'qa', agentId: 'qa', label: 'Verify', instructions: 'Run the reproduction and the existing checks. Record an issue for anything still failing; verdict failed if so.', onFail: 'fix' }
    ]
  },
  {
    id: 'secure-ship',
    name: 'Secure ship',
    description: 'Plan → build → QA → security → ship',
    maxLoops: 4,
    nodes: [
      { id: 'plan', role: 'plan', agentId: 'planner', label: 'Plan', instructions: 'Plan the change and acceptance criteria. Check brain_search for related decisions.' },
      { id: 'build', role: 'build', agentId: 'builder', label: 'Build', instructions: 'Implement. Fix open issues first.' },
      { id: 'qa', role: 'qa', agentId: 'qa', label: 'QA', instructions: 'Run checks, record each failure as an issue.', onFail: 'build' },
      { id: 'security', role: 'security', agentId: 'security', label: 'Security', instructions: 'Check the diff for injection, secrets, unsafe input handling, auth gaps. Record issues and fail if found.', onFail: 'build' },
      { id: 'ship', role: 'ship', agentId: 'shipper', label: 'Commit', instructions: 'Commit the work on the current branch with a clear message. Do not push.' }
    ]
  }
]

export function newRunState(p: Pipeline, runId: string): PipelineRunState {
  return {
    runId,
    pipelineId: p.id,
    name: p.name,
    nodes: p.nodes.map((n) => ({ ...n, status: 'pending', visits: 0 })),
    current: null,
    loops: 0,
    maxLoops: p.maxLoops,
    issues: [],
    status: 'running'
  }
}

/**
 * Pure transition shared by the MCP server (authority, answers the agent) and the main process
 * (mirrors the same events from the stream to animate the UI). Same input → same state.
 */
export function applyStep(
  s: PipelineRunState,
  step: { node: string; status: 'running' | 'passed' | 'failed'; note?: string }
): { state: PipelineRunState; reply: string } {
  const st: PipelineRunState = structuredClone(s)
  const idx = st.nodes.findIndex((n) => n.id === step.node)
  if (idx < 0) return { state: st, reply: `Unknown node "${step.node}". Valid: ${st.nodes.map((n) => n.id).join(', ')}` }
  const node = st.nodes[idx]
  if (step.status === 'running') {
    node.status = 'running'
    node.visits += 1
    node.note = step.note
    st.current = node.id
    return { state: st, reply: `OK, you are now [${node.id}] ${node.label}. ${node.instructions}` }
  }
  node.note = step.note
  if (step.status === 'passed') {
    node.status = 'passed'
    const next = st.nodes[idx + 1]
    if (!next) {
      st.current = null
      st.status = 'completed'
      return { state: st, reply: 'Pipeline completed. Write the final summary for the user.' }
    }
    st.current = next.id
    return { state: st, reply: `Passed. Next node: [${next.id}] ${next.label}. Call pipeline_step running for it.` }
  }
  node.status = 'failed'
  if (!node.onFail) {
    st.status = 'failed'
    st.current = null
    return { state: st, reply: 'Node failed and has no loop target. Stop and summarize what is open.' }
  }
  if (st.loops >= st.maxLoops) {
    st.status = 'failed'
    st.current = null
    return { state: st, reply: `Loop budget exhausted (${st.maxLoops}). Stop, summarize open issues for the user.` }
  }
  st.loops += 1
  const target = st.nodes.findIndex((n) => n.id === node.onFail)
  // Everything from the loop target onward is to be redone.
  for (let i = target; i < st.nodes.length; i++) if (i !== idx) st.nodes[i].status = 'pending'
  st.current = node.onFail
  return {
    state: st,
    reply: `Loop ${st.loops}/${st.maxLoops}: go back to [${node.onFail}] and fix the open issues (brain_search kind=issue). Then continue the pipeline from there.`
  }
}

/** System prompt that turns the pipeline into a plan the one agent follows without losing context. */
export function pipelinePrompt(
  p: Pipeline,
  agents: Agent[] = DEFAULT_AGENTS,
  part?: { only: string[]; startAt?: string; multi: boolean }
): string {
  const agentOf = (n: Pipeline['nodes'][number]) =>
    agents.find((a) => a.id === n.agentId) ?? agents.find((a) => a.role === n.role) ?? DEFAULT_AGENTS.find((a) => a.role === n.role)
  const steps = p.nodes
    .map((n, i) => {
      const a = agentOf(n)
      return `${i + 1}. [${n.id}] ${n.label} — play ${a?.name ?? n.role}${n.onFail ? ` — on failure loop back to [${n.onFail}]` : ''}\n   ${a ? `As ${a.name}: ${a.instructions}\n   ` : ''}Task: ${n.instructions}`
    })
    .join('\n')
  return `You are the code-maxxer orchestrator running the "${p.name}" pipeline. You are ONE agent playing each node in order, keeping full context across nodes.

PIPELINE
${steps}

PROTOCOL (mandatory)
- Before starting a node call mcp__cm2__pipeline_step {node, status:"running"}.
- When a node ends call mcp__cm2__pipeline_step {node, status:"passed"|"failed", note}. The tool answers with the next node to run — follow it exactly.
- Every problem found (failed check, bug, broken criterion) → mcp__cm2__brain_record {kind:"issue", title, body, node}. Resolve fixed ones with mcp__cm2__brain_resolve {id}.
- Before re-learning something, query mcp__cm2__brain_search {query}. Never dump large files into context: read only the ranges you need.
- Max ${p.maxLoops} loops. If the tool says the loop budget is exhausted, stop and summarize what is still open.
- For UI checks use the built-in browser tools (mcp__cm2__browser_navigate / read / click / type / screenshot): the user watches it live.
- STANDING INSTRUCTION FROM THE USER (this counts as the user explicitly asking you to commit): when a node changes code and its checks pass, commit it: git add -A && git commit -m "<type>: <what changed>" (never push, never amend).
- Finish with a short summary for the user: what changed, what was verified, which commits you made, what is still open.${
    part?.multi
      ? `\n\nTEAM RUN: this pipeline is split across agents with different models. You play only these nodes: ${part.only.join(', ')}${part.startAt ? ` (start at [${part.startAt}])` : ''}. When the protocol tool says your part ends, stop and write a HANDOFF for the next agent: what you did, files changed, commits, open issues (ids), anything it must know. Keep it under 15 lines.`
      : ''
  }`
}
