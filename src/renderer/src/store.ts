import { useSyncExternalStore } from 'react'
import { STATUS_LABELS, type SessionStatus } from '@shared/status'
import type { ThemeName } from '@shared/themes'
import type {
  AgendaState,
  Catalogue,
  Choice,
  GitStatus,
  GoogleStatus,
  Launcher,
  Model,
  Project,
  Usage
} from '@shared/types'

export interface SessionView {
  id: string
  projectId: string
  launcherId: string
  launcherName: string
  /** The model the session was started on, unless the program chose it. */
  model: Model | null
  /** The name the user gave the session, which comes before any other. */
  name: string | null
  /** Title the running program has set for its terminal, if any. */
  title: string | null
  status: SessionStatus
  /** Something happened in the session that the user has not seen yet. */
  unread: boolean
  /** Frozen where it is, by the user. */
  paused: boolean
}

export type Layout = 'single' | 'grid'

const LAYOUT_KEY = 'telegraph.layout'

/** Kept by the window, since it is about nothing but the window. */
function lastLayout(): Layout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'single'
  } catch {
    return 'single'
  }
}

export function keepLayout(layout: Layout): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // One session at a time again at the next start, which is no loss.
  }
}

export interface AppState {
  loaded: boolean
  projects: Project[]
  /** The launchers whose program is installed. */
  launchers: Launcher[]
  catalogue: Catalogue
  /** What was last chosen in each project. */
  choices: Record<string, Choice>
  git: Record<string, GitStatus | null>
  /** What the agents have used. Null until it was read. */
  usage: Usage | null
  /** The meetings of the user, as far as Telegraph knows them. Null until it was read. */
  agenda: AgendaState | null
  google: GoogleStatus
  /** Whether the companion lives in this window. It lives in one window only. */
  companionHost: boolean
  connectionsOpen: boolean
  sessions: SessionView[]
  activeSessionId: string | null
  selectedProjectId: string | null
  /** One session at a time, or all of them side by side. */
  layout: Layout
  /** The session whose name is being typed, and where: in the sidebar or in its tile. */
  renaming: { sessionId: string; place: 'sidebar' | 'tile' } | null
  theme: ThemeName
  error: string | null
  reportingBug: boolean
}

let state: AppState = {
  loaded: false,
  projects: [],
  launchers: [],
  catalogue: {},
  choices: {},
  git: {},
  usage: null,
  agenda: null,
  google: { state: 'unconfigured' },
  companionHost: false,
  connectionsOpen: false,
  sessions: [],
  activeSessionId: null,
  selectedProjectId: null,
  layout: lastLayout(),
  renaming: null,
  theme: window.telegraph.theme,
  error: null,
  reportingBug: false
}

const listeners = new Set<() => void>()

export function getState(): AppState {
  return state
}

export function setState(update: (current: AppState) => AppState): void {
  const next = update(state)
  if (next === state) return
  state = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState)
}

/** Sessions in the order the sidebar shows them. */
export function orderedSessions(current: AppState): SessionView[] {
  return current.projects.flatMap((project) =>
    current.sessions.filter((session) => session.projectId === project.id)
  )
}

/**
 * The name of the model a session runs on: as the session reports it, which
 * is so whichever way it was changed, or else as it was chosen.
 */
export function modelOf(current: AppState, session: SessionView): string | null {
  return current.usage?.sessions[session.id]?.model ?? session.model?.name ?? null
}

/** What a session is doing, in words: its status, unless it is paused. */
export function statusLabel(session: SessionView): string {
  return session.paused && session.status !== 'exited' ? 'Paused' : STATUS_LABELS[session.status]
}

export function sessionLabel(session: SessionView): string {
  return session.name ?? session.title ?? session.launcherName
}
