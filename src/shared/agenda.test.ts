import { describe, expect, it } from 'vitest'
import { dueNudges, nudgePrompt, parseAgenda } from './agenda'

const NOW = Date.parse('2026-09-30T11:00:00.000Z')
const MINUTE = 60_000

function meeting(changes: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: 'Design review', start: '2026-09-30T14:00:00+03:00', end: '2026-09-30T15:00:00+03:00', allDay: false, ...changes }
}

describe('parseAgenda', () => {
  it('reads the meetings from what the agent answered', () => {
    const answer = `Here you are.\nEVENTS: ${JSON.stringify([meeting()])}\n`
    expect(parseAgenda(answer)).toEqual({
      status: 'read',
      meetings: [
        {
          id: '2026-09-30T11:00:00.000Z Design review',
          title: 'Design review',
          start: '2026-09-30T11:00:00.000Z',
          end: '2026-09-30T12:00:00.000Z',
          allDay: false
        }
      ]
    })
  })

  it('says so when the calendar cannot be read', () => {
    expect(parseAgenda('EVENTS: UNAVAILABLE The Google Calendar server needs authentication')).toEqual({
      status: 'unavailable',
      reason: 'The Google Calendar server needs authentication'
    })
  })

  it('gives the reason without what comes before it', () => {
    expect(parseAgenda('EVENTS: UNAVAILABLE - Google Calendar requires authentication')).toEqual({
      status: 'unavailable',
      reason: 'Google Calendar requires authentication'
    })
  })

  it('says so when the answer is not an agenda', () => {
    expect(parseAgenda('I would rather not.')).toEqual({ status: 'unreadable' })
    expect(parseAgenda('EVENTS: [not json')).toEqual({ status: 'unreadable' })
    expect(parseAgenda('EVENTS: {"a": 1}')).toEqual({ status: 'unreadable' })
  })

  it('reads an empty day', () => {
    expect(parseAgenda('EVENTS: []')).toEqual({ status: 'read', meetings: [] })
  })

  it('leaves out what is not a meeting', () => {
    const answer = `EVENTS: ${JSON.stringify([meeting({ start: 'soon' }), meeting({ title: '' }), 'text', null, meeting({ title: 'Kept' })])}`
    const result = parseAgenda(answer)
    expect(result.status === 'read' && result.meetings.map((one) => one.title)).toEqual(['Kept'])
  })

  it('makes one short line of a title', () => {
    const answer = `EVENTS: ${JSON.stringify([meeting({ title: `  Plan\n${'x'.repeat(300)}` })])}`
    const result = parseAgenda(answer)
    const title = result.status === 'read' ? result.meetings[0]!.title : ''
    expect(title.startsWith('Plan x')).toBe(true)
    expect(title).toHaveLength(120)
  })

  it('puts the meetings in order, and keeps a working day of them at most', () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      meeting({ title: `M${index}`, start: new Date(NOW + (80 - index) * MINUTE).toISOString(), end: new Date(NOW + (81 - index) * MINUTE).toISOString() })
    )
    const result = parseAgenda(`EVENTS: ${JSON.stringify(many)}`)
    const meetings = result.status === 'read' ? result.meetings : []
    expect(meetings).toHaveLength(50)
    expect(meetings[0]!.title).toBe('M79')
  })
})

describe('dueNudges', () => {
  const at = (minutes: number) => new Date(NOW + minutes * MINUTE).toISOString()
  const soon = { id: 'a', title: 'Design review', start: at(25), end: at(85), allDay: false }

  it('finds a meeting that starts within half an hour', () => {
    expect(dueNudges([soon], NOW, new Set())).toEqual([soon])
  })

  it('leaves a meeting that is further off, has begun, or takes the whole day', () => {
    const later = { ...soon, id: 'b', start: at(45) }
    const begun = { ...soon, id: 'c', start: at(-5) }
    const allDay = { ...soon, id: 'd', allDay: true }
    expect(dueNudges([later, begun, allDay], NOW, new Set())).toEqual([])
  })

  it('tells of a meeting once', () => {
    expect(dueNudges([soon], NOW, new Set(['a']))).toEqual([])
  })
})

describe('nudgePrompt', () => {
  it('asks the companion to help prepare for the meeting', () => {
    const prompt = nudgePrompt({ id: 'a', title: 'Design review', start: '2026-09-30T11:30:00.000Z', end: '2026-09-30T12:30:00.000Z', allDay: false }, 'at 14:30')
    expect(prompt).toBe(
      'Help me prepare for “Design review” at 14:30: what it is about, who is coming, and what in my mail or calendar I should know before it.'
    )
  })

  it('is one line, so that it is sent as one message', () => {
    const prompt = nudgePrompt({ id: 'a', title: 'Two\nlines', start: '2026-09-30T11:30:00.000Z', end: '2026-09-30T12:30:00.000Z', allDay: false }, 'at 14:30')
    expect(prompt).not.toMatch(/[\r\n]/)
  })
})
