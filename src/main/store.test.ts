import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAUNCHERS } from '@shared/launchers'
import { StateStore, parseState } from './store'

let directory: string
let filePath: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'telegraph-store-'))
  filePath = join(directory, 'nested', 'state.json')
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('StateStore', () => {
  it('starts with no projects and the default launchers', () => {
    expect(new StateStore(filePath).get()).toEqual({ projects: [], launchers: DEFAULT_LAUNCHERS })
  })

  it('names a project after its folder', () => {
    const project = new StateStore(filePath).addProject('/Users/someone/projects/telegraph')
    expect(project).toMatchObject({ name: 'telegraph', path: '/Users/someone/projects/telegraph' })
  })

  it('keeps projects across restarts', () => {
    const project = new StateStore(filePath).addProject('/tmp/one')
    expect(new StateStore(filePath).get().projects).toEqual([project])
  })

  it('does not add the same folder twice', () => {
    const store = new StateStore(filePath)
    const first = store.addProject('/tmp/one')
    const second = store.addProject('/tmp/one')
    expect(second).toEqual(first)
    expect(store.get().projects).toHaveLength(1)
  })

  it('removes a project', () => {
    const store = new StateStore(filePath)
    const kept = store.addProject('/tmp/one')
    const removed = store.addProject('/tmp/two')
    store.removeProject(removed.id)
    expect(new StateStore(filePath).get().projects).toEqual([kept])
  })

  it('sets an unreadable file aside instead of overwriting it', () => {
    const store = new StateStore(filePath)
    store.addProject('/tmp/one')
    writeFileSync(filePath, '{ not json')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(new StateStore(filePath).get().projects).toEqual([])

    const backups = readdirSync(join(directory, 'nested')).filter((name) =>
      name.startsWith('state.json.unreadable-')
    )
    expect(backups).toHaveLength(1)
    expect(readFileSync(join(directory, 'nested', backups[0]!), 'utf8')).toBe('{ not json')
    log.mockRestore()
  })

  it('tells when it has set an unreadable file aside', () => {
    writeFileSync(join(directory, 'state.json'), '{ not json')
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onUnreadable = vi.fn()

    new StateStore(join(directory, 'state.json'), onUnreadable)

    expect(onUnreadable).toHaveBeenCalledExactlyOnceWith(
      expect.any(SyntaxError),
      expect.stringContaining('state.json.unreadable-')
    )
    log.mockRestore()
  })
})

describe('parseState', () => {
  it('keeps launchers the user has edited', () => {
    const launchers = [{ id: 'codex', name: 'Codex', command: 'codex' }]
    expect(parseState(JSON.stringify({ projects: [], launchers })).launchers).toEqual(launchers)
  })

  it('drops entries that are not projects', () => {
    const valid = { id: 'a', name: 'one', path: '/tmp/one' }
    const state = parseState(JSON.stringify({ projects: [valid, { id: 'b' }, 'nope', null] }))
    expect(state.projects).toEqual([valid])
  })

  it('restores the default launchers when none are valid', () => {
    const state = parseState(JSON.stringify({ projects: [], launchers: [{ name: 'broken' }] }))
    expect(state.launchers).toEqual(DEFAULT_LAUNCHERS)
  })
})
