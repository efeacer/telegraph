import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { E2E_ARGUMENT, IPC } from '@shared/ipc'
import type { TelegraphApi } from '@shared/types'

function subscribe<Args extends unknown[]>(
  channel: string,
  listener: (...args: Args) => void
): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]): void => listener(...(args as Args))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: TelegraphApi = {
  e2e: process.argv.includes(E2E_ARGUMENT),
  // Asked for once and at once, so that the window is never drawn in the wrong colours.
  theme: ipcRenderer.sendSync(IPC.theme),
  setTheme: (theme) => ipcRenderer.send(IPC.setTheme, theme),
  onThemeChanged: (listener) => subscribe(IPC.themeChanged, listener),
  loadState: () => ipcRenderer.invoke(IPC.loadState),
  addProject: () => ipcRenderer.invoke(IPC.addProject),
  removeProject: (projectId) => ipcRenderer.invoke(IPC.removeProject, projectId),
  openFolder: (projectId) => ipcRenderer.send(IPC.openFolder, projectId),
  orderProjects: (projectIds) => ipcRenderer.send(IPC.orderProjects, projectIds),
  onStateChanged: (listener) => subscribe(IPC.stateChanged, listener),
  isCompanionHost: () => ipcRenderer.invoke(IPC.isCompanionHost),
  onCompanionHostChanged: (listener) => subscribe(IPC.companionHostChanged, listener),
  installedLaunchers: () => ipcRenderer.invoke(IPC.installedLaunchers),
  loadCatalogue: () => ipcRenderer.invoke(IPC.loadCatalogue),
  saveChoice: (projectId, choice) => ipcRenderer.send(IPC.saveChoice, projectId, choice),
  listChats: (projectId, launcherId) => ipcRenderer.invoke(IPC.listChats, projectId, launcherId),
  readUsage: () => ipcRenderer.invoke(IPC.readUsage),
  readAgenda: () => ipcRenderer.invoke(IPC.readAgenda),
  refreshAgenda: () => ipcRenderer.send(IPC.refreshAgenda),
  onAgendaChanged: (listener) => subscribe(IPC.agendaChanged, listener),
  sendSnapshot: (snapshot) => ipcRenderer.send(IPC.sendSnapshot, snapshot),
  onAskCompanion: (listener) => subscribe(IPC.askCompanion, listener),
  listConnections: () => ipcRenderer.invoke(IPC.listConnections),
  googleStatus: () => ipcRenderer.invoke(IPC.googleStatus),
  connectGoogle: () => ipcRenderer.invoke(IPC.connectGoogle),
  disconnectGoogle: () => ipcRenderer.invoke(IPC.disconnectGoogle),
  importGoogleClient: () => ipcRenderer.invoke(IPC.importGoogleClient),
  onGoogleChanged: (listener) => subscribe(IPC.googleChanged, listener),
  notify: (notice) => ipcRenderer.send(IPC.notify, notice),
  withdrawNotice: (sessionId) => ipcRenderer.send(IPC.withdrawNotice, sessionId),
  setBadge: (count) => ipcRenderer.send(IPC.setBadge, count),
  onOpenSession: (listener) => subscribe(IPC.openSession, listener),
  gitStatus: (projectPath) => ipcRenderer.invoke(IPC.gitStatus, projectPath),
  createSession: (request) => ipcRenderer.invoke(IPC.createSession, request),
  closeSession: (sessionId) => ipcRenderer.invoke(IPC.closeSession, sessionId),
  pauseSession: (sessionId) => ipcRenderer.invoke(IPC.pauseSession, sessionId),
  resumeSession: (sessionId) => ipcRenderer.invoke(IPC.resumeSession, sessionId),
  write: (sessionId, data) => ipcRenderer.send(IPC.write, sessionId, data),
  resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.resize, sessionId, cols, rows),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  pathOf: (file) => webUtils.getPathForFile(file),
  saveAttachment: (type, data, name) => ipcRenderer.invoke(IPC.saveAttachment, type, data, name),
  kindsOf: (paths) => ipcRenderer.invoke(IPC.kindsOf, paths),
  chooseAttachments: (projectPath) => ipcRenderer.invoke(IPC.chooseAttachments, projectPath),
  report: (report) => ipcRenderer.invoke(IPC.report, report),
  reporting: () => ipcRenderer.send(IPC.reporting),
  onSessionData: (listener) => subscribe(IPC.sessionData, listener),
  onSessionExit: (listener) => subscribe(IPC.sessionExit, listener),
  onMenuCommand: (listener) => subscribe(IPC.menuCommand, listener),
  onProblem: (listener) => subscribe(IPC.problem, listener),
  onUsageChanged: (listener) => subscribe(IPC.usageChanged, listener)
}

contextBridge.exposeInMainWorld('telegraph', api)
