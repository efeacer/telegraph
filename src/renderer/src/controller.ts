import { composeCommand } from '@shared/launchers'
import { isModelId, modelsFor } from '@shared/models'
import { describeNotice, noticeFor, type NoticeKind } from '@shared/notices'
import { tidyName } from '@shared/names'
import { formatAttachment } from '@shared/paths'
import { reorder, step } from '@shared/reorder'
import type { ThemeName } from '@shared/themes'
import {
  QUIET_MS,
  initialStatus,
  reduceStatus,
  type StatusEvent,
  type StatusState
} from '@shared/status'
import type { Chat, Choice, Launcher, MenuCommand, Model, SessionSnapshot, Start } from '@shared/types'
import { report } from './problems'
import {
  getState,
  keepLayout,
  orderedSessions,
  sessionLabel,
  setState,
  type SessionView
} from './store'
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
const terminals = new TerminalManager({ useGpu: !api.e2e, theme: api.theme })
const statuses = new Map<string, StatusState>()
/** Sessions into which something has been typed and not yet sent. */
const drafting = new Set<string>()
/** Lines to type into sessions, each once the session can be typed to. */
const pendingLines = new Map<string, string[]>()
const COMPANION_ID = 'companion'
let lastSnapshot = ''

// From the start: the theme can be chosen in the menu before the window has drawn anything.
api.onThemeChanged(showTheme)
// From the start too: a meeting that is near is offered as soon as Telegraph opens.
api.onAskCompanion((prompt) => void askCompanion(prompt))

/** Settled once the projects and launchers are known, which starting a session needs. */
let markReady: () => void = () => {}
const ready = new Promise<void>((resolve) => (markReady = resolve))
let companionStarting: Promise<string | null> | null = null

export function attachTerminalHost(host: HTMLElement): void {
  terminals.attach(host)
}

/** Puts the terminal of a session into its tile, or out of sight when it has none. */
export function placeTerminal(sessionId: string, container: HTMLElement | null): void {
  terminals.place(sessionId, container)
}

/** Asks for a theme, which the main process keeps and tells of back. */
export function chooseTheme(theme: ThemeName): void {
  api.setTheme(theme)
}

function showTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme
  terminals.setTheme(theme)
  setState((state) => ({ ...state, theme }))
}

/** Changes between one session at a time and all of them side by side. */
export function toggleLayout(): void {
  const layout = getState().layout === 'grid' ? 'single' : 'grid'
  setState((state) => ({ ...state, layout }))
  keepLayout(layout)
  // The keys go back to the session once it is in its new place, from the button that was pressed.
  requestAnimationFrame(focusActive)
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
  api.onOpenSession(activateSession)
  api.onAgendaChanged((agenda) => setState((state) => ({ ...state, agenda })))
  api.onGoogleChanged((google) => setState((state) => ({ ...state, google })))
  api.onStateChanged(() => void reloadProjects())
  api.onCompanionHostChanged((companionHost) => {
    setState((state) => ({ ...state, companionHost }))
    if (companionHost) void startCompanion()
  })
  void api.googleStatus().then((google) => setState((state) => ({ ...state, google })))

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
    // The companion is at hand in the sidebar. What is shown first is the user's own work.
    selectedProjectId: persisted.projects.find((project) => !project.companion)?.id ?? null
  }))
  void api
    .readAgenda()
    .then((agenda) => setState((state) => ({ ...state, agenda: state.agenda ?? agenda })))
    .catch(() => {})
  markReady()
  const companionHost = await api.isCompanionHost().catch(() => false)
  setState((state) => ({ ...state, companionHost }))
  // The companion lives in one window: the first opened.
  if (companionHost) void startCompanion()
  if (installed === null) {
    void detection.then((ids) =>
      setState((state) => ({ ...state, launchers: state.launchers.filter(offer(ids)) }))
    )
  }
  // A window that starts over has nothing to tell of yet.
  countUnread()
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

type Place = 'before' | 'after'

/** Puts a project before or after another. The companion stays first, and a project put on it goes first. */
export function moveProject(movedId: string, targetId: string, place: Place): void {
  const ids = getState().projects.filter((project) => !project.companion).map((project) => project.id)
  const onCompanion = !ids.includes(targetId)
  const first = ids[0]
  if (onCompanion && !first) return
  orderProjects(onCompanion ? reorder(ids, movedId, first!, 'before') : reorder(ids, movedId, targetId, place))
}

