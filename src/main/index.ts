import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { E2E_ARGUMENT, IPC } from '@shared/ipc'
import type { CreateSessionRequest, CreateSessionResult, MenuCommand } from '@shared/types'
import { readGitStatus } from './git'
import { buildMenu } from './menu'
import { PtyManager } from './pty'
import { StateStore } from './store'

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

let window: BrowserWindow | null = null
let quitConfirmed = false

const sessions = new PtyManager(app.getVersion(), {
  onData: (sessionId, data) => send(IPC.sessionData, sessionId, data),
  onExit: (sessionId, exitCode) => send(IPC.sessionExit, sessionId, exitCode)
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
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrusted(event)) throw new Error(`Rejected ${channel} from an unknown page`)
    return handler(...(args as Args))
  })
}

function listen<Args extends unknown[]>(channel: string, handler: (...args: Args) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrusted(event)) handler(...(args as Args))
  })
}

function registerIpc(store: StateStore): void {
  handle(IPC.loadState, () => store.get())

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
      sessions.create(request)
      return { ok: true }
    } catch (error) {
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
    backgroundColor: '#15202a',
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

  created.once('ready-to-show', () => created.show())

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

  // A reloaded page has lost track of its sessions, so they cannot be
  // reached any more and would keep running unseen.
  created.webContents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) sessions.killAll()
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
  app.on('will-quit', () => sessions.killAll())

  void app.whenReady().then(() => {
    const store = new StateStore(join(app.getPath('userData'), 'state.json'))
    registerIpc(store)
    Menu.setApplicationMenu(
      buildMenu({
        launchers: store.get().launchers,
        includeDeveloperTools: !app.isPackaged,
        send: sendMenuCommand
      })
    )
    createWindow()
  })
}
