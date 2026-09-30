import { useSyncExternalStore } from 'react'
import type { SessionStatus } from '@shared/status'
import type { Catalogue, Choice, GitStatus, Launcher, Model, Project, Usage } from '@shared/types'

export interface SessionView {
  id: string
  projectId: string
  launcherName: string
  /** The model the session was started on, unless the program chose it. */
  model: Model | null
  /** Title the running program has set for its terminal, if any. */
  title: string | null
  status: SessionStatus
  /** Something happened in the session that the user has not seen yet. */
  unread: boolean
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
  sessions: SessionView[]
  activeSessionId: string | null
  selectedProjectId: string | null
  /** One session at a time, or all of them side by side. */
  layout: Layout
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
  sessions: [],
  activeSessionId: null,
  selectedProjectId: null,
  layout: lastLayout(),
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

export function sessionLabel(session: SessionView): string {
  return session.title ?? session.launcherName
}
