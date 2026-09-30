import { mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Limit, Limits, SessionMeter } from '@shared/types'

export { STATUS_LINE_SETTINGS, USAGE_FILE_VARIABLE } from '@shared/usage'

const KEPT_FOR_MS = 7 * 24 * 60 * 60 * 1000
const ENDING = '.json'
// A session is named by the window, and its name becomes the name of a file.
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

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

/**
 * What the sessions report of themselves: how much of the limits of the plan
 * is used, what a session has cost, how full its context is. Each session of
 * Claude Code writes what it knows to a file of its own, whenever it changes.
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
    let limits: Limits | null = null
    // The limits are those of the account, so the session that reported last knows them best.
    for (const { name, path, at } of this.reports().reverse()) {
      const status = parse(path)
      if (status === null) continue
      sessions[name.slice(0, -ENDING.length)] = readSession(status)
      limits ??= readLimits(status, at, this.now())
    }
    return { limits, sessions }
  }

  /** Removes the reports of more than a week ago, except the last, which still knows the limits. */
  clearOld(): void {
    for (const { path, at } of this.reports().slice(0, -1)) {
      if (this.now() - at > KEPT_FOR_MS) rmSync(path, { force: true })
    }
  }

  /** The oldest first. */
  private reports(): { name: string; path: string; at: number }[] {
    try {
      return readdirSync(this.options.directory)
        .filter((name) => name.endsWith(ENDING))
        .map((name) => {
          const path = join(this.options.directory, name)
          return { name, path, at: statSync(path).mtimeMs }
        })
        .sort((one, other) => one.at - other.at)
    } catch {
      return []
    }
  }
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

function readSession(status: Record<string, unknown>): SessionMeter {
  const model = part(status.model, 'display_name')
  return {
    model: typeof model === 'string' && model !== '' ? model : null,
    costUsd: number(part(status.cost, 'total_cost_usd')),
    contextPercent: number(part(status.context_window, 'used_percentage'))
  }
}

function readLimits(status: Record<string, unknown>, at: number, now: number): Limits | null {
  const fiveHour = readLimit(part(status.rate_limits, 'five_hour'), now)
  const week = readLimit(part(status.rate_limits, 'seven_day'), now)
  if (fiveHour === null && week === null) return null
  return { fiveHour, week, at: new Date(at).toISOString() }
}

function readLimit(value: unknown, now: number): Limit | null {
  const used = number(part(value, 'used_percentage'))
  if (used === null) return null
  const resets = number(part(value, 'resets_at'))
  // Past the time it starts over, what was used no longer counts.
  if (resets !== null && resets * 1000 <= now) return { usedPercent: 0, resetsAt: null }
  return {
    usedPercent: Math.min(100, Math.max(0, used)),
    resetsAt: resets === null ? null : new Date(resets * 1000).toISOString()
  }
}
