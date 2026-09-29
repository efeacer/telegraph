import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { DEFAULT_LAUNCHERS } from '@shared/launchers'
import type { Launcher, PersistedState, Project } from '@shared/types'

function isProject(value: unknown): value is Project {
  const project = value as Project
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof project.id === 'string' &&
    typeof project.name === 'string' &&
    typeof project.path === 'string'
  )
}

function isLauncher(value: unknown): value is Launcher {
  const launcher = value as Launcher
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof launcher.id === 'string' &&
    typeof launcher.name === 'string' &&
    (launcher.command === null || typeof launcher.command === 'string')
  )
}

export function parseState(json: string): PersistedState {
  const raw = JSON.parse(json) as Partial<Record<keyof PersistedState, unknown>>
  if (typeof raw !== 'object' || raw === null) throw new Error('State is not an object')
  const projects = Array.isArray(raw.projects) ? raw.projects.filter(isProject) : []
  const launchers = Array.isArray(raw.launchers) ? raw.launchers.filter(isLauncher) : []
  return { projects, launchers: launchers.length > 0 ? launchers : DEFAULT_LAUNCHERS }
}

/** Projects and launchers, kept in a JSON file the user can also edit by hand. */
export class StateStore {
  private state: PersistedState

  constructor(private readonly filePath: string) {
    this.state = this.read()
  }

  get(): PersistedState {
    return this.state
  }

  addProject(projectPath: string): Project {
    const existing = this.state.projects.find((project) => project.path === projectPath)
    if (existing) return existing
    const project: Project = { id: randomUUID(), name: basename(projectPath), path: projectPath }
    this.update({ ...this.state, projects: [...this.state.projects, project] })
    return project
  }

  removeProject(projectId: string): void {
    const projects = this.state.projects.filter((project) => project.id !== projectId)
    this.update({ ...this.state, projects })
  }

  private update(state: PersistedState): void {
    this.state = state
    mkdirSync(dirname(this.filePath), { recursive: true })
    // Write to the side and rename, so a crash never leaves half a file.
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`)
    renameSync(temporaryPath, this.filePath)
  }

  private read(): PersistedState {
    if (!existsSync(this.filePath)) return { projects: [], launchers: DEFAULT_LAUNCHERS }
    try {
      return parseState(readFileSync(this.filePath, 'utf8'))
    } catch (error) {
      // Keep the unreadable file for the user instead of overwriting it.
      const backupPath = `${this.filePath}.unreadable-${Date.now()}`
      renameSync(this.filePath, backupPath)
      console.error(`Could not read ${this.filePath}, moved it to ${backupPath}:`, error)
      return { projects: [], launchers: DEFAULT_LAUNCHERS }
    }
  }
}
