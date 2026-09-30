import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BRIEFING, checkSnapshot, parseConnections, renderContext, writeBriefing } from './companion'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'telegraph-companion-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('the briefing of the companion', () => {
  it('is written where the companion starts, for Claude to read', () => {
    writeBriefing(join(directory, 'companion'))
    expect(readFileSync(join(directory, 'companion', 'CLAUDE.md'), 'utf8')).toBe(BRIEFING)
  })

  it('points it to what Telegraph knows, and keeps it from acting unasked', () => {
    expect(BRIEFING).toContain('context.md')
    expect(BRIEFING).toMatch(/calendar/i)
    expect(BRIEFING).toMatch(/mail/i)
    expect(BRIEFING).toMatch(/never send/i)
  })
})

describe('renderContext', () => {
  const now = new Date('2026-09-30T11:00:00.000Z')

  it('tells of the meetings and the sessions', () => {
    const text = renderContext({
      now,
      agenda: {
        status: 'read',
        readAt: '2026-09-30T10:30:00.000Z',
        reason: null,
        meetings: [{ id: 'a', title: 'Design review', start: '2026-09-30T11:30:00.000Z', end: '2026-09-30T12:30:00.000Z', allDay: false }]
      },
      snapshot: { sessions: [{ label: 'Fix the seat picker', project: 'TakeYourSeat', status: 'working', model: 'Opus 5.5' }] }
    })
    expect(text).toContain('# What Telegraph knows')
    expect(text).toContain('Design review')
    expect(text).toContain('2026-09-30T11:30:00.000Z')
    expect(text).toContain('Fix the seat picker (TakeYourSeat): working, on Opus 5.5')
  })

  it('says why it knows no meetings', () => {
    const text = renderContext({
      now,
      agenda: { status: 'unavailable', readAt: null, reason: 'Google Calendar needs authentication', meetings: [] },
      snapshot: { sessions: [] }
    })
    expect(text).toContain('Google Calendar needs authentication')
    expect(text).toContain('No sessions are open')
  })
})

describe('checkSnapshot', () => {
  it('takes what the window says of its sessions', () => {
    const snapshot = { sessions: [{ label: 'Build', project: 'telegraph', status: 'idle', model: null }] }
    expect(checkSnapshot(snapshot)).toEqual(snapshot)
  })

  it('makes one short line of each text, and leaves out what is no session', () => {
    const checked = checkSnapshot({
      sessions: [{ label: `a\nb${'x'.repeat(300)}`, project: 'p', status: 'idle', model: 'm' }, 'nonsense', { label: 'x' }]
    })
    expect(checked?.sessions).toHaveLength(1)
    expect(checked?.sessions[0]!.label).toHaveLength(100)
    expect(checked?.sessions[0]!.label.startsWith('a b')).toBe(true)
  })

  it('refuses what is no snapshot', () => {
    expect(checkSnapshot(null)).toBeNull()
    expect(checkSnapshot({ sessions: 'all' })).toBeNull()
  })
})

describe('parseConnections', () => {
  it('reads the connectors of the Claude account, and the other servers', () => {
    const output = [
      'Checking MCP server health…',
      '',
      'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected',
      'claude.ai Google Calendar: https://calendarmcp.googleapis.com/mcp/v1 - ✔ Connected',
      'claude.ai Outlook: https://example.com/mcp - ✗ Failed to connect',
      'plugin:context7:context7: https://mcp.context7.com/mcp (HTTP) - ✔ Connected',
      'my-notes: node /Users/someone/notes.js - ✔ Connected'
    ].join('\n')
    expect(parseConnections(output)).toEqual([
      { name: 'Gmail', account: true, reachable: true },
      { name: 'Google Calendar', account: true, reachable: true },
      { name: 'Outlook', account: true, reachable: false },
      { name: 'context7', account: false, reachable: true },
      { name: 'my-notes', account: false, reachable: true }
    ])
  })

  it('reads nothing from nothing', () => {
    expect(parseConnections('No MCP servers configured.')).toEqual([])
  })
})
