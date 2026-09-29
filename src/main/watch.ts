import { app, type BrowserWindow } from 'electron'
import { describeProblem, type LogEntry } from '@shared/buglog'
import type { BugLog } from './buglog'

// Chromium's code for a load that was called off, which happens whenever one
// navigation replaces another.
const LOAD_ABORTED = -3

export interface ProcessEvents {
  /** Called the first time this run meets an error nothing has caught. */
  onNewError(entry: LogEntry): void
}

export interface WindowEvents {
  /** True once the page reports its own errors, with more to say than its console has. */
  pageReports(): boolean
  onCrash(): void
}

/** Records what goes wrong in the main process and the processes that help it. */
export function watchProcess(log: BugLog, events: ProcessEvents): void {
  process.on('uncaughtException', (error) => {
    const entry = log.record({ kind: 'main-error', ...describeProblem(error) })
    if (entry?.count === 1) events.onNewError(entry)
  })

  process.on('unhandledRejection', (reason) => {
    log.record({ kind: 'main-rejection', ...describeProblem(reason) })
  })

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    log.record({
      kind: 'child-crash',
      message: `The ${details.name ?? details.type} process ended: ${details.reason}`,
      detail: { ...details }
    })
  })
}

/** Records what goes wrong in a window. */
export function watchWindow(log: BugLog, window: BrowserWindow, events: WindowEvents): void {
  const contents = window.webContents

  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    log.record({
      kind: 'window-crash',
      message: `The window's process ended: ${details.reason}`,
      detail: { ...details }
    })
    events.onCrash()
  })

  window.on('unresponsive', () => {
    log.record({ kind: 'window-unresponsive', message: 'The window stopped responding' })
  })

  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === LOAD_ABORTED) return
    log.record({
      kind: 'load-failure',
      message: `The window could not load: ${description}`,
      detail: { code, url }
    })
  })

  contents.on('preload-error', (_event, preloadPath, error) => {
    log.record({ kind: 'preload-error', ...describeProblem(error), detail: { preloadPath } })
  })

  contents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level !== 'error') return
    // The page reports these itself, and knows where they came from.
    if (events.pageReports() && message.startsWith('Uncaught ')) return
    log.record({
      kind: 'console-error',
      message,
      detail: { source: sourceId, line: lineNumber }
    })
  })
}
