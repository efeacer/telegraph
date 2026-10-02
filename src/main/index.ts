import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BrowserWindow,
  Menu,
  Notification,
  app,
  crashReporter,
  dialog,
  ipcMain,
  nativeImage,
  net,
  safeStorage,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { checkWindowReport, describeProblem, type LogEntry } from '@shared/buglog'
import { DEFAULT_THEME, THEMES, type ThemeName } from '@shared/themes'
import { withReporting } from '@shared/usage'
import { nudgePrompt, type Meeting } from '@shared/agenda'
import type { SessionSnapshot } from '@shared/types'
import { E2E_ARGUMENT, IPC } from '@shared/ipc'
import type { CreateSessionRequest, CreateSessionResult, MenuCommand } from '@shared/types'
import { Attachments } from './attachments'
import { BugLog } from './buglog'
import { AgendaWatcher, askClaudeForAgenda } from './agenda'
import { Bridge, socketPathFor } from './bridge'
import { GoogleAccount, type GoogleStatus } from './google/account'
import { loadGoogleClient, readGoogleClient } from './google/client'
import { ModelCatalogue } from './catalogue'
import {
  checkSnapshot,
  companionProject,
  parseConnections,
  renderContext,
  writeBriefing,
  writeContext
} from './companion'
import { listChats } from './chats'
import { readGitStatus } from './git'
import { findInstalled } from './installed'
import { TokenLedger } from './ledger'
import { Meters, hasOwnStatusLine } from './meters'
import { Notifier, type NotifierTools } from './notifier'
import { buildMenu } from './menu'
import { PtyManager } from './pty'
import { buildSessionEnv, posixShell } from './shell'
import { StateStore } from './store'
import { watchProcess, watchWindow } from './watch'

const isE2E = process.env.TELEGRAPH_E2E === '1'
const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
const rendererFile = join(__dirname, '../renderer/index.html')

// Development builds keep their own data, so trying things out never
// touches the projects of the installed app.
if (process.env.TELEGRAPH_USER_DATA) {
  app.setPath('userData', process.env.TELEGRAPH_USER_DATA)
} else if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Telegraph Dev'))
}

// The tests start the app many times over, often while the user is at work in
// the Telegraph they have installed. The app under test stays out of the Dock
// and never comes to the front, so that it takes no keys meant for another.
if (isE2E) app.dock?.hide()

// Crash dumps stay on this machine, where the bug log can point to them.
crashReporter.start({ uploadToServer: false })

const bugLog = new BugLog({
  directory: join(app.getPath('userData'), 'logs'),
  crashDumps: app.getPath('crashDumps'),
  build: {
    version: app.getVersion(),
    builtAt: __BUILT_AT__,
    packaged: app.isPackaged,
    electron: process.versions.electron,
    platform: `${process.platform} ${release()} ${process.arch}`
  }
})
watchProcess(bugLog, { onNewError: showError })

const attachments = new Attachments({
  directory: join(app.getPath('temp'), 'telegraph-attachments')
})

// Every window of Telegraph. Each has sessions of its own; projects, the theme and the accounts are shared.
const windows = new Set<BrowserWindow>()
/** The window the companion lives in: the first opened of those still open. */
let host: BrowserWindow | null = null
/** The window last in front, which the menu and the notices go to when none is. */
let lastFocused: BrowserWindow | null = null
/** Each session, by the window it belongs to. */
const owners = new Map<string, number>()
/** What each window counts as new, which the icon of the app adds up. */
const unreadCounts = new Map<number, number>()
/** The windows whose page reports its own errors. */
const reportingPages = new Set<number>()

function frontWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused && windows.has(focused)) return focused
  if (lastFocused && windows.has(lastFocused)) return lastFocused
  return host ?? [...windows][0] ?? null
}

function windowOf(sessionId: string): BrowserWindow | null {
  const owner = owners.get(sessionId)
  return [...windows].find((candidate) => candidate.webContents.id === owner) ?? null
}

function sessionsOf(target: BrowserWindow): string[] {
  return [...owners].filter(([, owner]) => owner === target.webContents.id).map(([sessionId]) => sessionId)
}
let theme: ThemeName = DEFAULT_THEME
let quitConfirmed = false