export function nudgeProject(projectId: string, by: -1 | 1): void {
  orderProjects(step(getState().projects.filter((project) => !project.companion).map((project) => project.id), projectId, by))
}

function orderProjects(ids: string[]): void {
  setState((state) => {
    const companion = state.projects.filter((project) => project.companion)
    const ordered = ids.map((id) => state.projects.find((project) => project.id === id)).filter((project) => project !== undefined)
    return { ...state, projects: [...companion, ...ordered] }
  })
  api.orderProjects(ids)
}

/** Puts a session before or after another of its project. Sessions stay in their project. */
export function moveSession(movedId: string, targetId: string, place: Place): void {
  const sessions = getState().sessions
  const moved = sessions.find((session) => session.id === movedId)
  const target = sessions.find((session) => session.id === targetId)
  if (!moved || !target || moved.projectId !== target.projectId) return
  orderSessions(moved.projectId, (ids) => reorder(ids, movedId, targetId, place))
}

export function nudgeSession(sessionId: string, by: -1 | 1): void {
  const moved = getState().sessions.find((session) => session.id === sessionId)
  if (moved) orderSessions(moved.projectId, (ids) => step(ids, sessionId, by))
}

/** Reorders the sessions of a project, leaving those of the others where they are. */
function orderSessions(projectId: string, order: (ids: string[]) => string[]): void {
  setState((state) => {
    const ids = order(state.sessions.filter((session) => session.projectId === projectId).map((session) => session.id))
    const queue = ids.map((id) => state.sessions.find((session) => session.id === id)!)
    return {
      ...state,
      sessions: state.sessions.map((session) => (session.projectId === projectId ? queue.shift()! : session))
    }
  })
}

/** Takes the projects as another window left them. */
async function reloadProjects(): Promise<void> {
  const persisted = await api.loadState()
  setState((state) => {
    const projects = persisted.projects
    const kept = projects.some((project) => project.id === state.selectedProjectId)
    return {
      ...state,
      projects,
      selectedProjectId: kept ? state.selectedProjectId : (projects.find((project) => !project.companion)?.id ?? null)
    }
  })
  void refreshGit()
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
  start: Partial<Start> = {},
  /** Started without being brought to the front, as the companion is at start. */
  quietly = false
): Promise<string | null> {
  const current = getState()
  const project = current.projects.find((candidate) => candidate.id === projectId)
  const launcher = current.launchers.find((candidate) => candidate.id === launcherId)
  if (!project || !launcher) return null

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
      noteDraft(sessionId, data)
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
    launcherId: launcher.id,
    launcherName: launcher.name,
    name: null,
    model,
    title: null,
    status: 'idle',
    unread: false,
    paused: false
  }
  setState((state) => ({ ...state, sessions: [...state.sessions, session], error: null }))
  if (!quietly) activateSession(sessionId)

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
    return null
  }
  return sessionId
}

/**
 * Starts the companion, an agent that is always there: it goes on with the
 * chat it had before, so that it knows what was said. Claude, where it is
 * installed; nothing otherwise.
 */
function startCompanion(): Promise<string | null> {
  // Asked for twice at once, as at start while a meeting is offered, it is started once.
  companionStarting ??= launchCompanion().finally(() => {
    companionStarting = null
  })
  return companionStarting
}

// The agents a companion can be, when none was chosen for it: the first of these that is installed.
const COMPANION_AGENTS = ['claude', 'codex', 'gemini']

async function launchCompanion(): Promise<string | null> {
  await ready
  const state = getState()
  const running = state.sessions.find((session) => session.projectId === COMPANION_ID && session.status !== 'exited')
  if (running) return running.id
  const agents = state.launchers.filter((launcher) => launcher.command !== null)
  const chosen = state.choices[COMPANION_ID]?.launcherId
  const launcher =
    agents.find((candidate) => candidate.id === chosen) ??
    COMPANION_AGENTS.map((id) => agents.find((candidate) => candidate.id === id)).find(Boolean)
  if (!launcher) return null
  // It goes on with the chat it had, where its agent keeps chats Telegraph can find.
  const chats = launcher.chats ? await listChats(COMPANION_ID, launcher.id) : []
  const continues = chats.length > 0 && launcher.modes?.some((mode) => mode.id === 'continue')
  return startSession(COMPANION_ID, launcher.id, { modeId: continues ? 'continue' : null }, true)
}

