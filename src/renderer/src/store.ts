import { useSyncExternalStore } from 'react'
import type { SessionStatus } from '@shared/status'
import type { GitStatus, Launcher, Project } from '@shared/types'

export interface SessionView {
  id: string
  projectId: string
  launcherName: string
  /** Title the running program has set for its terminal, if any. */
  title: string | null
  status: SessionStatus
}

export interface AppState {
  loaded: boolean
  projects: Project[]
  launchers: Launcher[]
  git: Record<string, GitStatus | null>
  sessions: SessionView[]
  activeSessionId: string | null
  selectedProjectId: string | null
  error: string | null
  reportingBug: boolean
}

let state: AppState = {
  loaded: false,
  projects: [],
  launchers: [],
  git: {},
  sessions: [],
  activeSessionId: null,
  selectedProjectId: null,
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
