/** Source control (git) for a workspace's worktree. */

/** M modified · A added · D deleted · R renamed · C copied · U untracked · ! conflict */
export type ScmStatusCode = 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '!'

export type ScmChange = {
  path: string
  /** Where a rename came from */
  oldPath?: string
  status: ScmStatusCode
  add?: number
  del?: number
}

export type ScmStatus = {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: ScmChange[]
  changes: ScmChange[]
  conflicts: ScmChange[]
}

export type ScmCommit = {
  sha: string
  parents: string[]
  subject: string
  author: string
  at: number
  /** Branch / tag names pointing here, e.g. "HEAD -> main", "origin/main" */
  refs: string[]
}

export type ScmFileText = { text: string; binary: boolean; tooLarge: boolean; missing: boolean }

/** Where one side of a diff comes from: the working tree, the index, or a commit-ish. */
export type ScmRef = 'worktree' | 'index' | string

export type ScmApi = {
  status(workspaceId: string): Promise<ScmStatus>
  log(workspaceId: string, limit?: number): Promise<ScmCommit[]>
  commitFiles(workspaceId: string, sha: string): Promise<ScmChange[]>
  /** File text at a ref; missing=true when it doesn't exist there. */
  read(workspaceId: string, path: string, ref?: ScmRef): Promise<ScmFileText>
  write(workspaceId: string, path: string, text: string): Promise<void>
  stage(workspaceId: string, paths: string[] | 'all'): Promise<void>
  unstage(workspaceId: string, paths: string[] | 'all'): Promise<void>
  discard(workspaceId: string, paths: string[]): Promise<void>
  commit(workspaceId: string, message: string, opts?: { all?: boolean }): Promise<void>
  push(workspaceId: string): Promise<void>
  pull(workspaceId: string): Promise<void>
  fetch(workspaceId: string): Promise<void>
}
