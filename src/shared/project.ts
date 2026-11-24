// Per-project settings: preview (dev server), worktree hooks and formatter.

export type ProjectSettings = {
  preview: {
    /** Shell command; empty = `npm run dev` (or `start`) from package.json */
    command: string
    /** Fixed URL to open; empty = the first localhost URL the command prints */
    url: string
    /** Run `npm install` first when node_modules is missing */
    install: boolean
  }
  hooks: {
    /** Runs in a new branch's worktree right after it is created */
    setup: string
    /** The agent waits for the setup script before its first turn in that branch */
    wait: boolean
    /** Runs in a branch's worktree before code-maxxer removes it */
    archive: string
  }
  branches: {
    /** A branch whose PR got merged into the default branch (and has nothing new since) leaves the sidebar */
    hideMerged: boolean
    /** The branches a merge into counts (main, develop …); empty: the default branch */
    mergedInto: string[]
  }
  formatter: {
    /** Runs once per changed file after each agent turn; ${file} = absolute path, ${relativeFile} = path from the worktree */
    command: string
    /** One glob per line, relative to the worktree root */
    globs: string
  }
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  preview: { command: '', url: '', install: true },
  hooks: { setup: '', wait: false, archive: '' },
  branches: { hideMerged: false, mergedInto: [] },
  formatter: { command: '', globs: '**/*.{ts,tsx,js,jsx,json,css,scss,html,md,yaml,yml}' }
}

/** Variables the hook scripts and the preview command get. */
export const HOOK_ENV = ['CM_PROJECT_PATH', 'CM_WORKTREE_PATH', 'CM_BRANCH', 'CM_PROJECT_NAME'] as const

export type ProjectSettingsApi = {
  get(projectId: string): Promise<ProjectSettings>
  save(projectId: string, s: ProjectSettings): Promise<ProjectSettings>
}
