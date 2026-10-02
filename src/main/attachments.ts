import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const KEPT_FOR_MS = 7 * 24 * 60 * 60 * 1000
const PREFIX = 'pasted-'

// What the files of common kinds end in. A file of another kind ends in .bin, unless its name says more.
const ENDINGS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html'
}
const ENDING = /^[A-Za-z0-9]{1,10}$/
const LONGEST_NAME = 60

export interface AttachmentsOptions {
  directory: string
  maxBytes?: number
  now?: () => number
}

/**
 * Files pasted into a session. A program in a terminal is handed a file by
 * its path, and a file on the clipboard that came from no folder, such as a
 * screenshot, has none until it is kept here.
 */
export class Attachments {
  private readonly maxBytes: number
  private readonly now: () => number

  constructor(private readonly options: AttachmentsOptions) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.now = options.now ?? Date.now
  }

  /**
   * Returns the path of the file, or null if it was not kept. The name the
   * file had is kept in its own, so that the agent knows what it is. What is
   * to be saved comes from the window, so nothing about it is taken on trust.
   */
  save(type: unknown, data: unknown, originalName?: unknown): string | null {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    if (typeof type !== 'string' || !(bytes instanceof Uint8Array)) return null
    if (bytes.length === 0 || bytes.length > this.maxBytes) return null

    const { directory } = this.options
    const kept = typeof originalName === 'string' ? keptName(originalName) : { base: '', ending: null }
    const ending = kept.ending ?? (Object.hasOwn(ENDINGS, type) ? ENDINGS[type] : 'bin')
    const name = `${PREFIX}${stamp(this.now())}${kept.base ? `-${kept.base}` : ''}`
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      for (let copy = 1; ; copy++) {
        const path = join(directory, `${name}${copy === 1 ? '' : `-${copy}`}.${ending}`)
        try {
          // Fails rather than writing over a file pasted in the same second.
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

  /** Removes what was pasted more than a week ago, which no chat is likely to look at again. */
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

/**
 * What can be kept of the name a file had: letters, digits and the signs no
 * shell makes anything of, and nothing that could lead to another folder.
 */
function keptName(name: string): { base: string; ending: string | null } {
  const last = name.split(/[/\\]/).at(-1) ?? ''
  const dot = last.lastIndexOf('.')
  const ending = dot > 0 && ENDING.test(last.slice(dot + 1)) ? last.slice(dot + 1).toLowerCase() : null
  const base = (ending ? last.slice(0, dot) : last)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, LONGEST_NAME)
    .replace(/^[-.]+|[-.]+$/g, '')
  // The clipboard calls every image it holds image.png, which says nothing.
  return { base: base === 'image' ? '' : base, ending }
}

/** The time as a name: 2026-09-29-181012. */
function stamp(time: number): string {
  const [day, clock] = new Date(time).toISOString().split('T') as [string, string]
  return `${day}-${clock.slice(0, 8).replaceAll(':', '')}`
}

/**
 * Whether each path is a folder or a file, or null for one that is not there.
 * The paths come from the window, so only whole paths are looked at.
 */
export function kindsOf(paths: unknown): Array<'file' | 'folder' | null> {
  if (!Array.isArray(paths)) return []
  return paths.map((path) => {
    if (typeof path !== 'string' || !isAbsolute(path)) return null
    try {
      return statSync(path).isDirectory() ? 'folder' : 'file'
    } catch {
      return null
    }
  })
}
