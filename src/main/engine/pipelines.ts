import type { Agent, AgentRole, Pipeline, PipelineRunState } from '@shared/types'

export const DEFAULT_AGENTS: Agent[] = [
  { id: 'planner', name: 'Planner', role: 'plan', builtIn: true, description: 'Turns a request into a short plan and acceptance criteria.', instructions: 'Think in small steps. Name the files you will touch and the checks that prove it works. No code yet.' },
  { id: 'investigator', name: 'Investigator', role: 'spec', builtIn: true, description: 'Finds the root cause before anyone changes code.', instructions: 'Reproduce first. Prefer a failing command or test over reasoning. Record the cause as a decision.' },
  { id: 'builder', name: 'Builder', role: 'build', builtIn: true, description: 'Writes the change with the smallest diff that works.', instructions: 'Follow the repo conventions. Fix open issues before new work. No unrelated refactors.' },
  { id: 'qa', name: 'QA', role: 'qa', builtIn: true, description: 'Proves it works with the checks the repo has.', instructions: 'Run the real checks (tests, typecheck, build). Every failure becomes an issue with repro, expected, observed.' },
  { id: 'reviewer', name: 'Reviewer', role: 'review', builtIn: true, description: 'Reads the diff like a senior engineer.', instructions: 'Look for bugs, leftovers, needless complexity. Fix trivia directly, record real problems as issues.' },
  { id: 'security', name: 'Security', role: 'security', builtIn: true, description: 'Checks the diff for security holes.', instructions: 'Injection, secrets, unsafe input, auth gaps, unsafe deps. Record each finding as an issue.' },
  { id: 'shipper', name: 'Shipper', role: 'ship', builtIn: true, description: 'Commits finished work.', instructions: 'Commit on the current branch with a clear message. Never push.' }
]

export const agentForRole = (role: AgentRole) => DEFAULT_AGENTS.find((a) => a.role === role)!.id

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
    nodes: p.nodes.map((n) => ({ ...n, status: n.skip ? 'skipped' : 'pending', visits: 0, ...(n.skip ? { note: n.skip } : {}) })),
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
    const next = st.nodes.slice(idx + 1).find((n) => n.status !== 'skipped')
    if (!next) {
      st.current = null
      st.status = 'completed'
      return { state: st, reply: 'Pipeline completed. Write the final summary for the user.' }
    }
    st.current = next.id
    if (next.role === 'gate') return { state: waitAt(st, next.id, 'approval'), reply: GATE_REPLY(next.label) }
    return { state: st, reply: `Passed. Next node: [${next.id}] ${next.label}. Call pipeline_step running for it.` }
  }
  node.status = 'failed'
  if (!node.onFail) {
    st.status = 'failed'
    st.current = null
    return { state: st, reply: 'Node failed and has no loop target. Stop and summarize what is open.' }
  }
  if (st.loops >= st.maxLoops) {
    // Out of loops: the user decides (more loops, another target, or stop), the run doesn't just fail.
    st.current = node.id
    return { state: waitAt(st, node.id, 'budget'), reply: `Loop budget exhausted (${st.maxLoops}): the user decides how to go on. Stop now: end your turn with a short summary of the open issues and what you tried. Do not call more tools.` }
  }
  st.loops += 1
  // A skipped loop target hands over to the next node that runs.
  let target = st.nodes.findIndex((n) => n.id === node.onFail)
  while (target >= 0 && target < idx && st.nodes[target].status === 'skipped') target++
  if (target < 0) target = idx
  // Everything from the loop target onward is to be redone.
  for (let i = target; i < st.nodes.length; i++) if (i !== idx && st.nodes[i].status !== 'skipped') st.nodes[i].status = 'pending'
  st.current = st.nodes[target].id
  return {
    state: st,
    reply: `Loop ${st.loops}/${st.maxLoops}: go back to [${st.current}] and fix ONLY the open blocking issues (brain_search kind=issue open=true): a targeted fix, don't redo the node from scratch or re-read what you already know. Then continue the pipeline from there.`
  }
}

const GATE_REPLY = (label: string) =>
  `Passed. Next is [${label}]: the user approves it. Stop now: end your turn with a short summary of what the user should check before approving (what changed, how it was verified, what is still open). Do not call more tools.`

function waitAt(st: PipelineRunState, node: string, kind: 'approval' | 'budget'): PipelineRunState {
  const nd = st.nodes.find((n) => n.id === node)
  if (nd && kind === 'approval') nd.status = 'waiting'
  st.status = 'waiting'
  st.current = node
  st.wait = { kind, node, at: Date.now() }
  return st
}

