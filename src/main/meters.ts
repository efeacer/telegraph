import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Limit, Limits, SessionMeter } from '@shared/types'

export { STATUS_LINE_SETTINGS, USAGE_FILE_VARIABLE } from '@shared/usage'

const ENDING = '.json'
// Not a name a session can have, so that it is never taken for the report of one.
const KEPT_FILE = '_limits.json'
// A session is named by the window, and its name becomes the name of a file.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
// Sessions report with every answer. Reports in a row are told of once, but not held back for long.
const SETTLE_MS = 150
const AT_MOST_MS = 1000

export interface MetersOptions {
  directory: string
  now?: () => number
}

export interface Readings {
  /** Null until a session has reported them. */
  limits: Limits | null
  /** By the id Telegraph knows the session by. */
  sessions: Record<string, SessionMeter>
}

/** What one report says of one limit. */
interface Reading {
  usedPercent: number
  /** When the stretch of time it counts for ends, if the report says. */
  resetsAt: number | null
  /** When it was reported. */
  at: number
}

interface Windows {
  fiveHour: Reading[]
  week: Reading[]
}

/**
 * What the sessions report of themselves: how much of the limits of the plan
 * is used, what a session has cost, how full its context is. Each session of
 * Claude Code writes what it knows to a file of its own, whenever it changes.
 *
 * A report holds more than Telegraph reads, the folder and the name of the
 * session among it. When a session ends, only what it knew of the limits is
 * kept.
 */
export class Meters {
  private readonly now: () => number

  constructor(private readonly options: MetersOptions) {
    this.now = options.now ?? Date.now
  }

  /** The file a session is to report to, or null for a name that is no name for a file. */
  fileFor(sessionId: string): string | null {
    if (!SESSION_ID.test(sessionId)) return null
    try {
      mkdirSync(this.options.directory, { recursive: true, mode: 0o700 })
    } catch {
      return null
    }
    return join(this.options.directory, `${sessionId}${ENDING}`)
  }

  read(): Readings {
    const sessions: Record<string, SessionMeter> = {}
    const windows = this.kept()
    for (const { sessionId, path, at } of this.reports()) {
      const status = parse(path)
      if (status === null) continue
      sessions[sessionId] = readSession(status)
      collect(windows, status, at)
    }
    return { limits: choose(windows, this.now()), sessions }
  }

  /** Forgets a session that has ended, but for what it knew of the limits. */
  retire(sessionId: string): void {
    const found = this.reports().find((report) => report.sessionId === sessionId)
    if (found) this.keep([found])
  }

  /** Forgets the sessions of the last time Telegraph ran, none of which goes on. */
  retireAll(): void {
    this.keep(this.reports())
  }

  /** Calls back when a session has reported. Never throws: without it, reports are read when asked for. */
  watch(onReport: () => void): void {
    try {
      mkdirSync(this.options.directory, { recursive: true, mode: 0o700 })
      let settling: NodeJS.Timeout | null = null
      let waitingSince = 0
      const tell = (): void => {
        settling = null
        onReport()
      }
      watch(this.options.directory, (_event, name) => {
        if (!name?.endsWith(ENDING)) return
        const now = Date.now()
        if (settling) clearTimeout(settling)
        else waitingSince = now
        // Several busy sessions report without a pause between them.
        settling = setTimeout(tell, Math.max(0, Math.min(SETTLE_MS, waitingSince + AT_MOST_MS - now)))
      }).on('error', () => {})
    } catch {
      // The folder cannot be watched.
    }
  }

  private keep(reports: { path: string; at: number }[]): void {
    if (reports.length === 0) return
    const windows = this.kept()
    for (const { path, at } of reports) {
      const status = parse(path)
      if (status !== null) collect(windows, status, at)
    }
    // One reading of each limit says all that the ended sessions knew of it.
    const now = this.now()
    const kept = {
      fiveHour: [best(windows.fiveHour, now)].filter((reading) => reading !== null),
      week: [best(windows.week, now)].filter((reading) => reading !== null)
    }
    try {
      const path = join(this.options.directory, KEPT_FILE)
      writeFileSync(`${path}.tmp`, JSON.stringify(kept), { mode: 0o600 })
      renameSync(`${path}.tmp`, path)
      for (const report of reports) rmSync(report.path, { force: true })
    } catch {
      // The reports stay, and are kept the next time.
    }
  }

