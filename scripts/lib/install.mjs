// Puts a newly built app in the place of the installed one.
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'

const CHECK_EVERY_MS = 1000
const DAY_MS = 24 * 60 * 60 * 1000

function copyApp(from, to) {
  cpSync(from, to, { recursive: true, verbatimSymlinks: true })
}

// By the program alone, without what it was started with: a command that only names Telegraph is not Telegraph.
const MAIN_PROCESS = /^\s*\d+\s+(\/.*\/Telegraph\.app)\/Contents\/MacOS\/Telegraph$/
const LAUNCH_CHECKS = 20
const LAUNCH_CHECK_EVERY_MS = 500

function listProcesses() {
  return execFileSync('ps', ['-axo', 'pid=,comm='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/**
 * The copies of Telegraph that are running, each by the path of its app.
 * Telegraph can run from more than one place: the one that was installed,
 * and the one that was built, which macOS knows as the same app.
 */
export function findRunning(list = listProcesses()) {
  return list.split('\n').flatMap((line) => MAIN_PROCESS.exec(line.trimEnd())?.[1] ?? [])
}

/** True while the app at the path is running. */
export function isRunning(destination) {
  try {
    return findRunning().includes(destination)
  } catch {
    // Better taken for running, and left alone, than replaced while it runs.
    return true
  }
}

const launching = {
  // A new one of this very copy: macOS would otherwise bring up whichever copy it thinks of first.
  open: (destination) => execFileSync('open', ['-n', destination], { stdio: 'ignore' }),
  start: (destination) =>
    spawn(`${destination}/Contents/MacOS/Telegraph`, [], { detached: true, stdio: 'ignore' }).unref(),
  running: () => findRunning(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Starts the app at the path and makes sure it is that one that runs.
 * Resolves to 'opened', to 'started' when macOS did not start it and it was
 * started without its help, or to 'another' when a different copy came up.
 */
export async function launchExactly(destination, tools = launching) {
  try {
    tools.open(destination)
    for (let check = 0; check < LAUNCH_CHECKS; check++) {
      const running = tools.running()
      if (running.includes(destination)) return 'opened'
      if (running.length > 0) return 'another'
      await tools.sleep(LAUNCH_CHECK_EVERY_MS)
    }
  } catch {
    // Started below.
  }
  tools.start(destination)
  return 'started'
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
