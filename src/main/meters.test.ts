import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { withReporting } from '@shared/usage'
import { Meters, STATUS_LINE_SETTINGS, USAGE_FILE_VARIABLE, hasOwnStatusLine } from './meters'

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

  it('takes the most that any session knows to be used of a limit', () => {
    // An idle session writes its report anew without knowing anything new.
    report(FIRST, status({ rate_limits: { five_hour: { used_percentage: 80, resets_at: IN_TWO_HOURS } } }), 60)
    report(SECOND, status({ rate_limits: { five_hour: { used_percentage: 12, resets_at: IN_TWO_HOURS } } }), 5)
    const { limits } = open().read()
    expect(limits?.fiveHour?.usedPercent).toBe(80)
    expect(limits?.at).toBe(new Date(NOW - 60_000).toISOString())
  })

  it('goes by the session that knows the stretch of time that is running now', () => {
    const anHourAgo = (NOW - 60 * 60 * 1000) / 1000
    report(FIRST, status({ rate_limits: { five_hour: { used_percentage: 80, resets_at: IN_TWO_HOURS } } }), 60)
    report(SECOND, status({ rate_limits: { five_hour: { used_percentage: 97, resets_at: anHourAgo } } }), 5)
    expect(open().read().limits?.fiveHour).toEqual({
      usedPercent: 80,
      resetsAt: new Date(IN_TWO_HOURS * 1000).toISOString()
    })
  })

  it('goes by the later stretch of time when sessions know of two', () => {
    const inFourHours = IN_TWO_HOURS + 2 * 60 * 60
    report(FIRST, status({ rate_limits: { five_hour: { used_percentage: 90, resets_at: IN_TWO_HOURS } } }), 5)
    report(SECOND, status({ rate_limits: { five_hour: { used_percentage: 3, resets_at: inFourHours } } }), 60)
    expect(open().read().limits?.fiveHour?.usedPercent).toBe(3)
  })

  it('knows each limit from whichever session knows it', () => {
    report(FIRST, status(), 600)
    report(SECOND, status({ rate_limits: { five_hour: { used_percentage: 50, resets_at: IN_TWO_HOURS } } }), 5)
    const { limits } = open().read()
    expect(limits?.fiveHour?.usedPercent).toBe(50)
    expect(limits?.week?.usedPercent).toBe(18)
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

  it('keeps the limits of a session that has ended, and nothing else of it', () => {
    report(FIRST, status({ cwd: '/Users/someone/secret-project', session_name: 'A private matter' }), 30)
    const meters = open()
    meters.retire(FIRST)

    expect(readdirSync(directory)).toEqual(['_limits.json'])
    expect(readFileSync(join(directory, '_limits.json'), 'utf8')).not.toMatch(/secret|private|Opus|4\.2/)
    expect(meters.read()).toEqual({
      limits: {
        fiveHour: { usedPercent: 42.4, resetsAt: new Date(IN_TWO_HOURS * 1000).toISOString() },
        week: { usedPercent: 18, resetsAt: new Date(ON_FRIDAY * 1000).toISOString() },
        at: new Date(NOW - 30_000).toISOString()
      },
      sessions: {}
    })
  })

  it('weighs the limits it has kept against those of the sessions that go on', () => {
    report(FIRST, status({ rate_limits: { five_hour: { used_percentage: 60, resets_at: IN_TWO_HOURS } } }), 30)
    const meters = open()
    meters.retire(FIRST)
    report(SECOND, status({ rate_limits: { five_hour: { used_percentage: 75, resets_at: IN_TWO_HOURS } } }), 5)
    expect(meters.read().limits?.fiveHour?.usedPercent).toBe(75)

    meters.retire(SECOND)
    expect(meters.read().limits?.fiveHour?.usedPercent).toBe(75)
    expect(readdirSync(directory)).toEqual(['_limits.json'])
  })

  it('keeps the limits of the sessions that were going when it was last closed', () => {
    report(FIRST, status(), 30)
    report(SECOND, status({ rate_limits: undefined }), 5)
    open().retireAll()
    expect(readdirSync(directory)).toEqual(['_limits.json'])
    expect(open().read().limits?.week?.usedPercent).toBe(18)
  })

  it('has nothing to keep of a session that never reported', () => {
    const meters = open()
    expect(() => meters.retire(FIRST)).not.toThrow()
    expect(() => meters.retire('../../etc/passwd')).not.toThrow()
    expect(() => meters.retireAll()).not.toThrow()
    expect(meters.read().limits).toBeNull()
  })
})

describe('hasOwnStatusLine', () => {
  it('is true for a user who has set up a status line', () => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }))
    expect(hasOwnStatusLine(directory)).toBe(true)
  })

  it('is false for a user who has not', () => {
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'settings.json'), JSON.stringify({ model: 'opus' }))
    expect(hasOwnStatusLine(directory)).toBe(false)
  })

  it('is true in a project that has set up a status line for itself', () => {
    const project = join(directory, 'project')
    for (const name of ['settings.json', 'settings.local.json']) {
      rmSync(join(project, '.claude'), { recursive: true, force: true })
      mkdirSync(join(project, '.claude'), { recursive: true })
      writeFileSync(join(project, '.claude', name), JSON.stringify({ statusLine: { type: 'command', command: 'theirs' } }))
      expect(hasOwnStatusLine(directory, project), name).toBe(true)
    }
    expect(hasOwnStatusLine(directory, join(directory, 'another'))).toBe(false)
  })

  it('is false where there are no settings, or none that can be read', () => {
    expect(hasOwnStatusLine(directory)).toBe(false)
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'settings.json'), '{ cut short')
    expect(hasOwnStatusLine(directory)).toBe(false)
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

  it('is put after a command so that the session reports', () => {
    expect(withReporting('claude --model opus')).toBe(`claude --model opus --settings '${STATUS_LINE_SETTINGS}'`)
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
