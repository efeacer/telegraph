import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgendaState, Connection, Project, SessionSnapshot } from '@shared/types'

export const COMPANION_ID = 'companion'
const TEXT_LENGTH = 100
const MOST_SESSIONS = 50

/** Written by Telegraph at every start into the companion's folder, where Claude reads it as its instructions. */
export const BRIEFING = `# You are the companion in Telegraph

<!-- Written by Telegraph each time it starts. Changes here are not kept. -->

Telegraph is the terminal the user works in, running agents and shells for
their projects. You are the chat that is always open in it, at the top of
its sidebar. Your job is the user's day: their meetings, their mail, and
how the work in their sessions fits around them.

## What you know

- \`context.md\` in this folder is kept up to date by Telegraph: the time,
  the meetings it knows of, and what each of the user's sessions is doing.
  Read it at the start of every answer that is about the day.
- The \`telegraph\` command reads the user's calendars and mail, whatever
  agent you are. Run \`telegraph help\` to see how. For example:
  \`telegraph meetings\`, \`telegraph mail search from:ada newer_than:7d\`,
  \`telegraph mail read <id>\`. If it says Google is not connected, tell the
  user to press Connections in Telegraph's sidebar.
- If you are Claude, the connectors of the user's Claude account may reach
  more, such as their drive.

## How you work

- Be brief. The user reads you between other things.
- When asked to help with a meeting, look up the invitation, who is coming,
  recent mail with those people or about the subject, and say what the user
  should know or bring. Keep it to what fits on one screen.
- Never send mail, reply to invitations, or create, change or delete
  anything in the calendar or mailbox unless the user asks you to in so many
  words, and say what you are about to do before you do it.
- You do not work in the user's projects. For that they start a session in
  the project.
`

/** Where each agent looks for its instructions: Claude, Codex and others, and Gemini. */
export const BRIEFING_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']

export function writeBriefing(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  for (const name of BRIEFING_FILES) writeFileSync(join(directory, name), BRIEFING)
}

export function companionProject(directory: string): Project {
  return { id: COMPANION_ID, name: 'Companion', path: directory, companion: true }
}

function line(text: unknown): string {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, TEXT_LENGTH) : ''
}

/** What the window says of its sessions comes as plain data, and nothing about it is taken on trust. */
export function checkSnapshot(value: unknown): SessionSnapshot | null {
  const sessions = (value as { sessions?: unknown } | null)?.sessions
  if (!Array.isArray(sessions)) return null
  return {
    sessions: sessions
      .flatMap((session) => {
        const { label, project, status, model } = (session ?? {}) as Record<string, unknown>
        const checked = { label: line(label), project: line(project), status: line(status), model: line(model) || null }
        return checked.label && checked.project && checked.status ? [checked] : []
      })
      .slice(0, MOST_SESSIONS)
  }
}

export function renderContext(options: { now: Date; agenda: AgendaState; snapshot: SessionSnapshot }): string {
  const { now, agenda, snapshot } = options
  const lines = ['# What Telegraph knows', '', `Now: ${now.toString()} (${now.toISOString()})`, '', '## Meetings', '']
  if (agenda.meetings.length > 0) {
    for (const meeting of agenda.meetings) {
      lines.push(`- ${meeting.allDay ? 'All day' : `${meeting.start} to ${meeting.end}`}: ${meeting.title}`)
    }
    if (agenda.readAt) lines.push('', `Read from the calendar at ${agenda.readAt}.`)
  } else {
    lines.push(agenda.reason ? `Telegraph could not read the calendar: ${agenda.reason}` : 'None known.')
  }
  lines.push('', '## Sessions', '')
  if (snapshot.sessions.length === 0) lines.push('No sessions are open.')
  for (const session of snapshot.sessions) {
    lines.push(`- ${session.label} (${session.project}): ${session.status}${session.model ? `, on ${session.model}` : ''}`)
  }
  return `${lines.join('\n')}\n`
}

export function writeContext(directory: string, text: string): void {
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const path = join(directory, 'context.md')
    writeFileSync(`${path}.tmp`, text, { mode: 0o600 })
    renameSync(`${path}.tmp`, path)
  } catch {
    // Written again at the next change.
  }
}

const LISTED = /^(.+?):\s.*\s-\s(✔|✓|✗|!|⚠)/

/** Reads what `claude mcp list` prints. */
export function parseConnections(output: string): Connection[] {
  return output.split('\n').flatMap((text) => {
    const found = LISTED.exec(text.trim())
    if (!found) return []
    const [, label, mark] = found
    const account = label!.startsWith('claude.ai ')
    const name = account ? label!.slice('claude.ai '.length) : label!.split(':').at(-1)!
    return [{ name, account, reachable: mark === '✔' || mark === '✓' }]
  })
}