/** The user's decision on a waiting run: go on, send the work back to a node, or stop. Pure, like applyStep. */
export function decideWait(s: PipelineRunState, d: { decision: 'approve' | 'back' | 'stop'; target?: string }): PipelineRunState {
  let st: PipelineRunState = structuredClone(s)
  const w = st.wait
  if (st.status !== 'waiting' || !w) return st
  st.wait = undefined
  if (d.decision === 'stop') {
    st.status = 'stopped'
    st.current = null
    const nd = st.nodes.find((n) => n.id === w.node)
    if (nd?.status === 'waiting') nd.status = 'pending'
    return st
  }
  st.status = 'running'
  if (d.decision === 'approve') {
    if (w.kind === 'approval') {
      const nd = st.nodes.find((n) => n.id === w.node)!
      nd.status = 'running'
      st = applyStep(st, { node: w.node, status: 'passed', note: 'Approved' }).state
      return st
    }
    // More loops: two more, then the failed node loops back as it would have.
    st.maxLoops += 2
    return applyStep(st, { node: w.node, status: 'failed', note: st.nodes.find((n) => n.id === w.node)?.note }).state
  }
  const at = st.nodes.findIndex((n) => n.id === d.target)
  if (at < 0) return s
  for (let i = at; i < st.nodes.length; i++) if (st.nodes[i].status !== 'skipped') st.nodes[i].status = 'pending'
  st.current = st.nodes[at].id
  // Sent back by the user: the loop count starts over from here.
  st.loops = 0
  return st
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
    .filter((n) => !n.skip)
    .map((n, i) => {
      if (n.role === 'script')
        return `${i + 1}. [${n.id}] ${n.label} — SCRIPT run by code-maxxer, not by you: \`${n.command ?? ''}\`${n.onFail ? ` — on failure loop back to [${n.onFail}]` : ''}\n   Don't play it: when the node before it passes, the tool runs the command and answers with the result.`
      if (n.role === 'gate') return `${i + 1}. [${n.id}] ${n.label} — APPROVAL by the user: the tool stops the run here; you end your turn.`
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
- Every problem that blocks the work (failed check, bug, broken acceptance criterion, security hole) → mcp__cm2__brain_record {kind:"issue", title, body, node}, with where it is, how to reproduce it and the evidence. Resolve fixed ones with mcp__cm2__brain_resolve {id}. Style, naming, nice-to-haves and risks you can't prove are not blocking: fix them directly if trivial, or record them with severity:"minor" (they never fail a node or start a loop).
- A verdict is checked: "passed" is refused while issues you recorded at that node are still open (and, for a build node, when no file changed since it started), and "failed" is refused if you recorded none (the node you loop back to must know what to fix). A check you could not run is not a pass: say so in the note.
- Before re-learning something, query mcp__cm2__brain_search {query}. Never dump large files into context: read only the ranges you need.
- TOKEN BUDGET: you keep your context across nodes, so use it. Don't re-read a file you already read unless it changed since, and don't repeat output you already have. Plan and investigate until the evidence is enough, then stop searching. Review and QA look at what the change touches (git diff and its callers), not the whole repo. Notes are one line; subagent reports at most 8 short bullets. Prefer a check command's exit code and its failing lines over its full output.
- Max ${p.maxLoops} loops. If the tool says the loop budget is exhausted, stop and summarize what is still open.
- EVERY TASK IS CHECKED IN THE BROWSER: the QA node takes at least one mcp__cm2__browser_screenshot of what changed (its verdict is refused without), and the user sees those screenshots in the run.
- For UI checks use the built-in browser tools (mcp__cm2__browser_navigate / read / click / type / screenshot): the user watches it live. Check every UI change at several viewports with mcp__cm2__browser_viewport (mobile, tablet, mac, desktop fullscreen, ultrawide), a screenshot at each, then browser_viewport panel.
- STANDING INSTRUCTION FROM THE USER (this counts as the user explicitly asking you to commit): when a node changes code and its checks pass, commit it: git add -A && git commit -m "<type>: <what changed>" (never push, never amend).
- PARALLEL WORK: inside a node, split work into independent pieces when you can and run them at the same time with subagents (the Agent tool), several in ONE message: e.g. Build changes to separate files or modules, QA checks that don't depend on each other (typecheck, tests, lint, browser checks), Review of separate areas. Brief each one fully (files it owns, goal, constraints, what to report in a few lines). Two subagents never edit the same file. Subagents don't call pipeline_step, brain_* or git commit: you do, after reading their reports and checking the result. Do small or tightly coupled work yourself. While they work, don't start other work of your own in the same area: wait for their reports. Each one finishes its piece, its tests included, so you integrate ONCE at the end (one typecheck and test run over everything), and you don't redo their work: if a piece is wrong, send that subagent back with what's wrong.
- NEVER END YOUR TURN MID-NODE: your turn ends the run, so it ends only after the last node's verdict (or at a HANDOFF / approval the tool tells you about). Subagents, tests and builds you started must finish inside the turn: run checks in the foreground, wait for every subagent's report, then call pipeline_step. Never stop with "while they run" or "I'll check later".
- WAITING: never wait with a fixed sleep (sleep 8, sleep 10). Wait for the thing itself, with a short timeout: e.g. until curl answers on the dev server port, until a file exists, until the process prints its ready line.
- Finish with the summary for the user (10 lines at most), as the REPLIES rule says: Done (what changed, as they will see it), Not done (left out, failed or unverified, and why), Your turn (only an action they must take). No node names, ids, commit hashes or lists of checks.${
    part?.multi
      ? `\n\nTEAM RUN: this pipeline is split across agents with different models. You play only these nodes: ${part.only.join(', ')}${part.startAt ? ` (start at [${part.startAt}])` : ''}. When the protocol tool says your part ends, stop and write a HANDOFF for the next agent: what you did, files changed, commits, open issues (ids), anything it must know. Keep it under 15 lines.`
      : ''
  }`
}
