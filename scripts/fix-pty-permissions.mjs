// node-pty ships its prebuilt spawn-helper without the executable bit,
// which makes every spawn fail with "posix_spawnp failed".
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const prebuilds = join(import.meta.dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = join(prebuilds, platform, 'spawn-helper')
    if (existsSync(helper)) chmodSync(helper, 0o755)
  }
}