// Claude Code keeps its records in the home folder unless it is told another place.
const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR || join(app.getPath('home'), '.claude')
const meters = new Meters({ directory: join(app.getPath('userData'), 'usage') })
// Sessions report several times a second while agents work, and the window asks each time.
const ledger = new TokenLedger({ configDir: claudeConfigDir, freshForMs: 5_000 })
// Windows shows a notice only of an app that has said what it is called.
if (process.platform === 'win32') app.setAppUserModelId('dev.efeacer.telegraph')

// Windows has no count on the icon of an app, but takes a small picture to lay over it.
const WAITING_MARK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAx0lEQVR42t2Xuw3EIAxAmYkZaK+lvpJl2Mo7MEEKdkDiXDjS6eSLSEJsJ8VrUMCPT8B2y/vlNHF3EwhIRgCpSCMqtWX6ZrpAQgrSBynU57SAp5n1gwCNcUgg0vL2kzQaa5dAnBD4lzgq4CfNnFsJPyIAFwT/PhObAunC4CtpS6AICJR/AkEg+ErgBLKgQOYEQFAAOIEqKFA5gSYo0EwKqG+B+iFU/w3VLyL1q9jEY6T+HJtISNRTMhNJqYm03ERhYqY0e251/AGyza5RMEXXjwAAAABJRU5ErkJggg=='

/** The ways the system tells the user of something, which differ from one system to the next. */
const systemNotices: NotifierTools = {
  supported: () => Notification.isSupported(),
  create: (options) => {
    const notification = new Notification(options)
    // A window that is not in front can ask for a look, where the system has a way to.
    const asking = frontWindow()
    if (process.platform !== 'darwin' && asking && !asking.isFocused()) asking.flashFrame(true)
    return {
      show: () => notification.show(),
      close: () => notification.close(),
      onClick: (listener) => void notification.on('click', listener)
    }
  },
  setBadge: (count) => {
    if (process.platform !== 'win32') {
      app.setBadgeCount(count)
    } else {
      const mark = count > 0 ? nativeImage.createFromDataURL(WAITING_MARK) : null
      for (const each of windows) each.setOverlayIcon(mark, count > 0 ? `${count} waiting` : '')
    }
  }
}

/**
 * Under test the notices are kept and not shown: the tests run while the user
 * is at work, and would cover the screen with notices that are none.
 */
function recordedNotices(): NotifierTools {
  const kept: { title: string; body: string; closed: boolean; press(): void }[] = []
  Object.assign(globalThis, { telegraphNotices: kept, telegraphBadge: 0 })
  return {
    supported: () => true,
    create: (options) => {
      const notice = { ...options, closed: false, press: () => {} }
      kept.push(notice)
      return {
        show: () => {},
        close: () => void (notice.closed = true),
        onClick: (listener) => void (notice.press = listener)
      }
    },
    setBadge: (count) => void Object.assign(globalThis, { telegraphBadge: count })
  }
}

const notifier = new Notifier(isE2E ? recordedNotices() : systemNotices, (sessionId) => {
  const owner = windowOf(sessionId)
  bringForward(owner)
  if (owner) owner.webContents.send(IPC.openSession, sessionId)
})

/** Brings a window to the front, which under test would take the keys from the user. */
function bringForward(target: BrowserWindow | null = frontWindow()): void {
  if (!target || isE2E) return
  if (target.isMinimized()) target.restore()
  target.show()
  target.focus()
}

// The companion: a chat of its own in a folder of its own, told of the day.
const companionDir = join(app.getPath('userData'), 'companion')
const HOUR_MS = 60 * 60_000
const MINUTE_MS = 60_000
let snapshot: SessionSnapshot = { sessions: [] }

const askClaude = isE2E
  ? () => fromTestFile('test-agenda.txt', 'EVENTS: []')()
  : askClaudeForAgenda({
      shell: posixShell(process.env.SHELL),
      cwd: companionDir,
      env: buildSessionEnv(process.env, app.getVersion())
    })

function endOfTomorrow(now: number): number {
  const at = new Date(now)
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + 2).getTime()
}

// The user's Google account, which Telegraph signs in to itself and reads for every agent.
// Made once the app is ready: its key is sealed by the keychain, which is not there before.
const resourcesDir = app.isPackaged ? process.resourcesPath : join(__dirname, '../../resources')
const testGoogle = isE2E ? process.env.TELEGRAPH_TEST_GOOGLE : undefined
let google: GoogleAccount | null = null
let bridge: Bridge | null = null

