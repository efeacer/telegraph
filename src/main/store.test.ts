import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(new StateStore(filePath).get()).toEqual({
      projects: [],
      launchers: DEFAULT_LAUNCHERS,
      choices: {}
    })
  })

  it('leaves the launchers it comes with out of the file', () => {
    new StateStore(filePath).addProject('/tmp/one')
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).not.toHaveProperty('launchers')
  })

  it('writes launchers the user has edited to the file', () => {
    const launchers = [{ id: 'codex', name: 'Codex', command: 'codex' }]
    mkdirSync(join(directory, 'nested'), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ projects: [], launchers }))

    new StateStore(filePath).addProject('/tmp/one')
    expect(JSON.parse(readFileSync(filePath, 'utf8')).launchers).toEqual(launchers)
  })

  it('remembers what was chosen in a project', () => {
    const store = new StateStore(filePath)
    const project = store.addProject('/tmp/one')
    store.saveChoice(project.id, { launcherId: 'claude', models: { claude: 'opus' } })

    expect(new StateStore(filePath).get().choices).toEqual({
      [project.id]: { launcherId: 'claude', models: { claude: 'opus' } }
    })
  })

  it('remembers nothing for a project it does not have', () => {
    const store = new StateStore(filePath)
    store.saveChoice('gone', { launcherId: 'claude', models: {} })
    expect(store.get().choices).toEqual({})
  })

  it('remembers nothing that is not a choice', () => {
    const store = new StateStore(filePath)
    const project = store.addProject('/tmp/one')
    store.saveChoice(project.id, { launcherId: 'claude', models: { claude: 'a; rm -rf ~' } })
    store.saveChoice(project.id, 'nonsense' as never)
    expect(store.get().choices).toEqual({ [project.id]: { launcherId: 'claude', models: {} } })
  })

  it('forgets what was chosen in a project that is removed', () => {
    const store = new StateStore(filePath)
    const project = store.addProject('/tmp/one')
    store.saveChoice(project.id, { launcherId: 'claude', models: {} })
    store.removeProject(project.id)
    expect(new StateStore(filePath).get().choices).toEqual({})
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

  it('keeps what a launcher says about its models and modes', () => {
    const launcher = {
      id: 'aider',
      name: 'Aider',
      command: 'aider',
      modelFlag: '--model',
      providers: ['openai'],
      models: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol' }],
      modes: [{ id: 'restore', name: 'restore chat history', args: '--restore-chat-history' }]
    }
    expect(parseState(JSON.stringify({ launchers: [launcher] })).launchers).toEqual([launcher])
  })

  it('drops the parts of a launcher it cannot read', () => {
    const launcher = {
      id: 'aider',
      name: 'Aider',
      command: 'aider',
      modelFlag: 42,
      providers: 'openai',
      models: [{ id: 'fine', name: 'Fine' }, { id: 'a; rm -rf ~', name: 'Trouble' }, { name: 'Nameless' }],
      modes: [{ id: 'restore', name: 'restore' }, null]
    }
    expect(parseState(JSON.stringify({ launchers: [launcher] })).launchers).toEqual([
      { id: 'aider', name: 'Aider', command: 'aider', models: [{ id: 'fine', name: 'Fine' }], modes: [] }
    ])
  })

  it('takes the launchers of the first version for the ones it comes with now', () => {
    const first = [
      { id: 'shell', name: 'Shell', command: null },
      { id: 'claude', name: 'Claude', command: 'claude' },
      { id: 'claude-continue', name: 'Claude, continue last chat', command: 'claude --continue' },
      { id: 'claude-resume', name: 'Claude, pick a chat to resume', command: 'claude --resume' }
    ]
    expect(parseState(JSON.stringify({ launchers: first })).launchers).toEqual(DEFAULT_LAUNCHERS)
  })

  it('keeps the launchers of the first version once the user has edited them', () => {
    const edited = [
      { id: 'shell', name: 'Shell', command: null },
      { id: 'claude', name: 'Claude', command: 'claude --verbose' },
      { id: 'claude-continue', name: 'Claude, continue last chat', command: 'claude --continue' },
      { id: 'claude-resume', name: 'Claude, pick a chat to resume', command: 'claude --resume' }
    ]
    expect(parseState(JSON.stringify({ launchers: edited })).launchers).toEqual(edited)
  })

  it('reads what was chosen for projects it has', () => {
    const state = parseState(
      JSON.stringify({
        projects: [{ id: 'a', name: 'one', path: '/tmp/one' }],
        choices: {
          a: { launcherId: 'claude', models: { claude: 'opus', codex: 42 } },
          gone: { launcherId: 'claude', models: {} },
          b: 'nonsense'
        }
      })
    )
    expect(state.choices).toEqual({ a: { launcherId: 'claude', models: { claude: 'opus' } } })
  })

  it('restores the default launchers when none are valid', () => {
    const state = parseState(JSON.stringify({ projects: [], launchers: [{ name: 'broken' }] }))
    expect(state.launchers).toEqual(DEFAULT_LAUNCHERS)
  })
})
