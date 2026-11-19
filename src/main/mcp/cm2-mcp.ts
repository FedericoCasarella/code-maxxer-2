/**
 * cm2 MCP server (stdio, JSON-RPC 2.0). Spawned by Claude Code via --mcp-config.
 * Exposes the pipeline protocol and the workspace brain as tools, so the orchestrator
 * queries memory on demand instead of carrying it in context.
 */
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import pg from 'pg'
import type { Pipeline, PipelineRunState } from '@shared/types'
import { searchTurns, turnDetail, turnsOf } from '@shared/turns'
import { applyStep, newRunState } from '../engine/pipelines'
import { join } from 'node:path'
import { attach, chatSkills, fetchSkill, skillRow, slugify, storeSkill } from '../engine/skillstore'

const WS = process.env.CM2_WORKSPACE_ID ?? ''
const RUN = process.env.CM2_RUN_ID ?? ''
const pipeline: Pipeline | null = process.env.CM2_PIPELINE ? JSON.parse(process.env.CM2_PIPELINE) : null
const pool = new pg.Pool({ connectionString: process.env.CM2_DATABASE_URL, max: 2 })
// A later segment of a team run continues from the saved state; only its own nodes belong to this agent.
let state: PipelineRunState | null = process.env.CM2_RUN_STATE
  ? JSON.parse(process.env.CM2_RUN_STATE)
  : pipeline
    ? newRunState(pipeline, RUN)
    : null
const SEGMENT: string[] = process.env.CM2_SEGMENT ? JSON.parse(process.env.CM2_SEGMENT) : []

// Built-in browser (visible to the user in the right drawer). Use it to check UI changes on the dev server.
const BROWSER_TOOLS = [
  { name: 'browser_navigate', description: 'Open a URL in the built-in browser the user watches (e.g. the dev server http://localhost:5173).', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'browser_read', description: 'Read the current page: title, URL, numbered interactive elements with coordinates, visible text.', inputSchema: { type: 'object', properties: {} } },
  { name: 'browser_click', description: 'Click an element by index (from browser_read), CSS selector, or x/y.', inputSchema: { type: 'object', properties: { index: { type: 'number' }, selector: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } } } },
  { name: 'browser_type', description: 'Type text, optionally into an element first (index/selector), clear it, and submit with Enter.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, index: { type: 'number' }, selector: { type: 'string' }, clear: { type: 'boolean' }, submit: { type: 'boolean' } }, required: ['text'] } },
  { name: 'browser_key', description: 'Press a key (Enter, Escape, Tab, ArrowDown…).', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'browser_scroll', description: 'Scroll the page by dy pixels (negative = up).', inputSchema: { type: 'object', properties: { dy: { type: 'number' } } } },
  { name: 'browser_viewport', description: 'Set the browser viewport to test a layout: mobile (390×844), tablet (820×1180), mac (1440×900), desktop (fullscreen 1920×1080), ultrawide (3440×1440), or width/height. "panel" goes back to the panel size. The panel shows large viewports zoomed out; screenshots are at the real layout.', inputSchema: { type: 'object', properties: { preset: { type: 'string', enum: ['mobile', 'tablet', 'mac', 'desktop', 'ultrawide', 'panel'] }, width: { type: 'number' }, height: { type: 'number' } } } },
  { name: 'browser_screenshot', description: 'Screenshot of the page (you get the image; the user sees it briefly in the chat). Use it to verify what you changed.', inputSchema: { type: 'object', properties: { caption: { type: 'string', description: 'What this shows' } } } }
]

/** Another project in the same code-maxxer workspace, by id or name. */
async function otherProject(q: string): Promise<{ id: string; name: string; path: string } | null> {
  const r = await pool.query(
    `select p.id, p.name, p.path from projects p, workspaces w join projects me on me.id=w.project_id
      where w.id=$1 and p.id <> me.id and p.space_id is not distinct from me.space_id and (p.id=$2 or lower(p.name)=lower($2))`,
    [WS, q.trim()]
  )
  return r.rows[0] ?? null
}

/** App features behind the bridge: security scans and the project's servers. */
async function app(action: string, args: unknown): Promise<string> {
  const url = process.env.CM2_BRIDGE_URL
  if (!url) return 'Not available'
  const res = await fetch(`${url}/app`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cm2-token': process.env.CM2_BRIDGE_TOKEN ?? '' },
    body: JSON.stringify({ ws: WS, action, args })
  })
  const r = await res.json()
  return r.text
}
const APP_ACTIONS = new Set(['security_status', 'security_scan', 'security_update', 'env_info', 'env_exec', 'automation_list', 'automation_save', 'automation_run', 'automation_pause', 'deploy_start', 'deploy_status'])

