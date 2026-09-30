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

/** How a program keeps the chats it has had, by which Telegraph can offer them again. */
export interface ChatRecords {
  /** Whose way of keeping chats it is. That of Claude Code is the one Telegraph can read. */
  kind: 'claude'
  /** Goes before the chat on the command line. */
  flag: string
}

/** How a program can be asked to report the limits of the plan and what a session has used. */
export interface Reports {
  /** Whose way of reporting it is. That of Claude Code is the one Telegraph knows. */
  kind: 'claude'
}

/** A chat that was had before and can be opened again. */
export interface Chat {
  id: string
  title: string
  /** When the chat last went on. */
  at: string
}

/** What answers took, in tokens. */
export interface Tokens {
  /** Read by the model for the first time. */
  input: number
  /** Written by the model. */
  output: number
  /** Read for the first time and kept, to be read again for less. */
  cacheWrite: number
  /** Read again from what was kept. */
  cacheRead: number
}

/** What the answers of a day took, in all and by the model that gave them. */
export interface DayTokens {
  /** The day by the clock on the wall, as 2026-09-30. */
  day: string
  tokens: Tokens
  models: Record<string, Tokens>
}

/** One limit of the plan: what may be used within a stretch of time. */
export interface Limit {
  /** From 0 to 100. */
  usedPercent: number
  /** When the limit starts over, if that is known. */
  resetsAt: string | null
}

/** The limits of the plan, as a session last reported them. */
export interface Limits {
  fiveHour: Limit | null
  week: Limit | null
  /** When they were reported. */
  at: string
}

/** What a session reports of itself. */
export interface SessionMeter {
  model: string | null
  /** What the session would have cost at the prices of the list. */
  costUsd: number | null
  /** How full the context of the model is, from 0 to 100. */
  contextPercent: number | null
}

/** What the agents have used. */
export interface Usage {
  limits: Limits | null
  sessions: Record<string, SessionMeter>
  /** The last seven days, the oldest first. */
  days: DayTokens[]
  /** False when sessions are not asked to report, because the user has a status line of their own. */
  reporting: boolean
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
  chats?: ChatRecords
  reports?: Reports
}

/** The models of each provider, newest first. */
export type Catalogue = Record<string, Model[]>

/** How to start a launcher. Null stands for the usual model and for a new chat. */
export interface Start {
  model: string | null
  modeId: string | null
  /** A chat that was had before, to go on with. Takes the place of the mode. */
  chatId?: string | null
  /** Whether the session is asked to report what it uses. */
  report?: boolean
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
  /** What was last chosen in each project, by the id of the project. */
  choices: Record<string, Choice>
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
  /** The ids of the launchers whose program is installed. */
  installedLaunchers(): Promise<string[]>
  /** The models of each provider. Empty when the list could not be had. */
  loadCatalogue(): Promise<Catalogue>
  saveChoice(projectId: string, choice: Choice): void
  /** The chats a launcher has had in a project, the latest first. None if it keeps none. */
  listChats(projectId: string, launcherId: string): Promise<Chat[]>
  readUsage(): Promise<Usage>
  /** Called when a session has reported, so that what was used can be read again. */
  onUsageChanged(listener: () => void): () => void
  gitStatus(projectPath: string): Promise<GitStatus | null>
  createSession(request: CreateSessionRequest): Promise<CreateSessionResult>
  /** Resolves to false when the user chose to keep the session running. */
  closeSession(sessionId: string): Promise<boolean>
  write(sessionId: string, data: string): void
  resize(sessionId: string, cols: number, rows: number): void
  openExternal(url: string): void
  /** Where a file is that was dropped or pasted. Empty for one that is nowhere, like an image on the clipboard. */
  pathOf(file: File): string
  /** Keeps a pasted image as a file. Resolves to where it is, or to null if it was not kept. */
  saveAttachment(type: string, data: ArrayBuffer): Promise<string | null>
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
