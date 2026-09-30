import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Meeting } from '@shared/agenda'
import { AgendaWatcher, agendaPrompt, readQueryOutput } from './agenda'

const NOW = Date.parse('2026-09-30T11:00:00.000Z')
const MINUTE = 60_000
const at = (minutes: number): string => new Date(NOW + minutes * MINUTE).toISOString()

let directory: string
let time: number

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'telegraph-agenda-'))
  time = NOW
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

function answering(meetings: Record<string, unknown>[]) {
  return vi.fn(async () => `EVENTS: ${JSON.stringify(meetings)}`)
}

function watcher(fetch: () => Promise<string>, onNudge = vi.fn()) {
  return {
    onNudge,
    agenda: new AgendaWatcher({ filePath: join(directory, 'agenda.json'), fetch, now: () => time, onNudge, onChange: () => {} })
  }
}

const review = { title: 'Design review', start: at(40), end: at(100), allDay: false }

describe('AgendaWatcher', () => {
  it('reads the meetings', async () => {
    const { agenda } = watcher(answering([review]))
    await agenda.refresh()
    expect(agenda.state()).toMatchObject({ status: 'read', readAt: new Date(NOW).toISOString() })
    expect(agenda.state().meetings.map((meeting: Meeting) => meeting.title)).toEqual(['Design review'])
  })

  it('tells of a meeting half an hour before it, and once', async () => {
    const { agenda, onNudge } = watcher(answering([review]))
    await agenda.refresh()
    agenda.check()
    expect(onNudge).not.toHaveBeenCalled()

    time = NOW + 12 * MINUTE
    agenda.check()
    agenda.check()
    expect(onNudge).toHaveBeenCalledOnce()
    expect(onNudge.mock.calls[0]![0]).toMatchObject({ title: 'Design review' })
  })

  it('does not tell of a meeting again after a restart', async () => {
    const first = watcher(answering([review]))
    await first.agenda.refresh()
    time = NOW + 12 * MINUTE
    first.agenda.check()

    const second = watcher(answering([review]))
    second.agenda.load()
    second.agenda.check()
    expect(second.onNudge).not.toHaveBeenCalled()
  })

  it('knows the meetings it read before, without asking again', () => {
    const first = watcher(answering([review]))
    return first.agenda.refresh().then(() => {
      const second = watcher(vi.fn(async () => ''))
      second.agenda.load()
      expect(second.agenda.state().meetings).toHaveLength(1)
    })
  })

  it('keeps what it knew when the calendar cannot be read now', async () => {
    let answer = `EVENTS: ${JSON.stringify([review])}`
    const { agenda } = watcher(async () => answer)
    await agenda.refresh()
    answer = 'EVENTS: UNAVAILABLE Google Calendar needs authentication'
    await agenda.refresh()
    expect(agenda.state()).toMatchObject({ status: 'unavailable', reason: 'Google Calendar needs authentication' })
    expect(agenda.state().meetings).toHaveLength(1)
  })

  it('says so when asking failed', async () => {
    const { agenda } = watcher(async () => {
      throw new Error('claude is not installed')
    })
    await agenda.refresh()
    expect(agenda.state()).toMatchObject({ status: 'failed', reason: 'claude is not installed' })
  })

  it('asks once at a time', async () => {
    let finish: (answer: string) => void = () => {}
    const fetch = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)))
    const { agenda } = watcher(fetch)
    const one = agenda.refresh()
    const two = agenda.refresh()
    expect(agenda.state().status).toBe('reading')
    finish('EVENTS: []')
    await Promise.all([one, two])
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('forgets the meetings that are over', async () => {
    const { agenda } = watcher(answering([review, { ...review, title: 'Earlier', start: at(-120), end: at(-60) }]))
    await agenda.refresh()
    expect(agenda.state().meetings.map((meeting: Meeting) => meeting.title)).toEqual(['Design review'])
  })

  it('starts over from a file it cannot read', () => {
    writeFileSync(join(directory, 'agenda.json'), '{ cut short')
    const { agenda } = watcher(answering([]))
    agenda.load()
    expect(agenda.state()).toMatchObject({ status: 'unknown', meetings: [] })
  })

  it('writes the file only with what it read', async () => {
    const { agenda } = watcher(answering([review]))
    await agenda.refresh()
    const kept = JSON.parse(readFileSync(join(directory, 'agenda.json'), 'utf8'))
    expect(Object.keys(kept).sort()).toEqual(['meetings', 'readAt', 'told'])
  })
})

describe('readQueryOutput', () => {
  it('takes the answer out of what claude -p prints', () => {
    expect(readQueryOutput(JSON.stringify({ result: 'EVENTS: []', total_cost_usd: 0.02, is_error: false }))).toEqual({
      answer: 'EVENTS: []',
      costUsd: 0.02
    })
  })

  it('refuses what is no answer', () => {
    expect(() => readQueryOutput('not json')).toThrow()
    expect(() => readQueryOutput(JSON.stringify({ is_error: true, result: 'Credit balance too low' }))).toThrow('Credit balance too low')
  })
})

describe('agendaPrompt', () => {
  it('asks to read, and never to change, and says how to answer', () => {
    const prompt = agendaPrompt(new Date(NOW))
    expect(prompt).toContain('EVENTS:')
    expect(prompt).toContain('EVENTS: UNAVAILABLE')
    expect(prompt).toMatch(/never create, change or delete/i)
    expect(prompt).toContain('2026')
  })
})
