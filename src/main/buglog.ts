import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, relative } from 'node:path'
import { LIMITS, clip, type BuildInfo, type LogEntry, type Problem } from '@shared/buglog'

const LOG_FILE = 'bugs.jsonl'
const OLDER_LOG_FILE = 'bugs.1.jsonl'
const MARKER_FILE = 'running.json'

const DEFAULT_MAX_BYTES = 512 * 1024
// A problem that keeps happening is written in full a few times, then only
// when its count reaches the next power of ten.
const ALWAYS_WRITTEN = 3
const FINGERPRINT_FRAMES = 3
const MAX_CRASH_DUMPS = 20

const PATH_PATTERN = /(?:file:\/\/)?(?:[A-Za-z]:)?(?:[\\/][^\s\\/:'"()]+){2,}/g
const ID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const NUMBER_PATTERN = /\d+/g
const NAMED_FRAME_PATTERN = /^\s*at (?:async )?(.+?) \(/

export interface BugLogOptions {
  directory: string
  build: BuildInfo
  /** Where crash dumps are kept, to name the ones a crashed run left behind. */
  crashDumps?: string
  run?: string
  maxBytes?: number
  now?: () => Date
}

interface Marker {
  run: string
  startedAt: string
  version: string
  builtAt: string
}

/**
 * The same for every occurrence of a problem: numbers, ids, folders and the
 * position of the code all change between runs and builds, so they are left out.
 */
export function fingerprintOf(problem: Pick<Problem, 'kind' | 'message' | 'stack'>): string {
  const message = problem.message
    .replace(PATH_PATTERN, '<path>')
    .replace(ID_PATTERN, '<id>')
    .replace(NUMBER_PATTERN, '#')
  const frames = (problem.stack ?? '')
    .split('\n')
    .filter((line) => line.trimStart().startsWith('at '))
    .slice(0, FINGERPRINT_FRAMES)
    .map((line) => NAMED_FRAME_PATTERN.exec(line)?.[1] ?? '<anonymous>')
  return createHash('sha256')
    .update([problem.kind, message, ...frames].join('\n'))
    .digest('hex')
    .slice(0, 8)
}

/**
 * Problems, kept as lines of JSON for whoever comes to fix them. Writing is
 * synchronous so an entry is on disk before the process reporting it dies,
 * and it never throws: a log that fails must not become a problem itself.
 */
export class BugLog {
  readonly filePath: string
  private readonly run: string
  private readonly maxBytes: number
  private readonly now: () => Date
  private readonly counts = new Map<string, number>()

  constructor(private readonly options: BugLogOptions) {
    this.filePath = join(options.directory, LOG_FILE)
    this.run = options.run ?? randomUUID()
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
    this.now = options.now ?? (() => new Date())
  }

  /** Returns the entry, or null when it was not written. */
  record(problem: Problem): LogEntry | null {
    try {
      const fingerprint = fingerprintOf(problem)
      const count = (this.counts.get(fingerprint) ?? 0) + 1
      this.counts.set(fingerprint, count)
      if (!isWorthWriting(count)) return null

      const entry: LogEntry = {
        at: this.now().toISOString(),
        run: this.run,
        kind: problem.kind,
        message: clip(problem.message, LIMITS.message),
        ...(problem.stack === undefined ? {} : { stack: clip(problem.stack, LIMITS.stack) }),
        ...(problem.detail === undefined ? {} : { detail: problem.detail }),
        fingerprint,
        count,
        build: this.options.build
      }
      this.write(`${JSON.stringify(entry)}\n`)
      return entry
    } catch {
      return null
    }
  }

  /**
   * Marks the app as running. A mark left by the previous run means that run
   * crashed or was killed, which is recorded and returned.
   */
  start(): LogEntry | null {
    const markerPath = join(this.options.directory, MARKER_FILE)
    const previous = this.readMarker(markerPath)
    const entry =
      previous === null
        ? null
        : this.record({
            kind: 'unclean-exit',
            message: 'The previous run ended without shutting down',
            detail: { ...previous, ...this.crashDumpsSince(previous.startedAt) }
          })
    try {
      const marker: Marker = {
        run: this.run,
        startedAt: this.now().toISOString(),
        version: this.options.build.version,
        builtAt: this.options.build.builtAt
      }
      mkdirSync(this.options.directory, { recursive: true })
      writeFileSync(markerPath, `${JSON.stringify(marker)}\n`)
    } catch {
      // Without a mark, a crash of this run goes unnoticed. Nothing else is lost.
    }
    return entry
  }

  /** Marks the app as shut down. */
  stop(): void {
    try {
      rmSync(join(this.options.directory, MARKER_FILE), { force: true })
    } catch {
      // The next run reports an unclean exit that was not one.
    }
  }

  private write(line: string): void {
    mkdirSync(this.options.directory, { recursive: true })
    if (sizeOf(this.filePath) >= this.maxBytes) {
      renameSync(this.filePath, join(this.options.directory, OLDER_LOG_FILE))
    }
    appendFileSync(this.filePath, line)
  }

  /** What the mark says, nothing when it cannot be read, null when there is none. */
  private readMarker(markerPath: string): Partial<Marker> | null {
    let text: string
    try {
      text = readFileSync(markerPath, 'utf8')
    } catch {
      return null
    }
    try {
      const { run, startedAt, version, builtAt } = JSON.parse(text) as Record<string, unknown>
      const marker: Partial<Marker> = {}
      if (typeof run === 'string') marker.run = run
      if (typeof startedAt === 'string') marker.startedAt = startedAt
      if (typeof version === 'string') marker.version = version
      if (typeof builtAt === 'string') marker.builtAt = builtAt
      return marker
    } catch {
      return {}
    }
  }

  private crashDumpsSince(startedAt: string | undefined): { crashDumps?: string[] } {
    const root = this.options.crashDumps
    const since = startedAt === undefined ? Number.NaN : Date.parse(startedAt)
    if (root === undefined || Number.isNaN(since)) return {}
    try {
      const crashDumps = readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith('.dmp'))
        .map((file) => join(file.parentPath, file.name))
        .filter((path) => statSync(path).mtimeMs >= since)
        .map((path) => relative(root, path))
        .sort()
        .slice(0, MAX_CRASH_DUMPS)
      return { crashDumps }
    } catch {
      return { crashDumps: [] }
    }
  }
}

function isWorthWriting(count: number): boolean {
  return count <= ALWAYS_WRITTEN || Number.isInteger(Math.log10(count))
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}