/** Asks the companion something, bringing it to the front: the user asked for its help. */
export async function askCompanion(line: string): Promise<void> {
  const sessionId = await startCompanion()
  if (!sessionId) {
    setState((state) => ({ ...state, error: 'The companion needs an agent, such as Claude, Codex or Gemini, and none could be found.' }))
    return
  }
  activateSession(sessionId)
  typeWhenSettled(sessionId, line)
}

export function openConnections(): void {
  setState((state) => ({ ...state, connectionsOpen: true }))
}

export function closeConnections(): void {
  setState((state) => ({ ...state, connectionsOpen: false }))
  focusActive()
}

export function refreshAgenda(): void {
  api.refreshAgenda()
}

/** Tells the companion what the sessions are doing, when that has changed. */
function sendSnapshot(): void {
  const state = getState()
  const snapshot: SessionSnapshot = {
    sessions: state.sessions.map((session) => ({
      label: sessionLabel(session),
      project: state.projects.find((project) => project.id === session.projectId)?.name ?? '',
      status: session.status,
      model: session.model?.name ?? null
    }))
  }
  const text = JSON.stringify(snapshot)
  if (text === lastSnapshot) return
  lastSnapshot = text
  api.sendSnapshot(snapshot)
}

/**
 * Hands files and folders to the program in a session the way a terminal
 * does: by typing where they are. A pasted file that is nowhere yet, such as
 * a screenshot, is kept as a file first.
 */
async function attach(sessionId: string, files: File[]): Promise<void> {
  const paths: string[] = []
  const refused: string[] = []
  for (const file of files) {
    const path = api.pathOf(file) || (await api.saveAttachment(file.type, await file.arrayBuffer(), file.name))
    if (path) paths.push(path)
    else refused.push(file.name)
  }
  await typeAttachments(sessionId, paths, refused)
}

/** Asks for files and folders, and hands them to the program in the active session. */
export async function chooseAttachments(sessionId: string): Promise<void> {
  const current = getState()
  const session = current.sessions.find((candidate) => candidate.id === sessionId)
  const project = current.projects.find((candidate) => candidate.id === session?.projectId)
  if (!session || !project) return
  const paths = await api.chooseAttachments(project.path)
  await typeAttachments(sessionId, paths, [])
  terminals.focus(sessionId)
}

/**
 * Types the paths as the program in the session reads them: an agent such as
 * Claude is told of each by a mention, which it reads the file or folder by.
 */
async function typeAttachments(sessionId: string, paths: string[], refused: string[]): Promise<void> {
  const current = getState()
  const session = current.sessions.find((candidate) => candidate.id === sessionId)
  const style = current.launchers.find((launcher) => launcher.id === session?.launcherId)?.attachAs ?? 'path'
  const kinds = paths.length > 0 ? await api.kindsOf(paths) : []
  const typed: string[] = []
  paths.forEach((path, index) => {
    const written = formatAttachment(path, kinds[index] === 'folder', style)
    if (written) typed.push(written)
    else refused.push(path.split('/').at(-1) || path)
  })

  // With a space around each, so that a mention stands apart from what was typed before it, and what is typed next does not join the path.
  if (typed.length > 0) {
    const lead = style === 'mention' ? ' ' : ''
    terminals.paste(sessionId, `${lead}${typed.map((path) => `${path} `).join('')}`)
  }
  if (refused.length > 0) {
    setState((state) => ({
      ...state,
      error: `Could not attach ${refused.join(', ')}. It could not be kept as a file, or its name cannot be typed.`
    }))
  }
}

/**
 * Whether something is being typed. Enter sends it, and Ctrl-C or Ctrl-U
 * throw it away. Keys that move or delete leave it as it was, since what is
 * left of it cannot be told.
 */
function noteDraft(sessionId: string, data: string): void {
  if (data.endsWith('\r') || data === '\x03' || data === '\x15') drafting.delete(sessionId)
  else if (!data.startsWith('\x1b') && data !== '\x7f' && /[^\x00-\x1f]/.test(data)) drafting.add(sessionId)
}

