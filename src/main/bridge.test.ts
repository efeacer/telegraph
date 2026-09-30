import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Bridge, socketPathFor } from './bridge'

const CLI = join(__dirname, '..', '..', 'resources', 'cli', 'telegraph.cjs')

let directory: string
let bridge: Bridge | null

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tg-'))
  bridge = null
})

afterEach(async () => {
  await bridge?.close()
  rmSync(directory, { recursive: true, force: true })
})

const MEETING = { id: 'e1', title: 'Design review', start: '2026-09-30T11:00:00.000Z', end: '2026-09-30T12:00:00.000Z', allDay: false }

async function open(handlers: Partial<ConstructorParameters<typeof Bridge>[0]['handlers']> = {}): Promise<Bridge> {
  bridge = new Bridge({
    socketPath: socketPathFor(directory),
    handlers: {
      status: async () => ({ google: 'connected', email: 'ada@example.com' }),
      meetings: async () => [MEETING],
      searchMail: async (query) => [{ id: 'm1', from: 'Ada', subject: `About ${query}`, date: 'today', snippet: 'Can we move it?', body: '' }],
      readMail: async (id) => ({ id, from: 'Ada', subject: 'Review', date: 'today', snippet: '', body: 'Can we move it to Friday?' }),
      ...handlers
    }
  })
  await bridge.listen()
  return bridge
}

/** Runs the command as an agent would, with what its session is given. */
function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH ?? '', TZ: 'UTC', ...env } }, (error, out, err) =>
      resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out, err })
    )
  })
}

function sessionEnv(open: Bridge): Record<string, string> {
  return { TELEGRAPH_BRIDGE: open.socketPath, TELEGRAPH_BRIDGE_TOKEN: open.token }
}

describe('the telegraph command', () => {
  it('lists the meetings', async () => {
    const { code, out } = await run(['meetings'], sessionEnv(await open()))
    expect(code).toBe(0)
    expect(out).toContain('Design review')
    expect(out).toContain('11:00')
  })

  it('gives JSON to a program that asks for it', async () => {
    const { out } = await run(['meetings', '--json'], sessionEnv(await open()))
    expect(JSON.parse(out)).toEqual([MEETING])
  })

  it('finds mail, and reads a message', async () => {
    const env = sessionEnv(await open())
    expect((await run(['mail', 'search', 'from:ada', 'newer_than:7d'], env)).out).toContain('About from:ada newer_than:7d')
    expect((await run(['mail', 'read', 'm1'], env)).out).toContain('Can we move it to Friday?')
  })

  it('says how it is used', async () => {
    const { code, out } = await run(['help'], sessionEnv(await open()))
    expect(code).toBe(0)
    expect(out).toContain('telegraph meetings')
    expect(out).toContain('telegraph mail search')
  })

  it('says what went wrong, in words', async () => {
    const env = sessionEnv(await open({ meetings: async () => { throw new Error('Google is not connected. Connect it in Telegraph.') } }))
    const { code, err } = await run(['meetings'], env)
    expect(code).toBe(1)
    expect(err).toContain('Google is not connected')
  })

  it('does not answer without the key of the session', async () => {
    const opened = await open()
    const { code, err } = await run(['meetings'], { TELEGRAPH_BRIDGE: opened.socketPath, TELEGRAPH_BRIDGE_TOKEN: 'guessed' })
    expect(code).toBe(1)
    expect(err).toMatch(/not allowed/i)
  })

  it('says where to run it when it is run outside Telegraph', async () => {
    const { code, err } = await run(['meetings'])
    expect(code).toBe(1)
    expect(err).toMatch(/inside a Telegraph session/)
  })

  it('refuses a command it does not know', async () => {
    const { code, err } = await run(['calendar', 'delete', 'e1'], sessionEnv(await open()))
    expect(code).toBe(2)
    expect(err).toContain('telegraph help')
  })
})

describe('Bridge', () => {
  it('is reachable by its owner only', async () => {
    const { statSync } = await import('node:fs')
    const opened = await open()
    if (process.platform !== 'win32') expect(statSync(opened.socketPath).mode & 0o777).toBe(0o600)
  })

  it('makes a new key each time it opens', async () => {
    const one = (await open()).token
    await bridge!.close()
    expect((await open()).token).not.toBe(one)
  })
})
