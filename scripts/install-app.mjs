// Copies the packaged app into /Applications.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const APP_NAME = 'Telegraph.app'
const destination = join('/Applications', APP_NAME)
const dist = join(import.meta.dirname, '..', 'dist')

const source = readdirSync(dist)
  .filter((entry) => entry.startsWith('mac'))
  .map((entry) => join(dist, entry, APP_NAME))
  .find((candidate) => existsSync(candidate))

if (!source) {
  console.error(`No ${APP_NAME} in ${dist}. Run "npm run package" first.`)
  process.exit(1)
}

if (isRunning()) {
  console.error(
    `${APP_NAME} is running. Replacing it would end every session in it.\n` +
      'Quit Telegraph, then run this again from another terminal.'
  )
  process.exit(1)
}

rmSync(destination, { recursive: true, force: true })
cpSync(source, destination, { recursive: true, verbatimSymlinks: true })
console.log(`Installed ${destination}`)

function isRunning() {
  try {
    // With the processes this one descends from: started in a session of
    // Telegraph, this script is one of them, and would not see it otherwise.
    execFileSync('pgrep', ['-a', '-f', `${destination}/Contents/MacOS/`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