async function browser(action: string, args: unknown): Promise<{ text: string; image?: string; error?: boolean }> {
  const url = process.env.CM2_BRIDGE_URL
  if (!url) return { text: 'Browser not available', error: true }
  const res = await fetch(`${url}/browser`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cm2-token': process.env.CM2_BRIDGE_TOKEN ?? '' },
    body: JSON.stringify({ ws: WS, action, args })
  })
  return res.json()
}

const TOOLS = [
  ...(pipeline
    ? [
        {
          name: 'pipeline_step',
          description: 'Report entering or finishing a pipeline node. Returns the next node to run.',
          inputSchema: {
            type: 'object',
            properties: {
              node: { type: 'string', enum: pipeline.nodes.map((n) => n.id) },
              status: { type: 'string', enum: ['running', 'passed', 'failed'] },
              note: { type: 'string', description: 'One-line outcome' }
            },
            required: ['node', 'status']
          }
        }
      ]
    : []),
  ...BROWSER_TOOLS,
  {
    name: 'fork_branch',
    description:
      'Continue this conversation in a NEW git branch. Use when the user asks to do something "in a new branch". ' +
      'code-maxxer creates the branch from the current state (uncommitted changes carry over), opens a new chat that inherits ' +
      'this one and runs `prompt` there. After calling it, stop: reply with one short line, do not do the work here.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Branch name, e.g. feat/dark-mode' },
        prompt: { type: 'string', description: 'What to do in the new branch' }
      },
      required: ['name', 'prompt']
    }
  },
  {
    name: 'schedule_run',
    description:
      'Schedule a prompt to run later in this same branch chat. Use when the user asks to do something at a given time ' +
      '("tonight at 23", "tomorrow morning"). `at` is an ISO 8601 date-time WITH timezone offset. The current local time is in the reply ' +
      'of every call; if unsure, call with at omitted to read it.',
    inputSchema: {
      type: 'object',
      properties: { prompt: { type: 'string' }, at: { type: 'string', description: 'e.g. 2026-11-18T09:00:00+01:00' } },
      required: ['prompt']
    }
  },
  {
    name: 'design_read',
    description: "Read the project's design system (library, tokens with real values, showcase sections, principles). Call it before any UI work.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'ask_user',
    description:
      'Ask the user when you are blocked on a decision that is genuinely theirs (not something you can find out or choose sensibly). ' +
      '1-4 questions; each has exactly two answers: primary (your recommendation) and secondary (the realistic alternative). ' +
      'The user can also write a free reply. After calling it, STOP: their answers arrive as the next message.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'The question, one sentence' },
              detail: { type: 'string', description: 'Short context: what you found, what each answer means' },
              primary: { type: 'string', description: 'Recommended answer, 1-4 words' },
              secondary: { type: 'string', description: 'Alternative answer, 1-4 words' }
            },
            required: ['title', 'primary', 'secondary']
          }
        }
      },
      required: ['questions']
    }
  },
  {
    name: 'plan_propose',
    description:
      'Propose a plan for a big request (several steps or many files), AFTER exploring read-only. 2-10 tasks in the order you will do them, ' +
      'each small enough for one commit. The reply says whether to wait for the user or to start.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short name of the change, e.g. "Dark mode"' },
        summary: { type: 'string', description: 'One or two sentences: the approach' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Imperative, under 8 words' },
              detail: { type: 'string', description: 'What exactly to do and how to check it' },
              files: { type: 'array', items: { type: 'string' }, description: 'Files you expect to touch' }
            },
            required: ['title']
          }
        }
      },
      required: ['title', 'tasks']
    }
  },
  {
    name: 'plan_task',
    description:
      'While executing an approved plan: mark a task in_progress right before working on it, and done (or failed/skipped, with a note) ' +
      'after its checks pass and its commit is made. Returns the next task.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['in_progress', 'done', 'failed', 'skipped'] },
        note: { type: 'string', description: 'One line: outcome or why' }
      },
      required: ['id', 'status']
    }
  },
  {
    name: 'plan_read',
    description: 'Read the current plan of this branch with task ids and statuses.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'brain_record',
    description: 'Save an issue, lesson or decision into the workspace brain.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['issue', 'lesson', 'decision'] },
        title: { type: 'string' },
        body: { type: 'string' },
        node: { type: 'string' }
      },
      required: ['kind', 'title']
    }
  },
  {
    name: 'brain_search',
    description: 'Search the workspace brain. Returns short matches (id, kind, title, first line).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kind: { type: 'string', enum: ['issue', 'lesson', 'decision'] },
        open: { type: 'boolean', description: 'Only unresolved' }
      }
    }
  },
  {
    name: 'route_explain',
    description:
      'SENTIENT mode only, and FIRST, before any other tool: say how you will handle this request and why, in one short sentence in the user\'s language ' +
      '(e.g. "Small fix in one file: I do it myself, a pipeline would only add steps" or "New feature across pages: the Feature pipeline adds QA and review"). It is shown to the user.',
    inputSchema: {
      type: 'object',
      properties: { choice: { type: 'string', enum: ['direct', 'pipeline'] }, pipeline: { type: 'string', description: 'The pipeline id, when choice is pipeline' }, reason: { type: 'string' } },
      required: ['choice', 'reason']
    }
  },
  {
    name: 'history_search',
    description: "Find earlier turns of this chat by words (request, reply, files, commands). Returns the matching turns' short notes with their numbers.",
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'history_read',
    description: 'Read one earlier turn of this chat in full: the request, your reply, and the tools you ran (commands, files, errors). Use the turn number from the notes or history_search.',
    inputSchema: { type: 'object', properties: { turn: { type: 'number' } }, required: ['turn'] }
  },
  {
    name: 'automation_list',
    description: "The automations of this project (id, name, trigger, steps, where they run, enabled) and their last run.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'automation_save',
    description:
      'Create an automation (or update one with id) when the user asks for something to happen on its own: on a schedule, on push, on new commits. ' +
      'It runs steps in order in a workspace: prompt (to the agent), pipeline, shell (a command; non-zero exit fails the run), pr_comment (on the branch\'s PR; empty text = previous output). ' +
      'In prompt, shell and comment text, {{branch}}, {{commit}} and {{output}} (previous step) are filled in. ' +
      'Confirm the setup with the user in one line before saving, then tell them it shows in the Automations page.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Only to update an existing one' },
        name: { type: 'string' },
        trigger: {
          type: 'object',
          description: 'schedule: {kind:"schedule", every:"hourly|daily|weekdays|weekly", hour, minute, days?: [0-6, 0=Sunday]}; push or commit: {kind, branches: "main, release/*" or "*"}'
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            description: '{kind:"prompt", text, model?, effort?, fullAccess?} | {kind:"pipeline", pipelineId, text, model?} | {kind:"shell", command, timeoutSec?} | {kind:"pr_comment", text?}'
          }
        },
        where: { type: 'string', enum: ['this_branch', 'new_branch'], description: 'This chat\'s branch (default) or a new branch each run' },
        session: { type: 'string', enum: ['fresh', 'reuse'] },
        grace_hours: { type: 'number', description: 'Schedules: still run a missed time within this many hours. Default 12' },
        precheck: { type: 'string', description: 'Optional command; the run is skipped when it fails or prints nothing' },
        enabled: { type: 'boolean' }
      },
      required: ['name', 'trigger', 'steps']
    }
  },
  {
    name: 'automation_run',
    description: 'Run an automation now, by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'automation_pause',
    description: 'Pause (enabled false) or resume (enabled true) an automation.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['id', 'enabled'] }
  },
  {
    name: 'projects_list',
    description:
      'The other projects in the same code-maxxer workspace: name, folder and how many lessons each learned. ' +
      'Use it when the user says to look at how something was done in another project.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'project_lessons',
    description: "Another project's learned lessons, by its name or id (from projects_list). Use them as a starting point when importing.",
    inputSchema: { type: 'object', properties: { project: { type: 'string' } }, required: ['project'] }
  },
  {
    name: 'lessons_import',
    description:
      "Save lessons into THIS project's auto-learning, taken from another project the user pointed you to. Only when the user asked to learn from it. " +
      'Read the other project (its code with Read/Grep in its folder, and project_lessons) first, then save only what applies here. ' +
      'Each lesson: kind always (something to always do), never (something to stop doing) or know (a fact); title = the rule as one full sentence in the language the user writes in; ' +
      'situation = when it applies; why = what in the other project shows it. They become active at once and show in the Learning panel.',
    inputSchema: {
      type: 'object',
      properties: {
        from_project: { type: 'string', description: 'Name or id of the project learned from' },
        summary: { type: 'string', description: 'One sentence for the user: what was learned from it' },
        lessons: {
          type: 'array',
          items: {
            type: 'object',
            properties: { kind: { type: 'string', enum: ['always', 'never', 'know'] }, title: { type: 'string' }, situation: { type: 'string' }, why: { type: 'string' } },
            required: ['kind', 'title']
          }
        }
      },
      required: ['from_project', 'lessons']
    }
  },
  {
    name: 'lessons_search',
    description:
      'Search the lessons this project learned from earlier runs (approved by the user). Call it before a task with a few words about what you are about to do ' +
      '(area, file, kind of change) and follow the lessons that apply. Returns at most 10 short lines.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  },
  {
    name: 'brain_read',
    description: 'Read one brain entry in full.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'brain_resolve',
    description: 'Mark an issue as resolved.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'skill_install',
    description:
      'Install a skill from a link (GitHub folder or repo, a SKILL.md on GitHub, or a raw SKILL.md URL) and load it in this chat. ' +
      'Use it when the user asks to install or add a skill. Then read its SKILL.md and follow it.',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] }
  },
  {
    name: 'skill_list',
    description: 'Skills loaded in this chat, and the other installed skills that could be loaded with skill_load.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'skill_load',
    description: 'Load an already installed skill in this chat, by id or name.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'agent_save',
    description:
      'Save (or update, same handle) a custom agent refined in this chat, when the user asks to create or train one: its own instructions ' +
      '(how it works, its taste, its rules, what the user taught it here) and the skills it uses. The user then calls it anywhere with @handle.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name' },
        handle: { type: 'string', description: 'What follows @, lowercase with underscores, e.g. brand_designer' },
        description: { type: 'string', description: 'One line: what it is for' },
        instructions: { type: 'string', description: 'Everything it should know and do, written as standing instructions' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Skill ids or names it uses (default: all skills loaded in this chat)' }
      },
      required: ['name', 'description', 'instructions']
    }
  },
  {
    name: 'security_status',
    description: "The project's Cyber Security state: integrity of software, production and staging (0-100) and the open findings with ids, details and fixes.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'security_scan',
    description:
      'Run the Cyber Security agent (claude-red pentest skills): it audits the code and/or the production/staging servers read-only and records findings. ' +
      'Use it when the user asks to scan or check security, malware, vulnerabilities. Takes a few minutes; returns scores and open findings.',
    inputSchema: {
      type: 'object',
      properties: {
        targets: { type: 'array', items: { type: 'string', enum: ['software', 'production', 'staging'] }, description: 'Default: all' },
        focus: { type: 'string', description: "What the user wants checked, e.g. 'malware and webshells', 'auth flows'" }
      }
    }
  },
  {
    name: 'security_update',
    description: 'Change a finding: resolved (after you fixed and verified it), accepted (risk accepted by the user), false_positive, open.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['open', 'resolved', 'accepted', 'false_positive'] } }, required: ['id', 'status'] }
  },
  {
    name: 'env_info',
    description: "The project's connected servers (production, staging): host, user, app folder, health, profile.",
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'env_exec',
    description:
      'Run a shell command on the production or staging server over SSH (in the app folder). Read-only by default: commands that change the server are blocked. ' +
      'Set allow_changes only to apply a fix the user asked for; say what you will change first.',
    inputSchema: {
      type: 'object',
      properties: {
        env: { type: 'string', enum: ['production', 'staging'] },
        command: { type: 'string' },
        allow_changes: { type: 'boolean' },
        timeout_sec: { type: 'number' }
      },
      required: ['env', 'command']
    }
  },
  {
    name: 'deploy_start',
    description:
      "Run the project's built-in CI/CD (Recon > CI/CD) on staging or production, when the user asks to deploy. " +
      'The chat shows the steps live; then call deploy_status with wait true and report the outcome in one or two lines. Production only when the user named it.',
    inputSchema: { type: 'object', properties: { env: { type: 'string', enum: ['production', 'staging'] } }, required: ['env'] }
  },
  {
    name: 'deploy_status',
    description: 'Status and steps of the last deploy (or of id) on an environment. wait true waits until it ends (up to 4 minutes; call again if it is still running).',
    inputSchema: { type: 'object', properties: { env: { type: 'string', enum: ['production', 'staging'] }, id: { type: 'string' }, wait: { type: 'boolean' } }, required: ['env'] }
  },
  {
    name: 'pipeline_start',
    description:
      'Sentient mode only: hand this request to a pipeline (a team of agents with checks) instead of doing it yourself. ' +
      'It starts when your turn ends. Use it for multi-step work that benefits from QA/review loops; small things you do yourself.',
    inputSchema: {
      type: 'object',
      properties: { pipelineId: { type: 'string' }, task: { type: 'string', description: 'The task for the pipeline, complete and self-contained' } },
      required: ['pipelineId', 'task']
    }
  }
]

