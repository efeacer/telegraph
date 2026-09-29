import { describeProblem, type WindowReport } from '@shared/buglog'

// Chromium raises this when a resize handler causes another resize. The
// notifications arrive a frame later and nothing is lost.
const HARMLESS = /^ResizeObserver loop/

/** Resolves to false when the report could not be saved. */
export async function report(problem: WindowReport): Promise<boolean> {
  try {
    return await window.telegraph.report(problem)
  } catch {
    // Reporting this would only fail the same way.
    return false
  }
}

function describeEvent(event: ErrorEvent): Omit<WindowReport, 'kind'> {
  if (event.error !== null && event.error !== undefined) return describeProblem(event.error)
  return {
    message: event.message,
    detail: { source: event.filename, line: event.lineno, column: event.colno }
  }
}

window.addEventListener('error', (event) => {
  if (HARMLESS.test(event.message)) return
  void report({ kind: 'window-error', ...describeEvent(event) })
})

window.addEventListener('unhandledrejection', (event) => {
  void report({ kind: 'window-rejection', ...describeProblem(event.reason) })
})

window.telegraph.reporting()
