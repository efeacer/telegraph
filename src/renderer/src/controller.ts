import { composeCommand } from '@shared/launchers'
import { isModelId, modelsFor } from '@shared/models'
import { escapePath } from '@shared/paths'
import { initialStatus, reduceStatus, type StatusEvent, type StatusState } from '@shared/status'
import type { Chat, Choice, Launcher, MenuCommand, Model, Start } from '@shared/types'
import { report } from './problems'
import { getState, orderedSessions, setState, type SessionView } from './store'
import { TerminalManager } from './terminals'

const TICK_INTERVAL_MS = 500
// How long the window waits to hear which programs are installed before it
// offers all of them. A shell that reads a lot of settings can take longer.
const DETECTION_GRACE_MS = 400
const GIT_REFRESH_INTERVAL_MS = 10_000
// Sessions started here say when they have used something. The others are only found out by looking.
const USAGE_REFRESH_INTERVAL_MS = 30_000
const SESSION_ENDED_NOTE = '\r\n\x1b[2mSession ended.\x1b[0m\r\n'

const api = window.telegraph
const terminals = new TerminalManager({ useGpu: !api.e2e })
const statuses = new Map<string, StatusState>()

export function attachTerminalHost(host: HTMLElement): void {
  terminals.attach(host)
}

export async function initialize(): Promise<void> {
  api.onSessionData((sessionId, data) => {
    terminals.write(sessionId, data)
    track(sessionId, { type: 'output', at: performance.now() })
  })
  api.onSessionExit((sessionId) => {
    terminals.write(sessionId, SESSION_ENDED_NOTE)
    track(sessionId, { type: 'exit' })
  })
  api.onMenuCommand(handleMenuCommand)
  api.onProblem((message) => setState((state) => ({ ...state, error: message })))
  api.onUsageChanged(() => void refreshUsage())

  const persisted = await api.loadState()
  // Null when it cannot be told, in which case every launcher is offered.
  const detection = api.installedLaunchers().catch(() => null)
  const installed = await Promise.race([
    detection,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), DETECTION_GRACE_MS))
  ])
  const offer = (ids: string[] | null) => (launcher: Launcher) =>
    ids === null || ids.includes(launcher.id)

  setState((state) => ({
    ...state,
    loaded: true,
    projects: persisted.projects,
    launchers: persisted.launchers.filter(offer(installed)),
    choices: persisted.choices,
    selectedProjectId: persisted.projects[0]?.id ?? null
  }))
  if (installed === null) {
    void detection.then((ids) =>
      setState((state) => ({ ...state, launchers: state.launchers.filter(offer(ids)) }))
    )
  }
  // The list may have to come from the network, which nothing else waits for.
  void api
    .loadCatalogue()
    .then((catalogue) => setState((state) => ({ ...state, catalogue })))
    .catch(() => {})

  window.addEventListener('focus', () => {
    const { activeSessionId } = getState()
    if (activeSessionId) track(activeSessionId, { type: 'focus' })
    void refreshGit()
  })

  setInterval(tick, TICK_INTERVAL_MS)
  setInterval(() => void refreshGit(), GIT_REFRESH_INTERVAL_MS)
  setInterval(() => void refreshUsage(), USAGE_REFRESH_INTERVAL_MS)
  void refreshGit()
  void refreshUsage()
}

export async function addProject(): Promise<string | null> {
  const project = await api.addProject()
  if (!project) return null
  setState((state) => ({
    ...state,
    projects: state.projects.some((existing) => existing.id === project.id)
      ? state.projects
      : [...state.projects, project],
    selectedProjectId: project.id,
    activeSessionId: null
  }))
  terminals.show(null)
  void refreshGit()
  return project.id
}

export async function removeProject(projectId: string): Promise<void> {
  if (getState().sessions.some((session) => session.projectId === projectId)) return
  await api.removeProject(projectId)
  setState((state) => {
    const projects = state.projects.filter((project) => project.id !== projectId)
    const selectedProjectId =
      state.selectedProjectId === projectId ? (projects[0]?.id ?? null) : state.selectedProjectId
    const { [projectId]: _removed, ...choices } = state.choices
    return { ...state, projects, choices, selectedProjectId }
  })
}

/** The chats a launcher has had in a project. None if they cannot be told. */
export async function listChats(projectId: string, launcherId: string): Promise<Chat[]> {
  try {
    return await api.listChats(projectId, launcherId)
  } catch {
    return []
  }
}

