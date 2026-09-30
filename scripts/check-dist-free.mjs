// Packaging writes the app in dist anew. A Telegraph that runs from there would
// have its files changed under it, so that is refused.
import { join } from 'node:path'
import { findRunning } from './lib/install.mjs'

const dist = join(import.meta.dirname, '..', 'dist')
const running = findRunning().filter((path) => path.startsWith(`${dist}/`))

if (running.length > 0) {
  console.error(
    `Telegraph is running from ${running[0]}.\n` +
      'Packaging would change its files while it runs. Close it, and open the one in /Applications.'
  )
  process.exit(1)
}
