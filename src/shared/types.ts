import type { WindowReport } from './buglog'
import type { Notice } from './notices'
import type { ThemeName } from './themes'

export interface Project {
  id: string
  name: string
  path: string
  /** The companion's own place, which Telegraph keeps and the user cannot remove. */
  companion?: boolean
}

/** What the window tells the companion of its sessions. */
export interface SessionSnapshot {
  sessions: { label: string; project: string; status: string; model: string | null }[]
}

/** The user's Google account, as Telegraph is connected to it. */
export type GoogleStatus =
  /** Telegraph is not registered with Google, so there is nothing to sign in to. */
  | { state: 'unconfigured' }
  | { state: 'disconnected'; reason?: string }
  | { state: 'connecting' }
  | { state: 'connected'; email: string }

/** A connector the agents can reach: of the user's Claude account, or set up in Claude Code. */
export interface Connection {
  name: string
  account: boolean
  reachable: boolean
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

/** What Telegraph knows of the meetings of the user, and how it came to know it. */
export interface AgendaState {
  /** unknown: not read yet. reading: being read now. unavailable: the calendar cannot be read, for the reason given. */
  status: 'unknown' | 'reading' | 'read' | 'unavailable' | 'failed'
  meetings: import('./agenda').Meeting[]
  /** When the meetings were last read. */
  readAt: string | null
  reason: string | null
}

/** A way to start a session. A null command starts a plain shell. */
export interface Launcher {
  id: string
  name: string
  command: string | null
  /** Goes before the model on the command line. Without it there is no model to choose. */
  modelFlag?: string
  /** Typed into a running session, followed by a model, to change to that model. */
  modelCommand?: string
  /** Typed into a running session, followed by a name, to rename the chat. */
  renameCommand?: string
  /** Typed to stop what the program is doing: Esc for agents, and Ctrl-C by default. */
  interruptKey?: string
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
  theme: ThemeName
}

export interface CreateSessionRequest {
  sessionId: string
  cwd: string
  command: string | null
  /** How the program can be asked to report what it uses, if it can. */
  reports?: Reports['kind'] | null
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
  | { type: 'toggle-layout' }
  | { type: 'rename-session' }
  | { type: 'pause-session' }
  | { type: 'stop-session' }

export interface TelegraphApi {
  /** True when the app runs under the end-to-end tests. */
  e2e: boolean
  /** The theme the window starts in, known before it draws anything. */
  theme: ThemeName
  setTheme(theme: ThemeName): void
  /** Called when the theme has changed, from the window or from the menu. */
  onThemeChanged(listener: (theme: ThemeName) => void): () => void
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
  readAgenda(): Promise<AgendaState>
  refreshAgenda(): void
  onAgendaChanged(listener: (agenda: AgendaState) => void): () => void
  /** Tells the companion what the sessions are doing. */
  sendSnapshot(snapshot: SessionSnapshot): void
  /** Called with what the companion is to be asked, when the user takes up an offer of help. */
  onAskCompanion(listener: (prompt: string) => void): () => void
  listConnections(): Promise<Connection[]>
  googleStatus(): Promise<GoogleStatus>
  /** Signs in to Google in the browser. Resolves once that is done, or has failed. */
  connectGoogle(): Promise<GoogleStatus>
  disconnectGoogle(): Promise<GoogleStatus>
  onGoogleChanged(listener: (status: GoogleStatus) => void): () => void
  /** Tells the user, by a notice of the system, of a session they are not looking at. */
  notify(notice: Notice): void
  /** Takes back the notice of a session the user has gone to. */
  withdrawNotice(sessionId: string): void
  /** Marks the icon of the app with how many sessions have something to tell. */
  setBadge(count: number): void
  /** Called with the session whose notice the user pressed. */
  onOpenSession(listener: (sessionId: string) => void): () => void
  /** Called when a session has reported, so that what was used can be read again. */
  onUsageChanged(listener: () => void): () => void
  gitStatus(projectPath: string): Promise<GitStatus | null>
  createSession(request: CreateSessionRequest): Promise<CreateSessionResult>
  /** Resolves to false when the user chose to keep the session running. */
  closeSession(sessionId: string): Promise<boolean>
  /** Freezes a session where it is. Resolves to false where that cannot be done, as on Windows. */
  pauseSession(sessionId: string): Promise<boolean>
  resumeSession(sessionId: string): Promise<boolean>
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