async function planText(planId: string): Promise<string> {
  const p = (await pool.query('select * from plans where id=$1', [planId])).rows[0]
  if (!p) return 'No plan.'
  const t = (await pool.query('select id,title,status,detail from plan_tasks where plan_id=$1 order by position', [planId])).rows
  return `Plan ${p.id} "${p.title}" [${p.status}]\n` + t.map((x, i) => `${i + 1}. ${x.id} [${x.status}] ${x.title}${x.detail ? ` — ${x.detail}` : ''}`).join('\n')
}

async function call(name: string, a: any): Promise<string> {
  switch (name) {
    case 'design_read': {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      try {
        const m = JSON.parse(await fs.readFile(path.join(process.env.CM2_WORKTREE ?? '.', '.code-maxxer/design-system.json'), 'utf8'))
        const list = (l: any[] = []) => l.map((t) => `${t.name}: ${t.value}${t.note ? ` (${t.note})` : ''}`).join('; ')
        return [
          `Library: ${m.library} (${m.framework}). Showcase: ${m.route} in ${m.page_file}. Tokens: ${m.tokens_file}.`,
          `Colors: ${list(m.colors)}`,
          `Typography: ${list(m.typography)}`,
          `Spacing: ${list(m.spacing)}`,
          `Radii: ${list(m.radii)}`,
          `Sections: ${(m.sections ?? []).map((x: any) => x.title).join(', ')}`,
          `Principles:\n${(m.principles ?? []).map((x: string) => `- ${x}`).join('\n')}`
        ].join('\n')
      } catch {
        return 'This project has no design system yet.'
      }
    }
    case 'ask_user':
      return 'Shown to the user. STOP NOW: end your turn with one short line; their answers arrive as the next message.'
    case 'plan_propose': {
      const tasks = Array.isArray(a.tasks) ? a.tasks.filter((t: any) => t?.title).slice(0, 12) : []
      if (!tasks.length) return 'A plan needs at least one task.'
      const auto = process.env.CM2_AUTOPLAN === '1'
      const id = 'pl_' + randomUUID().slice(0, 8)
      // A new plan replaces one still waiting for approval.
      await pool.query("update plans set status='cancelled' where workspace_id=$1 and status='proposed'", [WS])
      await pool.query('insert into plans(id,workspace_id,title,summary,status) values($1,$2,$3,$4,$5)', [
        id, WS, String(a.title), String(a.summary ?? ''), auto ? 'running' : 'proposed'
      ])
      for (const [i, t] of tasks.entries()) {
        await pool.query('insert into plan_tasks(id,plan_id,position,title,detail,files) values($1,$2,$3,$4,$5,$6)', [
          'pt_' + randomUUID().slice(0, 8), id, i, String(t.title), String(t.detail ?? ''), Array.isArray(t.files) ? t.files.map(String) : []
        ])
      }
      const body = await planText(id)
      return auto
        ? `plan_id: ${id}\nApproved automatically (the user runs with full access). Execute it now, task by task: plan_task in_progress, do it, check it, commit, plan_task done.\n\n${body}`
        : `plan_id: ${id}\nThe plan is shown to the user for approval. STOP NOW: reply with one short line asking them to review it. Do not start the work.\n\n${body}`
    }
    case 'plan_task': {
      const r = await pool.query(
        `update plan_tasks t set status=$2, note=coalesce($3,note),
         started_at = case when $2='in_progress' then coalesce(started_at, now()) else started_at end,
         finished_at = case when $2 in ('done','failed','skipped') then now() else null end
         from plans p where t.id=$1 and p.id=t.plan_id and p.workspace_id=$4 returning t.plan_id, p.status`,
        [a.id, a.status, a.note ?? null, WS]
      )
      const row = r.rows[0]
      if (!row) return 'Unknown task id. Call plan_read.'
      if (row.status === 'proposed') return 'This plan is not approved yet. Stop and wait for the user.'
      await pool.query(
        `update plans set status='done' where id=$1 and status='running'
         and not exists (select 1 from plan_tasks where plan_id=$1 and status in ('todo','in_progress'))`,
        [row.plan_id]
      )
      const next = (await pool.query("select id,title,detail from plan_tasks where plan_id=$1 and status='todo' order by position limit 1", [row.plan_id])).rows[0]
      if (a.status === 'in_progress') return 'OK. Work on it, then mark it done.'
      return next ? `OK. Next: ${next.id} ${next.title}${next.detail ? ` — ${next.detail}` : ''}` : 'OK. That was the last task: the plan is complete. Sum up for the user.'
    }
    case 'plan_read': {
      const p = (await pool.query("select id from plans where workspace_id=$1 and status in ('proposed','running') order by created_at desc limit 1", [WS])).rows[0]
      return p ? planText(p.id) : 'No open plan in this branch.'
    }
    case 'schedule_run': {
      const now = new Date()
      const local = `${now.toString()}`
      if (!a.at) return `Current local time: ${local}. Call again with "at".`
      const at = new Date(a.at)
      if (isNaN(at.getTime())) return `Could not read "${a.at}". Use ISO 8601 with offset. Current local time: ${local}.`
      if (at.getTime() < now.getTime() - 60_000) return `That time is in the past. Current local time: ${local}.`
      await pool.query(
        "insert into scheduled_runs(id,workspace_id,text,at,source) values($1,$2,$3,$4,'agent')",
        ['sr_' + randomUUID().slice(0, 8), WS, String(a.prompt), at.toISOString()]
      )
      return `Scheduled for ${at.toString()}. It will run in this chat with the same settings. Tell the user in one line.`
    }
    case 'fork_branch':
      return `OK: branch "${a.name}" will be created when this turn ends and the new chat will run the prompt. Stop now with one short line.`
    case 'pipeline_step': {
      if (!state) return 'No pipeline active.'
      const r = applyStep(state, a)
      state = r.state
      if (SEGMENT.length && state.status === 'running' && state.current && !SEGMENT.includes(state.current)) {
        const next = state.nodes.find((n) => n.id === state!.current)
        return `${r.reply}\n\nYOUR PART ENDS HERE: [${next?.label ?? state.current}] is played by another agent. Do not call pipeline_step for it. Stop now and write the HANDOFF for it (what you did, files, commits, open issue ids, what to watch).`
      }
      return r.reply
    }
    case 'brain_record': {
      const id = 'b_' + randomUUID().slice(0, 8)
      await pool.query(
        'insert into brain_entries(id,workspace_id,kind,title,body,node_id) values($1,$2,$3,$4,$5,$6)',
        [id, WS, a.kind, a.title, a.body ?? '', a.node ?? null]
      )
      return JSON.stringify({ id })
    }
    case 'brain_search': {
      const q = `%${(a.query ?? '').toLowerCase()}%`
      const r = await pool.query(
        `select id, kind, title, resolved, split_part(body, E'\\n', 1) as head from brain_entries
         where workspace_id=$1 and (lower(title) like $2 or lower(body) like $2)
         and ($3::text is null or kind=$3) and ($4::boolean is not true or status in ('open','in_progress'))
         order by created_at desc limit 12`,
        [WS, q, a.kind ?? null, a.open ?? null]
      )
      if (!r.rows.length) return 'No matches.'
      return r.rows.map((x) => `${x.id} [${x.kind}${x.resolved ? ', resolved' : ''}] ${x.title} — ${x.head}`).join('\n')
    }
    case 'projects_list': {
      const r = await pool.query(
        `select p.id, p.name, p.path, (select count(*) from learning_lessons l where l.project_id=p.id and l.status='active') as lessons
           from projects p, workspaces w join projects me on me.id=w.project_id
          where w.id=$1 and p.id <> me.id and p.space_id is not distinct from me.space_id order by p.name`,
        [WS]
      )
      if (!r.rows.length) return 'No other projects in this workspace.'
      return r.rows.map((x) => `- ${x.name} (${x.id}) · folder ${x.path} · ${x.lessons} lessons`).join('\n')
    }
    case 'project_lessons': {
      const p = await otherProject(String(a.project ?? ''))
      if (!p) return 'No such project in this workspace. Call projects_list.'
      const r = await pool.query(`select kind, title, situation, body from learning_lessons where project_id=$1 and status='active' order by created_at`, [p.id])
      if (!r.rows.length) return `${p.name} has no lessons yet. Its code is in ${p.path}.`
      return `${p.name} (code in ${p.path}):\n` + r.rows.map((x) => `- [${x.kind}] ${x.title}${x.situation ? ` (when ${x.situation})` : ''}${x.body ? `. Why: ${x.body}` : ''}`).join('\n')
    }
    case 'lessons_import': {
      const from = await otherProject(String(a.from_project ?? ''))
      if (!from) return 'No such project in this workspace. Call projects_list.'
      const me = (await pool.query('select project_id from workspaces where id=$1', [WS])).rows[0]?.project_id
      const list = (Array.isArray(a.lessons) ? a.lessons : []).filter((l: any) => l && typeof l.title === 'string' && l.title.trim()).slice(0, 12)
      if (!me || !list.length) return 'Nothing to import.'
      const existing = new Set((await pool.query(`select lower(title) as t from learning_lessons where project_id=$1 and status <> 'rejected'`, [me])).rows.map((x) => x.t))
      const fresh = list.filter((l: any) => !existing.has(l.title.trim().toLowerCase()))
      const cycle = randomUUID()
      await pool.query(
        `insert into learning_cycles(id, project_id, workspace_id, message_id, status, outcome, title, conclusion, fix, signals)
         values($1,$2,$3,'',$4,'success',$5,$6,$7,'{}')`,
        [cycle, me, WS, 'done', `Learned from ${from.name}`.slice(0, 120), String(a.summary ?? '').slice(0, 500), `${fresh.length === 1 ? '1 lesson' : `${fresh.length} lessons`} from ${from.name} now guide${fresh.length === 1 ? 's' : ''} this project.`]
      )
      for (const l of fresh)
        await pool.query(
          `insert into learning_lessons(id, project_id, cycle_id, title, body, kind, situation, status) values($1,$2,$3,$4,$5,$6,$7,'active')`,
          [randomUUID(), me, cycle, l.title.trim().slice(0, 160), String(l.why ?? '').slice(0, 400), ['always', 'never', 'know'].includes(l.kind) ? l.kind : 'know', String(l.situation ?? '').slice(0, 200)]
        )
      await app('learning_changed', { projectId: me }).catch(() => '')
      return `Saved ${fresh.length === 1 ? '1 lesson' : `${fresh.length} lessons`}${list.length > fresh.length ? ` (${list.length - fresh.length} were already there)` : ''}. They show in the Learning panel and guide the next runs.`
    }
    case 'route_explain':
      return 'Shown to the user. Go on.'
    case 'history_search':
    case 'history_read': {
      const msgs = (await pool.query('select body from messages where workspace_id=$1 order by seq', [WS])).rows.map((r) => r.body)
      const turns = turnsOf(msgs)
      if (name === 'history_search') return searchTurns(turns, String(a.query ?? ''))
      const t = turns.find((x) => x.n === Number(a.turn))
      return t ? turnDetail(t) : `No turn #${a.turn}: this chat has ${turns.length}.`
    }
    case 'lessons_search': {
      const words = String(a.query ?? '').toLowerCase().split(/\W+/).filter((w) => w.length > 2).slice(0, 8)
      const r = await pool.query(
        `select l.title, l.kind, l.situation, l.body, l.status, c.problem from learning_lessons l
           left join learning_cycles c on c.id=l.cycle_id
          where l.project_id=(select project_id from workspaces where id=$1) and l.status in ('active','retired')`,
        [WS]
      )
      const word: Record<string, string> = { always: 'ALWAYS: ', never: 'NEVER: ' }
      const hits = r.rows
        .map((x) => ({ x, n: words.length ? words.filter((w) => `${x.title} ${x.situation} ${x.body} ${x.problem ?? ''}`.toLowerCase().includes(w)).length : 1 }))
        .filter((y) => y.n > 0)
        .sort((p, q) => q.n - p.n)
        .slice(0, 10)
      if (!hits.length) return 'No lessons match.'
      return hits
        .map(({ x }) => `- ${word[x.kind] ?? ''}${x.title}${x.situation ? ` (when ${x.situation})` : ''}${x.body ? `. Why: ${x.body}` : ''}${x.status === 'retired' ? ' [retired: proved wrong, do not follow]' : ''}`)
        .join('\n')
    }
    case 'brain_read': {
      const r = await pool.query('select * from brain_entries where id=$1 and workspace_id=$2', [a.id, WS])
      const x = r.rows[0]
      return x ? `${x.title}\n[${x.kind}${x.resolved ? ', resolved' : ''}]\n\n${x.body}` : 'Not found.'
    }
    case 'skill_install': {
      const sk = await storeSkill(pool, await fetchSkill(String(a.url)))
      await attach(pool, WS, sk.id)
      return `Installed "${sk.name}" (${sk.id}, ${sk.files} file${sk.files === 1 ? '' : 's'}) and loaded it in this chat.\n${sk.description}\nRead ${join(sk.dir, 'SKILL.md')} now and follow it.`
    }
    case 'skill_list': {
      const here = await chatSkills(pool, WS)
      const all = (await pool.query('select * from skills order by name')).rows.map(skillRow).filter((x) => !here.some((h) => h.id === x.id))
      const line = (x: { id: string; name: string; description: string }) => `${x.id} ${x.name}: ${x.description}`
      return `Loaded here:\n${here.map(line).join('\n') || '(none)'}\n\nInstalled, not loaded:\n${all.map(line).join('\n') || '(none)'}`
    }
    case 'skill_load': {
      const r = await pool.query('select * from skills where id=$1 or slug=$2 or lower(name)=lower($1) limit 1', [String(a.id), slugify(String(a.id))])
      if (!r.rows[0]) return 'No installed skill with that id or name. Call skill_list.'
      const sk = skillRow(r.rows[0])
      await attach(pool, WS, sk.id)
      return `Loaded "${sk.name}". Read ${join(sk.dir, 'SKILL.md')}.`
    }
    case 'agent_save': {
      const handle = slugify(String(a.handle || a.name))
      const here = await chatSkills(pool, WS)
      const wanted: string[] = Array.isArray(a.skills) && a.skills.length ? a.skills.map(String) : here.map((x) => x.id)
      const ids = (await pool.query('select id from skills where id = any($1) or slug = any($2) or lower(name) = any($3)', [
        wanted, wanted.map(slugify), wanted.map((x) => x.toLowerCase())
      ])).rows.map((x) => x.id)
      const prev = (await pool.query('select id from agents where handle=$1', [handle])).rows[0]
      const id = prev?.id ?? 'ag_' + randomUUID().slice(0, 8)
      await pool.query(
        `insert into agents(id, name, role, description, instructions, built_in, handle, skills, source_workspace_id, custom, model)
         values($1,$2,'build',$3,$4,false,$5,$6,$7,true,$8)
         on conflict (id) do update set name=excluded.name, description=excluded.description, instructions=excluded.instructions, skills=excluded.skills, model=excluded.model`,
        [id, String(a.name), String(a.description), String(a.instructions), handle, ids, WS, process.env.CM2_MODEL || null]
      )
      return `Saved agent @${handle} with ${ids.length} skill${ids.length === 1 ? '' : 's'}. Tell the user they can call it in any chat by typing @${handle}, and see it in Settings → Agents.`
    }
    case 'pipeline_start': {
      if (process.env.CM2_SENTIENT !== '1') return 'Only available in Sentient mode. Do the work yourself.'
      const p = (await pool.query('select id, name from pipelines where id=$1', [String(a.pipelineId)])).rows[0]
      if (!p) return 'Unknown pipeline id.'
      return `OK: the "${p.name}" pipeline starts on this task when your turn ends. Stop now with one short line saying so.`
    }
    case 'brain_resolve': {
      await pool.query("update brain_entries set resolved=true, status='resolved' where id=$1 and workspace_id=$2", [a.id, WS])
      return 'Resolved.'
    }
  }
  throw new Error(`Unknown tool ${name}`)
}

const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + '\n')

createInterface({ input: process.stdin }).on('line', async (line) => {
  if (!line.trim()) return
  let msg: any
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  const { id, method, params } = msg
  if (id === undefined) return // notification
  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'cm2', version: '0.0.1' }
        }
      })
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } })
    } else if (method === 'tools/call' && String(params.name).startsWith('browser_')) {
      const r = await browser(String(params.name).slice(8), params.arguments ?? {})
      const content: any[] = [{ type: 'text', text: r.text }]
      if (r.image) content.push({ type: 'image', data: r.image, mimeType: 'image/png' })
      send({ jsonrpc: '2.0', id, result: { content, isError: !!r.error } })
    } else if (method === 'tools/call' && APP_ACTIONS.has(String(params.name))) {
      const a = { ...(params.arguments ?? {}), full_access: process.env.CM2_AUTOPLAN === '1' }
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: await app(String(params.name), a) }] } })
    } else if (method === 'tools/call') {
      const text = await call(params.name, params.arguments ?? {})
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} })
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  } catch (e: any) {
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true } })
  }
})
