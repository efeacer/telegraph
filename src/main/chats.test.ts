import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { folderOf, listChats } from './chats'

const PROJECT = '/Users/someone/Projects/signal.box'
const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'
const THIRD = '33333333-3333-4333-8333-333333333333'

let configDir: string
let folder: string

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'telegraph-chats-'))
  folder = join(configDir, 'projects', '-Users-someone-Projects-signal-box')
  mkdirSync(folder, { recursive: true })
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
})

function said(text: unknown, more: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'user',
    cwd: PROJECT,
    entrypoint: 'cli',
    isSidechain: false,
    message: { role: 'user', content: text },
    ...more
  }
}

function answered(text: string): Record<string, unknown> {
  return { type: 'assistant', cwd: PROJECT, message: { role: 'assistant', content: [{ type: 'text', text }] } }
}

function titled(title: string): Record<string, unknown> {
  return { type: 'ai-title', aiTitle: title }
}

function record(id: string, lines: unknown[], at = '2026-09-29T12:00:00.000Z', name = `${id}.jsonl`): void {
  const path = join(folder, name)
  writeFileSync(path, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'))
  utimesSync(path, new Date(at), new Date(at))
}

function list(projectPath = PROJECT, limit?: number) {
  return listChats({ configDir, projectPath, ...(limit === undefined ? {} : { limit }) })
}

describe('folderOf', () => {
  it('names the folder the way Claude Code does', () => {
    expect(folderOf('/Users/efeacer/Projects/telegraph')).toBe('-Users-efeacer-Projects-telegraph')
    expect(folderOf('/Users/efeacer/.claude/double-shot-latte')).toBe(
      '-Users-efeacer--claude-double-shot-latte'
    )
    expect(folderOf('/tmp/my project_2')).toBe('-tmp-my-project-2')
  })
})

describe('listChats', () => {
  it('lists the chats that were had in the folder', async () => {
    record(FIRST, [said('Add a feature for logging bugs'), answered('On it.')])
    expect(await list()).toEqual([
      { id: FIRST, title: 'Add a feature for logging bugs', at: '2026-09-29T12:00:00.000Z' }
    ])
  })

  it('puts the chat that went on last first', async () => {
    record(FIRST, [said('first')], '2026-09-27T12:00:00.000Z')
    record(SECOND, [said('second')], '2026-09-29T12:00:00.000Z')
    record(THIRD, [said('third')], '2026-09-28T12:00:00.000Z')
    expect((await list()).map((chat) => chat.title)).toEqual(['second', 'third', 'first'])
  })

  it('calls a chat by the title it was given', async () => {
    record(FIRST, [said('hey can you add a thing'), titled('Add bug logging'), answered('Yes.')])
    expect((await list())[0]?.title).toBe('Add bug logging')
  })

  it('calls a chat by the name the user gave it, before any title', async () => {
    record(FIRST, [said('start'), titled('Add bug logging'), { type: 'custom-title', customTitle: 'Logging, round two' }, titled('Add bug logging again')])
    expect((await list())[0]?.title).toBe('Logging, round two')
  })

  it('calls a chat by the name it was given last', async () => {
    record(FIRST, [said('start'), { type: 'custom-title', customTitle: 'First name' }, { type: 'custom-title', customTitle: 'Second name' }])
    expect((await list())[0]?.title).toBe('Second name')
  })

  it('calls a chat by the title it was given last', async () => {
    const long = Array.from({ length: 4000 }, (_, index) => answered(`line ${index} ${'x'.repeat(200)}`))
    record(FIRST, [said('start'), titled('Add bug logging'), ...long, titled('Add bug logging and a model picker'), answered('Done.')])
    expect((await list())[0]?.title).toBe('Add bug logging and a model picker')
  })

  it('calls a chat without a title by what was said first', async () => {
    record(FIRST, [
      { type: 'mode', mode: 'default' },
      said([{ type: 'text', text: 'not typed by anyone' }], { isMeta: true }),
      said('<command-name>/clear</command-name>'),
      said([{ type: 'tool_result', content: 'output' }]),
      said([{ type: 'text', text: '  What does\nthis   do?  ' }]),
      said('and a second thing')
    ])
    expect((await list())[0]?.title).toBe('What does this do?')
  })

  it('cuts a title that goes on and on', async () => {
    record(FIRST, [said('word '.repeat(200))])
    const [chat] = await list()
    expect(chat?.title.length).toBeLessThanOrEqual(60)
    expect(chat?.title.endsWith('…')).toBe(true)
  })

  it('leaves out a chat in which nothing was said', async () => {
    record(FIRST, [{ type: 'mode', mode: 'default' }, { type: 'file-history-snapshot' }])
    record(SECOND, [])
    expect(await list()).toEqual([])
  })

  it('leaves out what helpers of an agent said among themselves', async () => {
    record(FIRST, [said('to a helper')], undefined, 'agent-a070a43.jsonl')
    record(SECOND, [said('on the side', { isSidechain: true })])
    expect(await list()).toEqual([])
  })

  it('leaves out what a program asked for and no person', async () => {
    record(FIRST, [said('Summarize this conversation', { entrypoint: 'sdk-cli' })])
    record(SECOND, [{ type: 'queue-operation' }, said('Summarize that one', { entrypoint: undefined })])
    expect(await list()).toEqual([])
  })

  it('keeps a chat from before records said where they were started', async () => {
    record(FIRST, [said('an old chat', { entrypoint: undefined }), titled('An old chat')])
    expect((await list()).map((chat) => chat.title)).toEqual(['An old chat'])
  })

  it('leaves out what is not the record of a chat', async () => {
    mkdirSync(join(folder, FIRST))
    writeFileSync(join(folder, 'notes.txt'), 'mine')
    writeFileSync(join(folder, 'not-an-id.jsonl'), JSON.stringify(said('hello')))
    expect(await list()).toEqual([])
  })

  it('leaves out a chat that was had in another folder of the same name', async () => {
    record(FIRST, [said('from elsewhere', { cwd: '/Users/someone/Projects/signal/box' })])
    record(SECOND, [said('from here')])
    expect((await list()).map((chat) => chat.title)).toEqual(['from here'])
  })

  it('reads past lines it cannot read', async () => {
    record(FIRST, ['{ cut short', '42', 'null', said('after the noise')])
    expect((await list())[0]?.title).toBe('after the noise')
  })

  it('lists no more than it is asked for, and the latest of them', async () => {
    record(FIRST, [said('first')], '2026-09-27T12:00:00.000Z')
    record(SECOND, [said('second')], '2026-09-29T12:00:00.000Z')
    record(THIRD, [said('third')], '2026-09-28T12:00:00.000Z')
    expect((await list(PROJECT, 2)).map((chat) => chat.title)).toEqual(['second', 'third'])
  })

  it('has nothing for a folder in which no chat was had', async () => {
    expect(await list('/Users/someone/Projects/other')).toEqual([])
  })

  it('has nothing when the program has never been used', async () => {
    rmSync(configDir, { recursive: true })
    expect(await list()).toEqual([])
  })
})
