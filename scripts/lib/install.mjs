// Puts a newly built app in the place of the installed one.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

const CHECK_EVERY_MS = 1000
const DAY_MS = 24 * 60 * 60 * 1000

function copyApp(from, to) {
  cpSync(from, to, { recursive: true, verbatimSymlinks: true })
}

/** True while the app at the path, or any part of it, is running. */
export function isRunning(destination) {
  try {
    // With the processes this one descends from: started in a session of
    // Telegraph, this script is one of them, and would not see it otherwise.
    execFileSync('pgrep', ['-a', '-f', `${destination}/Contents/MacOS/`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Copies the app next to where it goes and then moves it into place, so that
 * there is a whole app at the destination at every moment but one. The app
 * that was there is kept as the backup. If anything fails, the app that was
 * there is there again, and the error is thrown.
 */
export function replaceApp({ source, destination, backup, copy = copyApp, move }) {
  if (!existsSync(source)) throw new Error(`No app at ${source}. Run "npm run package" first.`)
  const moveApp = move ? (from, to) => move(from, to, renameSync) : renameSync
  const arriving = `${destination}.installing`

  rmSync(arriving, { recursive: true, force: true })
  try {
    copy(source, arriving)
  } catch (error) {
    rmSync(arriving, { recursive: true, force: true })
    throw error
  }

  const replaces = existsSync(destination)
  if (replaces) {
    rmSync(backup, { recursive: true, force: true })
    mkdirSync(dirname(backup), { recursive: true })
    moveApp(destination, backup)
  }
  try {
    moveApp(arriving, destination)
  } catch (error) {
    if (replaces) renameSync(backup, destination)
    rmSync(arriving, { recursive: true, force: true })
    throw error
  }
}

/**
 * Resolves to true once the app is closed, and to false if it is still
 * running when the time is up. An app ends its processes one after another,
 * so it counts as closed when it is not running twice in a row.
 */
export async function waitUntilClosed({
  isRunning: running,
  timeoutMs = DAY_MS,
  intervalMs = CHECK_EVERY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now
}) {
  const started = now()
  if (!running()) return true
  let closedBefore = false
  while (now() - started < timeoutMs) {
    await sleep(intervalMs)
    const closed = !running()
    if (closed && closedBefore) return true
    closedBefore = closed
  }
  return false
}
