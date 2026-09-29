import { describe, expect, it } from 'vitest'
import { digest, parseLog, render, resolve } from './digest.mjs'

const BUILD = {
  version: '0.1.0',
  builtAt: '2026-09-29T10:00:00.000Z',
  packaged: true,
  electron: '44.4.5',
  platform: 'darwin 24.6.0 arm64'
}

function entry(changes = {}) {
  return {
    at: '2026-09-29T12:00:00.000Z',
    run: 'run-1',
    kind: 'window-error',
    message: 'TypeError: nothing to read',
    stack: 'TypeError: nothing to read\n    at discardSession (index.js:180:12)',
    fingerprint: 'aaaaaaaa',
    count: 1,
    build: BUILD,
    ...changes
  }
}

describe('parseLog', () => {
  it('reads one entry from each line', () => {
    const text = `${JSON.stringify(entry())}\n${JSON.stringify(entry({ run: 'run-2' }))}\n`
    expect(parseLog(text).map((parsed) => parsed.run)).toEqual(['run-1', 'run-2'])
  })

  it('skips a line that was cut short by a crash', () => {
    const text = `${JSON.stringify(entry())}\n{"at":"2026-09-29T12:0`
    expect(parseLog(text)).toHaveLength(1)
  })

  it('skips lines that are not entries', () => {
    expect(parseLog('42\n"words"\n{"kind":"window-error"}\n\n')).toEqual([])
  })
})

describe('digest', () => {
  it('gathers the occurrences of a problem', () => {
    const [group, ...others] = digest([
      entry({ at: '2026-09-29T12:00:00.000Z', run: 'run-1' }),
      entry({ at: '2026-09-29T13:00:00.000Z', run: 'run-1', count: 2 }),
      entry({ at: '2026-09-30T09:00:00.000Z', run: 'run-2' })
    ])

    expect(others).toEqual([])
    expect(group).toMatchObject({
      fingerprint: 'aaaaaaaa',
      kind: 'window-error',
      message: 'TypeError: nothing to read',
      occurrences: 3,
      runs: 2,
      firstSeen: '2026-09-29T12:00:00.000Z',
      lastSeen: '2026-09-30T09:00:00.000Z',
      status: 'open'
    })
  })

  it('counts the occurrences that a flood left unwritten', () => {
    const [group] = digest([
      entry({ count: 1 }),
      entry({ count: 2 }),
      entry({ count: 3 }),
      entry({ count: 10 }),
      entry({ count: 100 }),
      entry({ run: 'run-2', count: 1 })
    ])
    expect(group.occurrences).toBe(101)
  })

  it('shows the latest occurrence of a problem', () => {
    const [group] = digest([
      entry({ at: '2026-09-29T12:00:00.000Z', detail: { channel: 'old' } }),
      entry({ at: '2026-09-30T12:00:00.000Z', detail: { channel: 'new' }, stack: 'newer stack' })
    ])
    expect(group.latest).toMatchObject({ detail: { channel: 'new' }, stack: 'newer stack' })
  })

  it('lists the builds a problem was seen in', () => {
    const later = { ...BUILD, builtAt: '2026-09-30T10:00:00.000Z', packaged: false }
    const [group] = digest([entry(), entry({ build: later }), entry({ build: later })])
    expect(group.builds).toEqual([
      { version: '0.1.0', builtAt: '2026-09-29T10:00:00.000Z', packaged: true },
      { version: '0.1.0', builtAt: '2026-09-30T10:00:00.000Z', packaged: false }
    ])
  })

  it('puts crashes first, then bug reports, then errors', () => {
    const groups = digest([
      entry({ kind: 'console-error', fingerprint: 'c' }),
      entry({ kind: 'window-error', fingerprint: 'e' }),
      entry({ kind: 'bug-report', fingerprint: 'b' }),
      entry({ kind: 'unclean-exit', fingerprint: 'u' }),
      entry({ kind: 'window-crash', fingerprint: 'w' })
    ])
    expect(groups.map((group) => group.kind)).toEqual([
      'window-crash',
      'unclean-exit',
      'bug-report',
      'window-error',
      'console-error'
    ])
  })

  it('puts the problem seen last before others of its kind', () => {
    const groups = digest([
      entry({ fingerprint: 'old', at: '2026-09-28T12:00:00.000Z' }),
      entry({ fingerprint: 'new', at: '2026-09-30T12:00:00.000Z' })
    ])
    expect(groups.map((group) => group.fingerprint)).toEqual(['new', 'old'])
  })

  it('leaves out a problem that was resolved after its builds were made', () => {
    const resolved = [{ fingerprint: 'aaaaaaaa', resolvedAt: '2026-09-29T18:00:00.000Z', note: 'fixed' }]
    expect(digest([entry()], { resolved })).toEqual([])
  })

  it('leaves in an old build that still meets a resolved problem', () => {
    const resolved = [{ fingerprint: 'aaaaaaaa', resolvedAt: '2026-09-29T18:00:00.000Z', note: 'fixed' }]
    const stillInstalled = entry({ at: '2026-10-02T12:00:00.000Z' })
    expect(digest([stillInstalled], { resolved })).toEqual([])
  })

  it('brings back a resolved problem that a newer build meets', () => {
    const resolved = [{ fingerprint: 'aaaaaaaa', resolvedAt: '2026-09-29T18:00:00.000Z', note: 'fixed' }]
    const rebuilt = { ...BUILD, builtAt: '2026-09-30T10:00:00.000Z' }
    const [group] = digest([entry(), entry({ build: rebuilt, at: '2026-09-30T12:00:00.000Z' })], {
      resolved
    })
    expect(group).toMatchObject({
      status: 'came-back',
      resolution: { resolvedAt: '2026-09-29T18:00:00.000Z', note: 'fixed' }
    })
  })

  it('shows resolved problems when asked for everything', () => {
    const resolved = [{ fingerprint: 'aaaaaaaa', resolvedAt: '2026-09-29T18:00:00.000Z', note: 'fixed' }]
    const [group] = digest([entry()], { resolved, all: true })
    expect(group.status).toBe('resolved')
  })
})