function makeGoogle(): GoogleAccount {
  // Under test the key is sealed by a stand-in, which asks no keychain on the user's desktop.
  const sealTest = (text: string): Buffer => Buffer.from([...text].reverse().join(''))
  return new GoogleAccount({
    filePath: join(app.getPath('userData'), 'google.json'),
    client: () =>
      testGoogle
        ? { clientId: 'test' }
        : loadGoogleClient([
            join(app.getPath('userData'), 'google-oauth.json'),
            // Under test, only what the test gave.
            ...(isE2E ? [] : [join(resourcesDir, 'google-oauth.json')])
          ]),
    encrypt: isE2E ? sealTest : (plain) => safeStorage.encryptString(plain),
    decrypt: isE2E ? (sealed) => [...sealed.toString()].reverse().join('') : (sealed) => safeStorage.decryptString(sealed),
    // Under test, the stand-in Google signs in whoever asks, and no browser is opened.
    openBrowser: testGoogle ? async (url) => void (await fetch(url)) : (url) => shell.openExternal(url),
    ...(testGoogle
      ? {
          endpoints: {
            auth: `${testGoogle}/auth`,
            token: `${testGoogle}/token`,
            revoke: `${testGoogle}/revoke`,
            userinfo: `${testGoogle}/userinfo`,
            calendar: `${testGoogle}/calendar/v3`,
            gmail: `${testGoogle}/gmail/v1`
          }
        }
      : {})
  })
}

const NOT_CONNECTED = 'Google is not connected. Press Connections in the sidebar of Telegraph to connect it.'

function connectedGoogle(): GoogleAccount {
  if (google?.status().state !== 'connected') throw new Error(NOT_CONNECTED)
  return google
}

async function openBridge(): Promise<void> {
  bridge = new Bridge({
    socketPath: socketPathFor(app.getPath('userData')),
    handlers: {
      status: async () => {
        const status = google?.status() ?? { state: 'unconfigured' }
        return { google: status.state, ...(status.state === 'connected' ? { account: status.email } : {}) }
      },
      meetings: async (days) => {
        const now = Date.now()
        if (google?.status().state === 'connected') return google.meetings(now, now + days * 24 * 60 * 60_000)
        return agenda.state().meetings
      },
      searchMail: (query, most) => connectedGoogle().searchMail(query, most),
      readMail: (id) => connectedGoogle().readMail(id)
    }
  })
  try {
    await bridge.listen()
  } catch {
    // Without it the telegraph command says that Telegraph cannot be reached.
    bridge = null
  }
}

/** What every session is given: the telegraph command, and how it reaches Telegraph. */
function sessionExtras(): Record<string, string> {
  if (!bridge) return {}
  return {
    TELEGRAPH_BRIDGE: bridge.socketPath,
    TELEGRAPH_BRIDGE_TOKEN: bridge.token,
    TELEGRAPH_NODE: process.execPath,
    TELEGRAPH_CLI: join(resourcesDir, 'cli', 'telegraph.cjs'),
    TELEGRAPH_BIN: join(resourcesDir, 'bin')
  }
}

function sendGoogleStatus(): void {
  send(IPC.googleChanged, google?.status() ?? { state: 'unconfigured' })
}

/** Under test, what Claude would answer is in a file of the test, and Claude is never asked. */
function fromTestFile(name: string, otherwise: string): () => Promise<string> {
  return async () => {
    try {
      return readFileSync(join(app.getPath('userData'), name), 'utf8')
    } catch {
      return otherwise
    }
  }
}

const agenda = new AgendaWatcher({
  filePath: join(app.getPath('userData'), 'agenda.json'),
  fetch: async () => {
    // From Google, where it is connected: free, and quick.
    if (google?.status().state === 'connected') {
      const now = Date.now()
      return `EVENTS: ${JSON.stringify(await google.meetings(now, endOfTomorrow(now)))}`
    }
    return askClaude()
  },
  onChange: (state) => {
    send(IPC.agendaChanged, state)
    updateContext()
  },
  onNudge: offerHelp
})