/** Shows the choice of what to start, also while the project has sessions open. */
export function showPicker(projectId: string): void {
  setState((state) => ({ ...state, selectedProjectId: projectId, activeSessionId: null }))
  terminals.show(null)
}

export function selectProject(projectId: string): void {
  const latest = getState()
    .sessions.filter((session) => session.projectId === projectId)
    .at(-1)
  if (latest) {
    activateSession(latest.id)
    return
  }
  setState((state) => ({ ...state, selectedProjectId: projectId, activeSessionId: null }))
  terminals.show(null)
}

/**
 * Starts a launcher in a project. What is left out of the start is filled in:
 * the model with the one last chosen for the launcher, the mode with a new chat.
 */
export async function startSession(
  projectId: string,
  launcherId: string,
  start: Partial<Start> = {}
): Promise<void> {
  const current = getState()
  const project = current.projects.find((candidate) => candidate.id === projectId)
  const launcher = current.launchers.find((candidate) => candidate.id === launcherId)
  if (!project || !launcher) return

  const remembered = current.choices[projectId]?.models[launcherId] ?? null
  const chosen = (start.model === undefined ? remembered : start.model)?.trim() || null
  const modelId = launcher.command !== null && launcher.modelFlag ? chosen : null
  const model: Model | null =
    modelId === null
      ? null
      : (modelsFor(launcher, current.catalogue).find((known) => known.id === modelId) ?? {
          id: modelId,
          name: modelId
        })
  // Also if the session then fails to start, so that the choice is still there to try again.
  remember(projectId, launcherId, modelId)

  const sessionId = crypto.randomUUID()
  const size = terminals.create(sessionId, {
    onInput: (data) => {
      api.write(sessionId, data)
      track(sessionId, { type: 'input', at: performance.now() })
    },
    onResize: (cols, rows) => api.resize(sessionId, cols, rows),
    onBell: () => track(sessionId, { type: 'bell', focused: isWatched(sessionId) }),
    onTitle: (title) => updateSession(sessionId, { title: title.trim() || null }),
    onLink: (url) => api.openExternal(url),
    onFiles: (files) => void attach(sessionId, files)
  })

  statuses.set(sessionId, initialStatus())
  const session: SessionView = {
    id: sessionId,
    projectId,
    launcherName: launcher.name,
    model,
    title: null,
    status: 'idle'
  }
  setState((state) => ({ ...state, sessions: [...state.sessions, session], error: null }))
  activateSession(sessionId)

  const result = await api.createSession({
    sessionId,
    cwd: project.path,
    command: composeCommand(launcher, {
      model: modelId,
      modeId: start.modeId ?? null,
      chatId: start.chatId ?? null
    }),
    reports: launcher.command === null ? null : (launcher.reports?.kind ?? null),
    cols: size.cols,
    rows: size.rows
  })
  if (!result.ok) {
    discardSession(sessionId)
    setState((state) => ({
      ...state,
      error: `Could not start ${launcher.name} in ${project.name}. ${result.error}.`
    }))
  }
}

/**
 * Hands files to the program in a session the way a terminal does: by typing
 * where they are. A pasted image is nowhere yet, and is kept as a file first.
 */
async function attach(sessionId: string, files: File[]): Promise<void> {
  const paths: string[] = []
  const refused: string[] = []
  for (const file of files) {
    const path = api.pathOf(file) || (await api.saveAttachment(file.type, await file.arrayBuffer()))
    const typed = path ? escapePath(path) : null
    if (typed) paths.push(typed)
    else refused.push(file.name)
  }

  // With a space after each, so that what is typed next does not join the path.
  if (paths.length > 0) terminals.paste(sessionId, paths.map((path) => `${path} `).join(''))
  if (refused.length > 0) {
    setState((state) => ({
      ...state,
      error: `Could not attach ${refused.join(', ')}. Only images can be pasted: a file of another kind has to be dropped, or copied as a file.`
    }))
  }
}

function remember(projectId: string, launcherId: string, modelId: string | null): void {
  const models = { ...getState().choices[projectId]?.models }
  // A name that could not be a model's is not kept, and the one chosen before stays.
  if (modelId === null) delete models[launcherId]
  else if (isModelId(modelId)) models[launcherId] = modelId
  const choice: Choice = { launcherId, models }
  setState((state) => ({ ...state, choices: { ...state.choices, [projectId]: choice } }))
  api.saveChoice(projectId, choice)
}

/** Goes back to the session the choice of what to start was opened over. False if there is none. */
function closePicker(): boolean {
  const { sessions, selectedProjectId } = getState()
  const latest = sessions.filter((session) => session.projectId === selectedProjectId).at(-1)
  if (latest) activateSession(latest.id)
  return latest !== undefined
}