/**
 * Changes the model of a running session, the way the user would: by typing
 * the command of its program. Not while the agent works, which it would
 * take for a message, nor while something is typed, which the command would
 * be added to.
 */
export function switchModel(sessionId: string, modelId: string): void {
  const state = getState()
  const session = state.sessions.find((candidate) => candidate.id === sessionId)
  const launcher = state.launchers.find((candidate) => candidate.id === session?.launcherId)
  if (!session || !launcher?.modelCommand || !isModelId(modelId)) return

  const refuse = (error: string): void => setState((current) => ({ ...current, error }))
  if (session.status === 'working') {
    return refuse(`${sessionLabel(session)} is working. Change its model once it waits for you.`)
  }
  if (session.status === 'exited') return refuse(`${sessionLabel(session)} has ended.`)
  if (drafting.has(sessionId)) {
    return refuse('Send or clear what you have typed in the session first, then change its model.')
  }

  api.write(sessionId, `${launcher.modelCommand} ${modelId}\r`)
  const model = modelsFor(launcher, state.catalogue).find((known) => known.id === modelId) ?? {
    id: modelId,
    name: modelId
  }
  updateSession(sessionId, { model })
  // Until the session reports again, what it reported would name the model it was on.
  setState((current) => {
    const reported = current.usage?.sessions[sessionId]
    if (!current.usage || !reported) return current
    const sessions = { ...current.usage.sessions, [sessionId]: { ...reported, model: null } }
    return { ...current, usage: { ...current.usage, sessions } }
  })
  remember(session.projectId, launcher.id, modelId)
  terminals.focus(sessionId)
}

/** Opens the name of a session to be typed, where it was asked for: by default in its tile, when there are tiles. */
export function startRenaming(sessionId: string | null, place?: 'sidebar' | 'tile'): void {
  if (!sessionId || !getState().sessions.some((session) => session.id === sessionId)) return
  const where = place ?? (getState().layout === 'grid' ? 'tile' : 'sidebar')
  setState((state) => ({ ...state, renaming: { sessionId, place: where } }))
}

/** Ends the typing of a name: with the text typed, or with null when it was given up. */
export function finishRenaming(sessionId: string, text: string | null): void {
  setState((state) => (state.renaming?.sessionId === sessionId ? { ...state, renaming: null } : state))
  focusActive()
  if (text === null) return
  const session = getState().sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return
  const name = tidyName(text)
  if (name === session.name) return
  updateSession(sessionId, { name })
  // The agent keeps the name in its own record of the chat, and so it outlives the session.
  const launcher = getState().launchers.find((candidate) => candidate.id === session.launcherId)
  if (name && launcher?.renameCommand) typeWhenSettled(sessionId, `${launcher.renameCommand} ${name}`)
}

/** Types a line into a session, and Enter, once that cannot go wrong. */
function typeWhenSettled(sessionId: string, line: string): void {
  pendingLines.set(sessionId, [...(pendingLines.get(sessionId) ?? []), line])
  typePending(sessionId, performance.now())
}

/**
 * Types what waits for a session, once that cannot go wrong: not while the
 * agent works, starts or has just been sent something, nor while something
 * is typed and not sent.
 */
function typePending(sessionId: string, at: number): void {
  const lines = pendingLines.get(sessionId)
  const status = statuses.get(sessionId)
  if (!lines || lines.length === 0 || !status || status.status === 'exited') {
    pendingLines.delete(sessionId)
    return
  }
  const settled = at - status.lastInputAt > QUIET_MS && at - status.lastOutputAt > QUIET_MS
  if (status.status === 'working' || !settled || drafting.has(sessionId)) return
  pendingLines.delete(sessionId)
  // One at a time: each is answered before the next is typed.
  const [line, ...rest] = lines
  api.write(sessionId, `${line}\r`)
  track(sessionId, { type: 'input', at })
  if (rest.length > 0) pendingLines.set(sessionId, rest)
}

export async function pauseSession(sessionId: string): Promise<void> {
  if (!(await api.pauseSession(sessionId))) {
    setState((state) => ({ ...state, error: 'Pausing is not possible on this system. Stop is.' }))
    return
  }
  updateSession(sessionId, { paused: true })
}

