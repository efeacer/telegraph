import { existsSync } from 'node:fs'
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
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { checkWindowReport, describeProblem, type LogEntry } from '@shared/buglog'
import { DEFAULT_THEME, THEMES, type ThemeName } from '@shared/themes'
import { withReporting } from '@shared/usage'
import { E2E_ARGUMENT, IPC } from '@shared/ipc'
import type { CreateSessionRequest, CreateSessionResult, MenuCommand } from '@shared/types'
import { Attachments } from './attachments'
import { BugLog } from './buglog'
import { ModelCatalogue } from './catalogue'
import { listChats } from './chats'
import { readGitStatus } from './git'
import { findInstalled } from './installed'
import { TokenLedger } from './ledger'
import { Meters, hasOwnStatusLine } from './meters'
import { Notifier, type NotifierTools } from './notifier'
import { buildMenu } from './menu'
import { PtyManager } from './pty'
import { buildSessionEnv } from './shell'
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

let window: BrowserWindow | null = null
let theme: ThemeName = DEFAULT_THEME
let quitConfirmed = false
let pageReports = false

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
    if (process.platform !== 'darwin' && window && !window.isFocused()) window.flashFrame(true)
    return {
      show: () => notification.show(),
      close: () => notification.close(),
      onClick: (listener) => void notification.on('click', listener)
    }
  },
  setBadge: (count) => {
    if (process.platform !== 'win32') {
      app.setBadgeCount(count)
    } else if (window && !window.isDestroyed()) {
      const mark = count > 0 ? nativeImage.createFromDataURL(WAITING_MARK) : null
      window.setOverlayIcon(mark, count > 0 ? `${count} waiting` : '')
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
  // Brought to the front, which under test would take the keys from the user.
  if (window && !isE2E) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }
  send(IPC.openSession, sessionId)
})

let readingDays: ReturnType<TokenLedger['read']> | null = null

/** One reading at a time: the ledger reads on from where it was, and two readers would count twice. */
function readDays(): ReturnType<TokenLedger['read']> {
  readingDays ??= ledger.read().finally(() => {
    readingDays = null
  })
  return readingDays
}

const sessions = new PtyManager(app.getVersion(), {
  onData: (sessionId, data) => send(IPC.sessionData, sessionId, data),
  onExit: (sessionId, exitCode) => {
    meters.retire(sessionId)
    send(IPC.sessionExit, sessionId, exitCode)
  },
  usageFileFor: (sessionId) => meters.fileFor(sessionId)
})

function send(channel: string, ...args: unknown[]): void {
  if (window && !window.isDestroyed()) window.webContents.send(channel, ...args)
}

function sendMenuCommand(command: MenuCommand): void {
  send(IPC.menuCommand, command)
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
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!isTrusted(event)) throw new Error(`Rejected ${channel} from an unknown page`)
      return await handler(...(args as Args))
    } catch (error) {
      bugLog.record({ kind: 'ipc-error', ...describeProblem(error), detail: { channel } })
      throw error
    }
  })
}

function listen<Args extends unknown[]>(channel: string, handler: (...args: Args) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrusted(event)) handler(...(args as Args))
  })
}

