import type { GitStatus, Tokens } from '@shared/types'

export function describeGit(git: GitStatus): string {
  const branch = git.branch ?? 'detached'
  return git.changedFiles === 0 ? branch : `${branch}, ${git.changedFiles} changed`
}

export function shortenPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~')
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** How long ago a time was, in the words one would use: hours for today, days for this week, the date beyond. */
export function describeAge(time: string, now = new Date()): string {
  const then = new Date(time)
  if (Number.isNaN(then.getTime())) return ''

  const passed = now.getTime() - then.getTime()
  if (passed < MINUTE_MS) return 'just now'
  if (passed < HOUR_MS) return plural(Math.floor(passed / MINUTE_MS), 'minute')

  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY_MS)
  if (days === 0 || passed < 12 * HOUR_MS) return plural(Math.floor(passed / HOUR_MS), 'hour')
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`

  const day = `${then.getDate()} ${MONTHS[then.getMonth()]}`
  return then.getFullYear() === now.getFullYear() ? day : `${day} ${then.getFullYear()}`
}

function startOfDay(time: Date): number {
  return new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime()
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}

const UNITS = [
  { size: 1e9, sign: 'B' },
  { size: 1e6, sign: 'M' },
  { size: 1e3, sign: 'K' }
]

/** A count in three figures at most: 486, 47.6K, 1.05M. */
export function compact(count: number): string {
  for (const [index, { size, sign }] of UNITS.entries()) {
    if (count < size) continue
    const figures = Number((count / size).toPrecision(3))
    // 999,950 is a million, not a thousand thousands.
    if (figures >= 1000 && index > 0) return `1${UNITS[index - 1]!.sign}`
    return `${figures}${sign}`
  }
  return String(Math.round(count))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** When a limit starts over: how long it is until then, or the day and the hour if that is far off. */
export function describeReset(time: string, now = new Date()): string {
  const then = new Date(time)
  const left = then.getTime() - now.getTime()
  if (Number.isNaN(left) || left <= 0) return ''
  if (left < MINUTE_MS) return 'in under a minute'
  if (left < 12 * HOUR_MS) {
    const hours = Math.floor(left / HOUR_MS)
    const minutes = Math.floor((left % HOUR_MS) / MINUTE_MS)
    return `in ${[hours > 0 ? `${hours} h` : '', minutes > 0 ? `${minutes} min` : ''].filter(Boolean).join(' ')}`
  }
  const clock = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  return `on ${WEEKDAYS[then.getDay()]} at ${clock}`
}

const CLAUDE_MODEL = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/

/** The name of a model the way it is said: "Opus 5.5" for claude-opus-5-5. */
export function modelName(id: string): string {
  const [, make, major, minor] = CLAUDE_MODEL.exec(id) ?? []
  if (!make || !major) return id
  return `${make[0]!.toUpperCase()}${make.slice(1)} ${major}${minor ? `.${minor}` : ''}`
}

/**
 * What answers took that was new: read for the first time, or written. What
 * was read again from the cache is the same text over and over, many times
 * the rest, and is told apart.
 */
export function newTokens(tokens: Tokens): number {
  return tokens.input + tokens.cacheWrite + tokens.output
}

/** A share as a whole figure. Nearly all is not all: only what is all used up reads 100. */
export function wholePercent(percent: number): number {
  return percent >= 100 ? 100 : Math.min(99, Math.round(percent))
}

/** When a meeting is: its hour today, or the day and the hour if it is not today. */
export function describeMeetingTime(time: string, now = new Date()): string {
  const then = new Date(time)
  if (Number.isNaN(then.getTime())) return ''
  const clock = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  const sameDay = then.toDateString() === now.toDateString()
  return sameDay ? `at ${clock}` : `${WEEKDAYS[then.getDay()]} at ${clock}`
}
