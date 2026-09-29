import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BuildInfo, LogEntry } from '@shared/buglog'
import { BugLog, fingerprintOf } from './buglog'

const BUILD: BuildInfo = {
  version: '0.1.0',
  builtAt: '2026-09-29T10:00:00.000Z',
  packaged: false,
  electron: '44.4.5',
  platform: 'darwin 24.6.0 arm64'
}

let directory: string

beforeEach(() => {
  directory = join(mkdtempSync(join(tmpdir(), 'telegraph-buglog-')), 'logs')
})

afterEach(() => {
  chmodSync(join(directory, '..'), 0o755)
  rmSync(join(directory, '..'), { recursive: true, force: true })
})

function openLog(options: Partial<ConstructorParameters<typeof BugLog>[0]> = {}): BugLog {
  return new BugLog({
    directory,
    build: BUILD,
    run: 'run-1',
    now: () => new Date('2026-09-29T12:00:00.000Z'),
    ...options
  })
}

function entries(fileName = 'bugs.jsonl'): LogEntry[] {
  const path = join(directory, fileName)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as LogEntry)
}

describe('BugLog', () => {
  it('writes a problem as one line of JSON', () => {
    openLog().record({ kind: 'main-error', message: 'Error: boom', stack: 'Error: boom\n    at here' })

    expect(entries()).toEqual([
      {
        at: '2026-09-29T12:00:00.000Z',
        run: 'run-1',
        kind: 'main-error',
        message: 'Error: boom',
        stack: 'Error: boom\n    at here',
        fingerprint: expect.stringMatching(/^[0-9a-f]{8}$/),
        count: 1,
        build: BUILD
      }
    ])
  })

  it('adds to the problems of earlier runs', () => {
    openLog({ run: 'run-1' }).record({ kind: 'main-error', message: 'first' })
    openLog({ run: 'run-2' }).record({ kind: 'main-error', message: 'second' })

    expect(entries().map((entry) => [entry.run, entry.message])).toEqual([
      ['run-1', 'first'],
      ['run-2', 'second']
    ])
  })

  it('keeps the facts that come with a problem', () => {
    openLog().record({ kind: 'ipc-error', message: 'boom', detail: { channel: 'git:status' } })
    expect(entries()[0]?.detail).toEqual({ channel: 'git:status' })
  })

  it('returns what it wrote', () => {
    const entry = openLog().record({ kind: 'main-error', message: 'boom' })
    expect(entry).toEqual(entries()[0])
  })

  it('counts a problem that keeps happening', () => {
    const log = openLog()
    for (let index = 0; index < 3; index++) log.record({ kind: 'main-error', message: 'again' })
    expect(entries().map((entry) => entry.count)).toEqual([1, 2, 3])
  })

  it('writes a problem that floods only now and then', () => {
    const log = openLog()
    for (let index = 0; index < 1000; index++) log.record({ kind: 'main-error', message: 'flood' })
    expect(entries().map((entry) => entry.count)).toEqual([1, 2, 3, 10, 100, 1000])
  })

  it('says nothing about a problem it did not write', () => {
    const log = openLog()
    for (let index = 0; index < 3; index++) log.record({ kind: 'main-error', message: 'flood' })
    expect(log.record({ kind: 'main-error', message: 'flood' })).toBeNull()
  })

  it('counts each problem on its own', () => {
    const log = openLog()
    for (let index = 0; index < 5; index++) log.record({ kind: 'main-error', message: 'flood' })
    log.record({ kind: 'main-error', message: 'something else' })
    expect(entries().at(-1)).toMatchObject({ message: 'something else', count: 1 })
  })

  it('cuts text that is too long', () => {
    openLog().record({ kind: 'main-error', message: 'm'.repeat(10_000), stack: 's'.repeat(20_000) })
    const [entry] = entries()
    expect(entry?.message).toHaveLength(4_000)
    expect(entry?.stack).toHaveLength(8_000)
  })

  it('starts a new file when the log has grown large', () => {
    const log = openLog({ maxBytes: 1000 })
    log.record({ kind: 'main-error', message: `one ${'a'.repeat(400)}` })
    log.record({ kind: 'main-error', message: `two ${'b'.repeat(400)}` })
    log.record({ kind: 'main-error', message: 'three' })

    expect(entries('bugs.1.jsonl').map((entry) => entry.message.slice(0, 3))).toEqual(['one', 'two'])
    expect(entries().map((entry) => entry.message)).toEqual(['three'])
  })

  it('keeps only one older file', () => {
    const log = openLog({ maxBytes: 300 })
    for (const name of ['one', 'two', 'three']) {
      log.record({ kind: 'main-error', message: `${name} ${'a'.repeat(400)}` })
    }

    expect(entries('bugs.1.jsonl').map((entry) => entry.message.slice(0, 3))).toEqual(['two'])
    expect(entries().map((entry) => entry.message.slice(0, 5))).toEqual(['three'])
    expect(existsSync(join(directory, 'bugs.2.jsonl'))).toBe(false)
  })

  it('carries on when the log cannot be written', () => {
    chmodSync(join(directory, '..'), 0o555)
    expect(openLog().record({ kind: 'main-error', message: 'boom' })).toBeNull()
  })

  it('tells where the log is', () => {
    expect(openLog().filePath).toBe(join(directory, 'bugs.jsonl'))
  })
})