function registerIpc(
  store: StateStore,
  installed: Promise<string[]>,
  catalogue: ModelCatalogue
): void {
  handle(IPC.loadState, () => store.get())

  handle(IPC.installedLaunchers, () => installed)

  handle(IPC.loadCatalogue, () => catalogue.load())

  listen(IPC.saveChoice, (projectId: string, choice: unknown) =>
    store.saveChoice(projectId, choice)
  )

  handle(IPC.listChats, (projectId: unknown, launcherId: unknown) => {
    // Found by what Telegraph knows of them: the window does not get to name a folder to read.
    const { projects, launchers } = store.get()
    const project = projects.find((candidate) => candidate.id === projectId)
    const launcher = launchers.find((candidate) => candidate.id === launcherId)
    if (!project || launcher?.chats?.kind !== 'claude') return []
    return listChats({ configDir: claudeConfigDir, projectPath: project.path })
  })

  listen(IPC.notify, (notice: unknown) => notifier.notify(notice))

  listen(IPC.withdrawNotice, (sessionId: unknown) => notifier.withdraw(sessionId))

  listen(IPC.setBadge, (count: unknown) => notifier.badge(count))

  ipcMain.on(IPC.theme, (event) => {
    event.returnValue = isTrusted(event) ? store.get().theme : DEFAULT_THEME
  })

  listen(IPC.setTheme, (chosen: unknown) => applyTheme(store, chosen))

  handle(IPC.readUsage, async () => ({
    ...meters.read(),
    days: await readDays(),
    reporting: !hasOwnStatusLine(claudeConfigDir)
  }))

  handle(IPC.addProject, async () => {
    if (!window) return null
    const result = await dialog.showOpenDialog(window, {
      title: 'Add project',
      buttonLabel: 'Add project',
      properties: ['openDirectory', 'createDirectory']
    })
    const folder = result.filePaths[0]
    if (result.canceled || !folder) return null
    return store.addProject(folder)
  })

  handle(IPC.removeProject, (projectId: string) => store.removeProject(projectId))

  handle(IPC.gitStatus, (projectPath: string) => readGitStatus(projectPath))

  handle(IPC.createSession, (request: CreateSessionRequest): CreateSessionResult => {
    try {
      sessions.create({ ...request, command: commandFor(request) })
      return { ok: true }
    } catch (error) {
      bugLog.record({ kind: 'session-failure', ...describeProblem(error) })
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  handle(IPC.closeSession, async (sessionId: string) => {
    const running = sessions.foregroundProcess(sessionId)
    if (running !== null && window && !isE2E) {
      const { response } = await dialog.showMessageBox(window, {
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

  listen(IPC.write, (sessionId: string, data: string) => sessions.write(sessionId, data))

  listen(IPC.resize, (sessionId: string, cols: number, rows: number) =>
    sessions.resize(sessionId, cols, rows)
  )

  listen(IPC.openExternal, (url: string) => openInBrowser(url))

  handle(IPC.saveAttachment, (type: unknown, data: unknown) => attachments.save(type, data))

  handle(IPC.report, (report: unknown) => {
    const checked = checkWindowReport(report)
    return checked !== null && bugLog.record(checked) !== null
  })

  listen(IPC.reporting, () => {
    pageReports = true
  })
}

/** Keeps the theme, colours the window behind the page with it, and tells the page and the menu. */
function applyTheme(store: StateStore, chosen: unknown): void {
  const found = THEMES.find((candidate) => candidate.name === chosen)
  if (!found) return
  store.saveTheme(found.name)
  theme = found.name
  if (window && !window.isDestroyed()) window.setBackgroundColor(found.background)
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

function confirmQuit(target: BrowserWindow): boolean {
  const busy = sessions.busySessionCount()
  if (busy === 0 || isE2E) return true
  const response = dialog.showMessageBoxSync(target, {
    type: 'warning',
    message: 'Quit Telegraph?',
    detail:
      busy === 1
        ? 'One session is still running. Quitting stops it.'
        : `${busy} sessions are still running. Quitting stops them.`,
    buttons: ['Quit', 'Cancel'],
    defaultId: 1,
    cancelId: 1
  })
  return response === 0
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1320,
    height: 860,
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
  const created = window

  watchWindow(bugLog, created, {
    pageReports: () => pageReports,
    onCrash: () => void offerReload(created)
  })

  created.once('ready-to-show', () => (isE2E ? created.showInactive() : created.show()))

  created.on('close', (event) => {
    if (quitConfirmed) return
    if (confirmQuit(created)) {
      quitConfirmed = true
    } else {
      event.preventDefault()
    }
  })

  created.on('closed', () => {
    window = null
  })

  // Asked for a look by a notice, and looked at now.
  created.on('focus', () => created.flashFrame(false))

  // A reloaded page has lost track of its sessions, so they cannot be
  // reached any more and would keep running unseen.
  created.webContents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return
    sessions.killAll()
    notifier.clear()
    pageReports = false
  })

  // The page that is going can still tell of its sessions ending, after it was cleared up behind.
  created.webContents.on('did-finish-load', () => {
    notifier.clear()
    // A theme chosen while the page was loading was told of before it could hear it.
    send(IPC.themeChanged, theme)
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
  app.on('second-instance', () => {
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.on('window-all-closed', () => app.quit())
  app.on('will-quit', () => {
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

    const setMenu = (offered: typeof launchers): void =>
      Menu.setApplicationMenu(
        buildMenu({
          launchers: offered,
          includeDeveloperTools: !app.isPackaged,
          send: sendMenuCommand,
          showBugLog,
          theme,
          setTheme: (chosen) => applyTheme(store, chosen)
        })
      )
    setMenu(launchers)
    void installed.then((ids) => setMenu(launchers.filter((launcher) => ids.includes(launcher.id))))
    createWindow()
  })
}
