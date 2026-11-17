# code-maxxer 2

Desktop orchestrator for coding agents. One agent runs your request directly, or executes a
**pipeline** (plan → build → QA → review…) node by node, looping back when QA fails. Problems found
along the way go to the workspace **brain**, which the agent queries through tools instead of
carrying it in context.

Electron + electron-vite + React 19 · Tailwind 4 · affectUI components · Postgres · Claude Code CLI.

## Run

```bash
npm install
npm run db:up      # Postgres in Docker on 127.0.0.1:5477 (separate from other projects)
npm run dev
```

Requires the `claude` CLI logged in; `codex` is optional (usage only).

## Layout

- `src/main` – Electron main: DB, orchestrator (spawns Claude Code with stream-json), file watcher, usage
- `src/main/mcp/cm2-mcp.ts` – stdio MCP server: `pipeline_step`, `brain_record/search/read/resolve`
- `src/renderer` – UI: projects & workspaces, chat, pipeline relay, live file tree, issues/pipelines/agents pages
- `src/renderer/src/components/affect` – vendored affectUI (MIT) components
