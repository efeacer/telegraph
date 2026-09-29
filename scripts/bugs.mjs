// Prints what Telegraph has written to its bug log, as a list of problems to fix.
//
//   npm run bugs                                  the open problems
//   npm run bugs -- --all                         resolved ones too
//   npm run bugs -- --json                        as JSON
//   npm run bugs -- --dir <folder>                from another log folder
//   npm run bugs -- --resolve <fingerprint> "what fixed it"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { digest, parseLog, render, resolve } from './lib/digest.mjs'

// The installed app and development builds keep their data apart.
const APP_FOLDERS = ['Telegraph', 'Telegraph Dev']
// Oldest first.
const LOG_FILES = ['bugs.1.jsonl', 'bugs.jsonl']
const RESOLVED_FILE = join(import.meta.dirname, '..', 'docs', 'bug-log', 'resolved.json')

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    all: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    dir: { type: 'string', multiple: true },
    resolve: { type: 'string' }
  }
})

const folders = values.dir ?? APP_FOLDERS.map((name) => join(appData(), name, 'logs'))

if (values.resolve !== undefined) {
  markResolved(values.resolve, positionals.join(' ').trim())
} else {
  const groups = digest(folders.flatMap(readFolder), { resolved: readResolved(), all: values.all })
  process.stdout.write(values.json ? `${JSON.stringify(groups, null, 2)}\n` : render(groups, { folders }))
}

function appData() {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config')
}

function readFolder(folder) {
  return LOG_FILES.map((name) => join(folder, name))
    .filter((path) => existsSync(path))
    .flatMap((path) => parseLog(readFileSync(path, 'utf8')))
}

function readResolved() {
  if (!existsSync(RESOLVED_FILE)) return []
  try {
    const resolved = JSON.parse(readFileSync(RESOLVED_FILE, 'utf8'))
    if (Array.isArray(resolved)) return resolved
  } catch {
    // Reported below.
  }
  console.error(`${RESOLVED_FILE} is not a list of resolved problems. Repair it, or delete it to start over.`)
  process.exit(1)
}

function markResolved(fingerprint, note) {
  if (!/^[0-9a-f]{8}$/.test(fingerprint) || note === '') {
    console.error('Usage: npm run bugs -- --resolve <fingerprint> "what fixed it"')
    process.exit(1)
  }
  const known = folders.flatMap(readFolder).some((entry) => entry.fingerprint === fingerprint)
  if (!known) {
    console.error(`No problem in the bug log has the fingerprint ${fingerprint}.`)
    process.exit(1)
  }
  const resolved = resolve(readResolved(), fingerprint, note, new Date())
  mkdirSync(dirname(RESOLVED_FILE), { recursive: true })
  writeFileSync(RESOLVED_FILE, `${JSON.stringify(resolved, null, 2)}\n`)
  console.log(`Resolved ${fingerprint}. Commit docs/bug-log/resolved.json with the fix.`)
}
