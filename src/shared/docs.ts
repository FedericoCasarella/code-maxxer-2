/** Documentation (Pro): the user manual of a project, in docs/manual/ of its repository. */
export type DocsNode = { id: string; label: string; children?: DocsNode[] }
/** A commit that changed the manual */
export type DocsRevision = { sha: string; author: string; date: string; message: string }
/** The words the exported files use, in the UI language */
export type DocsExportLabels = { lastRevision: string; notCommitted: string; history: string; date: string; author: string; change: string }
export type DocsState = { projectId: string; enabled: boolean; exists: boolean; tree: DocsNode[] }
export type DocsApi = {
  state(projectId: string): Promise<DocsState>
  setEnabled(projectId: string, on: boolean): Promise<void>
  page(projectId: string, path: string): Promise<string>
  asset(projectId: string, path: string): Promise<string | null>
  /** Writes or updates the manual now, on a branch of its own: the branch's id */
  write(projectId: string): Promise<string>
  /** The whole manual as one .md file (images in images/ next to it): the saved path, or null if cancelled */
  exportMarkdown(projectId: string, labels: DocsExportLabels): Promise<string | null>
  /** Who changed a page (or, without path, the whole manual) and when, from git: newest first */
  revisions(projectId: string, path?: string): Promise<DocsRevision[]>
  /** Saves the HTML of the whole manual as a PDF: the saved path, or null if cancelled */
  exportPdf(projectId: string, html: string): Promise<string | null>
}
