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
  loadState: () => ipcRenderer.invoke(IPC.loadState),
  addProject: () => ipcRenderer.invoke(IPC.addProject),
  removeProject: (projectId) => ipcRenderer.invoke(IPC.removeProject, projectId),
  installedLaunchers: () => ipcRenderer.invoke(IPC.installedLaunchers),
  loadCatalogue: () => ipcRenderer.invoke(IPC.loadCatalogue),
  saveChoice: (projectId, choice) => ipcRenderer.send(IPC.saveChoice, projectId, choice),
  listChats: (projectId, launcherId) => ipcRenderer.invoke(IPC.listChats, projectId, launcherId),
  gitStatus: (projectPath) => ipcRenderer.invoke(IPC.gitStatus, projectPath),
  createSession: (request) => ipcRenderer.invoke(IPC.createSession, request),
  closeSession: (sessionId) => ipcRenderer.invoke(IPC.closeSession, sessionId),
  write: (sessionId, data) => ipcRenderer.send(IPC.write, sessionId, data),
  resize: (sessionId, cols, rows) => ipcRenderer.send(IPC.resize, sessionId, cols, rows),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  pathOf: (file) => webUtils.getPathForFile(file),
  saveAttachment: (type, data) => ipcRenderer.invoke(IPC.saveAttachment, type, data),
  report: (report) => ipcRenderer.invoke(IPC.report, report),
  reporting: () => ipcRenderer.send(IPC.reporting),
  onSessionData: (listener) => subscribe(IPC.sessionData, listener),
  onSessionExit: (listener) => subscribe(IPC.sessionExit, listener),
  onMenuCommand: (listener) => subscribe(IPC.menuCommand, listener),
  onProblem: (listener) => subscribe(IPC.problem, listener)
}

contextBridge.exposeInMainWorld('telegraph', api)
