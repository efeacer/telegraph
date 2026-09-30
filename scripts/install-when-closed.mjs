// Installs the packaged app once Telegraph has been closed, and opens it again.
//
// Replacing the app while it runs would end every session in it, and an agent
// working in one of them cannot close the app it runs in. So this waits in the
// background, for up to a day, until the user closes Telegraph.
//
//   npm run install:when-closed               waits, then installs and opens
//   npm run install:when-closed -- --cancel   stops waiting
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { findRunning, launchExactly, replaceApp, waitUntilClosed } from './lib/install.mjs'

const APP_NAME = 'Telegraph.app'
const dist = join(import.meta.dirname, '..', 'dist')
const logPath = join(dist, 'install-when-closed.log')
const pidPath = join(dist, 'install-when-closed.pid')

const { values } = parseArgs({
  options: {
    cancel: { type: 'boolean', default: false },
    // Where the app goes, and whether to open it: other than the usual for trying this out.
    to: { type: 'string', default: join('/Applications', APP_NAME) },
    'no-open': { type: 'boolean', default: false },
    waiting: { type: 'boolean', default: false }
  }
})
const destination = values.to
// In a folder Spotlight leaves alone: a second copy that can be found is a second copy that can be started.
const backup = join(dist, 'previous.noindex', APP_NAME)
const REGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister'

if (values.cancel) cancel()
else if (values.waiting) await waitAndInstall()
else startWaiting()

function findPackaged() {
  if (!existsSync(dist)) return undefined
  return readdirSync(dist)
    .filter((entry) => entry.startsWith('mac'))
    .map((entry) => join(dist, entry, APP_NAME))
    .find((candidate) => existsSync(candidate))
}

function waitingProcess() {
  try {
    const pid = Number(readFileSync(pidPath, 'utf8'))
    process.kill(pid, 0)
    return pid
  } catch {
    return null
  }
}

function startWaiting() {
  if (!findPackaged()) {
    console.error(`No ${APP_NAME} in ${dist}. Run "npm run package" first.`)
    process.exit(1)
  }
  if (waitingProcess() !== null) {
    console.log('Already waiting for Telegraph to be closed.')
    return
  }
  mkdirSync(dist, { recursive: true })
  const log = openSync(logPath, 'a')
  const forwarded = process.argv.slice(2)
  // Of a session of its own, so that it outlives the terminal it was started in.
  const child = spawn(process.execPath, [import.meta.filename, '--waiting', ...forwarded], {
    detached: true,
    stdio: ['ignore', log, log]
  })
  child.unref()
  writeFileSync(pidPath, String(child.pid))
  console.log(
    anyRunning()
      ? `Waiting for Telegraph to be closed. Then ${destination} is replaced and opened.`
      : `Telegraph is closed. Installing ${destination} now.`
  )
  console.log(`The app it replaces is kept in ${backup}. What happens is written to ${logPath}.`)
}

function cancel() {
  const pid = waitingProcess()
  if (pid === null) {
    console.log('Nothing is waiting.')
    return
  }
  process.kill(pid)
  rmSync(pidPath, { force: true })
  console.log('Stopped waiting. Nothing was installed.')
}

/** Telegraph counts as running wherever it runs from: the user may have started another copy than the installed one. */
function anyRunning() {
  try {
    return findRunning().length > 0
  } catch {
    return true
  }
}

/** Takes a copy of the app out of what macOS knows, so that it is not started in place of the installed one. */
function forget(path) {
  try {
    execFileSync(REGISTER, ['-u', path], { stdio: 'ignore' })
  } catch {
    // It stays known, which the way the app is started makes up for.
  }
}

function note(text) {
  appendFileSync(logPath, `${new Date().toISOString()} ${text}\n`)
}

/** Says it where the user will see it: by now there is no terminal to say it in. */
function tell(text) {
  try {
    const script = `display dialog ${JSON.stringify(text)} with title "Telegraph" buttons {"OK"} default button 1`
    execFileSync('osascript', ['-e', script], { stdio: 'ignore' })
  } catch {
    // Written to the log as well.
  }
}

async function waitAndInstall() {
  const source = findPackaged()
  note(`waiting for ${destination} to be closed`)
  try {
    if (!(await waitUntilClosed({ isRunning: anyRunning }))) {
      note('gave up: Telegraph was not closed within a day')
      return
    }
    note(`closed, installing ${source}`)
    replaceApp({ source, destination, backup })
    note('installed')
    // The copy that was built has done its part. Left behind, it is an app like the installed one.
    rmSync(source, { recursive: true, force: true })
    forget(source)
    forget(backup)
    forget(join(dist, 'previous', APP_NAME))
    rmSync(join(dist, 'previous'), { recursive: true, force: true })
    if (!values['no-open']) {
      const how = await launchExactly(destination)
      note(`${how}: ${findRunning().join(', ') || 'nothing runs yet'}`)
      if (how === 'another') tell(`Another copy of Telegraph came up than the new one in ${destination}. Close it and open that one.`)
    }
  } catch (error) {
    note(`failed: ${error instanceof Error ? error.stack : String(error)}`)
    if (!values['no-open']) {
      if (existsSync(destination)) await launchExactly(destination).catch(() => {})
      tell(
        `The new Telegraph could not be installed, and the one you had is still there. ${error instanceof Error ? error.message : error}`
      )
    }
  } finally {
    rmSync(pidPath, { force: true })
  }
}
