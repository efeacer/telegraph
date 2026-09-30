import type { SessionStatus } from './status'

/** What there is to tell the user of a session they are not looking at. */
export type NoticeKind = 'waiting' | 'ended'

/** A notice as the system shows it. */
export interface Notice {
  sessionId: string
  title: string
  body: string
}

const TITLE_LENGTH = 120
const BODY_LENGTH = 300
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/

/**
 * What to tell the user when a session changes, if anything. A session that
 * waits was not being watched, or it would have come to rest instead. One
 * that ends is only worth telling of when nobody saw it end.
 */
export function noticeFor(
  previous: SessionStatus,
  next: SessionStatus,
  watched: boolean
): NoticeKind | null {
  if (previous === next) return null
  if (next === 'attention') return 'waiting'
  if (next === 'exited' && !watched) return 'ended'
  return null
}

export function describeNotice(
  kind: NoticeKind,
  names: { session: string; project: string }
): Omit<Notice, 'sessionId'> {
  return {
    title: names.session,
    body: kind === 'waiting' ? `Waiting for you in ${names.project}` : `Ended in ${names.project}`
  }
}

/** A notice comes from the window as plain data, so nothing about it is taken on trust. */
export function checkNotice(value: unknown): Notice | null {
  if (typeof value !== 'object' || value === null) return null
  const { sessionId, title, body } = value as Record<string, unknown>
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) return null
  const line = (text: unknown, length: number): string =>
    typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, length) : ''
  const checked = { sessionId, title: line(title, TITLE_LENGTH), body: line(body, BODY_LENGTH) }
  return checked.title === '' || checked.body === '' ? null : checked
}
