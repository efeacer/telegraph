import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TokenLedger } from './ledger'

// A Wednesday afternoon, by the clock on the wall.
const NOW = new Date(2026, 8, 30, 15, 0, 0)

let configDir: string
let folder: string
let answers: number

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'telegraph-ledger-'))
  folder = join(configDir, 'projects', '-Users-someone-signal-box')
  mkdirSync(folder, { recursive: true })
  answers = 0
})

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true })
})

interface Spent {
  input?: number
  output?: number
  cacheWrite?: number
  cacheRead?: number
}

/** A line as Claude Code writes it for an answer. */
function answer(at: Date, spent: Spent, more: { id?: string; model?: string } = {}): string {
  const id = more.id ?? `msg_${++answers}`
  return JSON.stringify({
    type: 'assistant',
    timestamp: at.toISOString(),
    requestId: `req_${id}`,
    message: {
      id,
      model: more.model ?? 'claude-opus-5-5',
      usage: {
        input_tokens: spent.input ?? 0,
        output_tokens: spent.output ?? 0,
        cache_creation_input_tokens: spent.cacheWrite ?? 0,
        cache_read_input_tokens: spent.cacheRead ?? 0
      }
    }
  })
}

function at(daysAgo: number, hour = 12): Date {
  return new Date(2026, 8, 30 - daysAgo, hour, 0, 0)
}

function write(name: string, lines: string[], written = NOW): string {
  const path = join(folder, name)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, lines.map((line) => `${line}\n`).join(''))
  utimesSync(path, written, written)
  return path
}

function open(now: () => Date = () => NOW): TokenLedger {
  return new TokenLedger({ configDir, now })
}