describe('resolve', () => {
  it('adds a problem to the resolved ones', () => {
    expect(resolve([], 'aaaaaaaa', 'fixed the order', new Date('2026-09-29T18:00:00.000Z'))).toEqual([
      { fingerprint: 'aaaaaaaa', resolvedAt: '2026-09-29T18:00:00.000Z', note: 'fixed the order' }
    ])
  })

  it('replaces the earlier resolution of a problem that came back', () => {
    const before = [
      { fingerprint: 'aaaaaaaa', resolvedAt: '2026-09-29T18:00:00.000Z', note: 'first try' },
      { fingerprint: 'bbbbbbbb', resolvedAt: '2026-09-29T19:00:00.000Z', note: 'other' }
    ]
    const after = resolve(before, 'aaaaaaaa', 'second try', new Date('2026-10-01T09:00:00.000Z'))
    expect(after).toEqual([
      { fingerprint: 'bbbbbbbb', resolvedAt: '2026-09-29T19:00:00.000Z', note: 'other' },
      { fingerprint: 'aaaaaaaa', resolvedAt: '2026-10-01T09:00:00.000Z', note: 'second try' }
    ])
  })
})

describe('render', () => {
  it('says so when there is nothing to fix', () => {
    expect(render([], { folders: ['/logs'] })).toContain('No open problems')
  })

  it('describes each problem', () => {
    const text = render(digest([entry(), entry({ run: 'run-2', detail: { channel: 'git:status' } })]), {
      folders: ['/logs']
    })
    expect(text).toContain('1 open problem')
    expect(text).toContain('aaaaaaaa')
    expect(text).toContain('window-error')
    expect(text).toContain('TypeError: nothing to read')
    expect(text).toContain('2 times in 2 runs')
    expect(text).toContain('at discardSession (index.js:180:12)')
    expect(text).toContain('"channel": "git:status"')
  })

  it('points out a problem that came back', () => {
    const resolved = [{ fingerprint: 'aaaaaaaa', resolvedAt: '2026-09-29T09:00:00.000Z', note: 'fixed' }]
    expect(render(digest([entry()], { resolved }), { folders: ['/logs'] })).toContain(
      'CAME BACK after it was resolved on 2026-09-29 (fixed)'
    )
  })
})
