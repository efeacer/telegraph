import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ModelCatalogue, type Fetch } from './catalogue'

const HOUR_MS = 60 * 60 * 1000
const NOON = Date.parse('2026-09-29T12:00:00.000Z')

const LISTED = {
  anthropic: {
    models: {
      'claude-opus-5-5': {
        id: 'claude-opus-5-5',
        name: 'Claude Opus 5.5',
        release_date: '2026-09-22',
        tool_call: true,
        modalities: { output: ['text'] }
      }
    }
  }
}
const OPUS = { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', releasedAt: '2026-09-22' }

let directory: string
let filePath: string
let time: number

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'telegraph-catalogue-'))
  filePath = join(directory, 'nested', 'models.json')
  time = NOON
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function answering(body: unknown, ok = true, length: string | null = null) {
  return vi.fn<Fetch>(async () => ({
    ok,
    headers: { get: (name) => (name === 'content-length' ? length : null) },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  }))
}

function open(fetch: Fetch | null, providers = ['anthropic']): ModelCatalogue {
  return new ModelCatalogue({ filePath, providers, fetch, now: () => time })
}

describe('ModelCatalogue', () => {
  it('asks for the list and reads the models from it', async () => {
    const fetch = answering(LISTED)
    expect(await open(fetch).load()).toEqual({ anthropic: [OPUS] })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://models.dev/api.json', expect.anything())
  })

  it('keeps the list for the next start', async () => {
    await open(answering(LISTED)).load()

    const fetch = answering({})
    expect(await open(fetch).load()).toEqual({ anthropic: [OPUS] })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('asks again after a day', async () => {
    await open(answering(LISTED)).load()
    time += 25 * HOUR_MS

    const fetch = answering(LISTED)
    await open(fetch).load()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('asks again when a launcher names a provider it has not kept', async () => {
    await open(answering(LISTED)).load()

    const fetch = answering(LISTED)
    expect(await open(fetch, ['anthropic', 'openai']).load()).toEqual({
      anthropic: [OPUS],
      openai: []
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('uses the list it has kept when it cannot ask', async () => {
    await open(answering(LISTED)).load()
    time += 25 * HOUR_MS

    const offline = vi.fn<Fetch>(async () => {
      throw new Error('no network')
    })
    expect(await open(offline).load()).toEqual({ anthropic: [OPUS] })
  })

  it('uses the list it has kept when the answer is an error', async () => {
    await open(answering(LISTED)).load()
    time += 25 * HOUR_MS

    expect(await open(answering({}, false)).load()).toEqual({ anthropic: [OPUS] })
  })

  it('does not replace the list it has kept with an empty one', async () => {
    await open(answering(LISTED)).load()
    time += 25 * HOUR_MS

    expect(await open(answering('<html>moved</html>')).load()).toEqual({ anthropic: [OPUS] })
  })

  it('keeps the models of a provider that is missing from a newer list', async () => {
    const gpt = { id: 'gpt-6-sol', name: 'GPT-6 Sol', release_date: '2026-09-22', tool_call: true, modalities: { output: ['text'] } }
    await open(answering({ ...LISTED, openai: { models: { 'gpt-6-sol': gpt } } }), ['anthropic', 'openai']).load()
    time += 25 * HOUR_MS

    expect(await open(answering(LISTED), ['anthropic', 'openai']).load()).toEqual({
      anthropic: [OPUS],
      openai: [{ id: 'gpt-6-sol', name: 'GPT-6 Sol', releasedAt: '2026-09-22' }]
    })
  })

  it('refuses a list that is far too long', async () => {
    const fetch = answering(LISTED, true, String(500 * 1024 * 1024))
    expect(await open(fetch).load()).toEqual({})
  })

  it('refuses a list that turns out far too long', async () => {
    const padded = JSON.stringify({ ...LISTED, padding: 'p'.repeat(33 * 1024 * 1024) })
    expect(await open(answering(padded)).load()).toEqual({})
  })

  it('reads at most twelve kept models of a provider', async () => {
    const many = Array.from({ length: 500 }, (_, index) => ({ id: `m-${index}`, name: `M ${index}` }))
    writeKept({ fetchedAt: NOON, providers: { anthropic: many } })
    expect((await open(null).load()).anthropic).toHaveLength(12)
  })

  it('has nothing when it has never been able to ask', async () => {
    const offline = vi.fn<Fetch>(async () => {
      throw new Error('no network')
    })
    expect(await open(offline).load()).toEqual({})
  })

  it('never asks when it has no way to', async () => {
    expect(await open(null).load()).toEqual({})
  })

  it('reads the list it was given without asking', async () => {
    const catalogue = { fetchedAt: NOON - 100 * HOUR_MS, providers: { anthropic: [OPUS] } }
    writeKept(catalogue)

    expect(await open(null).load()).toEqual({ anthropic: [OPUS] })
  })

  it('starts over from a list it cannot read', async () => {
    writeKept('{ not json')
    expect(await open(answering(LISTED)).load()).toEqual({ anthropic: [OPUS] })
    expect(JSON.parse(readFileSync(filePath, 'utf8')).providers).toEqual({ anthropic: [OPUS] })
  })

  it('drops names from the kept list that could be read as a command', async () => {
    writeKept({
      fetchedAt: NOON,
      providers: { anthropic: [OPUS, { id: 'opus; rm -rf ~', name: 'Trouble' }, 'nonsense'] }
    })
    expect(await open(null).load()).toEqual({ anthropic: [OPUS] })
  })

  it('asks for nothing when no launcher names a provider', async () => {
    const fetch = answering(LISTED)
    expect(await open(fetch, []).load()).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  })
})

function writeKept(kept: unknown): void {
  mkdirSync(join(directory, 'nested'), { recursive: true })
  writeFileSync(filePath, typeof kept === 'string' ? kept : JSON.stringify(kept))
}
