import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DEFAULT_LAUNCHERS } from '@shared/launchers'
import { isModelId, readModels } from '@shared/models'
import type { Choice, Launcher, Mode, PersistedState, Project } from '@shared/types'

// The first version wrote its launchers to the file in full. Left as they
// are, they would keep the ones Telegraph comes with now from showing up.
const FIRST_LAUNCHERS: Launcher[] = [
  { id: 'shell', name: 'Shell', command: null },
  { id: 'claude', name: 'Claude', command: 'claude' },
  { id: 'claude-continue', name: 'Claude, continue last chat', command: 'claude --continue' },
  { id: 'claude-resume', name: 'Claude, pick a chat to resume', command: 'claude --resume' }
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProject(value: unknown): value is Project {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.path === 'string'
  )
}

function isMode(value: unknown): value is Mode {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.args === 'string'
  )
}

/** The launcher with the parts of it that can be read, or nothing if it cannot start anything. */
function readLauncher(value: unknown): Launcher[] {
  if (!isRecord(value)) return []
  const { id, name, command, modelFlag, modelCommand, providers, models, modes, chats, reports } = value
  if (typeof id !== 'string' || typeof name !== 'string') return []
  if (command !== null && typeof command !== 'string') return []

  const launcher: Launcher = { id, name, command }
  if (typeof modelFlag === 'string') launcher.modelFlag = modelFlag
  if (typeof modelCommand === 'string') launcher.modelCommand = modelCommand
  if (Array.isArray(providers)) {
    launcher.providers = providers.filter((provider) => typeof provider === 'string')
  }
  if (Array.isArray(models)) launcher.models = readModels(models)
  if (Array.isArray(modes)) launcher.modes = modes.filter(isMode)
  if (isRecord(chats) && chats.kind === 'claude' && typeof chats.flag === 'string') {
    launcher.chats = { kind: 'claude', flag: chats.flag }
  }
  if (isRecord(reports) && reports.kind === 'claude') launcher.reports = { kind: 'claude' }
  return [launcher]
}

function readChoice(value: unknown): Choice | null {
  if (!isRecord(value) || typeof value.launcherId !== 'string') return null
  const models: Record<string, string> = {}
  for (const [launcherId, model] of Object.entries(isRecord(value.models) ? value.models : {})) {
    // A model ends up in a command, so only what can be one is kept.
    if (typeof model === 'string' && isModelId(model)) models[launcherId] = model
  }
  return { launcherId: value.launcherId, models }
}

export function parseState(json: string): PersistedState {
  const raw = JSON.parse(json) as Partial<Record<keyof PersistedState, unknown>>
  if (typeof raw !== 'object' || raw === null) throw new Error('State is not an object')
  const projects = Array.isArray(raw.projects) ? raw.projects.filter(isProject) : []
  const launchers = Array.isArray(raw.launchers) ? raw.launchers.flatMap(readLauncher) : []
  const comesWith =
    launchers.length === 0 ||
    isDeepStrictEqual(launchers, FIRST_LAUNCHERS) ||
    isDeepStrictEqual(launchers, DEFAULT_LAUNCHERS)

  const choices: Record<string, Choice> = {}
  for (const [projectId, value] of Object.entries(isRecord(raw.choices) ? raw.choices : {})) {
    const choice = readChoice(value)
    if (choice && projects.some((project) => project.id === projectId)) choices[projectId] = choice
  }
  return { projects, launchers: comesWith ? DEFAULT_LAUNCHERS : launchers, choices }
}

const EMPTY: PersistedState = { projects: [], launchers: DEFAULT_LAUNCHERS, choices: {} }

/** Projects, launchers and choices, kept in a JSON file the user can also edit by hand. */
export class StateStore {
  private state: PersistedState

  constructor(
    private readonly filePath: string,
    private readonly onUnreadable: (error: unknown, backupPath: string) => void = () => {}
  ) {
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
    const { [projectId]: _removed, ...choices } = this.state.choices
    this.update({ ...this.state, projects, choices })
  }

  /** Takes what the window says was chosen, which is checked like anything read from the file. */
  saveChoice(projectId: string, value: unknown): void {
    const choice = readChoice(value)
    if (!choice || !this.state.projects.some((project) => project.id === projectId)) return
    this.update({ ...this.state, choices: { ...this.state.choices, [projectId]: choice } })
  }

  private update(state: PersistedState): void {
    this.state = state
    mkdirSync(dirname(this.filePath), { recursive: true })
    // The launchers Telegraph comes with stay out of the file, so that a
    // newer Telegraph can come with newer ones.
    const { launchers, ...rest } = state
    const written = launchers === DEFAULT_LAUNCHERS ? rest : state
    // Write to the side and rename, so a crash never leaves half a file.
    const temporaryPath = `${this.filePath}.tmp`
    writeFileSync(temporaryPath, `${JSON.stringify(written, null, 2)}\n`)
    renameSync(temporaryPath, this.filePath)
  }

  private read(): PersistedState {
    if (!existsSync(this.filePath)) return EMPTY
    try {
      return parseState(readFileSync(this.filePath, 'utf8'))
    } catch (error) {
      // Keep the unreadable file for the user instead of overwriting it.
      const backupPath = `${this.filePath}.unreadable-${Date.now()}`
      renameSync(this.filePath, backupPath)
      console.error(`Could not read ${this.filePath}, moved it to ${backupPath}:`, error)
      this.onUnreadable(error, backupPath)
      return EMPTY
    }
  }
}
