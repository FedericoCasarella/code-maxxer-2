/** Design system (Pro): a showcase page in the project plus a manifest the agents read. */

/** Lives in the project, committed with it. */
export const DESIGN_MANIFEST = '.code-maxxer/design-system.json'
/** The hidden showcase route (dev only). */
export const DESIGN_ROUTE = '/__design'

export type DesignToken = { name: string; value: string; note?: string }

export type DesignManifest = {
  schema: 1
  framework: string
  library: string
  route: string
  page_file: string
  tokens_file: string
  origin: 'existing' | 'scratch'
  colors: DesignToken[]
  typography: DesignToken[]
  spacing: DesignToken[]
  radii: DesignToken[]
  /** Sections of the showcase page, each with an id anchor */
  sections: { id: string; title: string }[]
  /** Plain-language rules for the agents */
  principles: string[]
  updatedAt?: string
}

export type DesignState = {
  projectId: string
  /** Where the design system is (main checkout once merged, else its branch) */
  workspaceId: string | null
  branch: string | null
  manifest: DesignManifest | null
  /** The branch exists and its agent is working, or it has no manifest yet */
  building: boolean
  framework: string
  /** Libraries that fit the framework; `present` = already in package.json */
  libraries: { id: string; label: string; present: boolean }[]
}

export type DevServerStatus = 'off' | 'installing' | 'starting' | 'ready' | 'error'
/** Where a desktop or mobile app opens instead of the panel: its own window, the iOS Simulator, the Android emulator. */
export type DevServerApp = 'window' | 'ios' | 'android'
/** A page the dev server printed: one per app when the project starts several (site, admin…). */
export type DevServerPage = { url: string; label: string }
export type DevServerState = {
  workspaceId: string; status: DevServerStatus; url: string | null; message: string | null; log: string[]; app?: DevServerApp | null
  /** Every page it printed, the one to open first on top */
  pages?: DevServerPage[]
  /** The services a launch plan starts (Site, Admin, API…), and whether the plan is being worked out */
  services?: string[]
  detecting?: boolean
}

export type DesignApi = {
  state(projectId: string): Promise<DesignState>
  /** Create the design-system branch and its chat, and send the setup prompt there. Returns the branch's workspace id. */
  start(projectId: string, origin: 'existing' | 'scratch', library: string): Promise<string>
  /** Ask the design-system chat for a change (or a rebuild). */
  edit(projectId: string, request: string): Promise<string>
  devStart(workspaceId: string): Promise<DevServerState>
  devState(workspaceId: string): Promise<DevServerState>
}