describe('TokenLedger', () => {
  it('adds up what the answers of today took', async () => {
    write('a.jsonl', [
      answer(at(0, 9), { input: 10, output: 200, cacheWrite: 3000, cacheRead: 40000 }),
      answer(at(0, 10), { input: 5, output: 100, cacheWrite: 1000, cacheRead: 20000 })
    ])
    const days = await open().read()
    expect(days.at(-1)).toEqual({
      day: '2026-09-30',
      tokens: { input: 15, output: 300, cacheWrite: 4000, cacheRead: 60000 },
      models: { 'claude-opus-5-5': { input: 15, output: 300, cacheWrite: 4000, cacheRead: 60000 } }
    })
  })

  it('has a week of days, the oldest first, also the ones nothing was spent on', async () => {
    write('a.jsonl', [answer(at(2), { output: 7 }), answer(at(0), { output: 1 })])
    const days = await open().read()
    expect(days.map((day) => day.day)).toEqual([
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
      '2026-09-30'
    ])
    expect(days.map((day) => day.tokens.output)).toEqual([0, 0, 0, 0, 7, 0, 1])
  })

  it('counts a day by the clock on the wall', async () => {
    write('a.jsonl', [
      answer(new Date(2026, 8, 29, 23, 59, 0), { output: 1 }),
      answer(new Date(2026, 8, 30, 0, 1, 0), { output: 2 })
    ])
    const days = await open().read()
    expect(days.slice(-2).map((day) => day.tokens.output)).toEqual([1, 2])
  })

  it('leaves out what is more than a week old', async () => {
    write('a.jsonl', [answer(at(7), { output: 99 }), answer(at(6), { output: 1 })])
    const days = await open().read()
    expect(days.reduce((sum, day) => sum + day.tokens.output, 0)).toBe(1)
  })

  it('tells the models apart', async () => {
    write('a.jsonl', [
      answer(at(0), { output: 10 }, { model: 'claude-opus-5-5' }),
      answer(at(0), { output: 3 }, { model: 'claude-haiku-4-5-20251001' }),
      answer(at(0), { output: 5 }, { model: 'claude-opus-5-5' })
    ])
    const today = (await open().read()).at(-1)!
    expect(today.models['claude-opus-5-5']?.output).toBe(15)
    expect(today.models['claude-haiku-4-5-20251001']?.output).toBe(3)
    expect(today.tokens.output).toBe(18)
  })

  it('counts an answer once, however many lines it is written on', async () => {
    write('a.jsonl', [
      answer(at(0), { input: 2, output: 10 }, { id: 'msg_same' }),
      answer(at(0), { input: 2, output: 10 }, { id: 'msg_same' }),
      answer(at(0), { input: 2, output: 80 }, { id: 'msg_same' })
    ])
    // By its last line, which is written when the answer is complete.
    expect((await open().read()).at(-1)!.tokens).toMatchObject({ input: 2, output: 80 })
  })

  it('counts an answer once when two records hold it', async () => {
    write('a.jsonl', [answer(at(0), { output: 10 }, { id: 'msg_shared' })])
    write('b.jsonl', [answer(at(0), { output: 10 }, { id: 'msg_shared' })])
    expect((await open().read()).at(-1)!.tokens.output).toBe(10)
  })

  it('counts an answer by its most complete line, whichever record is read last', async () => {
    write('a.jsonl', [
      answer(at(0), { input: 2, output: 1 }, { id: 'msg_forked' }),
      answer(at(0), { input: 2, output: 500 }, { id: 'msg_forked' })
    ])
    // A record that was branched off while the answer was still being given.
    write('b.jsonl', [answer(at(0), { input: 2, output: 1 }, { id: 'msg_forked' })])
    expect((await open().read()).at(-1)!.tokens).toMatchObject({ input: 2, output: 500 })
  })

  it('counts an answer once when one of its lines does not say which request it was', async () => {
    const whole = answer(at(0), { output: 10 }, { id: 'msg_same' })
    const { requestId: _left, ...without } = JSON.parse(whole)
    write('a.jsonl', [whole, JSON.stringify(without)])
    expect((await open().read()).at(-1)!.tokens.output).toBe(10)
  })

  it('reads a record from the start when another file has taken its place', async () => {
    const path = write('a.jsonl', [answer(at(0), { output: 10 })])
    const ledger = open()
    await ledger.read()

    // Longer than the one before, so that its length does not give it away.
    const other = write('other.tmp', [answer(at(0), { output: 1 }), answer(at(0), { output: 2 }), answer(at(0), { output: 4 })])
    renameSync(other, path)
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(17)
  })

  it('reads a long record a piece at a time', async () => {
    const lines = Array.from({ length: 400 }, () => answer(at(0), { output: 1 }))
    write('a.jsonl', lines)
    const ledger = new TokenLedger({ configDir, now: () => NOW, chunkBytes: 1000 })
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(400)
  })

  it('reads a line that is longer than a piece', async () => {
    const long = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(5000) } })
    write('a.jsonl', [answer(at(0), { output: 1 }), long, answer(at(0), { output: 2 }), `${long}ü`, answer(at(0), { output: 4 })])
    const ledger = new TokenLedger({ configDir, now: () => NOW, chunkBytes: 1000 })
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(7)
  })

  it('gives what it read a moment ago, without reading again', async () => {
    const path = write('a.jsonl', [answer(at(0), { output: 10 })])
    let now = NOW
    const ledger = new TokenLedger({ configDir, now: () => now, freshForMs: 5_000 })
    await ledger.read()

    appendFileSync(path, `${answer(at(0), { output: 5 })}\n`)
    now = new Date(NOW.getTime() + 2_000)
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(10)
    now = new Date(NOW.getTime() + 6_000)
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(15)
  })

  it('counts what the helpers of an agent took', async () => {
    write('a.jsonl', [answer(at(0), { output: 10 })])
    write('chat-id/subagents/agent-a1.jsonl', [answer(at(0), { output: 4 })])
    expect((await open().read()).at(-1)!.tokens.output).toBe(14)
  })

  it('counts the records of every folder', async () => {
    write('a.jsonl', [answer(at(0), { output: 10 })])
    write('../-Users-someone-depot/b.jsonl', [answer(at(0), { output: 5 })])
    expect((await open().read()).at(-1)!.tokens.output).toBe(15)
  })

  it('leaves out lines that are no answers, and answers that took nothing', async () => {
    write('a.jsonl', [
      JSON.stringify({ type: 'user', timestamp: at(0).toISOString(), message: { usage: { output_tokens: 99 } } }),
      answer(at(0), { output: 50 }, { model: '<synthetic>' }),
      JSON.stringify({ type: 'assistant', timestamp: at(0).toISOString(), message: { id: 'x', model: 'm' } }),
      JSON.stringify({ type: 'assistant', message: { id: 'y', model: 'm', usage: { output_tokens: 9 } } }),
      '{ cut short',
      answer(at(0), { output: 1 })
    ])
    expect((await open().read()).at(-1)!.tokens.output).toBe(1)
  })

  it('takes numbers for what they are and nothing else', async () => {
    const line = JSON.stringify({
      type: 'assistant',
      timestamp: at(0).toISOString(),
      message: {
        id: 'odd',
        model: 'm',
        usage: { input_tokens: '12', output_tokens: -5, cache_read_input_tokens: 1.5, cache_creation_input_tokens: null }
      }
    })
    write('a.jsonl', [line])
    expect((await open().read()).at(-1)!.tokens).toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 })
  })

  it('reads on from where it was when a record grows', async () => {
    const path = write('a.jsonl', [answer(at(0), { output: 10 })])
    const ledger = open()
    await ledger.read()

    appendFileSync(path, `${answer(at(0), { output: 5 })}\n`)
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(15)
  })

  it('waits for a line that is still being written', async () => {
    const path = write('a.jsonl', [answer(at(0), { output: 10 })])
    const ledger = open()
    const half = answer(at(0), { output: 5 })
    appendFileSync(path, half.slice(0, 40))
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(10)

    appendFileSync(path, `${half.slice(40)}\n`)
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(15)
  })

  it('starts a record over when it has been written anew', async () => {
    const path = write('a.jsonl', [answer(at(0), { output: 10 }), answer(at(0), { output: 20 })])
    const ledger = open()
    await ledger.read()

    writeFileSync(path, `${answer(at(0), { output: 3 })}\n`)
    expect((await ledger.read()).at(-1)!.tokens.output).toBe(33)
  })

  it('does not open records that were last written before the week', async () => {
    write('old.jsonl', [answer(at(0), { output: 99 })], at(8))
    expect((await open().read()).at(-1)!.tokens.output).toBe(0)
  })

  it('moves on with the days', async () => {
    write('a.jsonl', [answer(at(6), { output: 6 }), answer(at(0), { output: 1 })])
    let now = NOW
    const ledger = open(() => now)
    await ledger.read()

    now = new Date(2026, 9, 1, 9, 0, 0)
    const days = await ledger.read()
    expect(days.map((day) => day.day).at(0)).toBe('2026-09-25')
    expect(days.map((day) => day.tokens.output)).toEqual([0, 0, 0, 0, 0, 1, 0])
  })

  it('has a week of nothing when the program has never been used', async () => {
    rmSync(configDir, { recursive: true })
    const days = await open().read()
    expect(days).toHaveLength(7)
    expect(days.every((day) => day.tokens.output === 0)).toBe(true)
  })
})
