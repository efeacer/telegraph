import type { WindowReport } from './buglog'

export interface Project {
  id: string
  name: string
  path: string
}

export interface Model {
  /** What the program is told to run. */
  id: string
  name: string
  /** The day the model came out, where the catalogue says so. */
  releasedAt?: string
}

/** Another way to start a launcher than with a new chat, such as continuing the last one. */
export interface Mode {
  id: string
  name: string
  /** Added to the end of the command. */
  args: string
}

/** A way to start a session. A null command starts a plain shell. */
export interface Launcher {
  id: string
  name: string
  command: string | null
  /** Goes before the model on the command line. Without it there is no model to choose. */
  modelFlag?: string
  /** The providers in the catalogue whose models the program runs. */
  providers?: string[]
  /** Models offered first, and the only ones offered without the catalogue. */
  models?: Model[]
  modes?: Mode[]
}

/** The models of each provider, newest first. */
export type Catalogue = Record<string, Model[]>

/** How to start a launcher. Null stands for the usual model and for a new chat. */
export interface Start {
  model: string | null
  modeId: string | null
}

/** What was last chosen in a project. */
export interface Choice {
  launcherId: string
  /** The model last chosen for each launcher. */
  models: Record<string, string>
}

export interface GitStatus {
  /** Null when HEAD is detached. */
  branch: string | null
  changedFiles: number
}

export interface PersistedState {
  projects: Project[]
  launchers: Launcher[]
}

export interface CreateSessionRequest {
  sessionId: string
  cwd: string
  command: string | null
  cols: number
  rows: number
}

export type CreateSessionResult = { ok: true } | { ok: false; error: string }

export type MenuCommand =
  | { type: 'launch'; launcherId: string }
  | { type: 'close-session' }
  | { type: 'next-session' }
  | { type: 'previous-session' }
  | { type: 'select-session'; index: number }
  | { type: 'clear' }
  | { type: 'add-project' }
  | { type: 'report-bug' }

export interface TelegraphApi {
  /** True when the app runs under the end-to-end tests. */
  e2e: boolean
  loadState(): Promise<PersistedState>
  addProject(): Promise<Project | null>
  removeProject(projectId: string): Promise<void>
  gitStatus(projectPath: string): Promise<GitStatus | null>
  createSession(request: CreateSessionRequest): Promise<CreateSessionResult>
  /** Resolves to false when the user chose to keep the session running. */
  closeSession(sessionId: string): Promise<boolean>
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  openExternal(url: string): void
  /** Resolves to false when the report was not saved. */
  report(report: WindowReport): Promise<boolean>
  /** Tells the main process that the page reports its own errors from here on. */
  reporting(): void
  onSessionData(listener: (sessionId: string, data: string) => void): () => void
  onSessionExit(listener: (sessionId: string, exitCode: number) => void): () => void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  /** Called when the main process has recorded a problem the user should know of. */
  onProblem(listener: (message: string) => void): () => void
}