export async function resumeSession(sessionId: string): Promise<void> {
  if (!(await api.resumeSession(sessionId))) return
  updateSession(sessionId, { paused: false })
  // Quiet while paused, it is not taken to have gone quiet now.
  const status = statuses.get(sessionId)
  if (status) statuses.set(sessionId, { ...status, burstStartedAt: null, lastOutputAt: performance.now() })
}

/** Stops what the program is doing, as its own key for that does: Esc for agents, Ctrl-C for a shell. */
export async function stopSession(sessionId: string): Promise<void> {
  const state = getState()
  const session = state.sessions.find((candidate) => candidate.id === sessionId)
  if (!session || session.status === 'exited') return
  // A frozen program would not hear it.
  if (session.paused) await resumeSession(sessionId)
  const launcher = state.launchers.find((candidate) => candidate.id === session.launcherId)
  api.write(sessionId, launcher?.interruptKey ?? '\x03')
  drafting.delete(sessionId)
  focusActive()
}

function togglePause(sessionId: string | null): void {
  const session = getState().sessions.find((candidate) => candidate.id === sessionId)
  if (!session) return
  void (session.paused ? resumeSession(session.id) : pauseSession(session.id))
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
      focusActive()
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
      projects: projects.filter((project) => !project.companion).length,
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
  drafting.delete(sessionId)
  pendingLines.delete(sessionId)
  setState((state) => ({
    ...state,
    sessions: state.sessions.filter((session) => session.id !== sessionId),
    activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId
  }))
  // Nothing is left of it to tell of.
  api.withdrawNotice(sessionId)
  countUnread()

  // The session in front stays in front, and keeps the keys the button took.
  if (before.activeSessionId !== sessionId) return focusActive()
  if (neighbour) {
    activateSession(neighbour.id)
  } else {
    terminals.show(null)
  }
}

function focusActive(): void {
  const { activeSessionId, reportingBug } = getState()
  // A note about a bug is being written, and has the keys.
  if (activeSessionId && !reportingBug) terminals.focus(activeSessionId)
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
  if (next.status !== previous.status) {
    updateSession(sessionId, { status: next.status })
    const kind = noticeFor(previous.status, next.status, isWatched(sessionId))
    if (kind) tell(sessionId, kind)
  }
  // Looked at or typed into by the user, who has now seen what there was to see.
  if ((event.type === 'focus' || event.type === 'input') && isWatched(sessionId)) seen(sessionId)
}

/** Tells the user of a session they are not looking at, and marks it until they do. */
function tell(sessionId: string, kind: NoticeKind): void {
  const state = getState()
  const session = state.sessions.find((candidate) => candidate.id === sessionId)
  const project = state.projects.find((candidate) => candidate.id === session?.projectId)
  if (!session || !project) return
  updateSession(sessionId, { unread: true })
  countUnread()
  // Side by side, the session is in plain view of a user who is at the window: the mark says enough.
  if (state.layout === 'grid' && state.activeSessionId !== null && document.hasFocus()) {
    // A notice from before would now say what is no longer so.
    api.withdrawNotice(sessionId)
    return
  }
  api.notify({
    sessionId,
    ...describeNotice(kind, { session: sessionLabel(session), project: project.name })
  })
}

function seen(sessionId: string): void {
  if (!getState().sessions.some((session) => session.id === sessionId && session.unread)) return
  updateSession(sessionId, { unread: false })
  api.withdrawNotice(sessionId)
  countUnread()
}

function countUnread(): void {
  api.setBadge(getState().sessions.filter((session) => session.unread).length)
}

function tick(): void {
  const at = performance.now()
  for (const sessionId of statuses.keys()) {
    // A paused session is quiet because the user asked it to be, not because it waits.
    if (getState().sessions.find((session) => session.id === sessionId)?.paused) continue
    track(sessionId, { type: 'tick', at, focused: isWatched(sessionId) })
  }
  for (const sessionId of pendingLines.keys()) typePending(sessionId, at)
  sendSnapshot()
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
    case 'toggle-layout':
      toggleLayout()
      break
    case 'rename-session':
      startRenaming(activeSessionId)
      break
    case 'pause-session':
      togglePause(activeSessionId)
      break
    case 'stop-session':
      if (activeSessionId) void stopSession(activeSessionId)
      break
  }
}
