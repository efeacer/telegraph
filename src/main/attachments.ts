import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const KEPT_FOR_MS = 7 * 24 * 60 * 60 * 1000
const PREFIX = 'pasted-'

// The kinds of image an agent can read, and what their files end in.
const ENDINGS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

export interface AttachmentsOptions {
  directory: string
  maxBytes?: number
  now?: () => number
}

/**
 * Images pasted into a session. A program in a terminal is handed a file by
 * its path, and an image on the clipboard has none until it is kept here.
 */
export class Attachments {
  private readonly maxBytes: number
  private readonly now: () => number

  constructor(private readonly options: AttachmentsOptions) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.now = options.now ?? Date.now
  }

  /**
   * Returns the path of the file, or null if the image was not kept. What is
   * to be saved comes from the window, so nothing about it is taken on trust.
   */
  save(type: unknown, data: unknown): string | null {
    const ending = typeof type === 'string' && Object.hasOwn(ENDINGS, type) ? ENDINGS[type] : null
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    if (!ending || !(bytes instanceof Uint8Array)) return null
    if (bytes.length === 0 || bytes.length > this.maxBytes) return null

    const { directory } = this.options
    const name = `${PREFIX}${stamp(this.now())}`
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      for (let copy = 1; ; copy++) {
        const path = join(directory, `${name}${copy === 1 ? '' : `-${copy}`}.${ending}`)
        try {
          // Fails rather than writing over an image pasted in the same second.
          writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' })
          return path
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      }
    } catch {
      return null
    }
  }

  /** Removes the images of more than a week ago, which no chat is likely to look at again. */
  clearOld(): void {
    const { directory } = this.options
    try {
      for (const name of readdirSync(directory)) {
        if (!name.startsWith(PREFIX)) continue
        const path = join(directory, name)
        if (this.now() - statSync(path).mtimeMs > KEPT_FOR_MS) rmSync(path, { force: true })
      }
    } catch {
      // Nothing was pasted yet, or the folder cannot be read. Either way nothing is cleared.
    }
  }
}

/** The time as a name: 2026-09-29-181012. */
function stamp(time: number): string {
  const [day, clock] = new Date(time).toISOString().split('T') as [string, string]
  return `${day}-${clock.slice(0, 8).replaceAll(':', '')}`
}
