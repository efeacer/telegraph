import type { Meeting } from '@shared/agenda'

const TITLE_LENGTH = 120
const BODY_LENGTH = 20_000
const LINE_LENGTH = 300

export interface Calendar {
  id: string
  name: string
}

export interface MailMessage {
  id: string
  from: string
  subject: string
  date: string
  snippet: string
  /** The text of the message. Empty in a list, where only the snippet is read. */
  body: string
}

// Google's answers are read for what they can be shown to hold.
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown, length = LINE_LENGTH): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, length) : ''
}

export function readCalendars(answer: unknown): Calendar[] {
  return list(record(answer).items).flatMap((item) => {
    const { id, summary, selected } = record(item)
    return typeof id === 'string' && selected === true ? [{ id, name: text(summary) || id }] : []
  })
}

function time(value: unknown): { at: number; allDay: boolean } | null {
  const { dateTime, date } = record(value)
  if (typeof dateTime === 'string') return { at: Date.parse(dateTime), allDay: false }
  // A whole day has a date and no time: taken as that day in UTC, which is what a day is to the calendar.
  if (typeof date === 'string') return { at: Date.parse(`${date}T00:00:00Z`), allDay: true }
  return null
}

export function readEvents(answer: unknown): Meeting[] {
  return list(record(answer).items).flatMap((item) => {
    const event = record(item)
    if (event.status === 'cancelled' || typeof event.id !== 'string') return []
    const declined = list(event.attendees).some((attendee) => {
      const { self, responseStatus } = record(attendee)
      return self === true && responseStatus === 'declined'
    })
    const start = time(event.start)
    const end = time(event.end)
    if (declined || !start || Number.isNaN(start.at)) return []
    return [
      {
        id: event.id,
        title: text(event.summary, TITLE_LENGTH) || '(No title)',
        start: new Date(start.at).toISOString(),
        end: new Date(end && !Number.isNaN(end.at) ? end.at : start.at).toISOString(),
        allDay: start.allDay
      }
    ]
  })
}

export function readMessageList(answer: unknown): string[] {
  return list(record(answer).messages).flatMap((item) => {
    const { id } = record(item)
    return typeof id === 'string' ? [id] : []
  })
}

function decode(data: unknown): string {
  return typeof data === 'string' ? Buffer.from(data, 'base64url').toString('utf8') : ''
}

/** The first part of the kind asked for, looked for through the parts within parts. */
function partOf(part: Record<string, unknown>, mimeType: string): string | null {
  if (part.mimeType === mimeType) return decode(record(part.body).data)
  for (const child of list(part.parts)) {
    const found = partOf(record(child), mimeType)
    if (found !== null) return found
  }
  return null
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

export function readMessage(answer: unknown, withBody = true): MailMessage | null {
  const message = record(answer)
  const payload = record(message.payload)
  if (typeof message.id !== 'string') return null
  const header = (name: string): string => {
    const found = list(payload.headers).find((item) => text(record(item).name).toLowerCase() === name.toLowerCase())
    return text(record(found).value)
  }
  const plain = withBody ? partOf(payload, 'text/plain') : null
  const html = withBody && plain === null ? partOf(payload, 'text/html') : null
  const body = (plain ?? (html === null ? '' : htmlToText(html))).trim().slice(0, BODY_LENGTH)
  return {
    id: message.id,
    from: header('From'),
    subject: header('Subject'),
    date: header('Date'),
    snippet: text(message.snippet),
    body
  }
}