describe('fingerprintOf', () => {
  const stack = (line: number): string =>
    [
      'TypeError: nothing to read',
      `    at discardSession (file:///Applications/Telegraph.app/out/renderer/assets/index-Bx3k.js:${line}:12)`,
      `    at endSession (file:///Applications/Telegraph.app/out/renderer/assets/index-Bx3k.js:${line + 40}:3)`
    ].join('\n')

  it('is the same wherever the code has moved to', () => {
    const before = { kind: 'window-error' as const, message: 'TypeError: nothing to read', stack: stack(180) }
    const after = { kind: 'window-error' as const, message: 'TypeError: nothing to read', stack: stack(212) }
    expect(fingerprintOf(after)).toBe(fingerprintOf(before))
  })

  it('is the same whatever the numbers and ids in the message', () => {
    const one = fingerprintOf({
      kind: 'main-error',
      message: 'Session 0b9f6f2e-8a53-4c0e-9d1b-3f1a2c4d5e6f already exists after 12 tries'
    })
    const other = fingerprintOf({
      kind: 'main-error',
      message: 'Session 7c1d2e3f-0a1b-4c2d-8e3f-4a5b6c7d8e9f already exists after 7 tries'
    })
    expect(other).toBe(one)
  })

  it('is the same whatever the folder in the message', () => {
    const one = fingerprintOf({
      kind: 'session-failure',
      message: 'The folder /Users/one/projects/telegraph does not exist'
    })
    const other = fingerprintOf({
      kind: 'session-failure',
      message: 'The folder /home/other/work does not exist'
    })
    expect(other).toBe(one)
  })

  it('tells apart problems with different messages', () => {
    const one = fingerprintOf({ kind: 'main-error', message: 'one thing' })
    const other = fingerprintOf({ kind: 'main-error', message: 'another thing' })
    expect(other).not.toBe(one)
  })

  it('tells apart problems of different kinds', () => {
    const one = fingerprintOf({ kind: 'main-error', message: 'boom' })
    const other = fingerprintOf({ kind: 'window-error', message: 'boom' })
    expect(other).not.toBe(one)
  })

  it('tells apart problems that come from different places', () => {
    const one = fingerprintOf({ kind: 'window-error', message: 'boom', stack: 'Error: boom\n    at first (a.js:1:1)' })
    const other = fingerprintOf({ kind: 'window-error', message: 'boom', stack: 'Error: boom\n    at second (a.js:1:1)' })
    expect(other).not.toBe(one)
  })
})

describe('the running marker', () => {
  it('finds nothing after a first start', () => {
    expect(openLog().start()).toBeNull()
  })

  it('finds nothing after a run that shut down', () => {
    const first = openLog({ run: 'run-1' })
    first.start()
    first.stop()

    expect(openLog({ run: 'run-2' }).start()).toBeNull()
    expect(entries()).toEqual([])
  })

  it('records a run that never shut down', () => {
    openLog({ run: 'run-1', now: () => new Date('2026-09-29T08:00:00.000Z') }).start()

    const entry = openLog({ run: 'run-2' }).start()

    expect(entry).toMatchObject({
      kind: 'unclean-exit',
      run: 'run-2',
      message: 'The previous run ended without shutting down',
      detail: {
        run: 'run-1',
        startedAt: '2026-09-29T08:00:00.000Z',
        version: '0.1.0',
        builtAt: BUILD.builtAt
      }
    })
    expect(entries()).toEqual([entry])
  })

  it('names the crash dumps written during that run', () => {
    const dumps = join(directory, '..', 'Crashpad')
    openLog({ run: 'run-1', now: () => new Date(Date.now() - 60_000) }).start()

    // Written now, which is after the first run began.
    mkdirSync(join(dumps, 'pending'), { recursive: true })
    writeFileSync(join(dumps, 'pending', 'a1b2.dmp'), 'dump')
    writeFileSync(join(dumps, 'pending', 'settings.dat'), 'not a dump')

    expect(openLog({ run: 'run-2', crashDumps: dumps }).start()?.detail).toMatchObject({
      crashDumps: [join('pending', 'a1b2.dmp')]
    })
  })

  it('leaves out crash dumps from before that run', () => {
    const dumps = join(directory, '..', 'Crashpad')
    mkdirSync(dumps, { recursive: true })
    writeFileSync(join(dumps, 'old.dmp'), 'dump')
    const afterTheDump = new Date(statSync(join(dumps, 'old.dmp')).mtimeMs + 60_000)
    openLog({ run: 'run-1', now: () => afterTheDump }).start()

    expect(openLog({ run: 'run-2', crashDumps: dumps }).start()?.detail).toMatchObject({
      crashDumps: []
    })
  })

  it('reports a run once', () => {
    openLog({ run: 'run-1' }).start()
    const second = openLog({ run: 'run-2' })
    second.start()
    second.stop()

    expect(openLog({ run: 'run-3' }).start()).toBeNull()
  })

  it('copes with a marker it cannot read', () => {
    openLog().start()
    writeFileSync(join(directory, 'running.json'), '{ not json')

    expect(openLog({ run: 'run-2' }).start()).toMatchObject({ kind: 'unclean-exit', detail: {} })
  })
})
