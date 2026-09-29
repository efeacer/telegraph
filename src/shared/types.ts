import type { WindowReport } from './buglog'

export interface Project {
  id: string
  name: string
  path: string
}

/** A way to start a session. A null command starts a plain shell. */
export interface Launcher {
  id: string
  name: string
  command: string | null
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
