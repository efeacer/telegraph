import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, readlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { replaceApp, waitUntilClosed } from './install.mjs'

let root
let source
let destination
let backup

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'telegraph-install-'))
  source = join(root, 'dist', 'Telegraph.app')
  destination = join(root, 'Applications', 'Telegraph.app')
  backup = join(root, 'dist', 'previous', 'Telegraph.app')
  mkdirSync(join(root, 'Applications'))
  app(source, 'new')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function app(path, version) {
  mkdirSync(join(path, 'Contents', 'MacOS'), { recursive: true })
  writeFileSync(join(path, 'Contents', 'MacOS', 'Telegraph'), version)
  symlinkSync('MacOS', join(path, 'Contents', 'Current'))
}

function versionAt(path) {
  return readFileSync(join(path, 'Contents', 'MacOS', 'Telegraph'), 'utf8')
}

describe('replaceApp', () => {
  it('puts the new app in the place of the old one', () => {
    app(destination, 'old')
    replaceApp({ source, destination, backup })
    expect(versionAt(destination)).toBe('new')
  })

  it('keeps the old app to go back to', () => {
    app(destination, 'old')
    replaceApp({ source, destination, backup })
    expect(versionAt(backup)).toBe('old')
  })

  it('keeps only the app it has just replaced', () => {
    app(backup, 'older')
    app(destination, 'old')
    replaceApp({ source, destination, backup })
    expect(versionAt(backup)).toBe('old')
  })

  it('puts the app where there was none', () => {
    replaceApp({ source, destination, backup })
    expect(versionAt(destination)).toBe('new')
    expect(existsSync(backup)).toBe(false)
  })

  it('leaves the new app where it was built', () => {
    replaceApp({ source, destination, backup })
    expect(versionAt(source)).toBe('new')
  })

  it('keeps the links in the app as links', () => {
    replaceApp({ source, destination, backup })
    expect(readlinkSync(join(destination, 'Contents', 'Current'))).toBe('MacOS')
  })

  it('leaves nothing else behind', () => {
    app(destination, 'old')
    replaceApp({ source, destination, backup })
    expect(readdirSync(join(root, 'Applications'))).toEqual(['Telegraph.app'])
  })

  it('says so when there is no new app', () => {
    rmSync(source, { recursive: true })
    app(destination, 'old')
    expect(() => replaceApp({ source, destination, backup })).toThrow(/No app at/)
    expect(versionAt(destination)).toBe('old')
  })

  it('leaves the old app alone when the new one cannot be copied', () => {
    app(destination, 'old')
    const copy = (from, to) => {
      mkdirSync(to, { recursive: true })
      writeFileSync(join(to, 'half'), 'written')
      throw new Error('disk is full')
    }
    expect(() => replaceApp({ source, destination, backup, copy })).toThrow('disk is full')
    expect(versionAt(destination)).toBe('old')
    expect(readdirSync(join(root, 'Applications'))).toEqual(['Telegraph.app'])
  })

  it('puts the old app back when the new one cannot take its place', () => {
    app(destination, 'old')
    let moves = 0
    const move = (from, to, really) => {
      // The old app moves away, and then the new one fails to move in.
      if (++moves === 2) throw new Error('not permitted')
      really(from, to)
    }
    expect(() => replaceApp({ source, destination, backup, move })).toThrow('not permitted')
    expect(versionAt(destination)).toBe('old')
    expect(readdirSync(join(root, 'Applications'))).toEqual(['Telegraph.app'])
  })
})

describe('waitUntilClosed', () => {
  function clock() {
    let time = 0
    return { now: () => time, sleep: async (ms) => void (time += ms) }
  }

  it('waits for as long as the app is running', async () => {
    let checks = 0
    const closed = await waitUntilClosed({ isRunning: () => ++checks < 4, ...clock() })
    expect(closed).toBe(true)
    // Three times running, then closed, and closed again to be sure.
    expect(checks).toBe(5)
  })

  it('does not wait for an app that is not running', async () => {
    const time = clock()
    expect(await waitUntilClosed({ isRunning: () => false, ...time })).toBe(true)
    expect(time.now()).toBe(0)
  })

  it('gives up on an app that is never closed', async () => {
    const time = clock()
    const closed = await waitUntilClosed({ isRunning: () => true, timeoutMs: 60_000, ...time })
    expect(closed).toBe(false)
    expect(time.now()).toBeGreaterThanOrEqual(60_000)
  })

  it('makes sure the app stays closed, since it takes a moment to end all of itself', async () => {
    const answers = [true, false, true, false, false]
    let checks = 0
    const closed = await waitUntilClosed({ isRunning: () => answers[checks++] ?? false, ...clock() })
    expect(closed).toBe(true)
    expect(checks).toBe(5)
  })
})