function clockOf(time: string): string {
  const at = new Date(time)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** Offers help with a meeting that is near. Taken up, the companion is asked. */
function offerHelp(meeting: Meeting): void {
  const minutes = Math.max(1, Math.round((Date.parse(meeting.start) - Date.now()) / MINUTE_MS))
  const clock = clockOf(meeting.start)
  notifier.offer(
    `meeting ${meeting.id}`,
    {
      title: `“${meeting.title}” in ${minutes} minutes`,
      body: `At ${clock}. Want help preparing? Press to ask your companion.`
    },
    () => {
      bringForward(host)
      askWhenLoaded(nudgePrompt(meeting, `at ${clock}`))
    }
  )
}

// What the companion is to be asked, held while the page it lives in is loading and cannot hear it.
const loadedPages = new Set<number>()
const heldAsks: string[] = []

function askWhenLoaded(prompt: string): void {
  if (host && loadedPages.has(host.webContents.id)) host.webContents.send(IPC.askCompanion, prompt)
  else heldAsks.push(prompt)
}

function updateContext(): void {
  writeContext(companionDir, renderContext({ now: new Date(), agenda: agenda.state(), snapshot }))
}

/** The connectors the agents can reach, as Claude Code lists them. */
function listConnections(): Promise<string> {
  if (isE2E) return fromTestFile('test-connections.txt', '')()
  return new Promise((resolve) => {
    execFile(
      posixShell(process.env.SHELL),
      ['-l', '-c', 'claude mcp list'],
      { timeout: 60_000, env: buildSessionEnv(process.env, app.getVersion()), cwd: companionDir },
      (_error, stdout) => resolve(stdout ?? '')
    )
  })
}

let readingDays: ReturnType<TokenLedger['read']> | null = null

/** One reading at a time: the ledger reads on from where it was, and two readers would count twice. */
function readDays(): ReturnType<TokenLedger['read']> {
  readingDays ??= ledger.read().finally(() => {
    readingDays = null
  })
  return readingDays
}

const sessions = new PtyManager(app.getVersion(), {
  onData: (sessionId, data) => windowOf(sessionId)?.webContents.send(IPC.sessionData, sessionId, data),
  onExit: (sessionId, exitCode) => {
    meters.retire(sessionId)
    // Still its window's after it ends, until the window lets go of it, to take back what was told of it.
    windowOf(sessionId)?.webContents.send(IPC.sessionExit, sessionId, exitCode)
  },
  usageFileFor: (sessionId) => meters.fileFor(sessionId),
  extraEnv: () => sessionExtras()
})

/** Tells every window. */
function send(channel: string, ...args: unknown[]): void {
  for (const each of windows) if (!each.isDestroyed()) each.webContents.send(channel, ...args)
}

function sendMenuCommand(command: MenuCommand): void {
  frontWindow()?.webContents.send(IPC.menuCommand, command)
}

/** Whether a window may act on a session: only on its own. */
function owns(event: IpcMainEvent | IpcMainInvokeEvent, sessionId: unknown): sessionId is string {
  return typeof sessionId === 'string' && owners.get(sessionId) === event.sender.id
}

/** Tells the windows that the projects have changed, all but the one that changed them. */
function tellOthers(event: IpcMainInvokeEvent): void {
  for (const each of windows) if (each.webContents.id !== event.sender.id) each.webContents.send(IPC.stateChanged)
}

/** Only the app's own page may talk to the main process. */
function isTrusted(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  if (!url) return false
  if (devServerUrl) return url.startsWith(devServerUrl)
  return url.startsWith(pathToFileURL(rendererFile).href)
}

function handle<Args extends unknown[], Result>(
  channel: string,
  handler: (...args: Args) => Result | Promise<Result>
): void {
  handleFrom<Args, Result>(channel, (_event, ...args) => handler(...args))
}

/** As handle, for what needs to know which window asked. */
function handleFrom<Args extends unknown[], Result>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: Args) => Result | Promise<Result>
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!isTrusted(event)) throw new Error(`Rejected ${channel} from an unknown page`)
      return await handler(event, ...(args as Args))
    } catch (error) {
      bugLog.record({ kind: 'ipc-error', ...describeProblem(error), detail: { channel } })
      throw error
    }
  })
}

function listen<Args extends unknown[]>(channel: string, handler: (...args: Args) => void): void {
  listenFrom<Args>(channel, (_event, ...args) => handler(...args))
}

/** As listen, for what needs to know which window sent it. */
function listenFrom<Args extends unknown[]>(channel: string, handler: (event: IpcMainEvent, ...args: Args) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrusted(event)) handler(event, ...(args as Args))
  })
}

