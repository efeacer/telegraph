/** Kinds of problem the window may report. Everything else is for the main process to say. */
export const WINDOW_KINDS = ['window-error', 'window-rejection', 'render-error', 'bug-report'] as const

export type WindowProblemKind = (typeof WINDOW_KINDS)[number]

export type ProblemKind =
  | WindowProblemKind
  | 'main-error'
  | 'main-rejection'
  | 'ipc-error'
  | 'session-failure'
  | 'state-unreadable'
  | 'console-error'
  | 'window-crash'
  | 'child-crash'
  | 'window-unresponsive'
  | 'load-failure'
  | 'preload-error'
  | 'unclean-exit'

export interface Problem {
  kind: ProblemKind
  message: string
  stack?: string
  /** A few facts about the situation. Never anything from a terminal. */
  detail?: Record<string, unknown>
}

export interface WindowReport extends Problem {
  kind: WindowProblemKind
}

/** The build a problem came from. */
export interface BuildInfo {
  version: string
  builtAt: string
  packaged: boolean
  electron: string
  platform: string
}

/** One line of the bug log. */
export interface LogEntry extends Problem {
  at: string
  /** The run of the app the entry belongs to. */
  run: string
  /** The same for every occurrence of the same problem. */
  fingerprint: string
  /** How often this run has met the problem so far. */
  count: number
  build: BuildInfo
}

/** Longest text the log keeps, in characters. */
export const LIMITS = {
  message: 4_000,
  stack: 8_000,
  detail: 4_000
} as const

const MAX_CAUSES = 5
const INDESCRIBABLE = 'Something that could not be described'

// A single quote only opens a quotation at the start of a word, which keeps apostrophes.
const QUOTED = /"[^"\n]*"|`[^`\n]*`|“[^”\n]*”|(?<!\w)'[^'\n]*'(?!\w)/g

export function clip(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

/**
 * What a message quotes is often not its own: a library that fails on a
 * character from a terminal will name that character.
 */
export function withoutQuotes(text: string): string {
  return text.replace(QUOTED, (quoted) => `${quoted[0]}…${quoted.at(-1)}`)
}

/**
 * Anything can be thrown, so anything can be described. This runs where an
 * error of its own would end the app, so it never throws.
 */
export function describeProblem(thrown: unknown): { message: string; stack?: string } {
  try {
    return describe(thrown)
  } catch {
    return { message: INDESCRIBABLE }
  }
}

function describe(thrown: unknown): { message: string; stack?: string } {
  if (!(thrown instanceof Error)) return { message: clip(describeValue(thrown), LIMITS.message) }
  const described: { message: string; stack?: string } = {
    message: clip(describeError(thrown), LIMITS.message)
  }
  if (typeof thrown.stack === 'string') described.stack = clip(thrown.stack, LIMITS.stack)
  return described
}

function describeError(error: Error): string {
  let text = titleOf(error)
  const seen = new Set<unknown>([error])
  let cause = error.cause
  while (cause !== undefined && cause !== null && !seen.has(cause) && seen.size <= MAX_CAUSES) {
    seen.add(cause)
    text += ` (caused by ${cause instanceof Error ? titleOf(cause) : describeValue(cause)})`
    cause = cause instanceof Error ? cause.cause : undefined
  }
  return text
}

function titleOf(error: Error): string {
  return error.message ? `${error.name}: ${error.message}` : error.name
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // Not everything can be written as JSON, or as text.
  }
  try {
    return String(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/** Reports cross from the window as plain data, so nothing about them is taken on trust. */
export function checkWindowReport(value: unknown): WindowReport | null {
  if (typeof value !== 'object' || value === null) return null
  const { kind, message, stack, detail } = value as Record<string, unknown>
  if (!WINDOW_KINDS.includes(kind as WindowProblemKind)) return null
  if (typeof message !== 'string' || message.trim() === '') return null

  const report: WindowReport = {
    kind: kind as WindowProblemKind,
    message: clip(message, LIMITS.message)
  }
  if (typeof stack === 'string') report.stack = clip(stack, LIMITS.stack)
  if (isSmallRecord(detail)) report.detail = detail
  return report
}

function isSmallRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    return JSON.stringify(value).length <= LIMITS.detail
  } catch {
    return false
  }
}