export function activateSession(sessionId: string): void {
  const session = getState().sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return
  setState((state) => ({
    ...state,
    activeSessionId: sessionId,
    selectedProjectId: session.projectId
  }))
  terminals.show(sessionId)
  track(sessionId, { type: 'focus' })
}

export async function endSession(sessionId: string): Promise<void> {
  const session = getState().sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return
  if (session.status !== 'exited') {
    const ended = await api.closeSession(sessionId)
    if (!ended) {
      terminals.focus(sessionId)
      return
    }
  }
  discardSession(sessionId)
}

export function dismissError(): void {
  setState((state) => ({ ...state, error: null }))
}

export function openBugReport(): void {
  setState((state) => ({ ...state, reportingBug: true }))
}

export function closeBugReport(): void {
  setState((state) => ({ ...state, reportingBug: false }))
  const { activeSessionId } = getState()
  if (activeSessionId) terminals.focus(activeSessionId)
}

/** Saves the note with the state of the sessions, and nothing that was in them. */
export function saveBugReport(note: string): Promise<boolean> {
  const { projects, sessions, activeSessionId } = getState()
  return report({
    kind: 'bug-report',
    message: note,
    detail: {
      projects: projects.length,
      sessions: sessions.map((session) => ({
        launcher: session.launcherName,
        model: session.model?.id ?? null,
        status: session.status,
        active: session.id === activeSessionId
      }))
    }
  })
}

function discardSession(sessionId: string): void {
  const before = getState()
  const order = orderedSessions(before)
  const index = order.findIndex((session) => session.id === sessionId)
  const neighbour = order[index + 1] ?? order[index - 1] ?? null

  terminals.dispose(sessionId)
  statuses.delete(sessionId)
  setState((state) => ({
    ...state,
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId
  }))

  if (before.activeSessionId !== sessionId) return
  if (neighbour) {
    activateSession(neighbour.id)
  } else {
    terminals.show(null)
  }
}

function updateSession(sessionId: string, changes: Partial<SessionView>): void {
  setState((state) => ({
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId ? { ...session, ...changes } : session
    )
  }))
}

/** True when the user is looking at this session right now. */
function isWatched(sessionId: string): boolean {
  return document.hasFocus() && getState().activeSessionId === sessionId
}

function track(sessionId: string, event: StatusEvent): void {
  const previous = statuses.get(sessionId)
  if (!previous) return
  const next = reduceStatus(previous, event)
  statuses.set(sessionId, next)
  if (next.status !== previous.status) updateSession(sessionId, { status: next.status })
}

function tick(): void {
  const at = performance.now()
  for (const sessionId of statuses.keys()) {
    track(sessionId, { type: 'tick', at, focused: isWatched(sessionId) })
  }
}

export async function refreshUsage(): Promise<void> {
  try {
    const usage = await api.readUsage()
    setState((state) => ({ ...state, usage }))
  } catch {
    // What was read last stays, and is read again soon.
  }
}

async function refreshGit(): Promise<void> {
  const { projects } = getState()
  const entries = await Promise.all(
    projects.map(async (project) => [project.id, await api.gitStatus(project.path)] as const)
  )
  setState((state) => ({ ...state, git: Object.fromEntries(entries) }))
}

async function launchInSelectedProject(launcherId: string): Promise<void> {
  const projectId = getState().selectedProjectId ?? (await addProject())
  if (projectId) await startSession(projectId, launcherId)
}

function stepSession(offset: number): void {
  const state = getState()
  const order = orderedSessions(state)
  if (order.length === 0) return
  const index = order.findIndex((session) => session.id === state.activeSessionId)
  const next = order[(index + offset + order.length) % order.length]
  if (next) activateSession(next.id)
}

function handleMenuCommand(command: MenuCommand): void {
  const { activeSessionId } = getState()
  switch (command.type) {
    case 'launch':
      void launchInSelectedProject(command.launcherId)
      break
    case 'add-project':
      void addProject()
      break
    case 'close-session':
      if (activeSessionId) void endSession(activeSessionId)
      else if (!closePicker()) window.close()
      break
    case 'next-session':
      stepSession(1)
      break
    case 'previous-session':
      stepSession(-1)
      break
    case 'select-session': {
      const target = orderedSessions(getState())[command.index]
      if (target) activateSession(target.id)
      break
    }
    case 'clear':
      if (activeSessionId) terminals.clear(activeSessionId)
      break
    case 'report-bug':
      openBugReport()
      break
  }
}
