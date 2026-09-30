import { describe, expect, it } from 'vitest'
import { readCalendars, readEvents, readMessage, readMessageList } from './api'

describe('readCalendars', () => {
  it('takes the calendars the user shows', () => {
    expect(
      readCalendars({
        items: [
          { id: 'me@example.com', summary: 'Me', selected: true, primary: true },
          { id: 'team@group', summary: 'Team', selected: true },
          { id: 'holidays', summary: 'Holidays', selected: false },
          { summary: 'No id' }
        ]
      })
    ).toEqual([
      { id: 'me@example.com', name: 'Me' },
      { id: 'team@group', name: 'Team' }
    ])
  })

  it('reads nothing from nothing', () => {
    expect(readCalendars(null)).toEqual([])
    expect(readCalendars({ items: 'x' })).toEqual([])
  })
})

describe('readEvents', () => {
  it('reads the meetings of a calendar', () => {
    const meetings = readEvents({
      items: [
        {
          id: 'e1',
          summary: 'Design review',
          start: { dateTime: '2026-09-30T14:00:00+03:00' },
          end: { dateTime: '2026-09-30T15:00:00+03:00' },
          attendees: [{ email: 'a@x' }, { email: 'b@x' }]
        },
        { id: 'e2', summary: 'Offsite', start: { date: '2026-10-01' }, end: { date: '2026-10-02' } },
        { id: 'e3', summary: 'Called off', status: 'cancelled', start: { dateTime: '2026-09-30T16:00:00Z' }, end: { dateTime: '2026-09-30T17:00:00Z' } },
        { id: 'e4', start: { dateTime: '2026-09-30T18:00:00Z' }, end: { dateTime: '2026-09-30T19:00:00Z' } }
      ]
    })
    expect(meetings).toEqual([
      { id: 'e1', title: 'Design review', start: '2026-09-30T11:00:00.000Z', end: '2026-09-30T12:00:00.000Z', allDay: false },
      { id: 'e2', title: 'Offsite', start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z', allDay: true },
      { id: 'e4', title: '(No title)', start: '2026-09-30T18:00:00.000Z', end: '2026-09-30T19:00:00.000Z', allDay: false }
    ])
  })

  it('leaves out an invitation the user declined', () => {
    const meetings = readEvents({
      items: [
        {
          id: 'e1',
          summary: 'Declined',
          start: { dateTime: '2026-09-30T14:00:00Z' },
          end: { dateTime: '2026-09-30T15:00:00Z' },
          attendees: [{ self: true, responseStatus: 'declined' }]
        }
      ]
    })
    expect(meetings).toEqual([])
  })
})

describe('readMessageList', () => {
  it('takes the ids of the messages', () => {
    expect(readMessageList({ messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2' }, {}] })).toEqual(['m1', 'm2'])
    expect(readMessageList({ resultSizeEstimate: 0 })).toEqual([])
  })
})

describe('readMessage', () => {
  const encode = (text: string): string => Buffer.from(text).toString('base64url')

  it('reads who wrote, about what, when, and what was written', () => {
    const message = readMessage({
      id: 'm1',
      snippet: 'Can we move the review…',
      payload: {
        headers: [
          { name: 'From', value: 'Ada <ada@example.com>' },
          { name: 'Subject', value: 'Design review' },
          { name: 'Date', value: 'Wed, 30 Sep 2026 09:12:00 +0300' }
        ],
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/html', body: { data: encode('<p>Can we <b>move</b> the review?</p>') } },
          { mimeType: 'text/plain', body: { data: encode('Can we move the review?\nThanks') } }
        ]
      }
    })
    expect(message).toEqual({
      id: 'm1',
      from: 'Ada <ada@example.com>',
      subject: 'Design review',
      date: 'Wed, 30 Sep 2026 09:12:00 +0300',
      snippet: 'Can we move the review…',
      body: 'Can we move the review?\nThanks'
    })
  })

  it('makes text of a message that has only HTML', () => {
    const message = readMessage({
      id: 'm1',
      payload: { headers: [], mimeType: 'text/html', body: { data: encode('<p>Hello&nbsp;<b>there</b></p><style>p{}</style>') } }
    })
    expect(message?.body).toBe('Hello there')
  })

  it('cuts a long message down to size', () => {
    const message = readMessage({ id: 'm1', payload: { headers: [], mimeType: 'text/plain', body: { data: encode('x'.repeat(50_000)) } } })
    expect(message?.body.length).toBeLessThanOrEqual(20_000)
  })

  it('reads nothing from what is no message', () => {
    expect(readMessage(null)).toBeNull()
    expect(readMessage({ payload: {} })).toBeNull()
  })
})
