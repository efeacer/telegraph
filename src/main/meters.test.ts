import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Meters, STATUS_LINE_SETTINGS, USAGE_FILE_VARIABLE } from './meters'

const NOW = Date.parse('2026-09-30T12:00:00.000Z')
const IN_TWO_HOURS = (NOW + 2 * 60 * 60 * 1000) / 1000
const ON_FRIDAY = (NOW + 2 * 24 * 60 * 60 * 1000) / 1000
const FIRST = '11111111-1111-4111-8111-111111111111'
const SECOND = '22222222-2222-4222-8222-222222222222'

let directory: string

beforeEach(() => {
  directory = join(mkdtempSync(join(tmpdir(), 'telegraph-meters-')), 'usage')
})

afterEach(() => {
  rmSync(join(directory, '..'), { recursive: true, force: true })
})

/** What Claude Code hands to a status line, as far as Telegraph reads it. */
function status(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    session_id: 'of-claude',
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    cost: { total_cost_usd: 4.2088, total_duration_ms: 17823 },
    context_window: { context_window_size: 200000, used_percentage: 38 },
    rate_limits: {
      five_hour: { used_percentage: 42.4, resets_at: IN_TWO_HOURS },
      seven_day: { used_percentage: 18, resets_at: ON_FRIDAY }
    },
    ...changes
  }
}

function report(sessionId: string, content: unknown, secondsAgo = 10): void {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, `${sessionId}.json`)
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
  const at = new Date(NOW - secondsAgo * 1000)
  utimesSync(path, at, at)
}

function open(): Meters {
  return new Meters({ directory, now: () => NOW })
}

describe('Meters', () => {
  it('reads how much of the limits is used, and when they start over', () => {
    report(FIRST, status())
    expect(open().read().limits).toEqual({
      fiveHour: { usedPercent: 42.4, resetsAt: new Date(IN_TWO_HOURS * 1000).toISOString() },
      week: { usedPercent: 18, resetsAt: new Date(ON_FRIDAY * 1000).toISOString() },
      at: new Date(NOW - 10_000).toISOString()
    })
  })

  it('reads what each session has cost and how full its context is', () => {
    report(FIRST, status())
    report(SECOND, status({ model: { display_name: 'Haiku 4.5' }, cost: { total_cost_usd: 0.03 }, context_window: { used_percentage: 5 } }))
    expect(open().read().sessions).toEqual({
      [FIRST]: { model: 'Opus 5.5', costUsd: 4.2088, contextPercent: 38 },
      [SECOND]: { model: 'Haiku 4.5', costUsd: 0.03, contextPercent: 5 }
    })
  })

  it('takes the limits from the session that reported last', () => {
    report(FIRST, status(), 600)
    report(SECOND, status({ rate_limits: { five_hour: { used_percentage: 50, resets_at: IN_TWO_HOURS } } }), 5)
    const { limits } = open().read()
    expect(limits?.fiveHour?.usedPercent).toBe(50)
    expect(limits?.week).toBeNull()
  })

  it('takes the limits from a session that knows them, when the last does not yet', () => {
    report(FIRST, status(), 600)
    report(SECOND, status({ rate_limits: undefined }), 5)
    expect(open().read().limits?.fiveHour?.usedPercent).toBe(42.4)
  })

  it('knows no limits before any session has reported them', () => {
    expect(open().read()).toEqual({ limits: null, sessions: {} })
    report(FIRST, status({ rate_limits: undefined }))
    expect(open().read().limits).toBeNull()
  })

  it('takes a limit that has started over since for unused', () => {
    const anHourAgo = (NOW - 60 * 60 * 1000) / 1000
    report(FIRST, status({ rate_limits: { five_hour: { used_percentage: 97, resets_at: anHourAgo }, seven_day: { used_percentage: 18, resets_at: ON_FRIDAY } } }))
    const { limits } = open().read()
    expect(limits?.fiveHour).toEqual({ usedPercent: 0, resetsAt: null })
    expect(limits?.week?.usedPercent).toBe(18)
  })

  it('keeps what is used between nothing and all of it', () => {
    report(FIRST, status({ rate_limits: { five_hour: { used_percentage: 140, resets_at: IN_TWO_HOURS }, seven_day: { used_percentage: -3, resets_at: ON_FRIDAY } } }))
    const { limits } = open().read()
    expect(limits?.fiveHour?.usedPercent).toBe(100)
    expect(limits?.week?.usedPercent).toBe(0)
  })

  it('leaves out what it cannot read', () => {
    report(FIRST, '{ cut short')
    report(SECOND, status({ rate_limits: { five_hour: { used_percentage: 'a lot', resets_at: IN_TWO_HOURS }, seven_day: 'soon' }, cost: 'dear', context_window: null, model: 42 }))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'notes.txt'), 'mine')
    expect(open().read()).toEqual({
      limits: null,
      sessions: { [SECOND]: { model: null, costUsd: null, contextPercent: null } }
    })
  })

  it('knows a limit without knowing when it starts over', () => {
    report(FIRST, status({ rate_limits: { five_hour: { used_percentage: 12 } } }))
    expect(open().read().limits?.fiveHour).toEqual({ usedPercent: 12, resetsAt: null })
  })

  it('says where a session is to report', () => {
    expect(open().fileFor(FIRST)).toBe(join(directory, `${FIRST}.json`))
    expect(existsSync(directory)).toBe(true)
  })

  it('has no place for a session whose name could lead elsewhere', () => {
    expect(open().fileFor('../../etc/passwd')).toBeNull()
    expect(open().fileFor('')).toBeNull()
  })

  it('clears out the reports of last week, but never the last one', () => {
    report(FIRST, status(), 9 * 24 * 60 * 60)
    report(SECOND, status(), 8 * 24 * 60 * 60)
    open().clearOld()
    expect(readdirSync(directory)).toEqual([`${SECOND}.json`])
  })

  it('has nothing to clear out before anything was reported', () => {
    expect(() => open().clearOld()).not.toThrow()
  })
})

describe('what Claude Code is asked to do', () => {
  it('is to hand its status to a command that writes it where the session is to report', () => {
    const settings = JSON.parse(STATUS_LINE_SETTINGS)
    expect(settings).toEqual({ statusLine: { type: 'command', command: expect.any(String) } })
    expect(settings.statusLine.command).toContain(`$${USAGE_FILE_VARIABLE}`)
  })

  it('writes the whole of a report or none of it', async () => {
    const { execFileSync } = await import('node:child_process')
    mkdirSync(directory, { recursive: true })
    const file = join(directory, `${FIRST}.json`)
    const { command } = JSON.parse(STATUS_LINE_SETTINGS).statusLine
    const printed = execFileSync('/bin/sh', ['-c', command], {
      input: JSON.stringify(status()),
      env: { PATH: '/usr/bin:/bin', [USAGE_FILE_VARIABLE]: file },
      encoding: 'utf8'
    })

    // Nothing is printed, so that no line of status shows in the session.
    expect(printed).toBe('')
    expect(open().read().limits?.fiveHour?.usedPercent).toBe(42.4)
    expect(readdirSync(directory)).toEqual([`${FIRST}.json`])
  })

  it('does nothing where there is nowhere to report', async () => {
    const { execFileSync } = await import('node:child_process')
    const { command } = JSON.parse(STATUS_LINE_SETTINGS).statusLine
    expect(() =>
      execFileSync('/bin/sh', ['-c', command], { input: '{}', env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8', cwd: tmpdir() })
    ).not.toThrow()
    expect(existsSync(join(tmpdir(), '.tmp'))).toBe(false)
  })
})