function registerIpc(
  store: StateStore,
  installed: Promise<string[]>,
  catalogue: ModelCatalogue
): void {
  // The companion comes first, and is Telegraph's: it is not in the state file.
  const projectsOf = () => [companionProject(companionDir), ...store.get().projects]
  handle(IPC.loadState, () => ({ ...store.get(), projects: projectsOf() }))

  handle(IPC.installedLaunchers, () => installed)

  handle(IPC.loadCatalogue, () => catalogue.load())

  listen(IPC.saveChoice, (projectId: string, choice: unknown) =>
    store.saveChoice(projectId, choice)
  )

  handle(IPC.listChats, (projectId: unknown, launcherId: unknown) => {
    // Found by what Telegraph knows of them: the window does not get to name a folder to read.
    const project = projectsOf().find((candidate) => candidate.id === projectId)
    const launcher = store.get().launchers.find((candidate) => candidate.id === launcherId)
    if (!project || launcher?.chats?.kind !== 'claude') return []
    return listChats({ configDir: claudeConfigDir, projectPath: project.path })
  })

  listen(IPC.notify, (notice: unknown) => notifier.notify(notice))

  handle(IPC.readAgenda, () => agenda.state())

  listen(IPC.refreshAgenda, () => void agenda.refresh().then(() => agenda.check()))

  listen(IPC.sendSnapshot, (value: unknown) => {
    const checked = checkSnapshot(value)
    if (!checked) return
    snapshot = checked
    updateContext()
  })

  handle(IPC.listConnections, async () => parseConnections(await listConnections()))

  handle(IPC.googleStatus, (): GoogleStatus => google?.status() ?? { state: 'unconfigured' })

  handle(IPC.connectGoogle, async (): Promise<GoogleStatus> => {
    if (!google) return { state: 'unconfigured' }
    const connecting = google.connect()
    sendGoogleStatus()
    await connecting
    sendGoogleStatus()
    if (google.status().state === 'connected') void agenda.refresh().then(() => agenda.check())
    return google.status()
  })

  handleFrom(IPC.importGoogleClient, async (event) => {
    const status = (): GoogleStatus => google?.status() ?? { state: 'unconfigured' }
    // Under test the file is named by the test, and no dialog is opened on the user's desktop.
    let path = isE2E ? process.env.TELEGRAPH_TEST_IMPORT_FILE : undefined
    const asking = BrowserWindow.fromWebContents(event.sender)
    if (!isE2E && asking) {
      const chosen = await dialog.showOpenDialog(asking, {
        title: 'Choose the file Google gave',
        buttonLabel: 'Use this file',
        defaultPath: app.getPath('downloads'),
        filters: [{ name: 'Google client file', extensions: ['json'] }],
        properties: ['openFile']
      })
      path = chosen.canceled ? undefined : chosen.filePaths[0]
    }
    if (!path) return { status: status() }
    let text = ''
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      return { status: status(), error: 'That file could not be read.' }
    }
    if (!readGoogleClient(text)) {
      return {
        status: status(),
        error: 'That is not the file Google gives for a Desktop app. On the Clients page, create a client of type Desktop app, and download it.'
      }
    }
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(join(app.getPath('userData'), 'google-oauth.json'), text, { mode: 0o600 })
    sendGoogleStatus()
    return { status: status() }
  })

  handle(IPC.disconnectGoogle, async (): Promise<GoogleStatus> => {
    await google?.disconnect()
    sendGoogleStatus()
    void agenda.refresh()
    return google?.status() ?? { state: 'unconfigured' }
  })

  listen(IPC.withdrawNotice, (sessionId: unknown) => notifier.withdraw(sessionId))

  // Each window counts its own; the icon shows them all.
  listenFrom(IPC.setBadge, (event, count: unknown) => {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) return
    unreadCounts.set(event.sender.id, count)
    updateBadge()
  })

  ipcMain.on(IPC.theme, (event) => {
    event.returnValue = isTrusted(event) ? store.get().theme : DEFAULT_THEME
  })

  listen(IPC.setTheme, (chosen: unknown) => applyTheme(store, chosen))

  handle(IPC.readUsage, async () => ({
    ...meters.read(),
    days: await readDays(),
    reporting: !hasOwnStatusLine(claudeConfigDir)
  }))

  handleFrom(IPC.addProject, async (event) => {
    const asking = BrowserWindow.fromWebContents(event.sender)
    if (!asking) return null
    const result = await dialog.showOpenDialog(asking, {
      title: 'Add project',
      buttonLabel: 'Add project',
      properties: ['openDirectory', 'createDirectory']
    })
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    const project = store.addProject(folder)
    tellOthers(event)
    return project
  })

  listenFrom(IPC.orderProjects, (event, projectIds: unknown) => {
    store.orderProjects(projectIds)
    for (const each of windows) if (each.webContents.id !== event.sender.id) each.webContents.send(IPC.stateChanged)
  })

  handleFrom(IPC.removeProject, (event, projectId: string) => {
    store.removeProject(projectId)
    tellOthers(event)
  })

  // Found by the project: the window names a project, never a path to open.
  listen(IPC.openFolder, (projectId: unknown) => {
    const project = projectsOf().find((candidate) => candidate.id === projectId)
    if (!project) return
    if (isE2E) {
      // Under test the folder is kept, and no window of the system is opened on the user's desktop.
      const opened = ((globalThis as Record<string, unknown>).telegraphOpenedFolders ??= []) as string[]
      opened.push(project.path)
      return
    }
    void shell.openPath(project.path)
  })

  handle(IPC.gitStatus, (projectPath: string) => readGitStatus(projectPath))

  handleFrom(IPC.createSession, (event, request: CreateSessionRequest): CreateSessionResult => {
    try {
      // Before it is started: what it prints first goes to the window it belongs to.
      owners.set(request.sessionId, event.sender.id)
      sessions.create({ ...request, command: commandFor(request) })
      return { ok: true }
    } catch (error) {
      owners.delete(request.sessionId)
      bugLog.record({ kind: 'session-failure', ...describeProblem(error) })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  handleFrom(IPC.closeSession, async (event, sessionId: unknown) => {
    if (!owns(event, sessionId)) return false
    const running = sessions.foregroundProcess(sessionId)
    const asking = BrowserWindow.fromWebContents(event.sender)
    if (running !== null && asking && !isE2E) {
      const { response } = await dialog.showMessageBox(asking, {
        type: 'warning',
        message: 'End this session?',
        detail: `${running} is still running. Ending the session stops it.`,
        buttons: ['End session', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      if (response !== 0) return false
    }
    sessions.kill(sessionId)
    return true
  })

  // A window acts on its own sessions only.
  handleFrom(IPC.pauseSession, (event, sessionId: unknown) => owns(event, sessionId) && sessions.pause(sessionId))

  handleFrom(IPC.resumeSession, (event, sessionId: unknown) => owns(event, sessionId) && sessions.resume(sessionId))

  listenFrom(IPC.write, (event, sessionId: unknown, data: string) => {
    if (owns(event, sessionId)) sessions.write(sessionId, data)
  })

  listenFrom(IPC.resize, (event, sessionId: unknown, cols: number, rows: number) => {
    if (owns(event, sessionId)) sessions.resize(sessionId, cols, rows)
  })

  handleFrom(IPC.isCompanionHost, (event) => host?.webContents.id === event.sender.id)

  listen(IPC.openExternal, (url: string) => openInBrowser(url))

  handle(IPC.saveAttachment, (type: unknown, data: unknown) => attachments.save(type, data))

  handle(IPC.report, (report: unknown) => {
    const checked = checkWindowReport(report)
    return checked !== null && bugLog.record(checked) !== null
  })

  listenFrom(IPC.reporting, (event) => {
    reportingPages.add(event.sender.id)
  })
}

/** Keeps the theme, colours the window behind the page with it, and tells the page and the menu. */
function applyTheme(store: StateStore, chosen: unknown): void {
  const found = THEMES.find((candidate) => candidate.name === chosen)
  if (!found) return
  store.saveTheme(found.name)
  theme = found.name
  for (const each of windows) if (!each.isDestroyed()) each.setBackgroundColor(found.background)
  const item = Menu.getApplicationMenu()?.getMenuItemById(`theme-${found.name}`)
  if (item) item.checked = true
  send(IPC.themeChanged, found.name)
}

/**
 * The command of a session, with Claude Code asked to report what it uses.
 * Decided here and as the session is started: asking takes the place of a
 * status line the user or the project has set up, so where there is one,
 * the session is left as it is.
 */
function commandFor(request: CreateSessionRequest): string | null {
  if (request.command === null || request.reports !== 'claude') return request.command
  if (hasOwnStatusLine(claudeConfigDir, request.cwd)) return request.command
  return withReporting(request.command)
}

/**
 * The app keeps running after an error, because ending it would end every
 * session in it. The window says so rather than a dialog, which would hold up
 * the sessions until someone answered it.
 */
function showError(entry: LogEntry): void {
  send(
    IPC.problem,
    `Telegraph ran into a problem and saved it to the bug log. Your sessions are still running. ${entry.message}`
  )
}

function showBugLog(): void {
  if (existsSync(bugLog.filePath)) shell.showItemInFolder(bugLog.filePath)
  else void shell.openPath(dirname(bugLog.filePath))
}

async function offerReload(target: BrowserWindow): Promise<void> {
  if (isE2E || target.isDestroyed()) return
  const { response } = await dialog.showMessageBox(target, {
    type: 'error',
    message: 'The window stopped working',
    detail: 'The problem was saved to the bug log. The sessions in the window could not be kept.',
    buttons: ['Reload', 'Quit'],
    defaultId: 0,
    cancelId: 1
  })
  if (target.isDestroyed()) return
  if (response === 0) {
    target.webContents.reload()
  } else {
    quitConfirmed = true
    app.quit()
  }
}

function openInBrowser(url: string): void {
  try {
    const { protocol } = new URL(url)
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(url)
  } catch {
    // Not a URL, nothing to open.
  }
}

/** Asks before stopping sessions that are busy. True when the user said yes, or nothing is busy. */
function confirmStopping(target: BrowserWindow, sessionIds: Iterable<string>, closing: 'quit' | 'window'): boolean {
  const busy = sessions.busySessionCount(sessionIds)
  if (busy === 0 || isE2E) return true
  const what = closing === 'quit' ? 'Quitting' : 'Closing the window'
  const response = dialog.showMessageBoxSync(target, {
    type: 'warning',
    message: closing === 'quit' ? 'Quit Telegraph?' : 'Close this window?',
    detail:
      busy === 1
        ? `One session is still running. ${what} stops it.`
        : `${busy} sessions are still running. ${what} stops them.`,
    buttons: [closing === 'quit' ? 'Quit' : 'Close', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  })
  return response === 0
}

function updateBadge(): void {
  notifier.badge([...unreadCounts.values()].reduce((sum, count) => sum + count, 0))
}

/** Ends the sessions of a window, which it has closed or lost track of, and forgets what it told of them. */
function forgetSessionsOf(target: BrowserWindow): void {
  for (const sessionId of sessionsOf(target)) {
    sessions.kill(sessionId)
    notifier.withdraw(sessionId)
    owners.delete(sessionId)
  }
  unreadCounts.delete(target.webContents.id)
  updateBadge()
}

/** Gives the companion a window to live in: the first opened of those still open. */
function chooseHost(): void {
  if (host && windows.has(host)) return
  host = [...windows][0] ?? null
  if (!host) return
  host.webContents.send(IPC.companionHostChanged, true)
  if (loadedPages.has(host.webContents.id)) for (const prompt of heldAsks.splice(0)) host.webContents.send(IPC.askCompanion, prompt)
}

/** Opens a window of Telegraph, a little below and to the right of the one in front. */
function createWindow(): void {
  const before = frontWindow()?.getBounds()
  const created = new BrowserWindow({
    width: before?.width ?? 1320,
    height: before?.height ?? 860,
    ...(before ? { x: before.x + 28, y: before.y + 28 } : {}),
    minWidth: 760,
    minHeight: 440,
    show: false,
    title: 'Telegraph',
    // The page is not drawn yet: the window is of the colour it will be, so that it does not flash.
    backgroundColor: THEMES.find((candidate) => candidate.name === theme)?.background,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 19 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: isE2E ? [E2E_ARGUMENT] : []
    }
  })
  const contentsId = created.webContents.id
  windows.add(created)
  host ??= created
  lastFocused = created

  watchWindow(bugLog, created, {
    pageReports: () => reportingPages.has(contentsId),
    onCrash: () => void offerReload(created)
  })

  created.once('ready-to-show', () => (isE2E ? created.showInactive() : created.show()))

  created.on('close', (event) => {
    if (quitConfirmed) return
    if (!confirmStopping(created, sessionsOf(created), 'window')) event.preventDefault()
  })

  created.on('closed', () => {
    windows.delete(created)
    reportingPages.delete(contentsId)
    loadedPages.delete(contentsId)
    for (const sessionId of [...owners].filter(([, owner]) => owner === contentsId).map(([id]) => id)) {
      sessions.kill(sessionId)
      notifier.withdraw(sessionId)
      owners.delete(sessionId)
    }
    unreadCounts.delete(contentsId)
    updateBadge()
    if (lastFocused === created) lastFocused = null
    if (host === created) {
      host = null
      chooseHost()
    }
  })

  created.on('focus', () => {
    lastFocused = created
    // Asked for a look by a notice, and looked at now.
    created.flashFrame(false)
  })

  // A reloaded page has lost track of its sessions, so they cannot be
  // reached any more and would keep running unseen.
  created.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    forgetSessionsOf(created)
    loadedPages.delete(contentsId)
    reportingPages.delete(contentsId)
  })

  created.webContents.on('did-finish-load', () => {
    loadedPages.add(contentsId)
    // The page that went can still have told of its sessions ending, after it was cleared up behind.
    forgetSessionsOf(created)
    if (host === created) for (const prompt of heldAsks.splice(0)) created.webContents.send(IPC.askCompanion, prompt)
    // A theme chosen while the page was loading was told of before it could hear it.
    created.webContents.send(IPC.themeChanged, theme)
  })

  created.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url)
    return { action: 'deny' }
  })

  created.webContents.on('will-navigate', (event, url) => {
    if (devServerUrl && url.startsWith(devServerUrl)) return
    event.preventDefault()
    openInBrowser(url)
  })

  if (devServerUrl) {
    void created.loadURL(devServerUrl)
  } else {
    void created.loadFile(rendererFile)
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Started again, from the Dock, Finder or a terminal: another window, as a terminal opens one.
  app.on('second-instance', () => {
    if (app.isReady()) createWindow()
  })

  app.on('window-all-closed', () => app.quit())

  // Quitting asks once for all windows, and then closes them without asking again.
  app.on('before-quit', (event) => {
    if (quitConfirmed) return
    const asking = frontWindow()
    if (asking && !confirmStopping(asking, owners.keys(), 'quit')) {
      event.preventDefault()
      return
    }
    quitConfirmed = true
  })
  app.on('will-quit', () => {
    void bridge?.close()
    sessions.killAll()
    bugLog.stop()
  })

  bugLog.start()
  attachments.clearOld()
  meters.retireAll()
  meters.watch(() => send(IPC.usageChanged))
  // A week of records takes a moment to read the first time, so that starts before the window asks.
  void readDays().catch(() => {})

  void app.whenReady().then(() => {
    const store = new StateStore(join(app.getPath('userData'), 'state.json'), (error, backupPath) =>
      bugLog.record({ kind: 'state-unreadable', ...describeProblem(error), detail: { backupPath } })
    )
    const { launchers } = store.get()
    theme = store.get().theme
    const installed = findInstalled(
      launchers,
      process.env.SHELL,
      buildSessionEnv(process.env, app.getVersion())
    )
    const catalogue = new ModelCatalogue({
      filePath: join(app.getPath('userData'), 'models.json'),
      providers: [...new Set(launchers.flatMap((launcher) => launcher.providers ?? []))],
      // The tests bring their own list, and never use the network.
      fetch: isE2E ? null : (url, options) => net.fetch(url, options)
    })
    registerIpc(store, installed, catalogue)

    writeBriefing(companionDir)
    agenda.load()
    google = makeGoogle()
    void openBridge()
    // Every ten minutes from Google, which costs nothing. Every hour from Claude, which costs a little.
    let askedClaudeAt = 0
    const readAgenda = (): void => {
      if (google?.status().state !== 'connected') {
        if (Date.now() - askedClaudeAt < HOUR_MS) return
        askedClaudeAt = Date.now()
      }
      void agenda.refresh().then(() => agenda.check())
    }
    readAgenda()
    setInterval(readAgenda, 10 * MINUTE_MS)
    setInterval(() => agenda.check(), MINUTE_MS)

    const setMenu = (offered: typeof launchers): void =>
      Menu.setApplicationMenu(
        buildMenu({
          launchers: offered,
          includeDeveloperTools: !app.isPackaged,
          send: sendMenuCommand,
          showBugLog,
          theme,
          setTheme: (chosen) => applyTheme(store, chosen),
          newWindow: createWindow
        })
      )
    setMenu(launchers)
    void installed.then((ids) => setMenu(launchers.filter((launcher) => ids.includes(launcher.id))))
    app.dock?.setMenu(Menu.buildFromTemplate([{ label: 'New Window', click: createWindow }]))
    createWindow()
  })
}
