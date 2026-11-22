/** Documentation (Pro): the user manual of a project, in docs/manual/ of its repository. */
export type DocsNode = { id: string; label: string; children?: DocsNode[] }
export type DocsState = { projectId: string; enabled: boolean; exists: boolean; tree: DocsNode[] }
export type DocsApi = {
  state(projectId: string): Promise<DocsState>
  setEnabled(projectId: string, on: boolean): Promise<void>
  page(projectId: string, path: string): Promise<string>
  asset(projectId: string, path: string): Promise<string | null>
  /** Writes or updates the manual now, on a branch of its own: the branch's id */
  write(projectId: string): Promise<string>
}
