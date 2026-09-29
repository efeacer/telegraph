import type { GitStatus } from '@shared/types'

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