  /** What the ended sessions knew of the limits. */
  private kept(): Windows {
    const kept = parse(join(this.options.directory, KEPT_FILE))
    const readings = (value: unknown): Reading[] =>
      Array.isArray(value) ? value.filter(isReading) : []
    return { fiveHour: readings(kept?.fiveHour), week: readings(kept?.week) }
  }

  /** The reports of the sessions. */
  private reports(): { sessionId: string; path: string; at: number }[] {
    try {
      return readdirSync(this.options.directory).flatMap((name) => {
        const sessionId = name.endsWith(ENDING) ? name.slice(0, -ENDING.length) : ''
        if (!SESSION_ID.test(sessionId)) return []
        const path = join(this.options.directory, name)
        return [{ sessionId, path, at: statSync(path).mtimeMs }]
      })
    } catch {
      return []
    }
  }
}

/**
 * True for a user, or a project, that has set up a status line of its own.
 * Settings given for one session take the place of it, so such sessions are
 * not asked to report.
 */
export function hasOwnStatusLine(configDir: string, projectPath?: string): boolean {
  const files = [join(configDir, 'settings.json')]
  if (projectPath !== undefined) {
    files.push(
      join(projectPath, '.claude', 'settings.json'),
      join(projectPath, '.claude', 'settings.local.json')
    )
  }
  return files.some((file) => parse(file)?.statusLine !== undefined)
}

// What Claude Code hands over is its own, and read as far as it can be made out.
function parse(path: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function part(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isReading(value: unknown): value is Reading {
  const resetsAt = part(value, 'resetsAt')
  return (
    number(part(value, 'usedPercent')) !== null &&
    number(part(value, 'at')) !== null &&
    (resetsAt === null || number(resetsAt) !== null)
  )
}

function readSession(status: Record<string, unknown>): SessionMeter {
  const model = part(status.model, 'display_name')
  return {
    model: typeof model === 'string' && model !== '' ? model : null,
    costUsd: number(part(status.cost, 'total_cost_usd')),
    contextPercent: number(part(status.context_window, 'used_percentage'))
  }
}

function collect(windows: Windows, status: Record<string, unknown>, at: number): void {
  const take = (readings: Reading[], value: unknown): void => {
    const used = number(part(value, 'used_percentage'))
    if (used === null) return
    const resets = number(part(value, 'resets_at'))
    readings.push({
      usedPercent: Math.min(100, Math.max(0, used)),
      resetsAt: resets === null ? null : resets * 1000,
      at
    })
  }
  take(windows.fiveHour, part(status.rate_limits, 'five_hour'))
  take(windows.week, part(status.rate_limits, 'seven_day'))
}

/**
 * The reading to go by. A session knows a limit as of its last answer, and
 * writes its report anew without knowing anything new, so the latest report
 * is not the one that knows most. What counts is the stretch of time that is
 * running now, and within it the most that any session has seen used.
 */
function best(readings: Reading[], now: number): Reading | null {
  if (readings.length === 0) return null
  const running = readings.filter((reading) => reading.resetsAt === null || reading.resetsAt > now)
  // Every session knows a stretch that is over: what was used in it no longer counts.
  if (running.length === 0) {
    return { usedPercent: 0, resetsAt: null, at: Math.max(...readings.map((reading) => reading.at)) }
  }
  const timed = running.filter((reading) => reading.resetsAt !== null)
  if (timed.length === 0) return running.reduce((one, other) => (other.at > one.at ? other : one))
  const latest = Math.max(...timed.map((reading) => reading.resetsAt!))
  return timed
    .filter((reading) => reading.resetsAt === latest)
    .reduce((one, other) => (other.usedPercent > one.usedPercent ? other : one))
}

function choose(windows: Windows, now: number): Limits | null {
  const fiveHour = best(windows.fiveHour, now)
  const week = best(windows.week, now)
  if (fiveHour === null && week === null) return null
  const limit = (reading: Reading | null): Limit | null =>
    reading && {
      usedPercent: reading.usedPercent,
      resetsAt: reading.resetsAt === null ? null : new Date(reading.resetsAt).toISOString()
    }
  return {
    fiveHour: limit(fiveHour),
    week: limit(week),
    at: new Date(Math.max(fiveHour?.at ?? 0, week?.at ?? 0)).toISOString()
  }
}
