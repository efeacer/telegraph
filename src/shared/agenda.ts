/** A meeting, as Telegraph keeps it to tell the user of it in time. */
export interface Meeting {
  /** The same for a meeting however often the calendar is read. */
  id: string
  title: string
  /** In UTC. */
  start: string
  end: string
  allDay: boolean
}

export type AgendaReading =
  | { status: 'read'; meetings: Meeting[] }
  /** The agent could not read the calendar, and says why: most often that it has not been signed in to. */
  | { status: 'unavailable'; reason: string }
  | { status: 'unreadable' }

const TITLE_LENGTH = 120
const REASON_LENGTH = 300
const MOST_MEETINGS = 50
export const NUDGE_LEAD_MS = 30 * 60_000

function line(text: unknown, length: number): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, length) : ''
}

function readMeeting(value: unknown): Meeting[] {
  if (typeof value !== 'object' || value === null) return []
  const { title, start, end, allDay } = value as Record<string, unknown>
  const name = line(title, TITLE_LENGTH)
  const from = typeof start === 'string' ? Date.parse(start) : Number.NaN
  const to = typeof end === 'string' ? Date.parse(end) : Number.NaN
  if (name === '' || Number.isNaN(from)) return []
  const startIso = new Date(from).toISOString()
  return [
    {
      id: `${startIso} ${name}`,
      title: name,
      start: startIso,
      end: new Date(Number.isNaN(to) ? from : to).toISOString(),
      allDay: allDay === true
    }
  ]
}

/**
 * Reads what the agent answered when asked for the meetings. The answer is
 * written by a model, and taken for no more than it can be shown to be.
 */
export function parseAgenda(answer: string): AgendaReading {
  const unavailable = /EVENTS:\s*UNAVAILABLE\b(.*)/.exec(answer)
  if (unavailable) {
    return { status: 'unavailable', reason: line(unavailable[1], REASON_LENGTH).replace(/^[-–:\s]+/, '') }
  }
  const listed = /EVENTS:\s*(\[.*\])/s.exec(answer)
  if (!listed) return { status: 'unreadable' }
  let items: unknown
  try {
    items = JSON.parse(listed[1]!)
  } catch {
    return { status: 'unreadable' }
  }
  if (!Array.isArray(items)) return { status: 'unreadable' }
  const meetings = items
    .flatMap(readMeeting)
    .sort((one, other) => one.start.localeCompare(other.start))
    .slice(0, MOST_MEETINGS)
  return { status: 'read', meetings }
}

/** The meetings to tell the user of now: those that start within the lead, once each. */
export function dueNudges(
  meetings: Meeting[],
  now: number,
  told: ReadonlySet<string>,
  lead = NUDGE_LEAD_MS
): Meeting[] {
  return meetings.filter((meeting) => {
    const until = Date.parse(meeting.start) - now
    return !meeting.allDay && until > 0 && until <= lead && !told.has(meeting.id)
  })
}

/** What the companion is asked when the user takes up the offer of help with a meeting. One line: it is sent as one message. */
export function nudgePrompt(meeting: Meeting, when: string): string {
  return line(
    `Help me prepare for “${meeting.title}” ${when}: what it is about, who is coming, and what in my mail or calendar I should know before it.`,
    600
  )
}
